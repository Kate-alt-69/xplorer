use std::{
    env,
    ffi::{c_void, OsStr, OsString},
    fs::{self, File},
    io::{self, BufWriter, Write},
    os::windows::{ffi::{OsStrExt, OsStringExt}, fs::MetadataExt},
    path::{Path, PathBuf},
    ptr::null,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::platform::{self, StopEvent};

type Handle = *mut c_void;

const WAKE_EVENT_NAME: &str = "Local\\Xplorer.IndexWorker.Wake.v1";
const WAIT_OBJECT_0: u32 = 0;
const WAIT_TIMEOUT: u32 = 258;
const WAIT_FAILED: u32 = 0xffff_ffff;
const WORKSPACE_MAGIC: &[u8; 8] = b"XPLWSP01";
const WORKSPACE_VERSION: u32 = 1;
const WORKSPACE_DEPTH: usize = 3;
const MAX_WORKSPACE_RECORDS: u64 = 50_000;
const WORKSPACE_BUDGET_BYTES_PER_SECOND: u64 = 512 * 1024;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
const FILE_ATTRIBUTE_READONLY: u32 = 0x0000_0001;
const FLAG_DIRECTORY: u8 = 1 << 0;
const FLAG_REPARSE_POINT: u8 = 1 << 1;
const FLAG_HIDDEN: u8 = 1 << 2;
const FLAG_SYSTEM: u8 = 1 << 3;
const FLAG_READONLY: u8 = 1 << 4;

static LAST_HINT_STAMP: OnceLock<Mutex<Option<SystemTime>>> = OnceLock::new();

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateEventW(
        event_attributes: *const c_void,
        manual_reset: i32,
        initial_state: i32,
        name: *const u16,
    ) -> Handle;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
}

pub struct WakeEvent(Handle);

impl WakeEvent {
    pub fn create_for_worker() -> io::Result<Self> {
        let name = wide(WAKE_EVENT_NAME);
        // Auto-reset is intentional: one workspace hint only needs one wake-up.
        let handle = unsafe { CreateEventW(null(), 0, 0, name.as_ptr()) };
        if handle.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(handle))
        }
    }

    pub fn wait(&self, timeout: Duration) -> io::Result<bool> {
        let milliseconds = timeout.as_millis().min(u32::MAX as u128) as u32;
        match unsafe { WaitForSingleObject(self.0, milliseconds) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            WAIT_FAILED => Err(io::Error::last_os_error()),
            other => Err(io::Error::other(format!("unexpected workspace wait result {other}"))),
        }
    }
}

impl Drop for WakeEvent {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// Refresh a bounded, metadata-only cache rooted at the directory Xplorer is currently showing.
/// The hint is written atomically by the WinUI process. A timestamp guard makes this cheap to call
/// from both the full-volume crawler and the idle worker loop.
pub fn refresh_hot_workspace(data_dir: &Path, stop_event: Option<&StopEvent>) -> io::Result<bool> {
    let hint_path = data_dir.join("workspace.hint");
    let metadata = match fs::metadata(&hint_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    let stamp = metadata.modified().unwrap_or(UNIX_EPOCH);

    let stamp_lock = LAST_HINT_STAMP.get_or_init(|| Mutex::new(None));
    if stamp_lock.lock().map(|guard| *guard == Some(stamp)).unwrap_or(false) {
        return Ok(false);
    }

    ensure_not_stopped(stop_event)?;
    let text = fs::read_to_string(&hint_path)?;
    let candidate = text.trim();
    if candidate.is_empty() {
        if let Ok(mut guard) = stamp_lock.lock() {
            *guard = Some(stamp);
        }
        return Ok(false);
    }

    let root = PathBuf::from(candidate);
    if !root.is_absolute() || !root.is_dir() {
        if let Ok(mut guard) = stamp_lock.lock() {
            *guard = Some(stamp);
        }
        return Ok(false);
    }

    let result = write_workspace_cache(&root, data_dir, stop_event);
    if result.is_ok() {
        if let Ok(mut guard) = stamp_lock.lock() {
            *guard = Some(stamp);
        }
    }
    result.map(|_| true)
}

fn write_workspace_cache(root: &Path, data_dir: &Path, stop_event: Option<&StopEvent>) -> io::Result<()> {
    ensure_not_stopped(stop_event)?;
    fs::create_dir_all(data_dir)?;
    let temp_path = data_dir.join("workspace.xwidx.tmp");
    let final_path = data_dir.join("workspace.xwidx");
    let file = File::create(&temp_path)?;
    let mut writer = BufWriter::with_capacity(16 * 1024, file);

    let root_units: Vec<u16> = root.as_os_str().encode_wide().collect();
    writer.write_all(WORKSPACE_MAGIC)?;
    writer.write_all(&WORKSPACE_VERSION.to_le_bytes())?;
    writer.write_all(&unix_now().to_le_bytes())?;
    writer.write_all(&(root_units.len() as u32).to_le_bytes())?;
    for unit in &root_units {
        writer.write_all(&unit.to_le_bytes())?;
    }

    let mut budget = PacedBudget::new(WORKSPACE_BUDGET_BYTES_PER_SECOND);
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut records = 0u64;

    while let Some((directory, depth)) = stack.pop() {
        ensure_not_stopped(stop_event)?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries {
            ensure_not_stopped(stop_event)?;
            if records >= MAX_WORKSPACE_RECORDS {
                break;
            }

            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.starts_with(data_dir) {
                continue;
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let relative = match path.strip_prefix(root) {
                Ok(relative) => relative,
                Err(_) => continue,
            };
            let relative_units: Vec<u16> = relative.as_os_str().encode_wide().collect();
            budget.charge(160u64.saturating_add((relative_units.len() as u64).saturating_mul(2)));

            let attributes = metadata.file_attributes();
            let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
            let is_reparse = attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
            let flags = flags_from_attributes(attributes);
            write_record(
                &mut writer,
                flags,
                attributes,
                if is_directory { 0 } else { metadata.len() },
                metadata.last_write_time(),
                &relative_units,
            )?;
            records = records.saturating_add(1);

            if is_directory && !is_reparse && depth < WORKSPACE_DEPTH {
                stack.push((path, depth + 1));
            }
        }

        if records >= MAX_WORKSPACE_RECORDS {
            break;
        }
    }

    ensure_not_stopped(stop_event)?;
    writer.flush()?;
    writer.get_ref().sync_data()?;
    drop(writer);
    platform::replace_file(&temp_path, &final_path)?;
    Ok(())
}

fn flags_from_attributes(attributes: u32) -> u8 {
    let mut flags = 0u8;
    if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 { flags |= FLAG_DIRECTORY; }
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 { flags |= FLAG_REPARSE_POINT; }
    if attributes & FILE_ATTRIBUTE_HIDDEN != 0 { flags |= FLAG_HIDDEN; }
    if attributes & FILE_ATTRIBUTE_SYSTEM != 0 { flags |= FLAG_SYSTEM; }
    if attributes & FILE_ATTRIBUTE_READONLY != 0 { flags |= FLAG_READONLY; }
    flags
}

fn write_record(
    writer: &mut BufWriter<File>,
    flags: u8,
    attributes: u32,
    size: u64,
    last_write_filetime: u64,
    path_units: &[u16],
) -> io::Result<()> {
    let path_bytes = (path_units.len() as u32).saturating_mul(2);
    let record_length = 32u32.saturating_add(path_bytes);
    writer.write_all(&record_length.to_le_bytes())?;
    writer.write_all(&[flags, 0, 0, 0])?;
    writer.write_all(&attributes.to_le_bytes())?;
    writer.write_all(&size.to_le_bytes())?;
    writer.write_all(&last_write_filetime.to_le_bytes())?;
    writer.write_all(&(path_units.len() as u32).to_le_bytes())?;
    for unit in path_units {
        writer.write_all(&unit.to_le_bytes())?;
    }
    Ok(())
}

fn ensure_not_stopped(stop_event: Option<&StopEvent>) -> io::Result<()> {
    if let Some(event) = stop_event {
        if event.wait(Duration::ZERO)? {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "Xplorer workspace scan was stopped"));
        }
    }
    Ok(())
}

struct PacedBudget {
    bytes_per_second: u64,
    charged_bytes: u128,
    started: Instant,
}

impl PacedBudget {
    fn new(bytes_per_second: u64) -> Self {
        Self {
            bytes_per_second: bytes_per_second.max(1),
            charged_bytes: 0,
            started: Instant::now(),
        }
    }

    fn charge(&mut self, estimated_bytes: u64) {
        self.charged_bytes = self.charged_bytes.saturating_add(estimated_bytes as u128);
        let target_nanos = self.charged_bytes.saturating_mul(1_000_000_000) / self.bytes_per_second as u128;
        let target = Duration::from_nanos(target_nanos.min(u64::MAX as u128) as u64);
        let elapsed = self.started.elapsed();
        if target > elapsed {
            thread::sleep(target - elapsed);
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[allow(dead_code)]
fn _decode_wide(units: &[u16]) -> PathBuf {
    PathBuf::from(OsString::from_wide(units))
}

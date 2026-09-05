use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    os::windows::{ffi::{OsStrExt, OsStringExt}, fs::MetadataExt},
    path::{Component, Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::{platform, workspace};

const SNAPSHOT_MAGIC: &[u8; 8] = b"XPLIDX01";
const SNAPSHOT_VERSION: u32 = 2;
const SNAPSHOT_HEADER_SIZE: u64 = 24;
const RESUME_MAGIC: &[u8; 8] = b"XPLRSM01";
const RESUME_VERSION: u32 = 1;
const RESUME_CHECKPOINT_DIRECTORY_INTERVAL: u64 = 32;
const MAX_RESUME_DIRECTORIES: usize = 1_000_000;
const MAX_RESUME_PATH_UNITS: usize = 32_768;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_READONLY: u32 = 0x0000_0001;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
const FLAG_DIRECTORY: u8 = 1 << 0;
const FLAG_REPARSE_POINT: u8 = 1 << 1;
const FLAG_HIDDEN: u8 = 1 << 2;
const FLAG_SYSTEM: u8 = 1 << 3;
const FLAG_READONLY: u8 = 1 << 4;
const MAX_RECURSION_DEPTH: usize = 256;

pub const DIRECTORY_BUDGET_BYTES_PER_SECOND: u64 = 24 * 1024;
pub const METADATA_BUDGET_BYTES_PER_SECOND: u64 = 488 * 1024;

#[derive(Clone, Copy, Debug, Default)]
pub struct ScanStats {
    pub records: u64,
    pub inaccessible: u64,
}

struct ResumeScan {
    writer: BufWriter<File>,
    pending: Vec<PathBuf>,
}

pub fn snapshot_path(data_dir: &Path, drive: u8) -> PathBuf {
    data_dir.join(format!("{}.xidx", drive as char))
}

fn temp_snapshot_path(data_dir: &Path, drive: u8) -> PathBuf {
    data_dir.join(format!("{}.xidx.tmp", drive as char))
}

fn resume_path(data_dir: &Path, drive: u8) -> PathBuf {
    data_dir.join(format!("{}.xresume", drive as char))
}

pub fn snapshot_is_current(data_dir: &Path, drive: u8) -> bool {
    let mut file = match File::open(snapshot_path(data_dir, drive)) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut header = [0u8; 12];
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    header[..8] == SNAPSHOT_MAGIC[..]
        && u32::from_le_bytes(header[8..12].try_into().unwrap()) == SNAPSHOT_VERSION
}

/// Build the immutable volume snapshot. An interrupted crawl keeps a bounded checkpoint containing
/// the DFS frontier plus the valid byte offset in C.xidx.tmp. On the next worker start we truncate
/// back to that checkpoint and continue from the unfinished directory instead of restarting at C:\.
pub fn scan_volume(
    drive: u8,
    data_dir: &Path,
    stop_event: Option<&platform::StopEvent>,
) -> io::Result<ScanStats> {
    ensure_not_stopped(stop_event)?;
    fs::create_dir_all(data_dir)?;

    let root = PathBuf::from(format!("{}:{}", drive as char, std::path::MAIN_SEPARATOR));
    let final_path = snapshot_path(data_dir, drive);
    let temp_path = temp_snapshot_path(data_dir, drive);
    let resume_file = resume_path(data_dir, drive);

    let ResumeScan {
        mut writer,
        mut pending,
    } = match try_resume_scan(drive, &root, &temp_path, &resume_file) {
        Ok(Some(resume)) => resume,
        Ok(None) => start_new_scan(drive, &root, &temp_path, &resume_file)?,
        Err(_) => {
            // A malformed/stale checkpoint must never poison future worker startups.
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_file(&resume_file);
            start_new_scan(drive, &root, &temp_path, &resume_file)?
        }
    };

    let mut directory_budget = PacedBudget::new(DIRECTORY_BUDGET_BYTES_PER_SECOND);
    let mut metadata_budget = PacedBudget::new(METADATA_BUDGET_BYTES_PER_SECOND);
    let mut stats = ScanStats::default();
    let mut directories_since_checkpoint = RESUME_CHECKPOINT_DIRECTORY_INTERVAL;

    let scan_result: io::Result<()> = (|| {
        // Give the actively viewed workspace first claim on the low-rate worker even while the
        // first full-volume snapshot is still crawling for hours.
        let _ = workspace::refresh_hot_workspace(data_dir, stop_event);

        while let Some(directory) = pending.pop() {
            ensure_not_stopped(stop_event)?;

            if directories_since_checkpoint >= RESUME_CHECKPOINT_DIRECTORY_INTERVAL {
                writer.flush()?;
                let checkpoint_offset = writer.stream_position()?;
                save_resume_checkpoint(
                    drive,
                    &root,
                    &resume_file,
                    checkpoint_offset,
                    &pending,
                    &directory,
                )?;
                directories_since_checkpoint = 0;
            }

            scan_one_directory(
                &root,
                &directory,
                data_dir,
                &mut pending,
                &mut writer,
                &mut directory_budget,
                &mut metadata_budget,
                &mut stats,
                stop_event,
            )?;
            directories_since_checkpoint = directories_since_checkpoint.saturating_add(1);
        }
        Ok(())
    })();

    if let Err(error) = scan_result {
        // The checkpoint points to a fully flushed boundary *before* the current checkpoint block.
        // Keep temp + resume on an intentional stop so the next startup can continue. For ordinary
        // I/O/corruption failures, discard them and let the next pass start cleanly.
        drop(writer);
        if error.kind() != io::ErrorKind::Interrupted {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_file(&resume_file);
        }
        return Err(error);
    }

    ensure_not_stopped(stop_event)?;
    writer.flush()?;
    writer.get_ref().sync_data()?;
    drop(writer);
    ensure_not_stopped(stop_event)?;
    platform::replace_file(&temp_path, &final_path)?;
    let _ = fs::remove_file(&resume_file);
    Ok(stats)
}

fn start_new_scan(
    drive: u8,
    root: &Path,
    temp_path: &Path,
    resume_file: &Path,
) -> io::Result<ResumeScan> {
    let _ = fs::remove_file(temp_path);
    let _ = fs::remove_file(resume_file);

    let file = File::create(temp_path)?;
    let mut writer = BufWriter::with_capacity(16 * 1024, file);
    write_snapshot_header(&mut writer, drive)?;
    writer.flush()?;
    writer.get_ref().sync_data()?;

    Ok(ResumeScan {
        writer,
        pending: vec![root.to_path_buf()],
    })
}

fn try_resume_scan(
    drive: u8,
    root: &Path,
    temp_path: &Path,
    resume_file: &Path,
) -> io::Result<Option<ResumeScan>> {
    if !temp_path.is_file() || !resume_file.is_file() {
        return Ok(None);
    }

    let mut reader = BufReader::new(File::open(resume_file)?);
    let mut magic = [0u8; 8];
    reader.read_exact(&mut magic)?;
    if magic != *RESUME_MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid index resume magic"));
    }
    let version = read_u32(&mut reader)?;
    if version != RESUME_VERSION {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "unsupported index resume version"));
    }
    let stored_drive = read_u16(&mut reader)? as u8;
    let _reserved = read_u16(&mut reader)?;
    if stored_drive.to_ascii_uppercase() != drive.to_ascii_uppercase() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "index resume drive mismatch"));
    }
    let checkpoint_offset = read_u64(&mut reader)?;
    let count = read_u32(&mut reader)? as usize;
    if checkpoint_offset < SNAPSHOT_HEADER_SIZE || count == 0 || count > MAX_RESUME_DIRECTORIES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid index resume checkpoint"));
    }

    let mut pending = Vec::with_capacity(count.min(4096));
    for _ in 0..count {
        let units = read_u32(&mut reader)? as usize;
        if units > MAX_RESUME_PATH_UNITS {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "index resume path is too long"));
        }
        let mut wide = Vec::with_capacity(units);
        for _ in 0..units {
            wide.push(read_u16(&mut reader)?);
        }
        let relative = PathBuf::from(OsString::from_wide(&wide));
        if !is_safe_relative_resume_path(&relative) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "unsafe index resume path"));
        }
        pending.push(if relative.as_os_str().is_empty() {
            root.to_path_buf()
        } else {
            root.join(relative)
        });
    }

    let mut file = OpenOptions::new().read(true).write(true).open(temp_path)?;
    validate_snapshot_header(&mut file, drive)?;
    let file_len = file.metadata()?.len();
    if checkpoint_offset > file_len {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "resume offset exceeds temp snapshot"));
    }
    file.set_len(checkpoint_offset)?;
    file.seek(SeekFrom::Start(checkpoint_offset))?;

    Ok(Some(ResumeScan {
        writer: BufWriter::with_capacity(16 * 1024, file),
        pending,
    }))
}

fn save_resume_checkpoint(
    drive: u8,
    root: &Path,
    resume_file: &Path,
    checkpoint_offset: u64,
    pending: &[PathBuf],
    current: &Path,
) -> io::Result<()> {
    let temp = resume_file.with_extension("xresume.tmp");
    let file = File::create(&temp)?;
    let mut writer = BufWriter::with_capacity(8 * 1024, file);
    writer.write_all(RESUME_MAGIC)?;
    writer.write_all(&RESUME_VERSION.to_le_bytes())?;
    writer.write_all(&(drive as u16).to_le_bytes())?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&checkpoint_offset.to_le_bytes())?;

    let count = pending.len().saturating_add(1);
    if count > MAX_RESUME_DIRECTORIES || count > u32::MAX as usize {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "index resume frontier is too large"));
    }
    writer.write_all(&(count as u32).to_le_bytes())?;

    for path in pending.iter().chain(std::iter::once(current)) {
        let relative = path.strip_prefix(root).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "resume directory escaped volume root")
        })?;
        let units: Vec<u16> = relative.as_os_str().encode_wide().collect();
        if units.len() > MAX_RESUME_PATH_UNITS {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "resume directory path is too long"));
        }
        writer.write_all(&(units.len() as u32).to_le_bytes())?;
        for unit in units {
            writer.write_all(&unit.to_le_bytes())?;
        }
    }

    writer.flush()?;
    writer.get_ref().sync_data()?;
    drop(writer);
    platform::replace_file(&temp, resume_file)
}

#[allow(clippy::too_many_arguments)]
fn scan_one_directory(
    root: &Path,
    directory: &Path,
    excluded_data_dir: &Path,
    pending: &mut Vec<PathBuf>,
    writer: &mut BufWriter<File>,
    directory_budget: &mut PacedBudget,
    metadata_budget: &mut PacedBudget,
    stats: &mut ScanStats,
    stop_event: Option<&platform::StopEvent>,
) -> io::Result<()> {
    ensure_not_stopped(stop_event)?;

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            stats.inaccessible = stats.inaccessible.saturating_add(1);
            return Ok(());
        }
    };

    let directory_depth = directory
        .strip_prefix(root)
        .map(|relative| relative.components().count())
        .unwrap_or(MAX_RECURSION_DEPTH + 1);

    for entry in entries {
        ensure_not_stopped(stop_event)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.inaccessible = stats.inaccessible.saturating_add(1);
                continue;
            }
        };

        let path = entry.path();
        if path.starts_with(excluded_data_dir) {
            continue;
        }

        let name_units = entry.file_name().encode_wide().count() as u64;
        directory_budget.charge(96u64.saturating_add(name_units.saturating_mul(2)));
        ensure_not_stopped(stop_event)?;

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.inaccessible = stats.inaccessible.saturating_add(1);
                continue;
            }
        };

        let relative = path.strip_prefix(root).unwrap_or(&path);
        let relative_units: Vec<u16> = relative.as_os_str().encode_wide().collect();
        metadata_budget.charge(
            128u64.saturating_add((relative_units.len() as u64).saturating_mul(2)),
        );
        ensure_not_stopped(stop_event)?;

        let attributes = metadata.file_attributes();
        let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        let is_reparse_point = attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
        let mut flags = 0u8;
        if is_directory { flags |= FLAG_DIRECTORY; }
        if is_reparse_point { flags |= FLAG_REPARSE_POINT; }
        if attributes & FILE_ATTRIBUTE_HIDDEN != 0 { flags |= FLAG_HIDDEN; }
        if attributes & FILE_ATTRIBUTE_SYSTEM != 0 { flags |= FLAG_SYSTEM; }
        if attributes & FILE_ATTRIBUTE_READONLY != 0 { flags |= FLAG_READONLY; }

        write_record(
            writer,
            flags,
            attributes,
            if is_directory { 0 } else { metadata.len() },
            metadata.last_write_time(),
            &relative_units,
        )?;
        stats.records = stats.records.saturating_add(1);

        if stats.records & 0x3f == 0 {
            // Only the active Xplorer workspace is checked here. Unrelated system USN traffic keeps
            // waiting for the normal reconciliation window, so this does not turn into a hot poll.
            let _ = workspace::refresh_hot_workspace(excluded_data_dir, stop_event);
        }

        if is_directory && !is_reparse_point && directory_depth < MAX_RECURSION_DEPTH {
            pending.push(path);
        }
    }

    Ok(())
}

fn write_snapshot_header(writer: &mut BufWriter<File>, drive: u8) -> io::Result<()> {
    writer.write_all(SNAPSHOT_MAGIC)?;
    writer.write_all(&SNAPSHOT_VERSION.to_le_bytes())?;
    writer.write_all(&(drive as u16).to_le_bytes())?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&unix_now().to_le_bytes())?;
    Ok(())
}

fn validate_snapshot_header(file: &mut File, drive: u8) -> io::Result<()> {
    file.seek(SeekFrom::Start(0))?;
    let mut header = [0u8; SNAPSHOT_HEADER_SIZE as usize];
    file.read_exact(&mut header)?;
    if header[..8] != SNAPSHOT_MAGIC[..]
        || u32::from_le_bytes(header[8..12].try_into().unwrap()) != SNAPSHOT_VERSION
        || u16::from_le_bytes(header[12..14].try_into().unwrap()) as u8 != drive
    {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "temp snapshot header mismatch"));
    }
    Ok(())
}

fn is_safe_relative_resume_path(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    path.components().all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn ensure_not_stopped(stop_event: Option<&platform::StopEvent>) -> io::Result<()> {
    if let Some(event) = stop_event {
        if event.wait(Duration::ZERO)? {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "Xplorer index scan was stopped",
            ));
        }
    }
    Ok(())
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

fn read_u16(reader: &mut impl Read) -> io::Result<u16> {
    let mut bytes = [0u8; 2];
    reader.read_exact(&mut bytes)?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32(reader: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(reader: &mut impl Read) -> io::Result<u64> {
    let mut bytes = [0u8; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
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
        let target_nanos = self
            .charged_bytes
            .saturating_mul(1_000_000_000)
            / self.bytes_per_second as u128;
        let target = Duration::from_nanos(target_nanos.min(u64::MAX as u128) as u64);
        let elapsed = self.started.elapsed();
        if target > elapsed {
            thread::sleep(target - elapsed);
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

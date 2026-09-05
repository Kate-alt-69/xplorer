use std::{
    fs::{self, File},
    io::{self, BufWriter, Read, Write},
    os::windows::{ffi::OsStrExt, fs::MetadataExt},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::platform;

const SNAPSHOT_MAGIC: &[u8; 8] = b"XPLIDX01";
const SNAPSHOT_VERSION: u32 = 2;
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

pub fn snapshot_path(data_dir: &Path, drive: u8) -> PathBuf {
    data_dir.join(format!("{}.xidx", drive as char))
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

pub fn scan_volume(
    drive: u8,
    data_dir: &Path,
    stop_event: Option<&platform::StopEvent>,
) -> io::Result<ScanStats> {
    ensure_not_stopped(stop_event)?;

    let root = PathBuf::from(format!("{}:{}", drive as char, std::path::MAIN_SEPARATOR));
    let final_path = snapshot_path(data_dir, drive);
    let temp_path = data_dir.join(format!("{}.xidx.tmp", drive as char));
    let file = File::create(&temp_path)?;
    let mut writer = BufWriter::with_capacity(16 * 1024, file);

    writer.write_all(SNAPSHOT_MAGIC)?;
    writer.write_all(&SNAPSHOT_VERSION.to_le_bytes())?;
    writer.write_all(&(drive as u16).to_le_bytes())?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&unix_now().to_le_bytes())?;

    let mut directory_budget = PacedBudget::new(DIRECTORY_BUDGET_BYTES_PER_SECOND);
    let mut metadata_budget = PacedBudget::new(METADATA_BUDGET_BYTES_PER_SECOND);
    let mut stats = ScanStats::default();

    let walk_result = walk_directory(
        &root,
        &root,
        data_dir,
        &mut writer,
        &mut directory_budget,
        &mut metadata_budget,
        &mut stats,
        0,
        stop_event,
    );

    if let Err(error) = walk_result {
        drop(writer);
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    ensure_not_stopped(stop_event)?;
    writer.flush()?;
    writer.get_ref().sync_data()?;
    drop(writer);
    ensure_not_stopped(stop_event)?;
    platform::replace_file(&temp_path, &final_path)?;
    Ok(stats)
}

#[allow(clippy::too_many_arguments)]
fn walk_directory(
    root: &Path,
    directory: &Path,
    excluded_data_dir: &Path,
    writer: &mut BufWriter<File>,
    directory_budget: &mut PacedBudget,
    metadata_budget: &mut PacedBudget,
    stats: &mut ScanStats,
    depth: usize,
    stop_event: Option<&platform::StopEvent>,
) -> io::Result<()> {
    ensure_not_stopped(stop_event)?;
    if depth > MAX_RECURSION_DEPTH {
        return Ok(());
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            stats.inaccessible = stats.inaccessible.saturating_add(1);
            return Ok(());
        }
    };

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
        if is_directory {
            flags |= FLAG_DIRECTORY;
        }
        if is_reparse_point {
            flags |= FLAG_REPARSE_POINT;
        }
        if attributes & FILE_ATTRIBUTE_HIDDEN != 0 {
            flags |= FLAG_HIDDEN;
        }
        if attributes & FILE_ATTRIBUTE_SYSTEM != 0 {
            flags |= FLAG_SYSTEM;
        }
        if attributes & FILE_ATTRIBUTE_READONLY != 0 {
            flags |= FLAG_READONLY;
        }

        write_record(
            writer,
            flags,
            attributes,
            if is_directory { 0 } else { metadata.len() },
            metadata.last_write_time(),
            &relative_units,
        )?;
        stats.records = stats.records.saturating_add(1);

        if is_directory && !is_reparse_point {
            walk_directory(
                root,
                &path,
                excluded_data_dir,
                writer,
                directory_budget,
                metadata_budget,
                stats,
                depth + 1,
                stop_event,
            )?;
        }
    }

    Ok(())
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
    // Fixed fields total 32 bytes including RecordLength and PathLength.
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

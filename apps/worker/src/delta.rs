use std::{
    collections::VecDeque,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Write},
    os::windows::{ffi::{OsStrExt, OsStringExt}, fs::MetadataExt},
    path::{Path, PathBuf},
};

use crate::usn::{FileIdResolver, UsnChange};

const DELTA_MAGIC: &[u8; 8] = b"XPLDLT01";
const DELTA_VERSION: u32 = 1;
const DELTA_KIND_UPSERT: u8 = 1;
const DELTA_KIND_DELETE: u8 = 2;
const FILE_ATTRIBUTE_READONLY: u32 = 0x0000_0001;
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
const FLAG_DIRECTORY: u8 = 1 << 0;
const FLAG_REPARSE_POINT: u8 = 1 << 1;
const FLAG_HIDDEN: u8 = 1 << 2;
const FLAG_SYSTEM: u8 = 1 << 3;
const FLAG_READONLY: u8 = 1 << 4;
const USN_REASON_FILE_DELETE: u32 = 0x0000_0200;
const USN_REASON_RENAME_OLD_NAME: u32 = 0x0000_1000;
const USN_REASON_RENAME_NEW_NAME: u32 = 0x0000_2000;
const USN_REASON_HARD_LINK_CHANGE: u32 = 0x0001_0000;
const USN_REASON_CLOSE: u32 = 0x8000_0000;
const PARENT_CACHE_CAPACITY: usize = 64;

#[derive(Debug, Default)]
pub struct DeltaApplyResult {
    pub records: usize,
    pub requires_full_scan: bool,
}

struct PreparedEvent {
    kind: u8,
    flags: u8,
    attributes: u32,
    size: u64,
    last_write_time: u64,
    usn: i64,
    relative_path: Vec<u16>,
}

pub fn delta_path(data_dir: &Path, drive: u8) -> PathBuf {
    data_dir.join(format!("{}.xdelta", drive as char))
}

pub fn delta_size(data_dir: &Path, drive: u8) -> u64 {
    fs::metadata(delta_path(data_dir, drive))
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

pub fn clear(data_dir: &Path, drive: u8) -> io::Result<()> {
    match fs::remove_file(delta_path(data_dir, drive)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn apply_changes(
    drive: u8,
    data_dir: &Path,
    changes: &[UsnChange],
) -> io::Result<DeltaApplyResult> {
    if changes.is_empty() {
        return Ok(DeltaApplyResult::default());
    }

    let root = PathBuf::from(format!("{}:{}", drive as char, std::path::MAIN_SEPARATOR));
    let resolver = FileIdResolver::open(drive)?;
    let mut parent_cache: VecDeque<(u64, PathBuf)> = VecDeque::with_capacity(PARENT_CACHE_CAPACITY);
    let mut prepared = Vec::with_capacity(changes.len());

    for change in changes {
        let meaningful_reason = change.reason & !USN_REASON_CLOSE;
        if meaningful_reason == 0 {
            continue;
        }

        let is_directory = change.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        let structural_directory_change = meaningful_reason
            & (USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME | USN_REASON_RENAME_NEW_NAME)
            != 0;
        if (is_directory && structural_directory_change)
            || meaningful_reason & USN_REASON_HARD_LINK_CHANGE != 0
        {
            return Ok(DeltaApplyResult {
                records: 0,
                requires_full_scan: true,
            });
        }

        let parent = resolve_parent(
            &resolver,
            &mut parent_cache,
            change.parent_file_reference_number,
        )?;
        let path = parent.join(OsString::from_wide(&change.file_name));
        let relative = match path.strip_prefix(&root) {
            Ok(relative) => relative,
            Err(_) => {
                return Ok(DeltaApplyResult {
                    records: 0,
                    requires_full_scan: true,
                });
            }
        };
        let relative_path: Vec<u16> = relative.as_os_str().encode_wide().collect();

        if meaningful_reason & (USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME) != 0 {
            prepared.push(PreparedEvent {
                kind: DELTA_KIND_DELETE,
                flags: 0,
                attributes: 0,
                size: 0,
                last_write_time: 0,
                usn: change.usn,
                relative_path,
            });
            continue;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                prepared.push(PreparedEvent {
                    kind: DELTA_KIND_DELETE,
                    flags: 0,
                    attributes: 0,
                    size: 0,
                    last_write_time: 0,
                    usn: change.usn,
                    relative_path,
                });
                continue;
            }
            Err(_) => {
                return Ok(DeltaApplyResult {
                    records: 0,
                    requires_full_scan: true,
                });
            }
        };

        let attributes = metadata.file_attributes();
        prepared.push(PreparedEvent {
            kind: DELTA_KIND_UPSERT,
            flags: flags_from_attributes(attributes),
            attributes,
            size: if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                0
            } else {
                metadata.len()
            },
            last_write_time: metadata.last_write_time(),
            usn: change.usn,
            relative_path,
        });
    }

    if prepared.is_empty() {
        return Ok(DeltaApplyResult::default());
    }

    let path = delta_path(data_dir, drive);
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(&path)?;
    let is_new = file.metadata()?.len() == 0;
    let mut writer = BufWriter::with_capacity(32 * 1024, file);
    if is_new {
        writer.write_all(DELTA_MAGIC)?;
        writer.write_all(&DELTA_VERSION.to_le_bytes())?;
        writer.write_all(&(drive as u16).to_le_bytes())?;
        writer.write_all(&0u16.to_le_bytes())?;
    }

    for event in &prepared {
        write_event(&mut writer, event)?;
    }
    writer.flush()?;
    writer.get_ref().sync_data()?;

    Ok(DeltaApplyResult {
        records: prepared.len(),
        requires_full_scan: false,
    })
}

fn resolve_parent(
    resolver: &FileIdResolver,
    cache: &mut VecDeque<(u64, PathBuf)>,
    parent_file_reference_number: u64,
) -> io::Result<PathBuf> {
    if let Some((_, path)) = cache
        .iter()
        .find(|(file_id, _)| *file_id == parent_file_reference_number)
    {
        return Ok(path.clone());
    }

    let path = resolver.resolve(parent_file_reference_number)?;
    if cache.len() == PARENT_CACHE_CAPACITY {
        cache.pop_front();
    }
    cache.push_back((parent_file_reference_number, path.clone()));
    Ok(path)
}

fn flags_from_attributes(attributes: u32) -> u8 {
    let mut flags = 0u8;
    if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        flags |= FLAG_DIRECTORY;
    }
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
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
    flags
}

fn write_event(writer: &mut BufWriter<File>, event: &PreparedEvent) -> io::Result<()> {
    let path_bytes = (event.relative_path.len() as u32).saturating_mul(2);
    let record_length = 40u32.saturating_add(path_bytes);

    writer.write_all(&record_length.to_le_bytes())?;
    writer.write_all(&[event.kind, event.flags])?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&event.attributes.to_le_bytes())?;
    writer.write_all(&event.size.to_le_bytes())?;
    writer.write_all(&event.last_write_time.to_le_bytes())?;
    writer.write_all(&event.usn.to_le_bytes())?;
    writer.write_all(&(event.relative_path.len() as u32).to_le_bytes())?;
    for unit in &event.relative_path {
        writer.write_all(&unit.to_le_bytes())?;
    }
    Ok(())
}

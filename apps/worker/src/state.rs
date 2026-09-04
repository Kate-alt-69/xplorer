use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

use crate::platform;

const CURSOR_MAGIC: &[u8; 8] = b"XPLCUR01";
const CURSOR_VERSION: u32 = 1;
const RECORD_SIZE: usize = 36;

#[derive(Clone, Copy, Debug, Default)]
pub struct VolumeCursor {
    pub drive: u8,
    pub journal_supported: bool,
    pub journal_id: u64,
    pub next_usn: i64,
    pub last_scan_unix: u64,
    pub last_seen_unix: u64,
}

#[derive(Debug, Default)]
pub struct CursorState {
    volumes: Vec<VolumeCursor>,
}

impl CursorState {
    pub fn load(path: &Path) -> io::Result<Self> {
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        if bytes.len() < 16 || &bytes[..8] != CURSOR_MAGIC {
            return Ok(Self::default());
        }

        let version = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        if version != CURSOR_VERSION {
            return Ok(Self::default());
        }

        let count = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        if bytes.len() != 16usize.saturating_add(count.saturating_mul(RECORD_SIZE)) {
            return Ok(Self::default());
        }

        let mut volumes = Vec::with_capacity(count.min(26));
        let mut offset = 16usize;
        for _ in 0..count.min(26) {
            let record = &bytes[offset..offset + RECORD_SIZE];
            let drive = record[0];
            let journal_supported = record[1] & 1 != 0;
            let journal_id = u64::from_le_bytes(record[4..12].try_into().unwrap());
            let next_usn = i64::from_le_bytes(record[12..20].try_into().unwrap());
            let last_scan_unix = u64::from_le_bytes(record[20..28].try_into().unwrap());
            let last_seen_unix = u64::from_le_bytes(record[28..36].try_into().unwrap());
            volumes.push(VolumeCursor {
                drive,
                journal_supported,
                journal_id,
                next_usn,
                last_scan_unix,
                last_seen_unix,
            });
            offset += RECORD_SIZE;
        }

        Ok(Self { volumes })
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "cursor path has no parent")
        })?;
        fs::create_dir_all(parent)?;
        let temp_path = parent.join("cursor.bin.tmp");
        let mut file = File::create(&temp_path)?;

        file.write_all(CURSOR_MAGIC)?;
        file.write_all(&CURSOR_VERSION.to_le_bytes())?;
        file.write_all(&(self.volumes.len() as u32).to_le_bytes())?;
        for cursor in &self.volumes {
            file.write_all(&[
                cursor.drive,
                u8::from(cursor.journal_supported),
                0,
                0,
            ])?;
            file.write_all(&cursor.journal_id.to_le_bytes())?;
            file.write_all(&cursor.next_usn.to_le_bytes())?;
            file.write_all(&cursor.last_scan_unix.to_le_bytes())?;
            file.write_all(&cursor.last_seen_unix.to_le_bytes())?;
        }
        file.sync_data()?;
        drop(file);
        platform::replace_file(&temp_path, path)
    }

    pub fn get(&self, drive: u8) -> Option<VolumeCursor> {
        self.volumes.iter().copied().find(|cursor| cursor.drive == drive)
    }

    pub fn upsert(&mut self, cursor: VolumeCursor) {
        if let Some(existing) = self.volumes.iter_mut().find(|entry| entry.drive == cursor.drive) {
            *existing = cursor;
            return;
        }

        if self.volumes.len() < 26 {
            self.volumes.push(cursor);
            self.volumes.sort_unstable_by_key(|entry| entry.drive);
        }
    }
}

use std::{
    ffi::{c_void, OsStr, OsString},
    io,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::PathBuf,
    ptr::{null, null_mut},
};

type Handle = *mut c_void;

const GENERIC_READ: u32 = 0x8000_0000;
const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const FILE_SHARE_DELETE: u32 = 0x0000_0004;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
const FSCTL_READ_USN_JOURNAL: u32 = 0x0009_00bb;
const USN_RECORD_V2_MIN_SIZE: usize = 60;
const READ_BUFFER_SIZE: usize = 64 * 1024;
const FILE_ID_TYPE: u32 = 0;

#[repr(C)]
struct ReadUsnJournalDataV0 {
    start_usn: i64,
    reason_mask: u32,
    return_only_on_close: u32,
    timeout: u64,
    bytes_to_wait_for: u64,
    usn_journal_id: u64,
}

#[repr(C, align(8))]
struct FileIdDescriptor {
    size: u32,
    id_type: u32,
    identifier: [u8; 16],
}

#[derive(Debug)]
pub struct UsnChange {
    pub file_reference_number: u64,
    pub parent_file_reference_number: u64,
    pub usn: i64,
    pub reason: u32,
    pub file_attributes: u32,
    pub file_name: Vec<u16>,
}

#[derive(Debug)]
pub struct UsnBatch {
    pub changes: Vec<UsnChange>,
    pub next_usn: i64,
    pub complete: bool,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *const c_void,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: Handle,
    ) -> Handle;
    fn DeviceIoControl(
        device: Handle,
        io_control_code: u32,
        in_buffer: *mut c_void,
        in_buffer_size: u32,
        out_buffer: *mut c_void,
        out_buffer_size: u32,
        bytes_returned: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn OpenFileById(
        volume_hint: Handle,
        file_id: *const FileIdDescriptor,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *const c_void,
        flags_and_attributes: u32,
    ) -> Handle;
    fn GetFinalPathNameByHandleW(
        file: Handle,
        path: *mut u16,
        path_capacity: u32,
        flags: u32,
    ) -> u32;
    fn CloseHandle(handle: Handle) -> i32;
}

struct OwnedHandle(Handle);

impl OwnedHandle {
    fn open_volume(drive: u8) -> io::Result<Self> {
        let volume = wide(&format!("\\\\.\\{}:", drive as char));
        let handle = unsafe {
            CreateFileW(
                volume.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if handle == invalid_handle() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(handle))
        }
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct FileIdResolver {
    volume: OwnedHandle,
}

impl FileIdResolver {
    pub fn open(drive: u8) -> io::Result<Self> {
        Ok(Self {
            volume: OwnedHandle::open_volume(drive)?,
        })
    }

    pub fn resolve(&self, file_reference_number: u64) -> io::Result<PathBuf> {
        let mut descriptor = FileIdDescriptor {
            size: size_of::<FileIdDescriptor>() as u32,
            id_type: FILE_ID_TYPE,
            identifier: [0; 16],
        };
        descriptor.identifier[..8].copy_from_slice(&file_reference_number.to_le_bytes());

        let handle = unsafe {
            OpenFileById(
                self.volume.0,
                &descriptor,
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                FILE_FLAG_BACKUP_SEMANTICS,
            )
        };
        if handle == invalid_handle() {
            return Err(io::Error::last_os_error());
        }
        let file = OwnedHandle(handle);

        let mut buffer = vec![0u16; 512];
        let mut length = unsafe {
            GetFinalPathNameByHandleW(file.0, buffer.as_mut_ptr(), buffer.len() as u32, 0)
        };
        if length == 0 {
            return Err(io::Error::last_os_error());
        }

        if length as usize >= buffer.len() {
            buffer.resize(length as usize + 1, 0);
            length = unsafe {
                GetFinalPathNameByHandleW(file.0, buffer.as_mut_ptr(), buffer.len() as u32, 0)
            };
            if length == 0 || length as usize >= buffer.len() {
                return Err(io::Error::last_os_error());
            }
        }

        let units = &buffer[..length as usize];
        let units = if units.starts_with(&[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]) {
            &units[4..]
        } else {
            units
        };
        Ok(PathBuf::from(OsString::from_wide(units)))
    }
}

pub fn read_changes(
    drive: u8,
    start_usn: i64,
    target_usn: i64,
    journal_id: u64,
    max_records: usize,
) -> io::Result<UsnBatch> {
    if start_usn >= target_usn {
        return Ok(UsnBatch {
            changes: Vec::new(),
            next_usn: start_usn,
            complete: true,
        });
    }

    let volume = OwnedHandle::open_volume(drive)?;
    let mut cursor = start_usn;
    let mut changes = Vec::with_capacity(max_records.min(256));
    let mut buffer = vec![0u8; READ_BUFFER_SIZE];
    let mut complete = true;

    while cursor < target_usn {
        let mut request = ReadUsnJournalDataV0 {
            start_usn: cursor,
            reason_mask: u32::MAX,
            return_only_on_close: 0,
            timeout: 0,
            bytes_to_wait_for: 0,
            usn_journal_id: journal_id,
        };
        let mut bytes_returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                volume.0,
                FSCTL_READ_USN_JOURNAL,
                (&mut request as *mut ReadUsnJournalDataV0).cast::<c_void>(),
                size_of::<ReadUsnJournalDataV0>() as u32,
                buffer.as_mut_ptr().cast::<c_void>(),
                buffer.len() as u32,
                &mut bytes_returned,
                null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }

        let bytes_returned = bytes_returned as usize;
        if bytes_returned < size_of::<i64>() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "short USN journal read",
            ));
        }

        let next_cursor = read_i64(&buffer, 0);
        let mut offset = size_of::<i64>();
        while offset + USN_RECORD_V2_MIN_SIZE <= bytes_returned {
            let record_length = read_u32(&buffer, offset) as usize;
            if record_length < USN_RECORD_V2_MIN_SIZE || offset + record_length > bytes_returned {
                complete = false;
                break;
            }

            let major_version = read_u16(&buffer, offset + 4);
            if major_version != 2 {
                // ReFS / newer record layouts need a different file-id representation. Fall back to
                // the paced snapshot path rather than pretending we understood the record.
                complete = false;
                break;
            }

            let file_reference_number = read_u64(&buffer, offset + 8);
            let parent_file_reference_number = read_u64(&buffer, offset + 16);
            let usn = read_i64(&buffer, offset + 24);
            let reason = read_u32(&buffer, offset + 40);
            let file_attributes = read_u32(&buffer, offset + 52);
            let file_name_length = read_u16(&buffer, offset + 56) as usize;
            let file_name_offset = read_u16(&buffer, offset + 58) as usize;

            if file_name_length % 2 != 0 ||
                file_name_offset < USN_RECORD_V2_MIN_SIZE ||
                file_name_offset + file_name_length > record_length
            {
                complete = false;
                break;
            }

            let name_start = offset + file_name_offset;
            let name_end = name_start + file_name_length;
            let mut file_name = Vec::with_capacity(file_name_length / 2);
            for chunk in buffer[name_start..name_end].chunks_exact(2) {
                file_name.push(u16::from_le_bytes([chunk[0], chunk[1]]));
            }

            changes.push(UsnChange {
                file_reference_number,
                parent_file_reference_number,
                usn,
                reason,
                file_attributes,
                file_name,
            });
            if changes.len() >= max_records {
                complete = false;
                break;
            }

            offset += record_length;
        }

        if !complete {
            break;
        }
        if next_cursor <= cursor {
            complete = false;
            break;
        }

        cursor = next_cursor;
    }

    Ok(UsnBatch {
        changes,
        next_usn: cursor,
        complete: complete && cursor >= target_usn,
    })
}

fn read_u16(buffer: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(buffer[offset..offset + 2].try_into().unwrap())
}

fn read_u32(buffer: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap())
}

fn read_u64(buffer: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(buffer[offset..offset + 8].try_into().unwrap())
}

fn read_i64(buffer: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(buffer[offset..offset + 8].try_into().unwrap())
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

fn invalid_handle() -> Handle {
    -1isize as Handle
}

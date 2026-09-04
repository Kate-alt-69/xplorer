use std::{
    env,
    ffi::{c_void, OsStr, OsString},
    io,
    os::windows::ffi::OsStrExt,
    path::Path,
    ptr::{null, null_mut},
    time::Duration,
};

type Handle = *mut c_void;
type HKey = *mut c_void;

const ERROR_ALREADY_EXISTS: u32 = 183;
const ERROR_FILE_NOT_FOUND: i32 = 2;
const ERROR_SUCCESS: i32 = 0;
const DRIVE_FIXED: u32 = 3;
const FILE_SHARE_READ: u32 = 0x0000_0001;
const FILE_SHARE_WRITE: u32 = 0x0000_0002;
const FILE_SHARE_DELETE: u32 = 0x0000_0004;
const OPEN_EXISTING: u32 = 3;
const GENERIC_READ: u32 = 0x8000_0000;
const FSCTL_QUERY_USN_JOURNAL: u32 = 0x0009_00f4;
const KEY_SET_VALUE: u32 = 0x0002;
const REG_SZ: u32 = 1;
const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
const PROCESS_MODE_BACKGROUND_BEGIN: u32 = 0x0010_0000;
const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
const EVENT_MODIFY_STATE: u32 = 0x0002;
const SYNCHRONIZE: u32 = 0x0010_0000;
const WAIT_OBJECT_0: u32 = 0;
const WAIT_TIMEOUT: u32 = 258;
const WAIT_FAILED: u32 = 0xffff_ffff;
const STOP_EVENT_NAME: &str = "Local\\Xplorer.IndexWorker.Stop.v1";

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct UsnJournalDataV0 {
    usn_journal_id: u64,
    first_usn: i64,
    next_usn: i64,
    lowest_valid_usn: i64,
    max_usn: i64,
    maximum_size: u64,
    allocation_delta: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UsnMarker {
    pub journal_id: u64,
    pub next_usn: i64,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateMutexW(attributes: *const c_void, initial_owner: i32, name: *const u16) -> Handle;
    fn GetLastError() -> u32;
    fn CloseHandle(handle: Handle) -> i32;
    fn CreateEventW(
        event_attributes: *const c_void,
        manual_reset: i32,
        initial_state: i32,
        name: *const u16,
    ) -> Handle;
    fn OpenEventW(desired_access: u32, inherit_handle: i32, name: *const u16) -> Handle;
    fn SetEvent(event: Handle) -> i32;
    fn ResetEvent(event: Handle) -> i32;
    fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    fn GetDriveTypeW(root_path_name: *const u16) -> u32;
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
    fn MoveFileExW(existing_file_name: *const u16, new_file_name: *const u16, flags: u32) -> i32;
    fn GetCurrentProcess() -> Handle;
    fn SetPriorityClass(process: Handle, priority_class: u32) -> i32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegCreateKeyExW(
        key: HKey,
        sub_key: *const u16,
        reserved: u32,
        class: *mut u16,
        options: u32,
        desired: u32,
        security_attributes: *const c_void,
        result: *mut HKey,
        disposition: *mut u32,
    ) -> i32;
    fn RegSetValueExW(
        key: HKey,
        value_name: *const u16,
        reserved: u32,
        value_type: u32,
        data: *const u8,
        data_size: u32,
    ) -> i32;
    fn RegDeleteValueW(key: HKey, value_name: *const u16) -> i32;
    fn RegCloseKey(key: HKey) -> i32;
}

pub struct SingleInstanceMutex(Handle);

impl SingleInstanceMutex {
    pub fn acquire() -> io::Result<Option<Self>> {
        let name = wide("Local\\Xplorer.IndexWorker.v1");
        let handle = unsafe { CreateMutexW(null(), 1, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }

        let last_error = unsafe { GetLastError() };
        if last_error == ERROR_ALREADY_EXISTS {
            unsafe {
                CloseHandle(handle);
            }
            return Ok(None);
        }

        Ok(Some(Self(handle)))
    }
}

impl Drop for SingleInstanceMutex {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct StopEvent(Handle);

impl StopEvent {
    pub fn create_for_worker() -> io::Result<Self> {
        let name = wide(STOP_EVENT_NAME);
        let handle = unsafe { CreateEventW(null(), 1, 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }

        if unsafe { ResetEvent(handle) } == 0 {
            let error = io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(error);
        }

        Ok(Self(handle))
    }

    pub fn wait(&self, timeout: Duration) -> io::Result<bool> {
        let milliseconds = timeout.as_millis().min(u32::MAX as u128) as u32;
        match unsafe { WaitForSingleObject(self.0, milliseconds) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            WAIT_FAILED => Err(io::Error::last_os_error()),
            other => Err(io::Error::other(format!("unexpected wait result {other}"))),
        }
    }
}

impl Drop for StopEvent {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn signal_stop_event() -> io::Result<bool> {
    let name = wide(STOP_EVENT_NAME);
    let handle = unsafe { OpenEventW(EVENT_MODIFY_STATE | SYNCHRONIZE, 0, name.as_ptr()) };
    if handle.is_null() {
        let error = unsafe { GetLastError() };
        if error == ERROR_FILE_NOT_FOUND as u32 {
            return Ok(false);
        }
        return Err(io::Error::from_raw_os_error(error as i32));
    }

    let ok = unsafe { SetEvent(handle) };
    let error = if ok == 0 {
        Some(io::Error::last_os_error())
    } else {
        None
    };
    unsafe {
        CloseHandle(handle);
    }

    if let Some(error) = error {
        Err(error)
    } else {
        Ok(true)
    }
}

pub fn enter_background_mode() {
    unsafe {
        let process = GetCurrentProcess();
        if SetPriorityClass(process, PROCESS_MODE_BACKGROUND_BEGIN) == 0 {
            let _ = SetPriorityClass(process, IDLE_PRIORITY_CLASS);
        }
    }
}

pub fn register_startup() -> io::Result<()> {
    let exe = env::current_exe()?;
    let mut command = OsString::from("\"");
    command.push(exe.as_os_str());
    command.push("\" --service-worker");
    set_run_value(command.as_os_str())
}

pub fn unregister_startup() -> io::Result<()> {
    let sub_key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let value_name = wide("Xplorer Index Worker");
    let mut key: HKey = null_mut();
    let mut disposition = 0u32;
    let status = unsafe {
        RegCreateKeyExW(
            hkey_current_user(),
            sub_key.as_ptr(),
            0,
            null_mut(),
            0,
            KEY_SET_VALUE,
            null(),
            &mut key,
            &mut disposition,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status));
    }

    let delete_status = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
    unsafe {
        RegCloseKey(key);
    }

    if delete_status == ERROR_SUCCESS || delete_status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(delete_status))
    }
}

fn set_run_value(command: &OsStr) -> io::Result<()> {
    let sub_key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let value_name = wide("Xplorer Index Worker");
    let command = wide_os(command);
    let mut key: HKey = null_mut();
    let mut disposition = 0u32;

    let status = unsafe {
        RegCreateKeyExW(
            hkey_current_user(),
            sub_key.as_ptr(),
            0,
            null_mut(),
            0,
            KEY_SET_VALUE,
            null(),
            &mut key,
            &mut disposition,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status));
    }

    let bytes = (command.len() * size_of::<u16>()) as u32;
    let set_status = unsafe {
        RegSetValueExW(
            key,
            value_name.as_ptr(),
            0,
            REG_SZ,
            command.as_ptr().cast::<u8>(),
            bytes,
        )
    };
    unsafe {
        RegCloseKey(key);
    }

    if set_status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(set_status))
    }
}

pub fn fixed_drive_letters() -> Vec<u8> {
    let mut result = Vec::with_capacity(8);
    for drive in b'A'..=b'Z' {
        let root = format!("{}:{}", drive as char, std::path::MAIN_SEPARATOR);
        let root_wide = wide(&root);
        if unsafe { GetDriveTypeW(root_wide.as_ptr()) } == DRIVE_FIXED {
            result.push(drive);
        }
    }
    result
}

pub fn query_usn_marker(drive: u8) -> io::Result<UsnMarker> {
    query_usn_marker_with_access(drive, 0).or_else(|_| query_usn_marker_with_access(drive, GENERIC_READ))
}

fn query_usn_marker_with_access(drive: u8, desired_access: u32) -> io::Result<UsnMarker> {
    let volume = format!("\\\\.\\{}:", drive as char);
    let volume_wide = wide(&volume);
    let invalid_handle = -1isize as Handle;
    let handle = unsafe {
        CreateFileW(
            volume_wide.as_ptr(),
            desired_access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    if handle == invalid_handle {
        return Err(io::Error::last_os_error());
    }

    let mut data = UsnJournalDataV0 {
        usn_journal_id: 0,
        first_usn: 0,
        next_usn: 0,
        lowest_valid_usn: 0,
        max_usn: 0,
        maximum_size: 0,
        allocation_delta: 0,
    };
    let mut bytes_returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_QUERY_USN_JOURNAL,
            null_mut(),
            0,
            (&mut data as *mut UsnJournalDataV0).cast::<c_void>(),
            size_of::<UsnJournalDataV0>() as u32,
            &mut bytes_returned,
            null_mut(),
        )
    };
    let error = if ok == 0 {
        Some(io::Error::last_os_error())
    } else {
        None
    };
    unsafe {
        CloseHandle(handle);
    }

    if let Some(error) = error {
        return Err(error);
    }
    if bytes_returned < size_of::<UsnJournalDataV0>() as u32 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "short USN journal response",
        ));
    }

    Ok(UsnMarker {
        journal_id: data.usn_journal_id,
        next_usn: data.next_usn,
    })
}

pub fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    let source = wide_os(source.as_os_str());
    let destination = wide_os(destination.as_os_str());
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

fn wide_os(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn hkey_current_user() -> HKey {
    0x8000_0001u32 as i32 as isize as HKey
}

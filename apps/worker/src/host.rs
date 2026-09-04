use std::{
    env,
    ffi::{c_void, OsStr, OsString},
    io,
    os::windows::ffi::OsStrExt,
    path::Path,
    process::Command,
    ptr::null_mut,
};

const UI_EXECUTABLE: &str = "Xplorer.Native.exe";
const MB_OK: u32 = 0;
const MB_ICONERROR: u32 = 0x0000_0010;

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

/// Rust owns the public xplorer.exe process. Worker switches are handled in-process without
/// touching .NET; ordinary launches forward to the sibling WinUI executable and immediately exit.
pub fn launch_ui(arguments: Vec<OsString>) -> io::Result<i32> {
    let executable = env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "xplorer.exe has no executable directory")
    })?;
    let ui = directory.join(UI_EXECUTABLE);

    if !ui.is_file() {
        show_missing_ui(&ui);
        return Ok(3);
    }

    Command::new(ui).args(arguments).spawn()?;
    Ok(0)
}

fn show_missing_ui(path: &Path) {
    let text = format!(
        "Xplorer's native UI is missing. Reinstall Xplorer or restore:\n{}",
        path.display()
    );
    let text = wide(&text);
    let caption = wide("Xplorer installation is incomplete");
    unsafe {
        MessageBoxW(null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

use std::{
    env,
    ffi::{c_void, OsStr, OsString},
    io,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
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
/// If the UI sidecar was removed or an update is incomplete, folder launches fall forward to
/// Windows Explorer instead of leaving a dead Shell verb behind.
pub fn launch_ui(arguments: Vec<OsString>) -> io::Result<i32> {
    let executable = env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "xplorer.exe has no executable directory")
    })?;
    let ui = directory.join(UI_EXECUTABLE);

    if !ui.is_file() {
        if launch_explorer_fallback(&arguments).is_ok() {
            return Ok(0);
        }
        show_missing_ui(&ui);
        return Ok(3);
    }

    Command::new(ui).args(arguments).spawn()?;
    Ok(0)
}

fn launch_explorer_fallback(arguments: &[OsString]) -> io::Result<()> {
    let target = arguments
        .iter()
        .find(|argument| !argument.to_string_lossy().starts_with("--"))
        .map(PathBuf::from)
        .filter(|path| path.exists());

    let mut command = Command::new("explorer.exe");
    if let Some(target) = target {
        command.arg(target);
    }
    command.spawn()?;
    Ok(())
}

fn show_missing_ui(path: &Path) {
    let text = format!(
        "Xplorer's native UI is missing and Windows Explorer could not be started. Reinstall Xplorer or restore:\n{}",
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

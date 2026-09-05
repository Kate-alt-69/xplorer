use std::{
    env,
    ffi::{c_void, OsStr, OsString},
    fs,
    io,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::Command,
    ptr::null_mut,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const UI_EXECUTABLE: &str = "Xplorer.Native.exe";
const STARTUP_GRACE_PERIOD: Duration = Duration::from_millis(900);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(75);
const MB_OK: u32 = 0;
const MB_ICONERROR: u32 = 0x0000_0010;

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

/// Rust owns the public xplorer.exe process. Worker switches are handled in-process without
/// touching .NET; ordinary launches forward to the sibling WinUI executable. Keep the host alive
/// for a very short grace period so an immediately-crashing UI produces a visible diagnostic
/// instead of looking like xplorer.exe simply did nothing.
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

    let mut child = match Command::new(&ui).args(&arguments).spawn() {
        Ok(child) => child,
        Err(error) => {
            log_host_failure(directory, &format!("Could not spawn {}: {error}", ui.display()));
            show_launch_failure(&ui, &error.to_string());
            return Err(error);
        }
    };

    let mut waited = Duration::ZERO;
    while waited < STARTUP_GRACE_PERIOD {
        if let Some(status) = child.try_wait()? {
            let code = status.code().unwrap_or(4);
            let detail = format!("{UI_EXECUTABLE} exited during startup with code {code}.");
            log_host_failure(directory, &detail);
            show_launch_failure(&ui, &detail);
            return Ok(code);
        }
        thread::sleep(STARTUP_POLL_INTERVAL);
        waited += STARTUP_POLL_INTERVAL;
    }

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

fn log_host_failure(_install_directory: &Path, message: &str) {
    let Some(local_app_data) = env::var_os("LOCALAPPDATA") else {
        return;
    };
    let log_dir = PathBuf::from(local_app_data).join("Xplorer").join("Logs");
    if fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let line = format!("[{timestamp}] Rust host: {message}\r\n");
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("host.log"))
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(line.as_bytes())
        });
}

fn show_launch_failure(path: &Path, detail: &str) {
    let log_path = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Xplorer").join("Logs").join("startup.log"));
    let text = match log_path {
        Some(log_path) => format!(
            "Xplorer's native UI could not stay running.\n\n{}\n\nUI: {}\n\nStartup log: {}",
            detail,
            path.display(),
            log_path.display()
        ),
        None => format!("Xplorer's native UI could not stay running.\n\n{}\n\nUI: {}", detail, path.display()),
    };
    show_error_message(&text, "Xplorer startup error");
}

fn show_missing_ui(path: &Path) {
    let text = format!(
        "Xplorer's native UI is missing and Windows Explorer could not be started. Reinstall Xplorer or restore:\n{}",
        path.display()
    );
    show_error_message(&text, "Xplorer installation is incomplete");
}

fn show_error_message(text: &str, caption: &str) {
    let text = wide(text);
    let caption = wide(caption);
    unsafe {
        MessageBoxW(null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR);
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

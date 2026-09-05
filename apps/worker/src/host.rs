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
const STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(3);
const DEBUG_STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(15);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(75);
const DEBUG_STARTUP_ENV: &str = "XPLORER_DEBUG_STARTUP";
const MB_OK: u32 = 0;
const MB_ICONERROR: u32 = 0x0000_0010;
const VC_RUNTIME_DLLS: &[&str] = &["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryW(file_name: *const u16) -> *mut c_void;
    fn FreeLibrary(module: *mut c_void) -> i32;
}

/// Rust owns the public xplorer.exe process. Worker switches are handled in-process without
/// touching .NET; ordinary launches forward to the sibling WinUI executable. Keep the host alive
/// briefly so an immediately-crashing UI produces a visible diagnostic instead of looking like
/// xplorer.exe simply did nothing. --debug/-debug extends that observation window and enables the
/// managed UI preflight through a private environment variable without forwarding a fake app arg.
pub fn launch_ui(arguments: Vec<OsString>) -> io::Result<i32> {
    let debug = arguments.iter().any(|argument| is_debug_argument(argument));
    let arguments: Vec<OsString> = arguments
        .into_iter()
        .filter(|argument| !is_debug_argument(argument))
        .collect();

    let executable = env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "xplorer.exe has no executable directory")
    })?;
    let ui = directory.join(UI_EXECUTABLE);

    if debug {
        log_host_message(
            &format!(
                "Debug launch requested. Host={}; UI={}; args={:?}",
                executable.display(),
                ui.display(),
                arguments
            ),
        );
    }

    let missing_runtime = missing_vc_runtime_dlls();
    if !missing_runtime.is_empty() {
        let detail = format!(
            "Microsoft Visual C++ runtime is missing or incomplete: {}. Re-run the latest Xplorer installer to repair the prerequisite.",
            missing_runtime.join(", ")
        );
        log_host_message(&detail);
        show_launch_failure(&ui, &detail);
        return Ok(5);
    }

    if !ui.is_file() {
        if launch_explorer_fallback(&arguments).is_ok() {
            return Ok(0);
        }
        show_missing_ui(&ui);
        return Ok(3);
    }

    let mut command = Command::new(&ui);
    command.args(&arguments);
    if debug {
        command.env(DEBUG_STARTUP_ENV, "1");
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            log_host_message(&format!("Could not spawn {}: {error}", ui.display()));
            show_launch_failure(&ui, &error.to_string());
            return Err(error);
        }
    };

    if debug {
        log_host_message(&format!("Spawned {UI_EXECUTABLE} as PID {}.", child.id()));
    }

    let grace_period = if debug {
        DEBUG_STARTUP_GRACE_PERIOD
    } else {
        STARTUP_GRACE_PERIOD
    };
    let mut waited = Duration::ZERO;
    while waited < grace_period {
        if let Some(status) = child.try_wait()? {
            let code = status.code().unwrap_or(4);
            let detail = format!(
                "{UI_EXECUTABLE} exited during startup with code {code} (0x{:08X}).",
                code as u32
            );
            log_host_message(&detail);
            show_launch_failure(&ui, &detail);
            return Ok(code);
        }
        thread::sleep(STARTUP_POLL_INTERVAL);
        waited += STARTUP_POLL_INTERVAL;
    }

    if debug {
        log_host_message(&format!(
            "{UI_EXECUTABLE} remained alive for {:.1}s; Rust host startup watch completed.",
            grace_period.as_secs_f32()
        ));
    }

    Ok(0)
}

fn is_debug_argument(argument: &OsStr) -> bool {
    matches!(
        argument.to_string_lossy().to_ascii_lowercase().as_str(),
        "--debug" | "-debug" | "--diagnose"
    )
}

fn missing_vc_runtime_dlls() -> Vec<&'static str> {
    let mut missing = Vec::new();
    for name in VC_RUNTIME_DLLS {
        let wide_name = wide(name);
        let module = unsafe { LoadLibraryW(wide_name.as_ptr()) };
        if module.is_null() {
            missing.push(*name);
        } else {
            unsafe {
                FreeLibrary(module);
            }
        }
    }
    missing
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

fn log_host_message(message: &str) {
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
    let host_log_path = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Xplorer").join("Logs").join("host.log"));
    let text = match (log_path, host_log_path) {
        (Some(log_path), Some(host_log_path)) => format!(
            "Xplorer's native UI could not stay running.\n\n{}\n\nUI: {}\n\nManaged startup log: {}\nRust host log: {}",
            detail,
            path.display(),
            log_path.display(),
            host_log_path.display()
        ),
        _ => format!("Xplorer's native UI could not stay running.\n\n{}\n\nUI: {}", detail, path.display()),
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

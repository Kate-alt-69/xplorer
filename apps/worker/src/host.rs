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
const ERROR_CHECK_EXECUTABLE: &str = "errorchk.exe";
const STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(3);
const DEBUG_STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(15);
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(75);
const DEBUG_STARTUP_ENV: &str = "XPLORER_DEBUG_STARTUP";
const CANONICAL_OPEN_ARGUMENT: &str = "--open";
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
/// touching .NET; ordinary launches forward to the sibling WinUI executable. errorchk.exe becomes
/// the long-lived event-driven lifecycle owner once the UI is spawned, while this host only keeps a
/// short startup watch so the public process still returns a meaningful early exit code.
///
/// Folder-launch spelling is intentionally normalized here. CLI/debug tooling may use --open,
/// --folder, --path, --test-open-folder, --test-open-path, their single-dash forms, or a bare folder.
/// The native UI receives one stable `--open <folder>` contract, so adding a tool alias never
/// changes MainWindow/session/navigation behavior.
pub fn launch_ui(arguments: Vec<OsString>) -> io::Result<i32> {
    let debug = arguments.iter().any(|argument| is_debug_argument(argument));

    let executable = env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "xplorer.exe has no executable directory")
    })?;
    let ui = directory.join(UI_EXECUTABLE);

    let arguments = match prepare_ui_arguments(arguments) {
        Ok(arguments) => arguments,
        Err(error) => {
            let detail = format!("Invalid Xplorer launch: {error}");
            log_host_message(&detail);
            show_launch_failure(&ui, &detail);
            return Ok(2);
        }
    };

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

    let watchdog_started = match launch_watchdog(directory, &ui, child.id(), &arguments, debug) {
        Ok(started) => started,
        Err(error) => {
            log_host_message(&format!("Could not start {ERROR_CHECK_EXECUTABLE}: {error}"));
            false
        }
    };

    let grace_period = if debug {
        DEBUG_STARTUP_GRACE_PERIOD
    } else {
        STARTUP_GRACE_PERIOD
    };
    let mut waited = Duration::ZERO;
    while waited < grace_period {
        if let Some(status) = child.try_wait()? {
            if status.success() {
                // errorchk distinguishes an expected restart from an unexpected code-0 lifecycle
                // termination. The public host does not duplicate that modal/reporting policy.
                log_host_message(
                    &format!(
                        "{UI_EXECUTABLE} exited cleanly during the startup watch with code 0 (0x00000000); watchdog_started={watchdog_started}."
                    ),
                );
                return Ok(0);
            }

            let code = status.code().unwrap_or(4);
            let detail = format!(
                "{UI_EXECUTABLE} exited during startup with code {code} (0x{:08X}).",
                code as u32
            );
            log_host_message(&detail);
            // When errorchk is alive it owns the one user-facing crash popup and numbered report.
            // Fall back to the legacy host dialog only if the watchdog itself could not start.
            if !watchdog_started {
                show_launch_failure(&ui, &detail);
            }
            return Ok(code);
        }
        thread::sleep(STARTUP_POLL_INTERVAL);
        waited += STARTUP_POLL_INTERVAL;
    }

    if debug {
        log_host_message(&format!(
            "{UI_EXECUTABLE} remained alive for {:.1}s; Rust host startup watch completed; watchdog_started={watchdog_started}.",
            grace_period.as_secs_f32()
        ));
    }

    Ok(0)
}

fn launch_watchdog(
    install_root: &Path,
    ui: &Path,
    ui_pid: u32,
    ui_arguments: &[OsString],
    debug: bool,
) -> io::Result<bool> {
    let watchdog = install_root.join(ERROR_CHECK_EXECUTABLE);
    if !watchdog.is_file() {
        log_host_message(&format!(
            "{ERROR_CHECK_EXECUTABLE} is not installed beside xplorer.exe; using host-only startup diagnostics."
        ));
        return Ok(false);
    }

    let mut command = Command::new(&watchdog);
    command
        .arg("--ui-pid")
        .arg(ui_pid.to_string())
        .arg("--ui")
        .arg(ui);
    for argument in ui_arguments {
        command.arg("--ui-arg").arg(argument);
    }

    let child = command.spawn()?;
    if debug {
        log_host_message(&format!(
            "Spawned {ERROR_CHECK_EXECUTABLE} as PID {} watching UI PID {ui_pid}.",
            child.id()
        ));
    }
    Ok(true)
}

fn prepare_ui_arguments(arguments: Vec<OsString>) -> io::Result<Vec<OsString>> {
    let mut forwarded = Vec::new();
    let mut requested_path: Option<PathBuf> = None;
    let mut index = 0usize;

    while index < arguments.len() {
        let argument = &arguments[index];
        if is_debug_argument(argument) {
            index += 1;
            continue;
        }

        if is_open_path_argument(argument) {
            if requested_path.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "only one explicit folder target may be supplied",
                ));
            }

            let value = arguments.get(index + 1).ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("{} requires a folder path", argument.to_string_lossy()),
                )
            })?;
            let path = PathBuf::from(value);
            if !path.is_dir() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!(
                        "folder does not exist or is not a directory: {}",
                        path.display()
                    ),
                ));
            }

            requested_path = Some(path);
            index += 2;
            continue;
        }

        forwarded.push(argument.clone());
        index += 1;
    }

    if let Some(path) = requested_path {
        let path = fs::canonicalize(&path).unwrap_or(path);
        let mut normalized = vec![
            OsString::from(CANONICAL_OPEN_ARGUMENT),
            path.into_os_string(),
        ];
        normalized.extend(forwarded);
        return Ok(normalized);
    }

    Ok(forwarded)
}

fn is_debug_argument(argument: &OsStr) -> bool {
    matches!(
        argument.to_string_lossy().to_ascii_lowercase().as_str(),
        "--debug" | "-debug" | "--diagnose"
    )
}

fn is_open_path_argument(argument: &OsStr) -> bool {
    matches!(
        argument.to_string_lossy().to_ascii_lowercase().as_str(),
        "--open"
            | "-open"
            | "/open"
            | "--folder"
            | "-folder"
            | "--path"
            | "-path"
            | "--test-open-folder"
            | "-test-open-folder"
            | "--test-open-path"
            | "-test-open-path"
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
    let mut target: Option<PathBuf> = None;
    let mut index = 0usize;
    while index < arguments.len() {
        if is_open_path_argument(&arguments[index]) ||
            arguments[index].to_string_lossy().eq_ignore_ascii_case(CANONICAL_OPEN_ARGUMENT)
        {
            if let Some(value) = arguments.get(index + 1) {
                let path = PathBuf::from(value);
                if path.exists() {
                    target = Some(path);
                    break;
                }
            }
            index += 2;
            continue;
        }

        let text = arguments[index].to_string_lossy();
        if !text.starts_with('-') && !text.starts_with('/') {
            let path = PathBuf::from(&arguments[index]);
            if path.exists() {
                target = Some(path);
                break;
            }
        }
        index += 1;
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_test_open_folder_alias_becomes_canonical_native_open_request() {
        let root = env::current_dir().expect("current directory");
        let arguments = vec![
            OsString::from("-debug"),
            OsString::from("-test-open-folder"),
            root.clone().into_os_string(),
        ];

        let forwarded = prepare_ui_arguments(arguments).expect("prepare arguments");
        assert_eq!(forwarded.len(), 2);
        assert_eq!(forwarded[0], OsString::from(CANONICAL_OPEN_ARGUMENT));
        assert!(PathBuf::from(&forwarded[1]).is_dir());
    }

    #[test]
    fn double_dash_test_open_path_alias_is_still_supported() {
        let root = env::current_dir().expect("current directory");
        let arguments = vec![
            OsString::from("--test-open-path"),
            root.into_os_string(),
        ];

        let forwarded = prepare_ui_arguments(arguments).expect("prepare arguments");
        assert_eq!(forwarded[0], OsString::from(CANONICAL_OPEN_ARGUMENT));
        assert!(PathBuf::from(&forwarded[1]).is_dir());
    }

    #[test]
    fn canonical_open_accepts_folder_without_debug_mode() {
        let root = env::current_dir().expect("current directory");
        let arguments = vec![
            OsString::from(CANONICAL_OPEN_ARGUMENT),
            root.into_os_string(),
        ];

        let forwarded = prepare_ui_arguments(arguments).expect("prepare arguments");
        assert_eq!(forwarded[0], OsString::from(CANONICAL_OPEN_ARGUMENT));
        assert!(PathBuf::from(&forwarded[1]).is_dir());
    }

    #[test]
    fn open_alias_requires_a_value() {
        let error = prepare_ui_arguments(vec![OsString::from("--open")])
            .expect_err("missing folder value");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}

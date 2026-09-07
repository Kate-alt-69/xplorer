#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_watchdog {
    use std::{
        env,
        ffi::{c_void, OsStr, OsString},
        fs,
        io::{self, Write},
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        process::Command,
        ptr::{null, null_mut},
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    const UI_EXECUTABLE: &str = "Xplorer.Native.exe";
    const WORKER_PID_FILE: &str = "xplorer-bgw.pid";
    const CONTROL_EVENT_PREFIX: &str = r"Local\Xplorer.ErrorChk.";
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;
    const WAIT_FAILED: u32 = 0xFFFF_FFFF;
    const INFINITE: u32 = 0xFFFF_FFFF;
    const MB_OK: u32 = 0;
    const MB_ICONERROR: u32 = 0x0000_0010;
    const HEALTH_WAIT_MS: u32 = 2_000;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
        fn WaitForMultipleObjects(
            count: u32,
            handles: *const *mut c_void,
            wait_all: i32,
            milliseconds: u32,
        ) -> u32;
        fn GetExitCodeProcess(process: *mut c_void, exit_code: *mut u32) -> i32;
        fn CreateEventW(
            attributes: *mut c_void,
            manual_reset: i32,
            initial_state: i32,
            name: *const u16,
        ) -> *mut c_void;
        fn ResetEvent(event: *mut c_void) -> i32;
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }

    pub fn run() -> io::Result<i32> {
        let request = WatchRequest::parse(env::args_os().skip(1).collect())?;
        let watchdog = env::current_exe()?;
        let install_root = watchdog.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "errorchk.exe has no install directory")
        })?;

        // Install-directory identity is deliberate: a random errorchk.exe elsewhere must not be
        // able to supervise or restart this Xplorer instance.
        let expected_ui = install_root.join(UI_EXECUTABLE);
        if normalize_for_compare(&request.ui) != normalize_for_compare(&expected_ui) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "refusing to watch UI outside this Xplorer install: {}",
                    request.ui.display()
                ),
            ));
        }

        let control_dir = local_control_directory()?;
        fs::create_dir_all(&control_dir)?;
        supervise_ui(request, install_root.to_path_buf(), control_dir)
    }

    fn supervise_ui(
        mut request: WatchRequest,
        install_root: PathBuf,
        control_dir: PathBuf,
    ) -> io::Result<i32> {
        loop {
            let process = ProcessHandle::open(request.ui_pid)?;
            let event_name = format!("{CONTROL_EVENT_PREFIX}{}.v1", request.ui_pid);
            let control_event = EventHandle::create(&event_name)?;
            let command_path = control_dir.join(format!("errorchk-{}.cmd", request.ui_pid));
            let _ = fs::remove_file(&command_path);

            log_watchdog(&format!(
                "watching UI pid={} path={} event={event_name}",
                request.ui_pid,
                request.ui.display()
            ));

            let mut planned_restart: Option<String> = None;
            let mut reported_worker_pid: Option<u32> = None;

            loop {
                let handles = [process.raw(), control_event.raw()];
                let result = unsafe {
                    WaitForMultipleObjects(
                        handles.len() as u32,
                        handles.as_ptr(),
                        0,
                        HEALTH_WAIT_MS,
                    )
                };

                match result {
                    WAIT_OBJECT_0 => {
                        let exit_code = process.exit_code().unwrap_or(u32::MAX);
                        if let Some(reason) = planned_restart.take() {
                            log_watchdog(&format!(
                                "UI pid={} completed planned restart with code {} reason={reason}",
                                request.ui_pid, exit_code
                            ));
                            request.ui_pid = spawn_replacement(&request.ui, &request.ui_arguments)?;
                            // Small grace prevents a requested restart from creating a tight spawn
                            // loop if Windows is still releasing the previous app resources.
                            thread::sleep(Duration::from_millis(180));
                            break;
                        }

                        let report = write_error_report(
                            &install_root,
                            "Native UI",
                            request.ui_pid,
                            Some(exit_code),
                            &request.ui,
                            "unexpected process exit",
                        )?;
                        show_failure(
                            "Xplorer UI failed",
                            &format!(
                                "Xplorer's UI stopped unexpectedly.\n\nRead: {}\n\nError code: {} (0x{:08X})",
                                report.display(),
                                exit_code as i32,
                                exit_code
                            ),
                        );
                        return Ok(exit_code as i32);
                    }
                    value if value == WAIT_OBJECT_0 + 1 => {
                        let command = fs::read_to_string(&command_path).unwrap_or_default();
                        let _ = fs::remove_file(&command_path);
                        unsafe {
                            ResetEvent(control_event.raw());
                        }

                        let command = command.trim();
                        if let Some(reason) = command.strip_prefix("restart") {
                            let reason = reason.trim_start_matches([':', ' ', '\t']).trim();
                            planned_restart = Some(if reason.is_empty() {
                                "application requested restart".to_string()
                            } else {
                                reason.to_string()
                            });
                            log_watchdog(&format!(
                                "restart acknowledged for UI pid={} reason={}",
                                request.ui_pid,
                                planned_restart.as_deref().unwrap_or_default()
                            ));
                        } else if command.eq_ignore_ascii_case("refresh") {
                            // Refresh is intentionally an acknowledgement-only control message. The
                            // live WinUI process owns theme/data refresh; errorchk only owns process
                            // lifecycle. Keeping this command in the protocol avoids abusing restart.
                            log_watchdog(&format!("refresh acknowledged for UI pid={}", request.ui_pid));
                        } else if !command.is_empty() {
                            log_watchdog(&format!(
                                "ignored unknown UI control command for pid={}: {command}",
                                request.ui_pid
                            ));
                        }
                    }
                    WAIT_TIMEOUT => {
                        inspect_background_worker(
                            &install_root,
                            &control_dir,
                            &mut reported_worker_pid,
                        );
                    }
                    WAIT_FAILED => {
                        return Err(io::Error::last_os_error());
                    }
                    _ => {}
                }
            }
        }
    }

    fn inspect_background_worker(
        install_root: &Path,
        control_dir: &Path,
        reported_worker_pid: &mut Option<u32>,
    ) {
        let pid_path = control_dir.join(WORKER_PID_FILE);
        let Ok(text) = fs::read_to_string(&pid_path) else {
            *reported_worker_pid = None;
            return;
        };
        let Ok(pid) = text.trim().parse::<u32>() else {
            return;
        };
        if *reported_worker_pid == Some(pid) {
            return;
        }

        let alive = ProcessHandle::open(pid)
            .map(|process| unsafe { WaitForSingleObject(process.raw(), 0) } == WAIT_TIMEOUT)
            .unwrap_or(false);
        if alive {
            *reported_worker_pid = None;
            return;
        }

        // A disabled index worker is allowed to stop. Otherwise a stale pid file is meaningful
        // enough to preserve as a health report, but not enough to interrupt the user with a modal
        // popup while the main file manager is healthy.
        if control_dir.join("indexing.disabled").is_file() {
            *reported_worker_pid = Some(pid);
            return;
        }

        let worker_path = install_root.join("xplorer-bgw.exe");
        if let Ok(report) = write_error_report(
            install_root,
            "Background worker",
            pid,
            None,
            &worker_path,
            "worker pid file exists but process is no longer alive",
        ) {
            log_watchdog(&format!(
                "background worker health failure pid={pid}; report={}",
                report.display()
            ));
        }
        *reported_worker_pid = Some(pid);
    }

    fn spawn_replacement(ui: &Path, arguments: &[OsString]) -> io::Result<u32> {
        let mut command = Command::new(ui);
        command.args(arguments);
        let child = command.spawn()?;
        Ok(child.id())
    }

    fn write_error_report(
        install_root: &Path,
        component: &str,
        pid: u32,
        exit_code: Option<u32>,
        executable: &Path,
        reason: &str,
    ) -> io::Result<PathBuf> {
        let report_dir = preferred_report_directory(install_root);
        fs::create_dir_all(&report_dir)?;
        let number = next_report_number(&report_dir);
        let path = report_dir.join(format!("error-report{number}.error"));
        let timestamp = unix_now();
        let startup_log = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|root| root.join("Xplorer").join("Logs").join("startup.log"));
        let host_log = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|root| root.join("Xplorer").join("Logs").join("host.log"));

        let mut file = fs::File::create(&path)?;
        writeln!(file, "Xplorer error report")?;
        writeln!(file, "====================")?;
        writeln!(file, "timestamp_unix={timestamp}")?;
        writeln!(file, "component={component}")?;
        writeln!(file, "pid={pid}")?;
        writeln!(file, "reason={reason}")?;
        writeln!(file, "executable={}", executable.display())?;
        writeln!(file, "install_root={}", install_root.display())?;
        if let Some(code) = exit_code {
            writeln!(file, "exit_code_decimal={}", code as i32)?;
            writeln!(file, "exit_code_hex=0x{code:08X}")?;
        } else {
            writeln!(file, "exit_code_decimal=<unavailable>")?;
            writeln!(file, "exit_code_hex=<unavailable>")?;
        }
        if let Some(path) = startup_log {
            writeln!(file, "startup_log={}", path.display())?;
        }
        if let Some(path) = host_log {
            writeln!(file, "host_log={}", path.display())?;
        }
        file.flush()?;
        Ok(path)
    }

    fn preferred_report_directory(install_root: &Path) -> PathBuf {
        let install_logs = install_root.join("log").join("error");
        if fs::create_dir_all(&install_logs).is_ok() {
            return install_logs;
        }

        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir)
            .join("Xplorer")
            .join("Logs")
            .join("error")
    }

    fn next_report_number(directory: &Path) -> u64 {
        let mut maximum = 0u64;
        if let Ok(entries) = fs::read_dir(directory) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                let Some(number) = name
                    .strip_prefix("error-report")
                    .and_then(|value| value.strip_suffix(".error"))
                    .and_then(|value| value.parse::<u64>().ok())
                else {
                    continue;
                };
                maximum = maximum.max(number);
            }
        }
        maximum.saturating_add(1)
    }

    fn local_control_directory() -> io::Result<PathBuf> {
        let root = env::var_os("LOCALAPPDATA").ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is unavailable")
        })?;
        Ok(PathBuf::from(root).join("Xplorer").join("Control"))
    }

    fn log_watchdog(message: &str) {
        let Some(root) = env::var_os("LOCALAPPDATA") else {
            return;
        };
        let directory = PathBuf::from(root).join("Xplorer").join("Logs");
        if fs::create_dir_all(&directory).is_err() {
            return;
        }
        let line = format!("[{}] errorchk: {message}\r\n", unix_now());
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join("errorchk.log"))
            .and_then(|mut file| file.write_all(line.as_bytes()));
    }

    fn show_failure(caption: &str, text: &str) {
        let caption = wide(caption);
        let text = wide(text);
        unsafe {
            MessageBoxW(null_mut(), text.as_ptr(), caption.as_ptr(), MB_OK | MB_ICONERROR);
        }
    }

    fn normalize_for_compare(path: &Path) -> PathBuf {
        fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    fn unix_now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    struct ProcessHandle(*mut c_void);

    impl ProcessHandle {
        fn open(pid: u32) -> io::Result<Self> {
            let handle = unsafe {
                OpenProcess(
                    SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }

        fn raw(&self) -> *mut c_void {
            self.0
        }

        fn exit_code(&self) -> io::Result<u32> {
            let mut code = 0u32;
            if unsafe { GetExitCodeProcess(self.0, &mut code) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(code)
        }
    }

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    struct EventHandle(*mut c_void);

    impl EventHandle {
        fn create(name: &str) -> io::Result<Self> {
            let wide_name = wide(name);
            let handle = unsafe { CreateEventW(null_mut(), 1, 0, wide_name.as_ptr()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }

        fn raw(&self) -> *mut c_void {
            self.0
        }
    }

    impl Drop for EventHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    #[derive(Debug)]
    struct WatchRequest {
        ui_pid: u32,
        ui: PathBuf,
        ui_arguments: Vec<OsString>,
    }

    impl WatchRequest {
        fn parse(arguments: Vec<OsString>) -> io::Result<Self> {
            let mut ui_pid = None;
            let mut ui = None;
            let mut ui_arguments = Vec::new();
            let mut index = 0usize;

            while index < arguments.len() {
                let name = arguments[index].to_string_lossy().to_ascii_lowercase();
                match name.as_str() {
                    "--ui-pid" => {
                        let value = arguments.get(index + 1).ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidInput, "--ui-pid requires a value")
                        })?;
                        ui_pid = Some(value.to_string_lossy().parse::<u32>().map_err(|_| {
                            io::Error::new(io::ErrorKind::InvalidInput, "invalid --ui-pid value")
                        })?);
                        index += 2;
                    }
                    "--ui" => {
                        let value = arguments.get(index + 1).ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidInput, "--ui requires a path")
                        })?;
                        ui = Some(PathBuf::from(value));
                        index += 2;
                    }
                    "--ui-arg" => {
                        let value = arguments.get(index + 1).ok_or_else(|| {
                            io::Error::new(io::ErrorKind::InvalidInput, "--ui-arg requires a value")
                        })?;
                        ui_arguments.push(value.clone());
                        index += 2;
                    }
                    _ => {
                        index += 1;
                    }
                }
            }

            Ok(Self {
                ui_pid: ui_pid.ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "missing --ui-pid")
                })?,
                ui: ui.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing --ui"))?,
                ui_arguments,
            })
        }
    }
}

#[cfg(windows)]
fn main() {
    std::process::exit(windows_watchdog::run().unwrap_or(1));
}

#[cfg(not(windows))]
fn main() {}

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod delta;
#[cfg(windows)]
mod diagnostics_folder;
#[cfg(windows)]
mod host;
#[cfg(windows)]
mod index;
#[cfg(windows)]
mod platform;
#[cfg(windows)]
mod state;
#[cfg(windows)]
mod usn;
#[cfg(windows)]
mod worker;
#[cfg(windows)]
mod workspace;

#[cfg(windows)]
fn main() {
    let arguments: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let result = if diagnostics_folder::has_test_folder(&arguments) {
        diagnostics_folder::run(&arguments)
    } else if is_worker_command(&arguments) {
        worker::run(normalize_worker_arguments(arguments).into_iter())
    } else {
        host::launch_ui(arguments)
    };

    std::process::exit(result.unwrap_or(1));
}

#[cfg(windows)]
fn is_worker_command(arguments: &[std::ffi::OsString]) -> bool {
    arguments.iter().any(|argument| {
        matches!(
            argument.to_string_lossy().as_ref(),
            "--service-worker"
                | "--register-startup"
                | "--unregister-startup"
                | "--stop-service-worker"
                | "--scan-once"
                | "--once"
                | "--idle-probe"
        )
    })
}

/// Keep every public worker entry point on the same user-owned control channel. Install/startup
/// paths normally pass --control-dir explicitly, but maintenance commands such as
/// `xplorer-bgw.exe --stop-service-worker` intentionally stay short. Without this normalization the
/// worker module would fall back to its data/index directory and miss the pid/disable files stored
/// under %LOCALAPPDATA%\Xplorer\Control, which could leave the BGW locked during uninstall.
#[cfg(windows)]
fn normalize_worker_arguments(
    mut arguments: Vec<std::ffi::OsString>,
) -> Vec<std::ffi::OsString> {
    let has_control_dir = arguments.iter().any(|argument| {
        let value = argument.to_string_lossy();
        value.eq_ignore_ascii_case("--control-dir")
            || value
                .get(.."--control-dir=".len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("--control-dir="))
    });
    if has_control_dir {
        return arguments;
    }

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let control_dir = std::path::PathBuf::from(local_app_data)
            .join("Xplorer")
            .join("Control");
        arguments.push(std::ffi::OsString::from("--control-dir"));
        arguments.push(control_dir.into_os_string());
    }
    arguments
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn worker_control_dir_is_not_duplicated_when_explicit() {
        let args = vec![
            std::ffi::OsString::from("--stop-service-worker"),
            std::ffi::OsString::from("--control-dir"),
            std::ffi::OsString::from(r"C:\custom-control"),
        ];
        let normalized = normalize_worker_arguments(args.clone());
        assert_eq!(normalized, args);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Xplorer is Windows-only");
}

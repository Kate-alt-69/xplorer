#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod delta;
#[cfg(windows)]
mod diagnostics_cli;
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
    let result = if diagnostics_cli::has_test_folder(&arguments) {
        diagnostics_cli::run(&arguments)
    } else if is_worker_command(&arguments) {
        worker::run(arguments.into_iter())
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

#[cfg(not(windows))]
fn main() {
    eprintln!("Xplorer is Windows-only");
}

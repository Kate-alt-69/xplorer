#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(windows)]
mod index;
#[cfg(windows)]
mod platform;
#[cfg(windows)]
mod state;
#[cfg(windows)]
mod worker;

#[cfg(windows)]
fn main() {
    let code = worker::run(std::env::args_os().skip(1)).unwrap_or(1);
    std::process::exit(code);
}

#[cfg(not(windows))]
fn main() {
    eprintln!("xplorer-worker is Windows-only");
}

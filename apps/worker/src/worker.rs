use std::{
    env,
    ffi::OsString,
    fs,
    io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    delta, index,
    platform::{self, SingleInstanceMutex, StopEvent},
    state::{CursorState, VolumeCursor},
    usn, workspace,
};

const RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const FULL_SNAPSHOT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const IDLE_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const WORKSPACE_WAIT_SLICE: Duration = Duration::from_secs(1);
const STOP_GRACE_TIMEOUT: Duration = Duration::from_secs(3);
const STOP_FORCE_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_FINAL_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_DELTA_BYTES: u64 = 4 * 1024 * 1024;
const MAX_USN_RECORDS_PER_PASS: usize = 4096;
const WORKER_PID_FILE: &str = "xplorer-bgw.pid";

pub fn run<I>(arguments: I) -> io::Result<i32>
where
    I: Iterator<Item = OsString>,
{
    let arguments: Vec<String> = arguments
        .map(|value| value.to_string_lossy().into_owned())
        .collect();

    let data_dir = option_path(&arguments, "--data-dir").unwrap_or(data_directory()?);
    let control_dir = option_path(&arguments, "--control-dir").unwrap_or_else(|| data_dir.clone());

    if arguments.iter().any(|value| value == "--register-startup") {
        platform::register_startup()?;
        return Ok(0);
    }
    if arguments.iter().any(|value| value == "--unregister-startup") {
        platform::unregister_startup()?;
        return Ok(0);
    }
    if arguments.iter().any(|value| value == "--stop-service-worker") {
        stop_service_worker(&control_dir)?;
        return Ok(0);
    }
    if arguments.iter().any(|value| value == "--idle-probe") {
        return run_idle_probe();
    }

    let service_worker = arguments.iter().any(|value| value == "--service-worker");
    let once = arguments.iter().any(|value| value == "--once" || value == "--scan-once");
    if !service_worker && !once {
        return Ok(2);
    }
    run_worker(once, data_dir, control_dir)
}

/// Shutdown is normally a cheap named-event handoff. A worker can however be inside a Windows
/// filesystem call long enough that an installer would otherwise have to schedule xplorer-bgw.exe
/// for deletion at reboot. After a short grace period, use the exact pid file plus an executable-
/// path verification before terminating anything. No process-name sweep is performed here.
fn stop_service_worker(control_dir: &Path) -> io::Result<()> {
    let _ = platform::signal_stop_event()?;
    if wait_for_worker_exit(STOP_GRACE_TIMEOUT).is_ok() {
        remove_worker_pid_if_stale(control_dir);
        return Ok(());
    }

    let pid = read_worker_pid(control_dir).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            "background worker did not stop and no verified pid is available for bounded shutdown",
        )
    })?;
    let expected_worker = expected_worker_path()?;

    let forced = platform::force_stop_verified_worker(pid, &expected_worker, STOP_FORCE_TIMEOUT)?;
    if !forced {
        // The PID may have exited between the pid-file read and OpenProcess. Re-check the mutex
        // before treating that race as a failure. If the pid was reused by another executable the
        // verified terminator returns false and this check remains safely non-destructive.
        wait_for_worker_exit(STOP_FINAL_TIMEOUT)?;
    } else {
        wait_for_worker_exit(STOP_FINAL_TIMEOUT)?;
    }

    remove_worker_pid_if_matches(control_dir, pid);
    Ok(())
}

fn expected_worker_path() -> io::Result<PathBuf> {
    let current = env::current_exe()?;
    let is_worker_image = current
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("xplorer-bgw.exe"));
    if is_worker_image {
        return Ok(current);
    }

    let sibling = current
        .parent()
        .map(|parent| parent.join("xplorer-bgw.exe"))
        .filter(|path| path.is_file());
    Ok(sibling.unwrap_or(current))
}

fn read_worker_pid(control_dir: &Path) -> Option<u32> {
    fs::read_to_string(control_dir.join(WORKER_PID_FILE))
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
}

fn remove_worker_pid_if_matches(control_dir: &Path, pid: u32) {
    let path = control_dir.join(WORKER_PID_FILE);
    let matches = fs::read_to_string(&path)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        == Some(pid);
    if matches {
        let _ = fs::remove_file(path);
    }
}

fn remove_worker_pid_if_stale(control_dir: &Path) {
    let path = control_dir.join(WORKER_PID_FILE);
    if path.is_file() {
        let _ = fs::remove_file(path);
    }
}

fn wait_for_worker_exit(timeout: Duration) -> io::Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(instance) = SingleInstanceMutex::acquire()? {
            drop(instance);
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Xplorer background worker did not stop before the shutdown timeout",
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn run_idle_probe() -> io::Result<i32> {
    let Some(_instance) = SingleInstanceMutex::acquire()? else {
        return Ok(0);
    };
    let stop_event = StopEvent::create_for_worker()?;
    platform::enter_background_mode();
    platform::trim_idle_working_set();
    let _ = stop_event.wait(IDLE_PROBE_TIMEOUT)?;
    Ok(0)
}

fn run_worker(once: bool, data_dir: PathBuf, control_dir: PathBuf) -> io::Result<i32> {
    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(&control_dir)?;

    let Some(_instance) = SingleInstanceMutex::acquire()? else {
        return Ok(0);
    };

    // errorchk discovers the exact background worker through this user-owned control file rather
    // than scanning process names. A drop guard removes only this process's pid, so normal worker
    // shutdown is distinguishable from a stale pid left by an abrupt termination.
    let _pid_file = WorkerPidFile::publish(&control_dir)?;

    let stop_event = StopEvent::create_for_worker()?;
    let wake_event = workspace::WakeEvent::create_for_worker()?;
    platform::enter_background_mode();
    let cursor_path = data_dir.join("cursor.bin");
    let mut state = CursorState::load(&cursor_path)?;

    loop {
        if indexing_disabled(&control_dir) {
            platform::trim_idle_working_set();
            if stop_event.wait(WORKSPACE_WAIT_SLICE)? {
                return Ok(0);
            }
            continue;
        }

        let _ = workspace::refresh_hot_workspace(&control_dir, &data_dir, Some(&stop_event));

        reconcile(&data_dir, &control_dir, &mut state, &stop_event);
        state.save(&cursor_path)?;
        if stop_event.wait(Duration::ZERO)? {
            return Ok(0);
        }
        if once {
            return Ok(0);
        }

        platform::trim_idle_working_set();
        let deadline = Instant::now() + RECONCILE_INTERVAL;
        loop {
            if stop_event.wait(Duration::ZERO)? {
                return Ok(0);
            }
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(now);
            let wait_for = remaining.min(WORKSPACE_WAIT_SLICE);
            let _ = wake_event.wait(wait_for)?;

            if indexing_disabled(&control_dir) {
                platform::trim_idle_working_set();
                continue;
            }

            let _ = workspace::refresh_hot_workspace(&control_dir, &data_dir, Some(&stop_event));
            platform::trim_idle_working_set();
        }
    }
}

fn reconcile(
    data_dir: &Path,
    control_dir: &Path,
    state: &mut CursorState,
    stop_event: &StopEvent,
) {
    let now = unix_now();
    for drive in platform::fixed_drive_letters() {
        if stop_event.wait(Duration::ZERO).unwrap_or(true) {
            return;
        }

        let snapshot_current = index::snapshot_is_current(data_dir, drive);
        let current = platform::query_usn_marker(drive).ok();
        let Some(previous) = state.get(drive) else {
            rebuild_snapshot(drive, data_dir, control_dir, state, now, current, stop_event);
            continue;
        };

        if !snapshot_current {
            rebuild_snapshot(drive, data_dir, control_dir, state, now, current, stop_event);
            continue;
        }

        let snapshot_due = now.saturating_sub(previous.last_scan_unix)
            >= FULL_SNAPSHOT_INTERVAL.as_secs();
        let delta_too_large = delta::delta_size(data_dir, drive) >= MAX_DELTA_BYTES;

        match current {
            Some(marker) => {
                if snapshot_due
                    || delta_too_large
                    || !previous.journal_supported
                    || previous.journal_id != marker.journal_id
                    || previous.next_usn > marker.next_usn
                {
                    rebuild_snapshot(
                        drive,
                        data_dir,
                        control_dir,
                        state,
                        now,
                        Some(marker),
                        stop_event,
                    );
                    continue;
                }

                if previous.next_usn == marker.next_usn {
                    state.upsert(VolumeCursor {
                        last_seen_unix: now,
                        ..previous
                    });
                    continue;
                }

                let batch = match usn::read_changes(
                    drive,
                    previous.next_usn,
                    marker.next_usn,
                    marker.journal_id,
                    MAX_USN_RECORDS_PER_PASS,
                ) {
                    Ok(batch) if batch.complete => batch,
                    _ => {
                        rebuild_snapshot(
                            drive,
                            data_dir,
                            control_dir,
                            state,
                            now,
                            Some(marker),
                            stop_event,
                        );
                        continue;
                    }
                };

                if stop_event.wait(Duration::ZERO).unwrap_or(true) {
                    return;
                }

                let applied = match delta::apply_changes(drive, data_dir, &batch.changes) {
                    Ok(result) if !result.requires_full_scan => result,
                    _ => {
                        rebuild_snapshot(
                            drive,
                            data_dir,
                            control_dir,
                            state,
                            now,
                            Some(marker),
                            stop_event,
                        );
                        continue;
                    }
                };

                let _ = applied.records;
                state.upsert(VolumeCursor {
                    drive,
                    journal_supported: true,
                    journal_id: marker.journal_id,
                    next_usn: batch.next_usn,
                    last_scan_unix: previous.last_scan_unix,
                    last_seen_unix: now,
                });
            }
            None => {
                if previous.journal_supported || snapshot_due {
                    rebuild_snapshot(drive, data_dir, control_dir, state, now, None, stop_event);
                } else {
                    state.upsert(VolumeCursor {
                        last_seen_unix: now,
                        ..previous
                    });
                }
            }
        }
    }
}

fn rebuild_snapshot(
    drive: u8,
    data_dir: &Path,
    control_dir: &Path,
    state: &mut CursorState,
    now: u64,
    before: Option<platform::UsnMarker>,
    stop_event: &StopEvent,
) {
    if index::scan_volume(drive, data_dir, control_dir, Some(stop_event)).is_err() {
        return;
    }
    if stop_event.wait(Duration::ZERO).unwrap_or(true) {
        return;
    }

    let _ = delta::clear(data_dir, drive);
    let after = platform::query_usn_marker(drive).ok().or(before);
    state.upsert(VolumeCursor {
        drive,
        journal_supported: after.is_some(),
        journal_id: after.map_or(0, |marker| marker.journal_id),
        next_usn: after.map_or(0, |marker| marker.next_usn),
        last_scan_unix: now,
        last_seen_unix: now,
    });
}

fn option_path(arguments: &[String], name: &str) -> Option<PathBuf> {
    for (index, argument) in arguments.iter().enumerate() {
        if argument.eq_ignore_ascii_case(name) {
            return arguments
                .get(index + 1)
                .filter(|value| !value.starts_with("--"))
                .map(PathBuf::from);
        }
        let prefix = format!("{name}=");
        if argument.len() > prefix.len() && argument[..prefix.len()].eq_ignore_ascii_case(&prefix) {
            return Some(PathBuf::from(&argument[prefix.len()..]));
        }
    }
    None
}

fn indexing_disabled(control_dir: &Path) -> bool {
    control_dir.join("indexing.disabled").is_file()
}

fn data_directory() -> io::Result<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA").ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is not available")
    })?;
    Ok(PathBuf::from(local_app_data).join("Xplorer").join("Index"))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

struct WorkerPidFile {
    path: PathBuf,
    pid: u32,
}

impl WorkerPidFile {
    fn publish(control_dir: &Path) -> io::Result<Self> {
        let path = control_dir.join(WORKER_PID_FILE);
        let pid = std::process::id();
        let temp = control_dir.join(format!("{WORKER_PID_FILE}.{pid}.tmp"));
        fs::write(&temp, pid.to_string())?;
        fs::rename(&temp, &path).or_else(|_| {
            let _ = fs::remove_file(&path);
            fs::rename(&temp, &path)
        })?;
        Ok(Self { path, pid })
    }
}

impl Drop for WorkerPidFile {
    fn drop(&mut self) {
        // Do not remove a pid file that has already been replaced by a newer worker instance.
        let matches = fs::read_to_string(&self.path)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            == Some(self.pid);
        if matches {
            let _ = fs::remove_file(&self.path);
        }
    }
}

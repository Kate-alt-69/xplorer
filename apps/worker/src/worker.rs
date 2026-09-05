use std::{
    env,
    ffi::OsString,
    fs,
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    delta, index,
    platform::{self, SingleInstanceMutex, StopEvent},
    state::{CursorState, VolumeCursor},
    usn,
};

const RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const FULL_SNAPSHOT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const IDLE_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DELTA_BYTES: u64 = 4 * 1024 * 1024;
const MAX_USN_RECORDS_PER_PASS: usize = 4096;

pub fn run<I>(arguments: I) -> io::Result<i32>
where
    I: Iterator<Item = OsString>,
{
    let arguments: Vec<String> = arguments
        .map(|value| value.to_string_lossy().into_owned())
        .collect();

    if arguments.iter().any(|value| value == "--register-startup") {
        platform::register_startup()?;
        return Ok(0);
    }

    if arguments.iter().any(|value| value == "--unregister-startup") {
        platform::unregister_startup()?;
        return Ok(0);
    }

    if arguments.iter().any(|value| value == "--stop-service-worker") {
        let _ = platform::signal_stop_event()?;
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

    run_worker(once)
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

fn run_worker(once: bool) -> io::Result<i32> {
    let Some(_instance) = SingleInstanceMutex::acquire()? else {
        return Ok(0);
    };

    let stop_event = StopEvent::create_for_worker()?;
    platform::enter_background_mode();
    let data_dir = data_directory()?;
    fs::create_dir_all(&data_dir)?;
    let cursor_path = data_dir.join("cursor.bin");
    let mut state = CursorState::load(&cursor_path)?;

    loop {
        reconcile(&data_dir, &mut state, &stop_event);
        state.save(&cursor_path)?;

        // A stop request may arrive while a paced full-volume snapshot is in progress. Check again
        // before entering the normal 30-minute idle wait so Settings -> Background indexing: Off
        // takes effect promptly even on very large disks.
        if stop_event.wait(Duration::ZERO)? {
            return Ok(0);
        }

        if once {
            return Ok(0);
        }
        platform::trim_idle_working_set();
        if stop_event.wait(RECONCILE_INTERVAL)? {
            return Ok(0);
        }
    }
}

fn reconcile(data_dir: &Path, state: &mut CursorState, stop_event: &StopEvent) {
    let now = unix_now();
    for drive in platform::fixed_drive_letters() {
        if stop_event.wait(Duration::ZERO).unwrap_or(true) {
            return;
        }

        let snapshot_current = index::snapshot_is_current(data_dir, drive);
        let current = platform::query_usn_marker(drive).ok();
        let Some(previous) = state.get(drive) else {
            rebuild_snapshot(drive, data_dir, state, now, current, stop_event);
            continue;
        };

        if !snapshot_current {
            rebuild_snapshot(drive, data_dir, state, now, current, stop_event);
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
                    rebuild_snapshot(drive, data_dir, state, now, Some(marker), stop_event);
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
                        rebuild_snapshot(drive, data_dir, state, now, Some(marker), stop_event);
                        continue;
                    }
                };

                if stop_event.wait(Duration::ZERO).unwrap_or(true) {
                    return;
                }

                let applied = match delta::apply_changes(drive, data_dir, &batch.changes) {
                    Ok(result) if !result.requires_full_scan => result,
                    _ => {
                        rebuild_snapshot(drive, data_dir, state, now, Some(marker), stop_event);
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
                if previous.journal_supported
                    || now.saturating_sub(previous.last_scan_unix) >= RECONCILE_INTERVAL.as_secs()
                {
                    rebuild_snapshot(drive, data_dir, state, now, None, stop_event);
                }
            }
        }
    }
}

fn rebuild_snapshot(
    drive: u8,
    data_dir: &Path,
    state: &mut CursorState,
    now: u64,
    before: Option<platform::UsnMarker>,
    stop_event: &StopEvent,
) {
    if index::scan_volume(drive, data_dir, Some(stop_event)).is_err() {
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

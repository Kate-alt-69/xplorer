use std::{
    env,
    ffi::OsString,
    fs,
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    index,
    platform::{self, SingleInstanceMutex, StopEvent, UsnMarker},
    state::{CursorState, VolumeCursor},
};

const RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);

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

    let service_worker = arguments.iter().any(|value| value == "--service-worker");
    let once = arguments.iter().any(|value| value == "--once" || value == "--scan-once");
    if !service_worker && !once {
        return Ok(2);
    }

    run_worker(once)
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
        reconcile(&data_dir, &mut state);
        state.save(&cursor_path)?;

        if once || stop_event.wait(RECONCILE_INTERVAL)? {
            return Ok(0);
        }
    }
}

fn reconcile(data_dir: &Path, state: &mut CursorState) {
    let now = unix_now();
    for drive in platform::fixed_drive_letters() {
        let snapshot_exists = index::snapshot_path(data_dir, drive).is_file();
        let before = platform::query_usn_marker(drive).ok();
        let previous = state.get(drive);

        if !needs_scan(snapshot_exists, previous, before, now) {
            continue;
        }

        if index::scan_volume(drive, data_dir).is_err() {
            continue;
        }

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
}

fn needs_scan(
    snapshot_exists: bool,
    previous: Option<VolumeCursor>,
    current_usn: Option<UsnMarker>,
    now: u64,
) -> bool {
    if !snapshot_exists {
        return true;
    }

    let Some(previous) = previous else {
        return true;
    };

    match current_usn {
        Some(marker) => {
            !previous.journal_supported
                || previous.journal_id != marker.journal_id
                || previous.next_usn != marker.next_usn
        }
        None => now.saturating_sub(previous.last_scan_unix) >= RECONCILE_INTERVAL.as_secs(),
    }
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

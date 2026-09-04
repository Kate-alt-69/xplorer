# Xplorer Rust host / background worker

`xplorer.exe` is now the public low-resource Rust process for the native Xplorer rewrite. It has no WebView, network client, AI runtime, async runtime, logging framework, or tray icon.

## One executable, two modes

- normal `xplorer.exe` launch forwards the original arguments to the sibling `Xplorer.Native.exe` WinUI application and exits;
- `xplorer.exe --service-worker` stays entirely inside Rust and never loads WinUI or .NET;
- `--register-startup` creates the reversible per-user `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry pointing back to the same `xplorer.exe --service-worker`;
- `--unregister-startup` removes only the Xplorer-owned startup value;
- `--stop-service-worker` signals a named Windows event so a running worker exits immediately instead of waiting for its 30-minute sleep interval;
- `--idle-probe` starts the worker primitives without scanning a drive so CI can measure the real Windows process footprint.

A named Windows mutex (`Local\\Xplorer.IndexWorker.v1`) guarantees one worker instance per user session. Release builds use the Windows GUI subsystem, so startup creates neither a console window nor a tray icon. The worker asks Windows for background scheduling and falls back to the idle priority class.

The WinUI build copies the release Rust host beside `Xplorer.Native.exe`. Windows Shell verbs prefer the Rust `xplorer.exe`, so shell launches and worker startup share one stable public executable while the UI remains a native WinUI process behind it.

## Indexing

The first pass writes one compact, streaming metadata snapshot per fixed drive under `%LOCALAPPDATA%\\Xplorer\\Index`:

- `C.xidx`, `D.xidx`, etc. contain UTF-16 relative paths, Windows attributes, file size, and last-write FILETIME.
- `cursor.bin` stores the per-volume USN journal id + `NextUsn` cursor and the last completed scan time.
- reparse-point directories are recorded but not traversed, preventing junction/symlink loops.
- the Xplorer index directory excludes itself from the crawl.
- snapshots are written to a temporary file and atomically replaced after a successful scan.

The crawler uses two logical pacing budgets:

- directory traversal/index record discovery: **24 KiB/s** estimated metadata work;
- metadata capture: **488 KiB/s** estimated metadata work;
- combined policy target: **512 KiB/s**.

This is intentionally a logical metadata-work throttle, not a claim that every cached kernel read can be byte-perfectly throttled. The worker never reads ordinary file contents while building the index.

## USN behavior

On NTFS volumes where the current user can query the USN Change Journal, the worker stores the journal id and `NextUsn`. Every 30 minutes it checks that marker. If nothing changed, the drive is not rescanned and disk activity stays at zero. If the journal changes, this first implementation performs another paced reconciliation scan.

The next worker pass will replay USN records into a delta log so ordinary file changes no longer require a full reconciliation scan. Volumes where USN is unavailable fall back to the paced 30-minute metadata reconciliation.

## Memory target

The design keeps only the current directory traversal state, one metadata record, small buffered writes, and at most 26 volume cursors alive. CI has an idle probe that reports both total working set and private committed memory without performing a drive scan. The optimization target remains under 1 MiB of Xplorer-owned/private idle memory; mapped Windows DLL/code pages are reported separately by the working-set metric.

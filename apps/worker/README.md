# Xplorer background worker

`xplorer-worker` is the low-resource Rust sidecar for the native Xplorer rewrite. It has no UI, tray icon, WebView, network client, AI runtime, async runtime, or logging framework.

## Current worker contract

- `xplorer-worker.exe --service-worker` starts the headless worker.
- `--register-startup` creates the reversible per-user `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry.
- `--unregister-startup` removes only the Xplorer-owned startup value.
- a named Windows mutex (`Local\\Xplorer.IndexWorker.v1`) guarantees one worker instance per user session.
- release builds use the Windows GUI subsystem so Registry startup does not create a console window or tray icon.
- the process asks Windows for background scheduling and falls back to the idle priority class.

The current WinUI shell is still a .NET executable, so this first pass is a separate Rust binary. The intended end state is a Rust-owned Xplorer process host where the same executable can dispatch `xplorer.exe --service-worker` without loading WinUI/.NET for worker mode.

## Indexing

The first pass writes one compact, streaming metadata snapshot per fixed drive under `%LOCALAPPDATA%\\Xplorer\\Index`:

- `C.xidx`, `D.xidx`, etc. contain UTF-16 relative paths, Windows attributes, file size, and last-write FILETIME.
- `cursor.bin` stores the per-volume USN journal id + `NextUsn` cursor and the last completed scan time.
- reparse-point directories are recorded but not traversed, preventing junction/symlink loops.
- the Xplorer index directory excludes itself from the crawl.
- snapshots are written to a temporary file and replaced with `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` after a successful scan.

The crawler uses two logical pacing budgets:

- directory traversal/index record discovery: **24 KiB/s** estimated metadata work;
- metadata capture: **488 KiB/s** estimated metadata work;
- combined policy target: **512 KiB/s**.

This is intentionally a logical metadata-work throttle, not a promise that every kernel cache/page read is exactly byte-limited. The worker never reads ordinary file contents while building this index.

## USN behavior

On NTFS volumes where the current user can query the USN Change Journal, the worker stores the journal id and `NextUsn`. Every 30 minutes it checks that marker. If nothing changed, the drive is not rescanned and disk activity stays at zero. If the journal changes, this first implementation performs another paced reconciliation scan.

The next worker pass will replay USN records into a delta log so ordinary file changes no longer require a full reconciliation scan. Volumes where USN is unavailable fall back to the paced 30-minute metadata reconciliation.

## Memory target

The design keeps only the current directory traversal state, one metadata record, small buffered writes, and at most 26 volume cursors alive. The optimization target is **under 1 MiB of worker-owned heap/state while idle**. Actual Task Manager working set/private commit also includes the PE image, thread stack, loader structures, and mapped Windows DLL pages and must be measured on a real Windows desktop before claiming a sub-1-MiB process footprint.

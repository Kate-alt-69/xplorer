# Xplorer Rust host / background worker

`xplorer.exe` is the public low-resource Rust process for the native Xplorer rewrite. It has no WebView, network client, AI runtime, async runtime, logging framework, or tray icon.

## One executable, two modes

- normal `xplorer.exe` launch forwards the original arguments to the sibling `Xplorer.Native.exe` WinUI application and exits;
- `xplorer.exe --service-worker` stays entirely inside Rust and never loads WinUI or .NET;
- `--register-startup` creates the reversible per-user `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry pointing back to the same `xplorer.exe --service-worker`;
- `--unregister-startup` removes only the Xplorer-owned startup value;
- `--stop-service-worker` signals a named Windows event so a running worker exits immediately instead of waiting for its 30-minute sleep interval;
- `--idle-probe` starts the worker primitives without scanning a drive so CI can measure the real Windows process footprint.

A named Windows mutex (`Local\\Xplorer.IndexWorker.v1`) guarantees one worker instance per user session. Release builds use the Windows GUI subsystem, so startup creates neither a console window nor a tray icon. The worker asks Windows for background scheduling and trims reclaimable resident pages before each long idle wait.

The WinUI package keeps the Rust host beside `Xplorer.Native.exe`. Windows Shell verbs prefer the Rust `xplorer.exe`, so shell launches and worker startup share one stable public executable while the UI remains native WinUI.

## Indexing

The first pass writes one compact, streaming metadata snapshot per fixed drive under `%LOCALAPPDATA%\\Xplorer\\Index`:

- `C.xidx`, `D.xidx`, etc. contain UTF-16 relative paths, Windows attributes, file size, and last-write FILETIME;
- `C.xdelta`, `D.xdelta`, etc. contain small append-only metadata upserts/tombstones replayed from the NTFS USN journal;
- `cursor.bin` stores the per-volume USN journal id + `NextUsn` cursor and the last completed full snapshot time;
- reparse-point directories are recorded but not traversed, preventing junction/symlink loops;
- the Xplorer index directory excludes itself from the crawl;
- snapshots are written to a temporary file and atomically replaced after a successful scan.

The crawler uses two logical pacing budgets: **24 KiB/s** for directory discovery and **488 KiB/s** for metadata capture, for the requested **512 KiB/s combined policy target**. It never reads ordinary file contents while indexing.

## USN incremental behavior

Every 30 minutes the worker queries the NTFS USN Change Journal. If the cursor has not moved, the drive stays untouched. If it has moved, Xplorer reads only records since the stored cursor and resolves the affected parent directory by NTFS file id. Normal file creates, edits, deletes and renames become tiny append-only delta records instead of triggering a full-drive crawl.

The worker deliberately falls back to the slow paced full snapshot when correctness is ambiguous: journal reset/wrap, unsupported USN record versions, very large bursts, hard-link topology changes, directory rename/delete, inaccessible parent ids, a delta log above 4 MiB, or the normal 24-hour compaction pass. A successful full snapshot clears that volume's delta log and resets its cursor.

This makes the USN journal an optimization, not a single point of correctness. Non-NTFS / unavailable-journal volumes continue using the paced 30-minute metadata reconciliation.

## Memory target

The idle worker retains only a mutex/event, a few cursors, and tiny process state. Windows CI previously measured **820 KiB private memory** before the working-set trim pass; after explicit idle trimming the resident working set dropped to roughly **296 KiB** in one CI run. Exact Task Manager figures vary by Windows build and mapped system pages, so CI keeps reporting both working-set and private-memory measurements instead of hiding either number.

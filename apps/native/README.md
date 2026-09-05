# Xplorer native rewrite

This directory contains the Windows-native Xplorer file manager milestone on `rewrite/native-winui`.

## Architecture

- **Public host / worker:** tiny Rust `xplorer.exe`.
- **Visible UI:** WinUI 3 / Windows App SDK in `Xplorer.Native.exe`.
- Normal `xplorer.exe` launches the WinUI UI and exits; `xplorer.exe --service-worker` stays entirely in Rust and does not load .NET or WinUI.
- No HTML/React/Tailwind/WebView, AI chat, agents, model providers, Ollama, MCP, or network-dependent file-management runtime.
- `explorer.exe` is never replaced or injected into. Xplorer integrates using reversible per-user Shell verbs and native Shell APIs.

## Implemented native milestone

- One real native tab strip with independent navigation history and tab-session restore.
- Saved normal window size/position/maximized state, clamped back onto an available monitor on restore.
- Dense Medium/Large tile views and a native Details view with lazy Windows thumbnails.
- File Tree removed; fixed-disk partitions never show a fake Eject control.
- Back/Forward/Up/Refresh/Terminal live in the bottom navigation strip.
- Compact native Settings dialog with explicit toggles, global view/sort defaults, and optional per-folder overrides.
- Windows Terminal launch plus optional custom terminal command/arguments.
- Windows Shell item/background context menus with `IContextMenu2` / `IContextMenu3` forwarding and multi-selection support.
- Reversible `Open in Xplorer` Shell entries for folders, drives, folder backgrounds, and the Windows desktop background.
- Explorer-compatible copy/cut clipboard data, native `IFileOperation` copy/move/delete, Recycle Bin, conflicts, elevation, progress and cancellation.
- Explorer-style F2 rename, New Folder, native drag/drop, and common Explorer keyboard shortcuts.
- Deterministic local search. With the Rust metadata index available, Ctrl+F searches recursively from the current folder without reading file contents; without an index it falls back to the immediate folder.
- Slow Rust metadata indexer with a 24 KiB/s directory-discovery budget + 488 KiB/s metadata budget, NTFS USN cursors, bounded append-only metadata deltas, 24-hour snapshot compaction, and safe full-scan fallback when journal replay is ambiguous.
- Safe data-only XML themes under `%LOCALAPPDATA%\Xplorer\Themes`, with validation and hot reload. Arbitrary executable XAML is not loaded.
- Rust host fallback to Windows Explorer if the WinUI sidecar is missing during an otherwise valid Xplorer Shell launch.

## Portable x64 build

Requirements: Windows 10 1809+ / Windows 11, Rust stable, .NET 10 SDK, and the Windows/Visual Studio build prerequisites needed by WinUI 3.

From the repository root:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-native.ps1 -Configuration Release -Runtime win-x64 -Package
```

Outputs:

```text
dist\Xplorer-win-x64\
dist\Xplorer-win-x64.zip
```

Launch:

```powershell
.\dist\Xplorer-win-x64\xplorer.exe
```

Worker controls:

```powershell
.\dist\Xplorer-win-x64\xplorer.exe --service-worker
.\dist\Xplorer-win-x64\xplorer.exe --register-startup
.\dist\Xplorer-win-x64\xplorer.exe --unregister-startup
.\dist\Xplorer-win-x64\xplorer.exe --stop-service-worker
```

## Deliberately conservative areas

- Removable-device safe eject is not exposed until a capability-based device implementation has been runtime-tested; internal partitions remain non-ejectable.
- Size Map remains a follow-up visualization rather than shipping a fake placeholder implementation.
- Windows Shell extensions, USN replay, drag/drop and registry integration compile in CI but still deserve interactive validation on real end-user Windows installations before this branch is called production-stable.

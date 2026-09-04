# Xplorer Native UI rewrite

This directory contains the Windows-native replacement for the React/WebView shell.

## Direction

- **UI:** WinUI 3 / Windows App SDK. No HTML, React, Tailwind, or WebView for the main file manager UI.
- **Windows support:** Windows 10 1809+ and Windows 11.
- **Migration:** the existing Tauri application remains intact while native parity is built. Advanced Rust services can then be extracted behind a narrow native bridge instead of being rewritten all at once.
- **Context menus:** file/folder item menus are sourced from the Windows Shell via `IContextMenu`. Xplorer should integrate with Windows rather than draw fake Explorer menus.
- **Settings:** a compact native `ContentDialog`, with global settings by default and optional per-folder view overrides.
- **Terminal:** always launch through Windows Terminal (`wt.exe`). The default Windows Terminal profile is used unless a custom command is configured.
- **Drives:** fixed disks/partitions never expose Eject. Device-eject support must be capability-based and conservative.
- **File tree:** intentionally removed from the native sidebar.
- **Navigation:** Back / Forward / Up / Refresh live in the bottom status/navigation strip so they are not duplicated above the file view.
- **Thumbnails:** generated lazily through Windows Storage thumbnail APIs for visible items only.

## Build

```powershell
cd apps/native/Xplorer.Native
dotnet restore
dotnet build -c Debug -p:Platform=x64
dotnet run -c Debug -p:Platform=x64
```

The project targets .NET 10 and Windows App SDK 2.4.0.

## Next native passes

1. Finish shell context menu message forwarding (`IContextMenu2` / `IContextMenu3`) for dynamic third-party submenus.
2. Add a real native background/folder context menu host so registered background extensions appear too.
3. Port tab state, split panes, copy/cut/paste/delete, drag/drop and file-operation progress.
4. Replace the conservative removable-drive flag with Windows device capability discovery + safe eject.
5. Extract the useful Rust indexer/AI/file-operation services from the Tauri command layer behind a native IPC/FFI boundary.
6. Add Windows shell registration/unregistration with an owned registry manifest so uninstall removes only keys Xplorer created.

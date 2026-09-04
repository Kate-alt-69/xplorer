# Xplorer Native UI rewrite

This directory contains the Windows-native replacement for the React/WebView shell.

## Direction

- **UI:** WinUI 3 / Windows App SDK. No HTML, React, Tailwind, or WebView for the main file manager UI.
- **Windows support:** Windows 10 1809+ and Windows 11.
- **Migration:** the existing Tauri application remains intact while native parity is built. Advanced Rust services can then be extracted behind a narrow native bridge instead of being rewritten all at once.
- **Context menus:** file/folder menus are sourced from the Windows Shell. `IContextMenu2` / `IContextMenu3` messages are forwarded so dynamic and owner-drawn third-party submenus can work instead of being redrawn by Xplorer.
- **Folder background RMB:** Xplorer owns only view-level commands such as View / Sort / Refresh; Windows supplies the registered folder-background verbs and shell extensions.
- **Settings:** a compact native `ContentDialog`, with global view/sort settings by default and optional per-folder overrides.
- **Terminal:** launch through Windows Terminal (`wt.exe`). The default Windows Terminal profile is used unless a custom command is configured.
- **Drives:** fixed disks/partitions never expose Eject. Device-eject support must be capability-based and conservative.
- **File tree:** intentionally removed from the native sidebar.
- **Navigation:** Back / Forward / Up / Refresh live in the bottom status/navigation strip so they are not duplicated above the file view.
- **Tabs:** one real native tab strip. Each tab owns its current path and independent Back/Forward history.
- **Views:** dense Medium/Large tile views plus a native Details list. View + sort choices persist globally by default.
- **Thumbnails:** generated lazily through Windows Storage thumbnail APIs for visible items only.

## Build

```powershell
cd apps/native/Xplorer.Native
dotnet restore -p:Platform=x64 -p:RuntimeIdentifier=win-x64
dotnet build -c Debug -p:Platform=x64 -p:RuntimeIdentifier=win-x64
dotnet run -c Debug -p:Platform=x64 -p:RuntimeIdentifier=win-x64
```

The project targets .NET 10 and Windows App SDK 2.4.0.

## Implemented native passes

1. WinUI shell + dense file grid + lazy Windows thumbnails.
2. Conservative fixed/removable drive detection with no fake eject button on SSD partitions.
3. Windows Terminal launcher and custom terminal command settings.
4. Windows Shell item context menus with `IContextMenu2` / `IContextMenu3` message forwarding.
5. Windows Shell folder-background context menu host combined with Xplorer View / Sort / Refresh controls.
6. One native tab strip with per-tab navigation history.
7. Global-by-default view + sort persistence, with optional per-folder overrides.
8. Compact settings popup and a dedicated right rail that cannot overlap the file view controls.
9. Windows CI build for the native project.

## Next native passes

1. Port real copy/cut/paste/delete, rename, drag/drop and progress/cancellation.
2. Add multi-selection Shell context menus instead of the current single-item shell menu host.
3. Add native file operation conflict handling (replace / skip / keep both / apply to all).
4. Add capability-based removable-device eject through Windows device APIs.
5. Extract the useful Rust indexer/AI/file-operation services from the Tauri command layer behind a native IPC/FFI boundary.
6. Add Windows shell registration/unregistration with an owned registry manifest so uninstall removes only keys Xplorer created.
7. Add session restore for tabs and window layout.

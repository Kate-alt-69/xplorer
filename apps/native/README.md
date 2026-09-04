# Xplorer Native UI rewrite

This directory contains the Windows-native Xplorer file manager.

## Direction

- **UI:** WinUI 3 / Windows App SDK. No HTML, React, Tailwind, WebView, AI chat, agents, LLM providers, Ollama, or MCP in the file-manager runtime.
- **Windows support:** Windows 10 1809+ and Windows 11.
- **Legacy code:** the old React/Tauri file-manager implementation is intentionally removed from this rewrite branch. Git history remains available when an old non-AI idea is worth salvaging.
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
4. Real Windows Shell item and folder-background context menus with `IContextMenu2` / `IContextMenu3` forwarding.
5. One native tab strip with independent per-tab navigation history.
6. Global-by-default view + sort persistence, with optional per-folder overrides.
7. Compact settings popup and dedicated right rail that cannot overlap file-view controls.
8. Windows CI build for the native x64 project.
9. Explorer-compatible Copy/Cut clipboard data plus Shell-backed paste/move/delete and Recycle Bin behavior.
10. Multi-selection Windows Shell context menus.
11. Reversible per-user Windows Shell registration owned by Xplorer.
12. Explorer-style F2 rename with Windows filename validation.
13. Native tab-session restore, including the active tab and Back/Forward stacks.
14. Explorer-style New folder command with `Ctrl+Shift+N` and immediate rename.
15. Explorer keyboard navigation: `Ctrl+L`, `Ctrl+T`, `Ctrl+W`, `F5`, `Alt+Left`, `Alt+Right`, and `Alt+Up`.

## Next native passes

1. Move the file-operation backend from legacy `SHFileOperation` to `IFileOperation` for richer per-item progress, cancellation, and conflict reporting.
2. Add native drag/drop in both directions while preserving Windows copy-vs-move semantics.
3. Add capability-based removable-device eject through Windows device APIs.
4. Add fast native search/indexing without coupling the file manager to an AI runtime.
5. Finish Size Map as a native disk-usage visualization rather than a placeholder button.
6. Restore window size/position alongside the existing tab session.

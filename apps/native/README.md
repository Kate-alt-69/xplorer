# Xplorer Native UI rewrite

This directory contains the Windows-native Xplorer file manager.

## Direction

- **Public process:** `xplorer.exe` is a tiny Rust host. Normal launches forward to the sibling WinUI UI; `xplorer.exe --service-worker` stays Rust-only and never loads .NET/WinUI.
- **UI:** WinUI 3 / Windows App SDK. No HTML, React, Tailwind, WebView, AI chat, agents, LLM providers, Ollama, or MCP in the file-manager runtime.
- **Windows support:** Windows 10 1809+ and Windows 11.
- **Legacy code:** the old React/Tauri file-manager implementation is intentionally removed from this rewrite branch. Git history remains available when an old non-AI idea is worth salvaging.
- **Context menus:** file/folder menus are sourced from the Windows Shell. `IContextMenu2` / `IContextMenu3` messages are forwarded so dynamic and owner-drawn third-party submenus can work instead of being redrawn by Xplorer.
- **Folder background RMB:** Xplorer owns only view-level commands such as View / Sort / Refresh; Windows supplies the registered folder-background verbs and shell extensions.
- **File operations:** copy/move/delete use the modern Windows `IFileOperation` stack so Windows owns native progress, cancellation, elevation, conflict prompts, apply-to-all behavior, undo records, and Recycle Bin semantics.
- **Search:** current-folder search is deterministic filename/type matching with no model, embeddings, network call, or background AI runtime.
- **Settings:** a compact native `ContentDialog`, with global view/sort settings by default and optional per-folder overrides.
- **Themes:** optional hot-reloaded XML themes use a strict data-only Xplorer schema, not executable XAML.
- **Terminal:** launch through Windows Terminal (`wt.exe`). The default Windows Terminal profile is used unless a custom command is configured.
- **Drives:** fixed disks/partitions never expose Eject. Device-eject support must be capability-based and conservative.
- **File tree:** intentionally removed from the native sidebar.
- **Navigation:** Back / Forward / Up / Refresh live in the bottom status/navigation strip so they are not duplicated above the file view.
- **Tabs:** one real native tab strip. Each tab owns its current path and independent Back/Forward history.
- **Views:** dense Medium/Large tile views plus a native Details list. View + sort choices persist globally by default.
- **Thumbnails:** generated lazily through Windows Storage thumbnail APIs for visible items only.
- **Background indexing:** Rust worker mode owns slow metadata indexing and USN cursors with no UI/tray process.

## Build

The CI/package order is Rust first, then WinUI so the Rust public host is copied into the native output:

```powershell
cargo build --manifest-path apps/worker/Cargo.toml --release
cd apps/native/Xplorer.Native
dotnet restore -p:Platform=x64 -p:RuntimeIdentifier=win-x64
dotnet build -c Debug -p:Platform=x64 -p:RuntimeIdentifier=win-x64
```

The UI targets .NET 10 and Windows App SDK 2.4.0. The Rust release profile uses size optimization, LTO, one codegen unit, panic abort, and stripped symbols.

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
16. Modern `IFileOperation` copy/move/delete backend with native Windows progress, cancellation, conflict handling, elevation, undo, and Recycle Bin behavior.
17. Native current-folder filename/type search, wired to `Ctrl+F` and the Search rail button, with no AI runtime.
18. Native file drag/drop in both directions with Windows copy-vs-move semantics and Shell-backed operations.
19. Safe XML theme loader with strict versioned fields, size limits, no DTD/external entities, layout clamps, and hot reload.
20. Rust-owned public `xplorer.exe` with the same executable dispatching `--service-worker`, startup registration, shell launches, and the WinUI frontend.

## XML themes

Selecting `Custom XML` creates/uses `%LOCALAPPDATA%\\Xplorer\\Themes\\default.xml`. Theme files are capped at 64 KiB, cannot leave that folder, reject unknown fields, prohibit DTD/external entity processing, and only expose approved colors/layout/tile dimensions. Editing the active XML file is hot-reloaded while Xplorer is open.

## Next native passes

1. Replay USN journal records into incremental index deltas instead of using the journal only as a reconciliation trigger.
2. Connect indexed/recursive search to the Rust-maintained snapshots through a tiny local contract.
3. Add capability-based removable-device eject through Windows device APIs.
4. Finish Size Map as a native disk-usage visualization rather than a placeholder button.
5. Restore window size/position alongside the existing tab session.
6. Add richer operation-status integration without replacing Windows-owned conflict/progress UI.

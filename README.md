# Xplorer Native

Xplorer is being rebuilt as a **fast Windows-native file manager** using a tiny Rust public host/background worker plus **WinUI 3 / Windows App SDK** for the visible UI.

This branch deliberately does **not** ship a WebView frontend, AI chat, agents, LLM providers, MCP servers, Ollama integration, semantic-AI pipelines, or agentic file operations. A file manager should browse and manage files quickly and predictably.

> Branch: `rewrite/native-winui`
>
> The older React/Tauri implementation still exists in Git history and on the original development branches, but it is intentionally removed from this native rewrite branch.

## Current native direction

- `xplorer.exe` is the public Rust entry point; normal launches forward to `Xplorer.Native.exe`, while `--service-worker` remains Rust-only.
- One native tab strip instead of duplicated tab chrome.
- Windows-native file/folder browsing with WinUI controls.
- Real Windows Shell context menus through `IShellFolder` / `IContextMenu`.
- `IContextMenu2` / `IContextMenu3` message forwarding for dynamic and owner-drawn shell extensions.
- Explorer-compatible Copy/Cut clipboard data using `CF_HDROP` and `Preferred DropEffect`.
- Copy, move, delete and Recycle Bin behavior delegated to the Windows Shell.
- Dense file layouts with larger visible icons and lazy OS thumbnails.
- Global view/sort settings by default, with optional per-folder overrides.
- Settings in a native popup instead of replacing the entire file-manager window.
- Windows Terminal integration with optional custom terminal commands.
- Internal fixed SSD partitions never receive a fake eject button.
- Reversible per-user Windows Shell registration with Xplorer-owned registry markers.
- Slow local Rust metadata indexing with a 512 KiB/s combined pacing target and NTFS USN cursors.
- Strict data-only XML themes with hot reload; no arbitrary executable XAML.
- No `explorer.exe` replacement, injection, or global process hooks.

## Build the portable x64 ZIP

### Requirements

- Windows 10 1809+ or Windows 11
- Rust stable (`rustup` + Cargo)
- .NET 10 SDK
- Visual Studio / Windows SDK prerequisites needed by WinUI 3 builds

From the repository root, run:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-native.ps1 -Configuration Release -Runtime win-x64 -Package
```

The script builds the optimized Rust `xplorer.exe`, publishes the WinUI frontend self-contained, copies both into one portable directory, and creates:

```text
dist\Xplorer-win-x64\
dist\Xplorer-win-x64.zip
```

Run the built application with:

```powershell
.\dist\Xplorer-win-x64\xplorer.exe
```

Useful worker commands:

```powershell
.\dist\Xplorer-win-x64\xplorer.exe --service-worker
.\dist\Xplorer-win-x64\xplorer.exe --register-startup
.\dist\Xplorer-win-x64\xplorer.exe --unregister-startup
.\dist\Xplorer-win-x64\xplorer.exe --stop-service-worker
```

The GitHub Actions workflow `.github/workflows/native-winui.yml` runs the same portable x64 packaging path and uploads `Xplorer-win-x64.zip` as a workflow artifact.

## Repository layout

```text
xplorer/
├── apps/
│   ├── native/           # WinUI 3 desktop file manager
│   ├── worker/           # Rust public host + metadata index worker
│   └── web/              # Separate Xplorer website / marketplace
├── packages/             # Extension SDK, CLI and related packages
├── infra/                # Marketplace infrastructure
└── scripts/              # Build / repository tooling
```

The old `apps/client` React file manager and `apps/src-tauri` desktop backend are intentionally absent from this branch. Useful non-AI behavior can be ported into the native implementation deliberately instead of carrying the old WebView/agent architecture forward.

## Product rule

**Core file management stays local, deterministic, native, and boring in the good way.**

Search can be fast and fuzzy without requiring an LLM. File operations should never depend on an AI service, API key, model download, background agent, or network connection.

## License

[AGPL-3.0](LICENSE)

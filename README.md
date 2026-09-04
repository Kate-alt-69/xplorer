# Xplorer Native

Xplorer is being rebuilt as a **fast Windows-native file manager** using **WinUI 3 / Windows App SDK**.

This branch deliberately does **not** ship a WebView frontend, AI chat, agents, LLM providers, MCP servers, Ollama integration, semantic-AI pipelines, or agentic file operations. A file manager should browse and manage files quickly and predictably.

> Branch: `rewrite/native-winui`
>
> The older React/Tauri implementation still exists in Git history and on the original development branches, but it is intentionally removed from this native rewrite branch.

## Current native direction

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
- Internal fixed SSD partitions never receive a fake eject button; eject UI is restricted to removable drives.
- Reversible per-user Windows Shell registration with Xplorer-owned registry markers.
- No `explorer.exe` replacement, injection, or global process hooks.

## Build the native app

### Requirements

- Windows 10 1809+ or Windows 11
- .NET 10 SDK
- Windows App SDK / WinUI build prerequisites

### Restore

```powershell
dotnet restore apps/native/Xplorer.Native/Xplorer.Native.csproj `
  -p:Platform=x64 `
  -p:RuntimeIdentifier=win-x64
```

### Build

```powershell
dotnet build apps/native/Xplorer.Native/Xplorer.Native.csproj `
  -c Release `
  -p:Platform=x64 `
  -p:RuntimeIdentifier=win-x64
```

The GitHub Actions workflow `.github/workflows/native-winui.yml` performs the same native x64 build on Windows.

## Repository layout

```text
xplorer/
├── apps/
│   ├── native/           # WinUI 3 desktop file manager
│   └── web/              # Separate Xplorer website / marketplace
├── packages/             # Extension SDK, CLI and related packages
├── infra/                # Marketplace infrastructure
└── scripts/              # Extension / repository tooling
```

The old `apps/client` React file manager and `apps/src-tauri` desktop backend are intentionally absent from this branch. Useful non-AI behavior can be ported into the native implementation deliberately instead of carrying the old WebView/agent architecture forward.

## Product rule

**Core file management stays local, deterministic, native, and boring in the good way.**

Search can be fast and fuzzy without requiring an LLM. File operations should never depend on an AI service, API key, model download, background agent, or network connection.

## License

[AGPL-3.0](LICENSE)

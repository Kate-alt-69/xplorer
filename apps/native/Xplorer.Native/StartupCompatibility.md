# Startup compatibility notes

This file intentionally stays tiny. It records why Xplorer uses an explicit WinUI entry point and app-owned fallback theme resources:

- `DISABLE_XAML_GENERATED_MAIN` lets `Program.Main` log failures that occur before `App` can install its exception handlers.
- Xplorer does not depend on newer Fluent resource keys merely to parse the main window on Windows 10; resources used directly by `MainWindow.xaml` have app-owned fallbacks.
- Windows App SDK self-contained deployment remains enabled for the unpackaged installer build.

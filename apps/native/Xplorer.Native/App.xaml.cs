using Microsoft.UI.Xaml;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var rawArgument = args.Arguments?.Trim() ?? string.Empty;
        if (TryHandleMaintenanceCommand(rawArgument) is int maintenanceExitCode)
        {
            Environment.Exit(maintenanceExitCode);
            return;
        }

        var settings = new SettingsService();
        if (settings.Current.BackgroundIndexing)
        {
            try
            {
                IndexWorkerService.EnsureEnabled();
            }
            catch
            {
                // A development build may not have the Rust sidecar beside it yet. Missing worker
                // integration must never prevent the file manager itself from launching.
            }
        }

        var initialFolder = ParseInitialFolder(rawArgument);
        var mainWindow = new MainWindow(initialFolder);
        mainWindow.InitializeXmlThemeSupport();
        if (initialFolder is null)
            mainWindow.RestorePreviousSession();

        _window = mainWindow;
        _window.Closed += (_, _) => mainWindow.PersistSession();
        _window.Activate();
        if (initialFolder is null)
            mainWindow.RestoreWindowPlacement();
    }

    private static int? TryHandleMaintenanceCommand(string rawArgument)
    {
        if (!rawArgument.StartsWith("--", StringComparison.Ordinal)) return null;

        try
        {
            if (string.Equals(rawArgument, "--register-shell", StringComparison.OrdinalIgnoreCase))
            {
                ShellIntegrationService.Register();
                var settings = new SettingsService();
                settings.Current.WindowsShellContextMenu = true;
                settings.Save();
                return 0;
            }

            if (string.Equals(rawArgument, "--unregister-shell", StringComparison.OrdinalIgnoreCase))
            {
                ShellIntegrationService.Unregister();
                var settings = new SettingsService();
                settings.Current.WindowsShellContextMenu = false;
                settings.Save();
                return 0;
            }

            if (string.Equals(rawArgument, "--cleanup-integration", StringComparison.OrdinalIgnoreCase))
            {
                // Used by the installer/uninstaller. Deliberately do not mutate user preferences:
                // uninstalling the program should not erase the user's chosen settings for a later reinstall.
                ShellIntegrationService.Unregister();
                IndexWorkerService.Disable();
                return 0;
            }
        }
        catch
        {
            return 1;
        }

        return null;
    }

    private static string? ParseInitialFolder(string rawArgument)
    {
        if (string.IsNullOrWhiteSpace(rawArgument) || rawArgument.StartsWith("--", StringComparison.Ordinal))
            return null;

        var candidate = rawArgument;
        if (candidate.Length >= 2 && candidate[0] == '"' && candidate[^1] == '"')
            candidate = candidate[1..^1];

        try
        {
            return Directory.Exists(candidate) ? Path.GetFullPath(candidate) : null;
        }
        catch
        {
            return null;
        }
    }
}

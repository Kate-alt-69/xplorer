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
        if (string.Equals(rawArgument, "--unregister-shell", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                ShellIntegrationService.Unregister();
                IndexWorkerService.Disable();
            }
            finally
            {
                Environment.Exit(0);
            }
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

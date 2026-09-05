using Microsoft.UI.Xaml;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        UnhandledException += (_, args) =>
        {
            CrashLogService.LogException("WinUI unhandled exception", args.Exception);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception exception)
                CrashLogService.LogException("AppDomain unhandled exception", exception);
            else
                CrashLogService.Log($"AppDomain unhandled exception: {args.ExceptionObject}");
        };
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            CrashLogService.LogException("Unobserved task exception", args.Exception);
        };

        CrashLogService.Log($"App constructor. OS={Environment.OSVersion}; BaseDirectory={AppContext.BaseDirectory}");
        try
        {
            InitializeComponent();
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("App.InitializeComponent", ex);
            CrashLogService.ShowFatal("application initialization", ex);
            throw;
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            LaunchCore(args);
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("App.OnLaunched", ex);
            CrashLogService.ShowFatal("window startup", ex);
            Environment.Exit(1);
        }
    }

    private void LaunchCore(LaunchActivatedEventArgs args)
    {
        var rawArgument = GetRawArgument(args);
        CrashLogService.Log($"OnLaunched. Argument='{rawArgument}'");

        if (TryHandleMaintenanceCommand(rawArgument) is int maintenanceExitCode)
        {
            CrashLogService.Log($"Maintenance command completed with exit code {maintenanceExitCode}.");
            Environment.Exit(maintenanceExitCode);
            return;
        }

        CrashLogService.Log("Loading settings.");
        var settings = new SettingsService();
        if (settings.Current.BackgroundIndexing)
        {
            try
            {
                IndexWorkerService.EnsureEnabled();
            }
            catch (Exception ex)
            {
                // Missing worker integration must never prevent the file manager itself from launching.
                CrashLogService.LogException("Background worker startup ignored", ex);
            }
        }

        var initialFolder = ParseInitialFolder(rawArgument);
        CrashLogService.Log($"Creating MainWindow. InitialFolder='{initialFolder ?? "<session>"}'.");
        var mainWindow = new MainWindow(initialFolder);
        CrashLogService.Log("MainWindow constructed.");
        mainWindow.InitializeXmlThemeSupport();
        CrashLogService.Log("Theme support initialized.");
        if (initialFolder is null)
            mainWindow.RestorePreviousSession();

        _window = mainWindow;
        _window.Closed += (_, _) => mainWindow.PersistSession();
        _window.Activate();
        CrashLogService.Log("MainWindow activated.");
        if (initialFolder is null)
            mainWindow.RestoreWindowPlacement();
        CrashLogService.Log("Startup completed.");
    }

    private static string GetRawArgument(LaunchActivatedEventArgs args)
    {
        if (!string.IsNullOrWhiteSpace(args.Arguments))
            return args.Arguments.Trim();

        // Unpackaged WinUI launches do not consistently populate LaunchActivatedEventArgs.Arguments.
        // Fall back to the real process command line so installer/shell maintenance switches work.
        var commandLine = Environment.GetCommandLineArgs();
        if (commandLine.Length <= 1) return string.Empty;
        if (commandLine.Length == 2) return commandLine[1].Trim();
        return string.Join(' ', commandLine.Skip(1)).Trim();
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
        catch (Exception ex)
        {
            CrashLogService.LogException($"Maintenance command {rawArgument}", ex);
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

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
            CrashLogService.Log("App.InitializeComponent completed.");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("App.InitializeComponent", ex);
            CrashLogService.ShowFatal("application initialization", ex);
            throw;
        }

        // Application.Resources can fail while the App constructor itself is still running on
        // older Windows 10 builds. Install framework control resources from OnLaunched instead,
        // after WinUI has fully registered the Application instance.
        UiStartupDiagnostics.AttachFrameworkTracing(this);
    }

    private void TryInstallFrameworkControlResources()
    {
        try
        {
            var controlResources = new Microsoft.UI.Xaml.Controls.XamlControlsResources();
            Resources.MergedDictionaries.Insert(0, controlResources);
            CrashLogService.Log("XamlControlsResources installed programmatically.");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("XamlControlsResources installation failed", ex);
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            TryInstallFrameworkControlResources();
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

        // --debug on the public Rust host enables these probes through an environment variable.
        // They run before MainWindow.xaml so a broken WinUI control/resource can be separated from
        // a bug in Xplorer's own compiled layout.
        UiStartupDiagnostics.RunPreflight();

        CrashLogService.Log("Loading settings.");
        var settings = new SettingsService();
        var initialFolder = ParseInitialFolder(rawArgument);

        MainWindow mainWindow;
        try
        {
            CrashLogService.Log($"Creating MainWindow. InitialFolder='{initialFolder ?? "<session>"}'.");
            mainWindow = new MainWindow(initialFolder);
            CrashLogService.Log("MainWindow constructed.");
        }
        catch (Exception ex)
        {
            // A compiled-XAML failure must not terminate the entire process. Keep a code-only
            // diagnostic window alive so Windows 10 users can see the exact failure and log path.
            CrashLogService.LogException("MainWindow construction failed", ex);
            _window = new StartupRecoveryWindow("MainWindow construction / InitializeComponent", ex);
            _window.Activate();
            CrashLogService.Log("Startup recovery window activated.");
            return;
        }

        try
        {
            mainWindow.InitializeXmlThemeSupport();
            CrashLogService.Log("Theme support initialized.");
        }
        catch (Exception ex)
        {
            // Theme files are optional customization. A bad filesystem state or theme watcher must
            // never make the file manager itself unavailable.
            CrashLogService.LogException("Theme startup ignored", ex);
        }

        if (initialFolder is null)
        {
            try
            {
                _ = mainWindow.RestorePreviousSession();
            }
            catch (Exception ex)
            {
                CrashLogService.LogException("Session restore ignored", ex);
            }
        }

        _window = mainWindow;
        _window.Closed += (_, _) => mainWindow.PersistSession();
        _window.Activate();
        CrashLogService.Log("MainWindow activated.");

        if (initialFolder is null)
        {
            try
            {
                mainWindow.RestoreWindowPlacement();
            }
            catch (Exception ex)
            {
                CrashLogService.LogException("Window placement restore ignored", ex);
            }
        }

        // Indexing is deliberately started only after the real UI has been activated. The worker
        // may still be performing its first multi-hour paced crawl while Xplorer is fully usable.
        // No snapshot, cursor or USN state is a startup prerequisite for the file manager.
        StartBackgroundIndexingAfterUi(settings);
        CrashLogService.Log("Startup completed.");
    }

    private static void StartBackgroundIndexingAfterUi(SettingsService settings)
    {
        if (!settings.Current.BackgroundIndexing)
        {
            CrashLogService.Log("Background indexing is disabled; startup continues without worker.");
            return;
        }

        CrashLogService.Log("Scheduling background index worker after UI activation.");
        _ = Task.Run(() =>
        {
            try
            {
                IndexWorkerService.EnsureEnabled();
                CrashLogService.Log("Background index worker startup completed.");
            }
            catch (Exception ex)
            {
                // Missing or unhealthy worker integration is an optimization failure, not a UI
                // startup failure. Current-folder enumeration/search remains available.
                CrashLogService.LogException("Background worker startup ignored", ex);
            }
        });
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

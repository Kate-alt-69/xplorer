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
        var processArguments = GetLaunchArguments(args);
        var launch = LaunchRequestParser.Parse(processArguments);
        CrashLogService.Log(
            $"OnLaunched. Args=[{string.Join(", ", processArguments.Select(argument => $"'{argument}'"))}]; " +
            $"InitialFolder='{launch.InitialFolder ?? "<session>"}'; ExplicitFolder={launch.ExplicitFolderRequested}; " +
            $"Maintenance='{launch.MaintenanceCommand ?? "<none>"}'.");

        if (!string.IsNullOrWhiteSpace(launch.Error))
            CrashLogService.Log($"Launch argument warning: {launch.Error}");
        if (launch.UnknownArguments.Count > 0)
            CrashLogService.Log($"Ignored launch arguments: {string.Join(", ", launch.UnknownArguments)}");

        if (launch.MaintenanceCommand is not null &&
            TryHandleMaintenanceCommand(launch.MaintenanceCommand) is int maintenanceExitCode)
        {
            CrashLogService.Log($"Maintenance command completed with exit code {maintenanceExitCode}.");
            Environment.Exit(maintenanceExitCode);
            return;
        }

        // The public Rust host normally enables debug preflight through XPLORER_DEBUG_STARTUP.
        // Accepting --debug directly as well makes Xplorer.Native.exe independently diagnosable.
        if (launch.DebugRequested)
            Environment.SetEnvironmentVariable("XPLORER_DEBUG_STARTUP", "1");

        // Debug startup probes run before MainWindow.xaml so a broken WinUI control/resource can be
        // separated from a bug in Xplorer's own compiled layout.
        UiStartupDiagnostics.RunPreflight();

        CrashLogService.Log("Loading settings.");
        var settings = new SettingsService();
        var initialFolder = launch.InitialFolder;
        var bypassSession = initialFolder is not null || launch.ExplicitFolderRequested;

        MainWindow mainWindow;
        try
        {
            CrashLogService.Log($"Creating MainWindow. InitialFolder='{initialFolder ?? (bypassSession ? "<home>" : "<session>")}'.");
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

        try
        {
            mainWindow.InitializeWorkspaceTracking();
            CrashLogService.Log("Live workspace tracking initialized.");
        }
        catch (Exception ex)
        {
            // Current-folder watching and priority indexing are optimizations. Normal navigation,
            // manual refresh and the background worker must remain available if setup fails.
            CrashLogService.LogException("Workspace tracking startup ignored", ex);
        }

        if (!bypassSession)
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

        if (!bypassSession)
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
        UiMemoryService.SchedulePostStartupTrim();
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

    private static string[] GetLaunchArguments(LaunchActivatedEventArgs args)
    {
        // Environment.GetCommandLineArgs preserves Windows' quote/token boundaries and is the
        // authoritative source for this unpackaged executable. LaunchActivatedEventArgs.Arguments
        // is retained as a single fallback token for activation paths where WinUI supplies one.
        var commandLine = Environment.GetCommandLineArgs();
        if (commandLine.Length > 1)
            return commandLine.Skip(1).ToArray();

        return string.IsNullOrWhiteSpace(args.Arguments)
            ? []
            : [args.Arguments.Trim()];
    }

    private static int? TryHandleMaintenanceCommand(string command)
    {
        try
        {
            if (string.Equals(command, "--register-shell", StringComparison.OrdinalIgnoreCase))
            {
                ShellIntegrationService.Register();
                var settings = new SettingsService();
                settings.Current.WindowsShellContextMenu = true;
                settings.Save();
                return 0;
            }

            if (string.Equals(command, "--unregister-shell", StringComparison.OrdinalIgnoreCase))
            {
                ShellIntegrationService.Unregister();
                var settings = new SettingsService();
                settings.Current.WindowsShellContextMenu = false;
                settings.Save();
                return 0;
            }

            if (string.Equals(command, "--cleanup-integration", StringComparison.OrdinalIgnoreCase))
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
            CrashLogService.LogException($"Maintenance command {command}", ex);
            return 1;
        }

        return null;
    }
}

using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Xplorer.Native.Views;

namespace Xplorer.Native.Services;

/// <summary>
/// Extra diagnostics used only when the Rust host launches the UI with XPLORER_DEBUG_STARTUP=1.
/// These probes deliberately run before MainWindow.InitializeComponent so a machine-specific
/// WinUI/resource problem can be distinguished from a bug in Xplorer's own compiled MainWindow.xaml.
/// </summary>
public static class UiStartupDiagnostics
{
    private const string DebugEnvironmentVariable = "XPLORER_DEBUG_STARTUP";
    private static bool _frameworkTracingAttached;

    public static bool IsEnabled =>
        string.Equals(
            Environment.GetEnvironmentVariable(DebugEnvironmentVariable),
            "1",
            StringComparison.Ordinal);

    public static void AttachFrameworkTracing(Application application)
    {
        if (!IsEnabled || _frameworkTracingAttached) return;

        try
        {
            var debug = application.DebugSettings;
            debug.FailFastOnErrors = false;
            debug.IsBindingTracingEnabled = true;
            debug.IsXamlResourceReferenceTracingEnabled = true;
            debug.BindingFailed += (_, args) =>
                CrashLogService.Log($"WinUI binding failure: {args.Message}");
            debug.XamlResourceReferenceFailed += (_, args) =>
                CrashLogService.Log($"WinUI XAML resource failure: {args.Message}");
            _frameworkTracingAttached = true;
            CrashLogService.Log("WinUI framework binding/resource tracing enabled.");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Could not enable WinUI framework tracing", ex);
        }
    }

    public static void RunPreflight()
    {
        if (!IsEnabled) return;

        CrashLogService.Log("UI preflight started.");
        CrashLogService.Log(
            $"MRT base directory env: MICROSOFT_WINDOWSAPPRUNTIME_BASE_DIRECTORY='{Environment.GetEnvironmentVariable("MICROSOFT_WINDOWSAPPRUNTIME_BASE_DIRECTORY") ?? "<unset>"}'");
        LogRuntimeFile("resources.pri");
        LogRuntimeFile("Xplorer.Native.pri");
        LogRuntimeFile("Microsoft.ui.xaml.dll");
        LogRuntimeFile("Microsoft.UI.Xaml.Controls.pri");
        LogRuntimeFile("Microsoft.UI.pri");

        ProbeControl("Grid", static () => new Grid());
        ProbeControl("TextBlock", static () => new TextBlock());
        ProbeControl("TextBox", static () => new TextBox());
        ProbeControl("Button", static () => new Button());
        ProbeControl("ListView", static () => new ListView());
        ProbeControl("GridView", static () => new GridView());
        ProbeControl("CommandBar", static () => new CommandBar());
        ProbeControl("TabView", static () => new TabView());
        ProbeControl("ScrollViewer", static () => new ScrollViewer());
        ProbeControl("ComboBox", static () => new ComboBox());
        ProbeControl("ToggleSwitch", static () => new ToggleSwitch());
        ProbeControl("ProgressBar", static () => new ProgressBar());
        ProbeControl("ContentDialog", static () => new ContentDialog());
        ProbeControl("MenuFlyout", static () => new MenuFlyout());

        ProbeXaml(
            "basic Grid",
            "<Grid xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><TextBlock Text=\"probe\" /></Grid>");
        ProbeXaml(
            "TabView basic",
            "<TabView xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" IsAddTabButtonVisible=\"True\" />");
        ProbeXaml(
            "TabView MainWindow properties",
            "<TabView xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Height=\"32\" IsAddTabButtonVisible=\"True\" CanReorderTabs=\"True\" TabWidthMode=\"SizeToContent\" />");
        ProbeXaml(
            "CommandBar FontIcon",
            "<CommandBar xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><AppBarButton><AppBarButton.Icon><FontIcon Glyph=\"&#xE8B0;\" /></AppBarButton.Icon></AppBarButton></CommandBar>");
        ProbeXaml(
            "AppBarButton Symbol icons",
            "<CommandBar xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><AppBarButton Icon=\"Copy\" Label=\"Copy\"/><AppBarButton Icon=\"Cut\" Label=\"Cut\"/><AppBarButton Icon=\"Paste\" Label=\"Paste\"/><AppBarButton Icon=\"Delete\" Label=\"Delete\"/><AppBarButton Icon=\"Setting\" Label=\"Settings\"/></CommandBar>");
        ProbeXaml(
            "ItemsWrapGrid template",
            "<ItemsPanelTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><ItemsWrapGrid Orientation=\"Horizontal\" ItemWidth=\"116\" ItemHeight=\"104\" /></ItemsPanelTemplate>");
        ProbeXaml(
            "GridView local ItemsPanel/DataTemplate",
            "<Grid xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><Grid.Resources><ItemsPanelTemplate x:Key=\"P\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\"><ItemsWrapGrid Orientation=\"Horizontal\" ItemWidth=\"116\" ItemHeight=\"104\" /></ItemsPanelTemplate><DataTemplate x:Key=\"T\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\"><TextBlock Text=\"item\" MaxLines=\"2\" /></DataTemplate></Grid.Resources><GridView ItemsPanel=\"{StaticResource P}\" ItemTemplate=\"{StaticResource T}\" SelectionMode=\"Extended\" IsMultiSelectCheckBoxEnabled=\"False\" /></Grid>");
        ProbeXaml(
            "ListView Header",
            "<ListView xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><ListView.Header><Grid Padding=\"12,7\"><TextBlock Text=\"Name\" /></Grid></ListView.Header></ListView>");
        ProbeXaml(
            "TextBlock MaxLines",
            "<TextBlock xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Text=\"probe\" TextWrapping=\"Wrap\" TextTrimming=\"CharacterEllipsis\" MaxLines=\"2\" />");
        ProbeXaml(
            "app theme resource",
            "<Border xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Background=\"{ThemeResource ApplicationPageBackgroundThemeBrush}\" />");
        ProbeXaml(
            "card stroke resource",
            "<Border xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" BorderBrush=\"{ThemeResource CardStrokeColorDefaultBrush}\" BorderThickness=\"1\" />");
        ProbeXaml(
            "critical fill resource",
            "<TextBlock xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Foreground=\"{ThemeResource SystemFillColorCriticalBrush}\" Text=\"probe\" />");
        ProbeXaml(
            "settings control stack",
            "<Grid xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><StackPanel><ComboBox Header=\"Theme\"><ComboBoxItem Content=\"System\"/></ComboBox><ToggleSwitch Header=\"Enabled\"/><ProgressBar Minimum=\"0\" Maximum=\"100\" Value=\"50\"/><ScrollViewer><TextBlock Text=\"probe\"/></ScrollViewer></StackPanel></Grid>");

        ProbeAction("application Resources access", static () =>
        {
            _ = Application.Current.Resources.Count;
        });
        ProbeAction("default XML theme parse", static () =>
        {
            ThemeService.EnsureDefaultThemeFile();
            _ = ThemeService.Load("default.xml");
        });
        ProbeAction("SettingsDialog compiled XAML", static () =>
        {
            _ = new SettingsDialog(new SettingsService());
        });
        ProbeAction("TerminalWorkspaceDialog compiled XAML", static () =>
        {
            using var dialog = new TerminalWorkspaceDialog(new SettingsService());
        });

        CrashLogService.Log("UI preflight completed.");
    }

    private static void ProbeAction(string name, Action action)
    {
        try
        {
            action();
            CrashLogService.Log($"UI preflight action OK: {name}");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException($"UI preflight action FAILED: {name}", ex);
        }
    }

    private static void ProbeControl(string name, Func<object> factory)
    {
        try
        {
            _ = factory();
            CrashLogService.Log($"UI preflight control OK: {name}");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException($"UI preflight control FAILED: {name}", ex);
        }
    }

    private static void ProbeXaml(string name, string xaml)
    {
        try
        {
            _ = XamlReader.Load(xaml);
            CrashLogService.Log($"UI preflight XAML OK: {name}");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException($"UI preflight XAML FAILED: {name}", ex);
        }
    }

    private static void LogRuntimeFile(string fileName)
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, fileName);
            if (!File.Exists(path))
            {
                CrashLogService.Log($"UI preflight runtime file MISSING: {path}");
                return;
            }

            var file = new FileInfo(path);
            var info = FileVersionInfo.GetVersionInfo(path);
            CrashLogService.Log(
                $"UI preflight runtime file: {fileName}; FileVersion={info.FileVersion ?? "<none>"}; ProductVersion={info.ProductVersion ?? "<none>"}; Size={file.Length}");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException($"UI preflight runtime file probe FAILED: {fileName}", ex);
        }
    }
}

using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;

namespace Xplorer.Native.Services;

/// <summary>
/// Extra diagnostics used only when the Rust host launches the UI with XPLORER_DEBUG_STARTUP=1.
/// These probes deliberately run before MainWindow.InitializeComponent so a machine-specific
/// WinUI/resource problem can be distinguished from a bug in Xplorer's compiled MainWindow.xaml.
/// </summary>
public static class UiStartupDiagnostics
{
    private const string DebugEnvironmentVariable = "XPLORER_DEBUG_STARTUP";

    public static bool IsEnabled =>
        string.Equals(
            Environment.GetEnvironmentVariable(DebugEnvironmentVariable),
            "1",
            StringComparison.Ordinal);

    public static void RunPreflight()
    {
        if (!IsEnabled) return;

        CrashLogService.Log("UI preflight started.");
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

        ProbeXaml(
            "basic Grid",
            "<Grid xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><TextBlock Text=\"probe\" /></Grid>");
        ProbeXaml(
            "TabView",
            "<TabView xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" IsAddTabButtonVisible=\"True\" />");
        ProbeXaml(
            "CommandBar",
            "<CommandBar xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><AppBarButton><AppBarButton.Icon><FontIcon Glyph=\"&#xE8B0;\" /></AppBarButton.Icon></AppBarButton></CommandBar>");
        ProbeXaml(
            "ItemsWrapGrid template",
            "<ItemsPanelTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><ItemsWrapGrid Orientation=\"Horizontal\" ItemWidth=\"116\" ItemHeight=\"104\" /></ItemsPanelTemplate>");
        ProbeXaml(
            "app theme resource",
            "<Border xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Background=\"{ThemeResource ApplicationPageBackgroundThemeBrush}\" />");
        ProbeXaml(
            "card stroke resource",
            "<Border xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" BorderBrush=\"{ThemeResource CardStrokeColorDefaultBrush}\" BorderThickness=\"1\" />");

        CrashLogService.Log("UI preflight completed.");
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

            var info = FileVersionInfo.GetVersionInfo(path);
            CrashLogService.Log(
                $"UI preflight runtime file: {fileName}; FileVersion={info.FileVersion ?? "<none>"}; ProductVersion={info.ProductVersion ?? "<none>"}; Size={new FileInfo(path).Length}");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException($"UI preflight runtime file probe FAILED: {fileName}", ex);
        }
    }
}

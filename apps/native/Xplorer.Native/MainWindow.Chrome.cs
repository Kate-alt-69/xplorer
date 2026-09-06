using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const double NativeSidebarWidth = 256;
    private const double NativeExtensionsRailWidth = 48;
    private bool _chromeLoaded;
    private bool _sidebarCollapsed;
    private double _sidebarExpandedWidth = NativeSidebarWidth;

    /// <summary>
    /// Finishes the visual setup after WinUI has loaded the tree. This deliberately runs after
    /// XML-theme initialization so built-in Light/Dark/System modes can never be left with a stale
    /// dark brush that was captured during startup.
    /// </summary>
    private void ChromeRoot_Loaded(object sender, RoutedEventArgs e)
    {
        if (_chromeLoaded) return;
        _chromeLoaded = true;

        _settingsService.Saved += ChromeSettings_Saved;
        Closed += (_, _) => _settingsService.Saved -= ChromeSettings_Saved;

        // Search is compiled into XAML now; only its keyboard behavior needs initialization here.
        // Drive, drag/drop and the embedded terminal are native-window services and idempotent.
        InitializeNativeSearch();
        InitializeNativeDriveUx();
        InitializeNativeDragDrop();
        InitializeEmbeddedTerminal();
        InitializeInspectorWorkspace();

        ApplyBuiltInChromePalette();
        RefreshChromeLabels();
    }

    private void ChromeSettings_Saved(object? sender, EventArgs e)
    {
        // ThemeService's live-refresh handler was registered before this Loaded handler. Queueing
        // once therefore runs after its ApplySavedSettingsAsync callback and repairs any local
        // background values that an older theme reset may have restored.
        DispatcherQueue.TryEnqueue(() =>
        {
            ApplyBuiltInChromePalette();
            RefreshSearchPresentation();
            RefreshChromeLabels();
        });
    }

    /// <summary>
    /// Old Xplorer used one coherent palette for the full frame. Native ThemeResource foregrounds
    /// switch correctly, but local Background values set by XML preview/reset can outlive a theme
    /// change. Re-apply only the built-in chrome surfaces here; Custom XML remains authoritative.
    /// </summary>
    private void ApplyBuiltInChromePalette()
    {
        if (string.Equals(_settingsService.Current.Theme, "Custom XML", StringComparison.OrdinalIgnoreCase))
            return;

        var useLight = string.Equals(_settingsService.Current.Theme, "Light", StringComparison.OrdinalIgnoreCase) ||
                       (!string.Equals(_settingsService.Current.Theme, "Dark", StringComparison.OrdinalIgnoreCase) &&
                        Root.ActualTheme == ElementTheme.Light);

        var surface = new SolidColorBrush(useLight
            ? Color.FromArgb(0xff, 0xff, 0xff, 0xff)
            : Color.FromArgb(0xff, 0x11, 0x11, 0x22));
        var rail = new SolidColorBrush(useLight
            ? Color.FromArgb(0xff, 0xff, 0xff, 0xff)
            : Color.FromArgb(0xff, 0x11, 0x11, 0x22));

        Root.Background = useLight
            ? new SolidColorBrush(Color.FromArgb(0xff, 0xf8, 0xfa, 0xfc))
            : CreateOriginalXplorerGradient();

        Tabs.Background = surface;
        Tabs.Height = 32;
        AddressChrome.Background = surface;
        OperationBar.Background = surface;
        SidebarBorder.Background = surface;
        ExtensionsRail.Background = rail;
        BottomBar.Background = rail;
        FileArea.Background = new SolidColorBrush(useLight
            ? Color.FromArgb(0xff, 0xf8, 0xfa, 0xfc)
            : Color.FromArgb(0x00, 0x00, 0x00, 0x00));

        if (!_sidebarCollapsed)
        {
            SidebarBorder.Visibility = Visibility.Visible;
            ShellGrid.ColumnDefinitions[0].Width = new GridLength(_sidebarExpandedWidth);
        }
        SetExtensionsRailWidth(NativeExtensionsRailWidth);

        // Custom XML may have created a window-local accent resource. Bring it back in sync when
        // the user returns to a built-in theme instead of leaving a stale custom accent behind.
        if (Root.Resources.TryGetValue("XplorerAccentBrush", out var accentResource) &&
            accentResource is SolidColorBrush accentBrush)
        {
            accentBrush.Color = useLight
                ? Color.FromArgb(0xff, 0x3b, 0x82, 0xf6)
                : Color.FromArgb(0xff, 0x63, 0x66, 0xf1);
        }

        ApplyBuiltInFileItemPalette(useLight);
        ApplyBuiltInInspectorPalette(useLight);
        SetNativeCaptionTheme(useLight);
    }

    private void ApplyBuiltInFileItemPalette(bool light)
    {
        var accent = light
            ? Color.FromArgb(0xff, 0x8b, 0x5c, 0xf6)
            : Color.FromArgb(0xff, 0xa7, 0x8b, 0xfa);
        var hover = light
            ? Color.FromArgb(0xff, 0xf1, 0xf5, 0xf9)
            : Color.FromArgb(0x20, 0x16, 0x16, 0x30);
        var pressed = light
            ? Color.FromArgb(0xff, 0xe2, 0xe8, 0xf0)
            : Color.FromArgb(0x2a, 0x16, 0x16, 0x30);

        Root.Resources["ListViewItemBackgroundPointerOver"] = new SolidColorBrush(hover);
        Root.Resources["ListViewItemBackgroundPressed"] = new SolidColorBrush(pressed);
        Root.Resources["ListViewItemBackgroundSelected"] =
            new SolidColorBrush(Color.FromArgb(light ? (byte)0x24 : (byte)0x33, accent.R, accent.G, accent.B));
        Root.Resources["ListViewItemBackgroundSelectedPointerOver"] =
            new SolidColorBrush(Color.FromArgb(light ? (byte)0x30 : (byte)0x48, accent.R, accent.G, accent.B));
        Root.Resources["ListViewItemBackgroundSelectedPressed"] =
            new SolidColorBrush(Color.FromArgb(light ? (byte)0x3d : (byte)0x56, accent.R, accent.G, accent.B));
        Root.Resources["ListViewItemSelectionIndicatorBrush"] = new SolidColorBrush(accent);
    }

    private static LinearGradientBrush CreateOriginalXplorerGradient()
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
        };
        brush.GradientStops.Add(new GradientStop { Offset = 0, Color = Color.FromArgb(0xff, 0x0a, 0x0a, 0x1a) });
        brush.GradientStops.Add(new GradientStop { Offset = 0.25, Color = Color.FromArgb(0xff, 0x0f, 0x0f, 0x2e) });
        brush.GradientStops.Add(new GradientStop { Offset = 0.50, Color = Color.FromArgb(0xff, 0x1a, 0x0a, 0x2e) });
        brush.GradientStops.Add(new GradientStop { Offset = 0.75, Color = Color.FromArgb(0xff, 0x0a, 0x1a, 0x2e) });
        brush.GradientStops.Add(new GradientStop { Offset = 1, Color = Color.FromArgb(0xff, 0x0a, 0x0a, 0x1a) });
        return brush;
    }

    private void SetNativeCaptionTheme(bool light)
    {
        NativeMenuThemeService.Apply(!light);

        // Windows 10 1809/1903 used attribute ids 19/20 for immersive dark captions. Trying both
        // is harmless and keeps the native title bar visually coherent without replacing it.
        var dark = light ? 0 : 1;
        try
        {
            if (DwmSetWindowAttribute(_hwnd, 20, ref dark, sizeof(int)) < 0)
                _ = DwmSetWindowAttribute(_hwnd, 19, ref dark, sizeof(int));
        }
        catch
        {
            // Caption styling is cosmetic; never make Xplorer startup depend on DWM support.
        }
    }

    private void RefreshChromeLabels()
    {
        SortModeLabel.Text = _settingsService.GetSortMode(CurrentPath);
        ViewModeLabel.Text = _settingsService.GetViewMode(CurrentPath) switch
        {
            "Large" => "Large icons",
            "Medium" => "Medium icons",
            _ => "Details",
        };
    }

    private void SidebarToggleButton_Click(object sender, RoutedEventArgs e)
    {
        _sidebarCollapsed = !_sidebarCollapsed;
        if (_sidebarCollapsed)
        {
            SidebarBorder.Visibility = Visibility.Collapsed;
            ShellGrid.ColumnDefinitions[0].Width = new GridLength(0);
            return;
        }

        SidebarBorder.Visibility = Visibility.Visible;
        ShellGrid.ColumnDefinitions[0].Width = new GridLength(_sidebarExpandedWidth);
    }

    private void SidebarResizeGrip_ManipulationDelta(object sender, ManipulationDeltaRoutedEventArgs e)
    {
        if (_sidebarCollapsed) return;

        var current = SidebarBorder.ActualWidth > 0
            ? SidebarBorder.ActualWidth
            : ShellGrid.ColumnDefinitions[0].ActualWidth;
        var width = Math.Clamp(current + e.Delta.Translation.X, 168, 480);
        _sidebarExpandedWidth = width;
        ShellGrid.ColumnDefinitions[0].Width = new GridLength(width);
        e.Handled = true;
    }

    private void SidebarResizeGrip_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (_sidebarCollapsed) return;
        _sidebarExpandedWidth = GetExpandedSidebarWidth();
        ShellGrid.ColumnDefinitions[0].Width = new GridLength(_sidebarExpandedWidth);
        e.Handled = true;
    }

    private double GetExpandedSidebarWidth()
    {
        if (_previewThemeDefinition is { } preview)
            return preview.SidebarWidth;

        if (!string.Equals(_settingsService.Current.Theme, "Custom XML", StringComparison.OrdinalIgnoreCase))
            return NativeSidebarWidth;

        try
        {
            return ThemeService.Load(_settingsService.Current.ThemeFileName).SidebarWidth;
        }
        catch
        {
            return NativeSidebarWidth;
        }
    }

    private async void SidebarLocation_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string location }) return;

        var target = location switch
        {
            "Home" => _homePath,
            "Desktop" => Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "Downloads" => Path.Combine(_homePath, "Downloads"),
            "Documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "Pictures" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            _ => null,
        };

        if (!string.IsNullOrWhiteSpace(target) && Directory.Exists(target))
            await NavigateAsync(target);
    }

    private async void ChromeSortName_Click(object sender, RoutedEventArgs e)
    {
        await SetSortModeAsync("Name");
        RefreshChromeLabels();
    }

    private async void ChromeSortDate_Click(object sender, RoutedEventArgs e)
    {
        await SetSortModeAsync("Date modified");
        RefreshChromeLabels();
    }

    private async void ChromeSortType_Click(object sender, RoutedEventArgs e)
    {
        await SetSortModeAsync("Type");
        RefreshChromeLabels();
    }

    private async void ChromeSortSize_Click(object sender, RoutedEventArgs e)
    {
        await SetSortModeAsync("Size");
        RefreshChromeLabels();
    }

    private async void ChromeViewLarge_Click(object sender, RoutedEventArgs e)
    {
        await SetViewModeAsync("Large");
        RefreshChromeLabels();
    }

    private async void ChromeViewMedium_Click(object sender, RoutedEventArgs e)
    {
        await SetViewModeAsync("Medium");
        RefreshChromeLabels();
    }

    private async void ChromeViewDetails_Click(object sender, RoutedEventArgs e)
    {
        await SetViewModeAsync("Details");
        RefreshChromeLabels();
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        nint hwnd,
        int attribute,
        ref int value,
        int valueSize);
}

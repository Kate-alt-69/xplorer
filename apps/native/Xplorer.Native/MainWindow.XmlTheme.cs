using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private FileSystemWatcher? _xmlThemeWatcher;
    private FileSystemWatcher? _settingsThemeWatcher;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _themeReloadTimer;
    private ItemsPanelTemplate? _defaultMediumItemsPanel;
    private ItemsPanelTemplate? _defaultLargeItemsPanel;
    private Brush? _defaultRootBackground;
    private Brush? _defaultSidebarBackground;
    private Brush? _defaultRailBackground;
    private Brush? _defaultCommandBarBackground;
    private Brush? _defaultBottomBarBackground;
    private double? _defaultTabHeight;
    private bool _reloadSettingsBeforeTheme;

    public void InitializeXmlThemeSupport()
    {
        // Capture the real compiled/native values once. XML reset must restore Xplorer's visual
        // language, not null out backgrounds and accidentally fall back to plain WinUI grey.
        _defaultMediumItemsPanel ??= Root.Resources["MediumItemsPanel"] as ItemsPanelTemplate;
        _defaultLargeItemsPanel ??= Root.Resources["LargeItemsPanel"] as ItemsPanelTemplate;
        _defaultRootBackground ??= Root.Background;
        _defaultTabHeight ??= Tabs.Height;

        var shellGrid = Root.Children
            .OfType<Grid>()
            .FirstOrDefault(grid => Grid.GetRow(grid) == 3 && grid.ColumnDefinitions.Count >= 3);
        if (shellGrid is not null)
        {
            foreach (var child in shellGrid.Children.OfType<FrameworkElement>())
            {
                if (Grid.GetColumn(child) == 0 && child is Border sidebar)
                    _defaultSidebarBackground ??= sidebar.Background;
                else if (Grid.GetColumn(child) == 2 && child is Panel rail)
                    _defaultRailBackground ??= rail.Background;
            }
        }

        foreach (var child in Root.Children.OfType<FrameworkElement>())
        {
            if (child is CommandBar commandBar && Grid.GetRow(commandBar) == 2)
                _defaultCommandBarBackground ??= commandBar.Background;
            else if (child is Grid bottomBar && Grid.GetRow(bottomBar) == 4)
                _defaultBottomBarBackground ??= bottomBar.Background;
        }

        ThemeService.EnsureDefaultThemeFile();
        ApplyXmlTheme();
        ConfigureSettingsThemeWatcher();
        Closed += (_, _) => DisposeThemeWatchers();
    }

    private void ApplyXmlTheme()
    {
        try
        {
            if (!string.Equals(_settingsService.Current.Theme, "Custom XML", StringComparison.OrdinalIgnoreCase))
            {
                ResetXmlThemeLayout();
                ConfigureXmlThemeWatcher(null);
                return;
            }

            // Watch the requested path before parsing it. A malformed file remains recoverable by
            // simply fixing/saving that same file in an editor.
            var themePath = ThemeService.ResolveThemePath(_settingsService.Current.ThemeFileName);
            ConfigureXmlThemeWatcher(themePath);
            var theme = ThemeService.Load(_settingsService.Current.ThemeFileName);

            // Build both runtime templates before mutating visible state. If either parser call
            // fails, the previous complete theme remains visible instead of a half-applied one.
            var mediumItemsPanel = CreateItemsPanel(theme.MediumTileWidth, theme.MediumTileHeight);
            var largeItemsPanel = CreateItemsPanel(theme.LargeTileWidth, theme.LargeTileHeight);

            Root.Background = new SolidColorBrush(theme.Background);
            Tabs.Height = theme.TabHeight;
            SetXmlAccent(theme.Accent);

            var shellGrid = Root.Children
                .OfType<Grid>()
                .FirstOrDefault(grid => Grid.GetRow(grid) == 3 && grid.ColumnDefinitions.Count >= 3);
            if (shellGrid is not null)
            {
                shellGrid.ColumnDefinitions[0].Width = new GridLength(theme.SidebarWidth);
                shellGrid.ColumnDefinitions[2].Width = new GridLength(theme.InspectorWidth);

                foreach (var child in shellGrid.Children.OfType<FrameworkElement>())
                {
                    if (Grid.GetColumn(child) == 0 && child is Border sidebar)
                        sidebar.Background = new SolidColorBrush(theme.Surface);
                    else if (Grid.GetColumn(child) == 2 && child is Panel rail)
                        rail.Background = new SolidColorBrush(theme.Rail);
                }
            }

            foreach (var child in Root.Children.OfType<FrameworkElement>())
            {
                switch (child)
                {
                    case CommandBar commandBar when Grid.GetRow(commandBar) == 2:
                        commandBar.Background = new SolidColorBrush(theme.Surface);
                        break;
                    case Grid bottomBar when Grid.GetRow(bottomBar) == 4:
                        bottomBar.Background = new SolidColorBrush(theme.Rail);
                        break;
                }
            }

            Root.Resources["MediumItemsPanel"] = mediumItemsPanel;
            Root.Resources["LargeItemsPanel"] = largeItemsPanel;
            ApplyViewMode(_settingsService.GetViewMode(CurrentPath));
        }
        catch (Exception ex)
        {
            RestoreCompiledItemPanels();
            StatusText.Text = $"XML theme ignored: {ex.Message}";
        }
    }

    private void SetXmlAccent(Windows.UI.Color color)
    {
        if (Root.Resources.TryGetValue("XplorerAccentBrush", out var resource) &&
            resource is SolidColorBrush brush)
        {
            brush.Color = color;
            return;
        }

        Root.Resources["XplorerAccentBrush"] = new SolidColorBrush(color);
    }

    private static ItemsPanelTemplate CreateItemsPanel(double width, double height)
    {
        var xaml = $"""
            <ItemsPanelTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
              <ItemsWrapGrid Orientation="Horizontal" ItemWidth="{width.ToString(System.Globalization.CultureInfo.InvariantCulture)}" ItemHeight="{height.ToString(System.Globalization.CultureInfo.InvariantCulture)}" />
            </ItemsPanelTemplate>
            """;
        return (ItemsPanelTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load(xaml);
    }

    private void ResetXmlThemeLayout()
    {
        if (_defaultRootBackground is not null)
            Root.Background = _defaultRootBackground;

        SetXmlAccent(XplorerThemeDefinition.Default.Accent);
        Tabs.Height = _defaultTabHeight ?? 38;

        var shellGrid = Root.Children
            .OfType<Grid>()
            .FirstOrDefault(grid => Grid.GetRow(grid) == 3 && grid.ColumnDefinitions.Count >= 3);
        if (shellGrid is not null)
        {
            shellGrid.ColumnDefinitions[0].Width = new GridLength(220);
            shellGrid.ColumnDefinitions[2].Width = new GridLength(42);
            foreach (var child in shellGrid.Children.OfType<FrameworkElement>())
            {
                if (Grid.GetColumn(child) == 0 && child is Border sidebar)
                    sidebar.Background = _defaultSidebarBackground;
                else if (Grid.GetColumn(child) == 1 && ReferenceEquals(child, FileArea))
                    FileArea.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
                else if (Grid.GetColumn(child) == 2 && child is Panel rail)
                    rail.Background = _defaultRailBackground;
            }
        }

        foreach (var child in Root.Children.OfType<FrameworkElement>())
        {
            if (child is CommandBar commandBar && Grid.GetRow(commandBar) == 2)
                commandBar.Background = _defaultCommandBarBackground;
            if (child is Grid grid && Grid.GetRow(grid) == 4)
                grid.Background = _defaultBottomBarBackground;
        }

        RestoreCompiledItemPanels();
        ApplyViewMode(_settingsService.GetViewMode(CurrentPath));
    }

    private void RestoreCompiledItemPanels()
    {
        if (_defaultMediumItemsPanel is not null)
            Root.Resources["MediumItemsPanel"] = _defaultMediumItemsPanel;
        if (_defaultLargeItemsPanel is not null)
            Root.Resources["LargeItemsPanel"] = _defaultLargeItemsPanel;
    }

    private void ConfigureSettingsThemeWatcher()
    {
        var settingsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Xplorer");
        Directory.CreateDirectory(settingsDirectory);

        _settingsThemeWatcher = new FileSystemWatcher(settingsDirectory, "settings.json")
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
            EnableRaisingEvents = true,
        };
        _settingsThemeWatcher.Changed += ThemeSettingsChanged;
        _settingsThemeWatcher.Created += ThemeSettingsChanged;
        _settingsThemeWatcher.Renamed += ThemeSettingsRenamed;
    }

    private void ThemeSettingsChanged(object sender, FileSystemEventArgs e) => ScheduleThemeReload(reloadSettings: true);

    private void ThemeSettingsRenamed(object sender, RenamedEventArgs e) => ScheduleThemeReload(reloadSettings: true);

    private void ConfigureXmlThemeWatcher(string? path)
    {
        _xmlThemeWatcher?.Dispose();
        _xmlThemeWatcher = null;
        if (string.IsNullOrWhiteSpace(path)) return;

        var directory = Path.GetDirectoryName(path);
        var fileName = Path.GetFileName(path);
        if (directory is null || string.IsNullOrEmpty(fileName)) return;

        _xmlThemeWatcher = new FileSystemWatcher(directory, fileName)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName,
            EnableRaisingEvents = true,
        };
        _xmlThemeWatcher.Changed += XmlThemeFileChanged;
        _xmlThemeWatcher.Created += XmlThemeFileChanged;
        _xmlThemeWatcher.Deleted += XmlThemeFileChanged;
        _xmlThemeWatcher.Renamed += XmlThemeFileRenamed;
    }

    private void XmlThemeFileChanged(object sender, FileSystemEventArgs e) => ScheduleThemeReload(reloadSettings: false);

    private void XmlThemeFileRenamed(object sender, RenamedEventArgs e) => ScheduleThemeReload(reloadSettings: false);

    private void ScheduleThemeReload(bool reloadSettings)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            _reloadSettingsBeforeTheme |= reloadSettings;
            if (_themeReloadTimer is null)
            {
                _themeReloadTimer = DispatcherQueue.CreateTimer();
                _themeReloadTimer.Interval = TimeSpan.FromMilliseconds(150);
                _themeReloadTimer.IsRepeating = false;
                _themeReloadTimer.Tick += (_, _) =>
                {
                    var shouldReloadSettings = _reloadSettingsBeforeTheme;
                    _reloadSettingsBeforeTheme = false;

                    if (shouldReloadSettings)
                    {
                        if (!_settingsService.TryReload()) return;
                        ApplyTheme();
                        RefreshSearchPresentation();
                    }

                    ApplyXmlTheme();
                };
            }

            _themeReloadTimer.Stop();
            _themeReloadTimer.Start();
        });
    }

    private void DisposeThemeWatchers()
    {
        _xmlThemeWatcher?.Dispose();
        _settingsThemeWatcher?.Dispose();
        _themeReloadTimer?.Stop();
        _xmlThemeWatcher = null;
        _settingsThemeWatcher = null;
        _themeReloadTimer = null;
    }
}

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
    private bool _reloadSettingsBeforeTheme;

    public void InitializeXmlThemeSupport()
    {
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

            // Watch the requested path before parsing it. If a newly selected theme is temporarily
            // malformed/missing while being edited, fixing or recreating that same file must hot-reload it.
            var themePath = ThemeService.ResolveThemePath(_settingsService.Current.ThemeFileName);
            ConfigureXmlThemeWatcher(themePath);
            var theme = ThemeService.Load(_settingsService.Current.ThemeFileName);
            Root.Background = new SolidColorBrush(theme.Background);
            Tabs.Height = theme.TabHeight;
            Root.Resources["XplorerAccentBrush"] = new SolidColorBrush(theme.Accent);

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

            Root.Resources["MediumItemsPanel"] = CreateItemsPanel(theme.MediumTileWidth, theme.MediumTileHeight);
            Root.Resources["LargeItemsPanel"] = CreateItemsPanel(theme.LargeTileWidth, theme.LargeTileHeight);
            ApplyViewMode(_settingsService.GetViewMode(CurrentPath));
        }
        catch (Exception ex)
        {
            StatusText.Text = $"XML theme ignored: {ex.Message}";
        }
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
        if (Application.Current.Resources.TryGetValue("ApplicationPageBackgroundThemeBrush", out var background) &&
            background is Brush brush)
        {
            Root.Background = brush;
        }

        // Custom themes install this key into the window ResourceDictionary. Remove it when the
        // user returns to a built-in theme so the old accent cannot bleed into System/Dark/Light.
        Root.Resources.Remove("XplorerAccentBrush");

        Tabs.Height = 38;
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
                    sidebar.Background = null;
                else if (Grid.GetColumn(child) == 1 && ReferenceEquals(child, FileArea))
                    FileArea.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
                else if (Grid.GetColumn(child) == 2 && child is Panel rail)
                    rail.Background = null;
            }
        }

        foreach (var child in Root.Children.OfType<FrameworkElement>())
        {
            if (child is CommandBar commandBar) commandBar.Background = null;
            if (child is Grid grid && Grid.GetRow(grid) == 4) grid.Background = null;
        }

        Root.Resources["MediumItemsPanel"] = CreateItemsPanel(116, 104);
        Root.Resources["LargeItemsPanel"] = CreateItemsPanel(170, 148);
        ApplyViewMode(_settingsService.GetViewMode(CurrentPath));
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

                    if (shouldReloadSettings && _settingsService.TryReload())
                    {
                        ApplyTheme();
                        RefreshSearchPresentation();
                    }
                    else
                    {
                        ApplyXmlTheme();
                    }
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

using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const double MinimumInspectorRailWidth = 48;

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
    private bool _pendingThemeAtStartup;
    private bool _pendingThemePromptShown;
    private XplorerThemeDefinition? _previewThemeDefinition;

    public void InitializeXmlThemeSupport()
    {
        _defaultMediumItemsPanel ??= Root.Resources["MediumItemsPanel"] as ItemsPanelTemplate;
        _defaultLargeItemsPanel ??= Root.Resources["LargeItemsPanel"] as ItemsPanelTemplate;
        _defaultRootBackground ??= Root.Background;
        _defaultTabHeight ??= Tabs.Height;

        var shellGrid = FindShellGrid();
        if (shellGrid is not null)
        {
            EnsureInspectorRailFits(shellGrid);
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
        ThemePreviewCoordinator.PreviewRequested += PreviewThemeDefinition;
        ThemePreviewCoordinator.RestoreRequested += RestorePersistedTheme;
        _settingsService.Saved += SettingsService_Saved;

        ApplyXmlTheme();
        ConfigureSettingsThemeWatcher();

        _pendingThemeAtStartup = ThemeImportService.HasPendingPreview();
        if (_pendingThemeAtStartup)
            Activated += PendingThemeStartup_Activated;

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

            var themePath = ThemeService.ResolveThemePath(_settingsService.Current.ThemeFileName);
            ConfigureXmlThemeWatcher(themePath);
            var theme = ThemeService.Load(_settingsService.Current.ThemeFileName);
            ApplyThemeDefinition(theme);
        }
        catch (Exception ex)
        {
            RestoreCompiledItemPanels();
            StatusText.Text = $"XML theme ignored: {ex.Message}";
        }
    }

    private void ApplyThemeOrPreview()
    {
        if (_previewThemeDefinition is { } preview)
        {
            ConfigureXmlThemeWatcher(null);
            ApplyThemeDefinition(preview);
        }
        else
        {
            ApplyXmlTheme();
        }
    }

    private void ApplyThemeDefinition(XplorerThemeDefinition theme)
    {
        var mediumItemsPanel = CreateItemsPanel(theme.MediumTileWidth, theme.MediumTileHeight);
        var largeItemsPanel = CreateItemsPanel(theme.LargeTileWidth, theme.LargeTileHeight);

        Root.Background = new SolidColorBrush(theme.Background);
        Tabs.Height = theme.TabHeight;
        SetXmlAccent(theme.Accent);

        var shellGrid = FindShellGrid();
        if (shellGrid is not null)
        {
            shellGrid.ColumnDefinitions[0].Width = new GridLength(theme.SidebarWidth);
            shellGrid.ColumnDefinitions[2].Width = new GridLength(Math.Max(MinimumInspectorRailWidth, theme.InspectorWidth));

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

    private void PreviewThemeDefinition(XplorerThemeDefinition theme)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                _previewThemeDefinition = theme;
                ConfigureXmlThemeWatcher(null);
                ApplyThemeDefinition(theme);
                StatusText.Text = "Temporary theme preview — restart Xplorer to keep or discard it";
            }
            catch (Exception ex)
            {
                _previewThemeDefinition = null;
                ApplyXmlTheme();
                StatusText.Text = $"Theme preview failed safely: {ex.Message}";
            }
        });
    }

    private void RestorePersistedTheme()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            _previewThemeDefinition = null;
            ApplyTheme();
            ApplyXmlTheme();
        });
    }

    private void SettingsService_Saved(object? sender, EventArgs e)
    {
        DispatcherQueue.TryEnqueue(() => _ = ApplySavedSettingsAsync());
    }

    private async Task ApplySavedSettingsAsync()
    {
        try
        {
            ApplyTheme();
            ApplyThemeOrPreview();
            await NavigateAsync(CurrentPath, pushHistory: false);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Setting saved but live refresh failed: {ex.Message}";
        }
    }

    private async void PendingThemeStartup_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (!_pendingThemeAtStartup || _pendingThemePromptShown) return;
        _pendingThemePromptShown = true;
        Activated -= PendingThemeStartup_Activated;

        try
        {
            await Task.Delay(100);
            var pending = await ThemeImportService.LoadPendingAsync();
            if (pending is null) return;

            var missingText = pending.MissingProperties.Count == 0
                ? string.Empty
                : $"\n\nThe theme leaves {pending.MissingProperties.Count} supported value(s) at Xplorer defaults.";
            var scanText = pending.Scan.Performed
                ? "\n\nThe staged XML passed the local Windows AMSI antimalware pipeline again."
                : "\n\nThe local AMSI provider did not perform a scan this time; Xplorer still revalidated the strict data-only XML schema.";

            var dialog = new ContentDialog
            {
                XamlRoot = Root.XamlRoot,
                Title = "Keep imported theme?",
                Content = $"A temporary preview of '{pending.State.DisplayName}' was active in your last Xplorer session. Do you want to make it your current theme?{missingText}{scanText}",
                PrimaryButtonText = "Use theme",
                CloseButtonText = "Discard",
                DefaultButton = ContentDialogButton.Primary,
            };

            var result = await dialog.ShowAsync();
            _previewThemeDefinition = null;
            if (result == ContentDialogResult.Primary)
            {
                var fileName = await ThemeImportService.CommitPendingAsync(_settingsService);
                ApplyTheme();
                ApplyXmlTheme();
                StatusText.Text = $"Theme saved: {fileName}";
            }
            else
            {
                ThemeImportService.DiscardPending();
                ApplyTheme();
                ApplyXmlTheme();
                StatusText.Text = "Imported theme discarded; previous theme restored";
            }
        }
        catch (Exception ex)
        {
            _previewThemeDefinition = null;
            ThemeImportService.DiscardPending();
            ApplyTheme();
            ApplyXmlTheme();
            StatusText.Text = $"Pending theme was rejected safely: {ex.Message}";
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

        var shellGrid = FindShellGrid();
        if (shellGrid is not null)
        {
            shellGrid.ColumnDefinitions[0].Width = new GridLength(220);
            shellGrid.ColumnDefinitions[2].Width = new GridLength(MinimumInspectorRailWidth);
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

    private Grid? FindShellGrid() => Root.Children
        .OfType<Grid>()
        .FirstOrDefault(grid => Grid.GetRow(grid) == 3 && grid.ColumnDefinitions.Count >= 3);

    private static void EnsureInspectorRailFits(Grid shellGrid)
    {
        var width = shellGrid.ColumnDefinitions[2].Width;
        if (width.IsAbsolute && width.Value < MinimumInspectorRailWidth)
            shellGrid.ColumnDefinitions[2].Width = new GridLength(MinimumInspectorRailWidth);
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

                    ApplyThemeOrPreview();
                };
            }

            _themeReloadTimer.Stop();
            _themeReloadTimer.Start();
        });
    }

    private void DisposeThemeWatchers()
    {
        ThemePreviewCoordinator.PreviewRequested -= PreviewThemeDefinition;
        ThemePreviewCoordinator.RestoreRequested -= RestorePersistedTheme;
        _settingsService.Saved -= SettingsService_Saved;
        Activated -= PendingThemeStartup_Activated;

        _xmlThemeWatcher?.Dispose();
        _settingsThemeWatcher?.Dispose();
        _themeReloadTimer?.Stop();
        _xmlThemeWatcher = null;
        _settingsThemeWatcher = null;
        _themeReloadTimer = null;
    }
}

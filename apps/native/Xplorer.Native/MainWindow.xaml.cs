using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;
using Xplorer.Native.Views;

namespace Xplorer.Native;

public sealed partial class MainWindow : Window
{
    private readonly SettingsService _settingsService = new();
    private readonly ShellContextMenuService _shellContextMenu = new();
    private readonly nint _hwnd;
    private readonly string _homePath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private bool _suppressTabSelection;
    private int _navigationGeneration;

    public ObservableCollection<FileSystemItem> Items { get; } = [];
    public ObservableCollection<DriveItem> Drives { get; } = [];

    private ExplorerTabState? ActiveTabState =>
        (Tabs.SelectedItem as TabViewItem)?.Tag as ExplorerTabState;

    private string CurrentPath => ActiveTabState?.CurrentPath ?? _homePath;

    public MainWindow(string? initialPath = null)
    {
        InitializeComponent();
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        Closed += (_, _) => _shellContextMenu.Dispose();
        InitializeNativeFileOperations();
        ApplyTheme();
        RefreshDrives();

        if (_settingsService.Current.WindowsShellContextMenu)
        {
            try
            {
                ShellIntegrationService.Register();
            }
            catch
            {
                // Shell registration is optional. A stale/missing registry capability must never
                // prevent the file manager from opening.
            }
        }

        var startPath = !string.IsNullOrWhiteSpace(initialPath) && Directory.Exists(initialPath)
            ? Path.GetFullPath(initialPath)
            : _homePath;
        AddTab(startPath, select: true);
    }

    private TabViewItem AddTab(string path, bool select)
    {
        var initialPath = Directory.Exists(path) ? Path.GetFullPath(path) : _homePath;
        var state = new ExplorerTabState { CurrentPath = initialPath };
        var tab = new TabViewItem
        {
            Header = GetTabHeader(initialPath),
            IsClosable = true,
            Tag = state,
        };

        Tabs.TabItems.Add(tab);
        if (select)
        {
            _suppressTabSelection = true;
            Tabs.SelectedItem = tab;
            _suppressTabSelection = false;
            _ = NavigateAsync(initialPath, pushHistory: false);
        }

        return tab;
    }

    private async Task NavigateAsync(string path, bool pushHistory = true)
    {
        var state = ActiveTabState;
        if (state is null) return;

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(path);
        }
        catch
        {
            StatusText.Text = "Invalid folder path";
            return;
        }

        if (!Directory.Exists(fullPath))
        {
            StatusText.Text = $"Folder not found: {fullPath}";
            return;
        }

        if (pushHistory && !string.Equals(fullPath, state.CurrentPath, StringComparison.OrdinalIgnoreCase))
        {
            state.BackHistory.Push(state.CurrentPath);
            state.ForwardHistory.Clear();
        }

        state.CurrentPath = fullPath;
        AddressBox.Text = fullPath;
        UpdateActiveTabHeader();
        UpdateNavigationButtons();

        var viewMode = _settingsService.GetViewMode(fullPath);
        var sortMode = _settingsService.GetSortMode(fullPath);
        var showHidden = _settingsService.Current.ShowHiddenFiles;
        var showExtensions = _settingsService.Current.ShowFileExtensions;
        var generation = Interlocked.Increment(ref _navigationGeneration);
        var tabId = state.Id;

        StatusText.Text = "Loading...";
        var entries = await Task.Run(() => EnumerateFolder(fullPath, showHidden, showExtensions, sortMode));

        if (generation != _navigationGeneration || ActiveTabState?.Id != tabId) return;

        var searchQuery = _activeSearchQuery;
        if (!string.IsNullOrWhiteSpace(searchQuery) &&
            string.Equals(searchQuery, SearchBox.Text.Trim(), StringComparison.Ordinal))
        {
            IndexedSearchService.SearchResult? indexed = null;
            if (_settingsService.Current.BackgroundIndexing)
            {
                indexed = await Task.Run(() =>
                    IndexedSearchService.TrySearch(fullPath, searchQuery, showHidden, showExtensions));
            }

            if (generation != _navigationGeneration ||
                ActiveTabState?.Id != tabId ||
                !string.Equals(searchQuery, SearchBox.Text.Trim(), StringComparison.Ordinal))
            {
                return;
            }

            if (indexed is not null)
            {
                entries = indexed.Items.ToList();
                _searchTotalCount = indexed.TotalMatches;
                _searchUsingIndex = true;
            }
            else
            {
                _searchTotalCount = entries.Count;
                entries = entries.Where(item => MatchesSearch(item, searchQuery)).ToList();
                _searchUsingIndex = false;
            }
        }
        else
        {
            searchQuery = string.Empty;
            _searchTotalCount = 0;
            _searchUsingIndex = false;
        }

        Items.Clear();
        foreach (var entry in entries) Items.Add(entry);

        ApplyViewMode(viewMode);
        if (string.IsNullOrEmpty(searchQuery))
            UpdateStatus();
        else
            UpdateSearchStatus();
    }

    private static List<FileSystemItem> EnumerateFolder(
        string path,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        var result = new List<FileSystemItem>();
        try
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(path))
            {
                try
                {
                    var attributes = File.GetAttributes(entry);
                    if (!showHidden && attributes.HasFlag(System.IO.FileAttributes.Hidden)) continue;

                    var isDirectory = attributes.HasFlag(System.IO.FileAttributes.Directory);
                    var lastWriteUtc = File.GetLastWriteTimeUtc(entry);
                    long? size = null;
                    if (!isDirectory)
                    {
                        size = new FileInfo(entry).Length;
                    }

                    result.Add(new FileSystemItem
                    {
                        FullPath = entry,
                        Name = Path.GetFileName(entry),
                        IsDirectory = isDirectory,
                        ShowExtension = showExtensions,
                        LastWriteTimeUtc = lastWriteUtc,
                        SizeBytes = size,
                    });
                }
                catch
                {
                    // One inaccessible/deleted item must not break the whole folder view.
                }
            }
        }
        catch
        {
            // Keep the UI alive for inaccessible folders; navigation controls still work.
        }

        var directoriesFirst = result.OrderByDescending(item => item.IsDirectory);
        return sortMode switch
        {
            "Date modified" => directoriesFirst
                .ThenByDescending(item => item.LastWriteTimeUtc)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            "Type" => directoriesFirst
                .ThenBy(item => item.TypeName, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            "Size" => directoriesFirst
                .ThenByDescending(item => item.SizeBytes ?? -1)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            _ => directoriesFirst
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
        };
    }

    private void RefreshDrives()
    {
        Drives.Clear();
        foreach (var drive in DriveService.GetDrives()) Drives.Add(drive);
    }

    private void ApplyTheme()
    {
        Root.RequestedTheme = _settingsService.Current.Theme switch
        {
            "Dark" => ElementTheme.Dark,
            "Light" => ElementTheme.Light,
            _ => ElementTheme.Default,
        };
    }

    private void ApplyViewMode(string viewMode)
    {
        var selectedPath = GetSelectedItem()?.FullPath;
        var details = string.Equals(viewMode, "Details", StringComparison.OrdinalIgnoreCase);
        FileDetails.Visibility = details ? Visibility.Visible : Visibility.Collapsed;
        FileGrid.Visibility = details ? Visibility.Collapsed : Visibility.Visible;

        if (!details)
        {
            var large = string.Equals(viewMode, "Large", StringComparison.OrdinalIgnoreCase);
            FileGrid.ItemsPanel = (ItemsPanelTemplate)Root.Resources[
                large ? "LargeItemsPanel" : "MediumItemsPanel"];
            FileGrid.ItemTemplate = (DataTemplate)Root.Resources[
                large ? "LargeTileTemplate" : "MediumTileTemplate"];
        }

        if (selectedPath is not null)
        {
            var item = Items.FirstOrDefault(candidate =>
                string.Equals(candidate.FullPath, selectedPath, StringComparison.OrdinalIgnoreCase));
            if (item is not null)
            {
                if (details) FileDetails.SelectedItem = item;
                else FileGrid.SelectedItem = item;
            }
        }
    }

    private async Task SetViewModeAsync(string viewMode)
    {
        await _settingsService.SetViewModeAsync(CurrentPath, viewMode);
        ApplyViewMode(viewMode);
        if (string.IsNullOrEmpty(_activeSearchQuery)) UpdateStatus();
        else UpdateSearchStatus();
    }

    private async Task SetSortModeAsync(string sortMode)
    {
        await _settingsService.SetSortModeAsync(CurrentPath, sortMode);
        await NavigateAsync(CurrentPath, pushHistory: false);
    }

    private FileSystemItem? GetSelectedItem() =>
        FileDetails.Visibility == Visibility.Visible
            ? FileDetails.SelectedItem as FileSystemItem
            : FileGrid.SelectedItem as FileSystemItem;

    private int GetSelectedCount() =>
        FileDetails.Visibility == Visibility.Visible
            ? FileDetails.SelectedItems.Count
            : FileGrid.SelectedItems.Count;

    private void UpdateStatus()
    {
        if (!string.IsNullOrEmpty(_activeSearchQuery))
        {
            UpdateSearchStatus();
            return;
        }

        var selected = GetSelectedCount();
        var viewMode = _settingsService.GetViewMode(CurrentPath);
        var sortMode = _settingsService.GetSortMode(CurrentPath);
        StatusText.Text = selected > 0
            ? $"{Items.Count} items  •  {selected} selected  •  {viewMode}  •  Sort: {sortMode}"
            : $"{Items.Count} items  •  {viewMode}  •  Sort: {sortMode}";
    }

    private void UpdateNavigationButtons()
    {
        var state = ActiveTabState;
        BackButton.IsEnabled = state is not null && state.BackHistory.Count > 0;
        ForwardButton.IsEnabled = state is not null && state.ForwardHistory.Count > 0;
    }

    private void UpdateActiveTabHeader()
    {
        if (Tabs.SelectedItem is TabViewItem tab)
        {
            tab.Header = GetTabHeader(CurrentPath);
        }
    }

    private static string GetTabHeader(string path)
    {
        var trimmed = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var name = Path.GetFileName(trimmed);
        return string.IsNullOrWhiteSpace(name) ? path : name;
    }

    private async void DriveList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is DriveItem drive)
            await NavigateAsync(drive.RootPath);
    }

    private async void FileArea_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (e.Handled) return;
        e.Handled = true;

        try
        {
            var command = _shellContextMenu.ShowForBackground(
                _hwnd,
                CurrentPath,
                _settingsService.GetViewMode(CurrentPath),
                _settingsService.GetSortMode(CurrentPath));

            switch (command)
            {
                case BackgroundMenuCommand.ViewLarge:
                    await SetViewModeAsync("Large");
                    break;
                case BackgroundMenuCommand.ViewMedium:
                    await SetViewModeAsync("Medium");
                    break;
                case BackgroundMenuCommand.ViewDetails:
                    await SetViewModeAsync("Details");
                    break;
                case BackgroundMenuCommand.SortName:
                    await SetSortModeAsync("Name");
                    break;
                case BackgroundMenuCommand.SortDateModified:
                    await SetSortModeAsync("Date modified");
                    break;
                case BackgroundMenuCommand.SortType:
                    await SetSortModeAsync("Type");
                    break;
                case BackgroundMenuCommand.SortSize:
                    await SetSortModeAsync("Size");
                    break;
                case BackgroundMenuCommand.Refresh:
                case BackgroundMenuCommand.ShellCommand:
                    await NavigateAsync(CurrentPath, pushHistory: false);
                    break;
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Shell menu error: {ex.Message}";
        }
    }

    private async void FileList_ContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.InRecycleQueue || args.Item is not FileSystemItem item || !item.TryBeginThumbnailLoad()) return;
        item.Thumbnail = await ThumbnailService.LoadAsync(item.FullPath, item.IsDirectory, 128);
    }

    private void FileList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateStatus();

    private async void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SettingsDialog(_settingsService)
        {
            XamlRoot = Root.XamlRoot,
        };
        await dialog.ShowAsync();

        // Settings save as they change and normally refresh through SettingsService.Saved. Reapply
        // once after close as a deterministic fallback if optional theme-watcher initialization was
        // unavailable on an older Windows build.
        ApplyTheme();
        await NavigateAsync(CurrentPath, pushHistory: false);
    }

    private async void ViewLarge_Click(object sender, RoutedEventArgs e) => await SetViewModeAsync("Large");
    private async void ViewMedium_Click(object sender, RoutedEventArgs e) => await SetViewModeAsync("Medium");
    private async void ViewDetails_Click(object sender, RoutedEventArgs e) => await SetViewModeAsync("Details");

    private void TerminalButton_Click(object sender, RoutedEventArgs e) => OpenTerminal();

    private void OpenTerminal()
    {
        try
        {
            TerminalService.Open(CurrentPath, _settingsService.Current);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Terminal launch failed: {ex.Message}";
        }
    }

    private async void BackButton_Click(object sender, RoutedEventArgs e)
    {
        var state = ActiveTabState;
        if (state is null || state.BackHistory.Count == 0) return;
        state.ForwardHistory.Push(state.CurrentPath);
        var target = state.BackHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async void ForwardButton_Click(object sender, RoutedEventArgs e)
    {
        var state = ActiveTabState;
        if (state is null || state.ForwardHistory.Count == 0) return;
        state.BackHistory.Push(state.CurrentPath);
        var target = state.ForwardHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async void UpButton_Click(object sender, RoutedEventArgs e)
    {
        var parent = Directory.GetParent(CurrentPath)?.FullName;
        if (!string.IsNullOrWhiteSpace(parent)) await NavigateAsync(parent);
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) =>
        await NavigateAsync(CurrentPath, pushHistory: false);

    private async void GoButton_Click(object sender, RoutedEventArgs e) =>
        await NavigateAsync(AddressBox.Text);

    private async void AddressBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await NavigateAsync(AddressBox.Text);
    }

    private void Tabs_AddTabButtonClick(TabView sender, object args) => AddTab(CurrentPath, select: true);

    private async void Tabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressTabSelection || ActiveTabState is null) return;
        await NavigateAsync(ActiveTabState.CurrentPath, pushHistory: false);
    }

    private async void Tabs_TabCloseRequested(TabView sender, TabViewTabCloseRequestedEventArgs args)
    {
        if (Tabs.TabItems.Count <= 1) return;

        var closing = args.Tab;
        var wasSelected = ReferenceEquals(Tabs.SelectedItem, closing);
        var oldIndex = Tabs.TabItems.IndexOf(closing);

        _suppressTabSelection = true;
        Tabs.TabItems.Remove(closing);
        if (wasSelected && Tabs.TabItems.Count > 0)
        {
            Tabs.SelectedIndex = Math.Clamp(oldIndex - 1, 0, Tabs.TabItems.Count - 1);
        }
        _suppressTabSelection = false;

        if (wasSelected && ActiveTabState is not null)
        {
            await NavigateAsync(ActiveTabState.CurrentPath, pushHistory: false);
        }
    }
}

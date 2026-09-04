using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.Storage;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;
using Xplorer.Native.Views;

namespace Xplorer.Native;

public sealed partial class MainWindow : Window
{
    private readonly SettingsService _settingsService = new();
    private readonly ShellContextMenuService _shellContextMenu = new();
    private readonly Stack<string> _backHistory = new();
    private readonly Stack<string> _forwardHistory = new();
    private readonly nint _hwnd;
    private string _currentPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public ObservableCollection<FileSystemItem> Items { get; } = [];
    public ObservableCollection<DriveItem> Drives { get; } = [];

    public MainWindow()
    {
        InitializeComponent();
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        ApplyTheme();
        RefreshDrives();
        _ = NavigateAsync(_currentPath, pushHistory: false);
    }

    private async Task NavigateAsync(string path, bool pushHistory = true)
    {
        if (!Directory.Exists(path)) return;

        if (pushHistory && !string.Equals(path, _currentPath, StringComparison.OrdinalIgnoreCase))
        {
            _backHistory.Push(_currentPath);
            _forwardHistory.Clear();
        }

        _currentPath = Path.GetFullPath(path);
        AddressBox.Text = _currentPath;
        ActiveTab.Header = Path.GetFileName(_currentPath.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name
            ? name
            : _currentPath;

        var settings = _settingsService.Current;
        var entries = await Task.Run(() =>
        {
            var result = new List<FileSystemItem>();
            try
            {
                foreach (var entry in Directory.EnumerateFileSystemEntries(_currentPath))
                {
                    try
                    {
                        var attributes = File.GetAttributes(entry);
                        if (!settings.ShowHiddenFiles && attributes.HasFlag(FileAttributes.Hidden)) continue;
                        var isDirectory = attributes.HasFlag(FileAttributes.Directory);
                        result.Add(new FileSystemItem
                        {
                            FullPath = entry,
                            Name = Path.GetFileName(entry),
                            IsDirectory = isDirectory,
                            ShowExtension = settings.ShowFileExtensions,
                        });
                    }
                    catch
                    {
                        // A single inaccessible/deleted item should not break the folder view.
                    }
                }
            }
            catch
            {
                // Keep the current view responsive even if enumeration fails.
            }

            return result
                .OrderByDescending(item => item.IsDirectory)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        });

        Items.Clear();
        foreach (var entry in entries) Items.Add(entry);

        StatusText.Text = $"{Items.Count} items";
        BackButton.IsEnabled = _backHistory.Count > 0;
        ForwardButton.IsEnabled = _forwardHistory.Count > 0;
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

    private async void DriveList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is DriveItem drive)
            await NavigateAsync(drive.RootPath);
    }

    private async void FileGrid_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (FileGrid.SelectedItem is not FileSystemItem item) return;

        if (item.IsDirectory)
        {
            await NavigateAsync(item.FullPath);
            return;
        }

        try
        {
            var file = await StorageFile.GetFileFromPathAsync(item.FullPath);
            await Launcher.LaunchFileAsync(file);
        }
        catch
        {
            // Native file association handling will be expanded during the shell integration pass.
        }
    }

    private void FileGrid_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if ((e.OriginalSource as FrameworkElement)?.DataContext is not FileSystemItem item) return;
        e.Handled = true;
        _shellContextMenu.ShowForPath(_hwnd, item.FullPath);
    }

    private void FileArea_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (e.Handled) return;

        var flyout = new MenuFlyout();

        var view = new MenuFlyoutSubItem { Text = "View" };
        view.Items.Add(new MenuFlyoutItem { Text = "Large icons" });
        view.Items.Add(new MenuFlyoutItem { Text = "Medium icons" });
        view.Items.Add(new MenuFlyoutItem { Text = "Details" });
        flyout.Items.Add(view);

        var sort = new MenuFlyoutSubItem { Text = "Sort by" };
        sort.Items.Add(new MenuFlyoutItem { Text = "Name" });
        sort.Items.Add(new MenuFlyoutItem { Text = "Date modified" });
        sort.Items.Add(new MenuFlyoutItem { Text = "Type" });
        sort.Items.Add(new MenuFlyoutItem { Text = "Size" });
        flyout.Items.Add(sort);

        var refresh = new MenuFlyoutItem { Text = "Refresh" };
        refresh.Click += async (_, _) => await NavigateAsync(_currentPath, pushHistory: false);
        flyout.Items.Add(refresh);
        flyout.Items.Add(new MenuFlyoutSeparator());

        var terminal = new MenuFlyoutItem { Text = "Open in Terminal" };
        terminal.Click += (_, _) => OpenTerminal();
        flyout.Items.Add(terminal);

        flyout.ShowAt(FileArea, e.GetPosition(FileArea));
        e.Handled = true;
    }

    private async void FileGrid_ContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.InRecycleQueue || args.Item is not FileSystemItem item || !item.TryBeginThumbnailLoad()) return;
        item.Thumbnail = await ThumbnailService.LoadAsync(item.FullPath, item.IsDirectory, 96);
    }

    private async void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SettingsDialog(_settingsService)
        {
            XamlRoot = Root.XamlRoot,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return;

        ApplyTheme();
        await NavigateAsync(_currentPath, pushHistory: false);
    }

    private void TerminalButton_Click(object sender, RoutedEventArgs e) => OpenTerminal();

    private void OpenTerminal()
    {
        try
        {
            TerminalService.Open(_currentPath, _settingsService.Current);
        }
        catch
        {
            // Settings UI will expose launch diagnostics in a later pass.
        }
    }

    private async void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (_backHistory.Count == 0) return;
        _forwardHistory.Push(_currentPath);
        var target = _backHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async void ForwardButton_Click(object sender, RoutedEventArgs e)
    {
        if (_forwardHistory.Count == 0) return;
        _backHistory.Push(_currentPath);
        var target = _forwardHistory.Pop();
        await NavigateAsync(target, pushHistory: false);
    }

    private async void UpButton_Click(object sender, RoutedEventArgs e)
    {
        var parent = Directory.GetParent(_currentPath)?.FullName;
        if (!string.IsNullOrWhiteSpace(parent)) await NavigateAsync(parent);
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e) =>
        await NavigateAsync(_currentPath, pushHistory: false);

    private async void GoButton_Click(object sender, RoutedEventArgs e) =>
        await NavigateAsync(AddressBox.Text);

    private async void AddressBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        await NavigateAsync(AddressBox.Text);
    }

    private void Tabs_AddTabButtonClick(TabView sender, object args)
    {
        // Multi-tab state is part of the next native migration pass. Keep one real tab strip,
        // rather than recreating the old duplicate app-level + pane-level tabs.
    }
}

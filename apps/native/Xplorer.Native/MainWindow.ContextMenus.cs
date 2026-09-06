using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.Storage;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const long FileActivationDedupWindowMs = 180;
    private string? _lastItemClickPath;
    private long _lastItemClickTick;
    private string? _lastActivatedPath;
    private long _lastActivationDispatchTick;

    /// <summary>
    /// Explorer-style RMB behavior: right-clicking an item outside the selection makes it the
    /// selection; right-clicking one of several selected items preserves the full selection.
    ///
    /// Item menus use the compatibility-first live Shell host. Registry cascades and many installed
    /// shell extensions populate child menus through CMF_SYNCCASCADEMENU and/or IContextMenu2/3
    /// messages, so they must remain attached to their COM owner until TrackPopupMenuEx exits.
    /// </summary>
    private async void FileList_MultiRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        var item = ResolveFileSystemItem(e.OriginalSource);
        if (item is null || sender is not ListViewBase list) return;

        e.Handled = true;

        if (!list.SelectedItems.Contains(item))
        {
            list.SelectedItems.Clear();
            list.SelectedItems.Add(item);
        }

        var selectedPaths = list.SelectedItems
            .OfType<FileSystemItem>()
            .Select(selected => selected.FullPath)
            .ToArray();
        if (selectedPaths.Length == 0) selectedPaths = [item.FullPath];

        try
        {
            using var liveShellMenu = new ExplorerShellMenuService();
            var result = liveShellMenu.ShowForPaths(_hwnd, selectedPaths);

            // Cancelling a context menu must be essentially free. Re-enumerate only after an
            // invoked Shell command because it may have created, renamed, moved or deleted items.
            if (result == ShellMenuShowResult.Invoked)
                await NavigateAsync(CurrentPath, pushHistory: false);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Shell menu error: {ex.Message}";
        }
    }

    /// <summary>
    /// Activates the exact row/tile that received the double-tap instead of trusting SelectedItem.
    /// Extended selection can otherwise leave a different item selected and make folders appear
    /// impossible to navigate.
    /// </summary>
    private async void FileList_ExactDoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        var item = ResolveFileSystemItem(e.OriginalSource) ?? GetSelectedItem();
        if (item is null) return;
        e.Handled = true;
        await ActivateFileSystemItemAsync(item);
    }

    /// <summary>
    /// Windows 10 can lose DoubleTapped on deeply templated ListView/GridView content. ItemClick is
    /// the compatibility fallback, but remains Explorer-style double-click rather than opening on
    /// the first click. The OS double-click interval is respected.
    /// </summary>
    private async void FileList_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter || GetSelectedItem() is not { } item) return;
        e.Handled = true;
        await ActivateFileSystemItemAsync(item);
    }

    private async void FileList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not FileSystemItem item) return;

        var now = Environment.TickCount64;
        var interval = Math.Max(200u, GetDoubleClickTime());
        var isSecondClick = string.Equals(_lastItemClickPath, item.FullPath, StringComparison.OrdinalIgnoreCase) &&
                            now - _lastItemClickTick >= 0 &&
                            now - _lastItemClickTick <= interval;

        _lastItemClickPath = item.FullPath;
        _lastItemClickTick = now;
        if (!isSecondClick) return;

        _lastItemClickPath = null;
        _lastItemClickTick = 0;
        await ActivateFileSystemItemAsync(item);
    }

    /// <summary>
    /// One activation gate is shared by the routed DoubleTapped path and the Windows 10 ItemClick
    /// fallback. Both events can be raised for the same physical double-click; without this guard a
    /// file can launch twice and a folder can push duplicate navigation history entries.
    /// </summary>
    private async Task ActivateFileSystemItemAsync(FileSystemItem item)
    {
        var now = Environment.TickCount64;
        if (string.Equals(_lastActivatedPath, item.FullPath, StringComparison.OrdinalIgnoreCase) &&
            now - _lastActivationDispatchTick >= 0 &&
            now - _lastActivationDispatchTick <= FileActivationDedupWindowMs)
        {
            return;
        }

        _lastActivatedPath = item.FullPath;
        _lastActivationDispatchTick = now;

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
            StatusText.Text = $"Could not open {item.Name}";
        }
    }

    private static FileSystemItem? ResolveFileSystemItem(object? originalSource)
    {
        if (originalSource is FrameworkElement direct && direct.DataContext is FileSystemItem directItem)
            return directItem;

        var current = originalSource as DependencyObject;
        for (var depth = 0; current is not null && depth < 24; depth++)
        {
            if (current is FrameworkElement element && element.DataContext is FileSystemItem item)
                return item;
            current = VisualTreeHelper.GetParent(current);
        }

        return null;
    }
}

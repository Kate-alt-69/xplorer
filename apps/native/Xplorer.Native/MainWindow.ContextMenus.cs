using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
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
    /// Xplorer's small configurable command section is prepended to the same live native HMENU as
    /// the real Shell menu. IContextMenu remains attached until TrackPopupMenuEx exits, so registry
    /// cascades, 7-Zip and owner-drawn extensions keep their native behavior.
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

        var selectedItems = list.SelectedItems
            .OfType<FileSystemItem>()
            .ToArray();
        if (selectedItems.Length == 0) selectedItems = [item];
        var selectedPaths = selectedItems
            .Select(selected => selected.FullPath)
            .ToArray();

        try
        {
            var canInspect = selectedItems.Length == 1 && CanOpenInInspector(selectedItems[0]);
            var xplorerEntries = XplorerContextMenuConfigService.Load(canInspect);
            using var liveShellMenu = new ExplorerShellMenuService();
            var result = liveShellMenu.ShowForPaths(_hwnd, selectedPaths, xplorerEntries);

            if (result.XplorerCommand is { } xplorerCommand)
            {
                await ExecuteXplorerContextCommandAsync(xplorerCommand, selectedItems, selectedPaths);
                return;
            }

            // Cancelling a context menu must be essentially free. Re-enumerate only after an
            // invoked Shell command because it may have created, renamed, moved or deleted items.
            if (result.ShellWasInvoked)
                await NavigateAsync(CurrentPath, pushHistory: false);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Shell menu error: {ex.Message}";
        }
    }

    private async Task ExecuteXplorerContextCommandAsync(
        XplorerContextCommand command,
        IReadOnlyList<FileSystemItem> selectedItems,
        IReadOnlyList<string> selectedPaths)
    {
        switch (command)
        {
            case XplorerContextCommand.OpenInspector:
                if (selectedItems.Count == 1 && CanOpenInInspector(selectedItems[0]))
                    await OpenItemInInspectorAsync(selectedItems[0]);
                break;

            case XplorerContextCommand.OpenTerminal:
            {
                if (selectedPaths.Count == 0) break;
                var first = selectedPaths[0];
                var directory = Directory.Exists(first)
                    ? first
                    : Path.GetDirectoryName(first) ?? CurrentPath;
                await ShowEmbeddedTerminalAsync(directory);
                break;
            }

            case XplorerContextCommand.CopyPath:
                if (selectedPaths.Count > 0)
                {
                    var package = new DataPackage();
                    package.SetText(string.Join(Environment.NewLine, selectedPaths));
                    Clipboard.SetContent(package);
                    Clipboard.Flush();
                }
                break;
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
            DebugUxTrace($"Activate folder path='{item.FullPath}' route=navigate");
            await NavigateAsync(item.FullPath);
            return;
        }

        if (CanOpenInInspector(item))
        {
            DebugUxTrace($"Activate file path='{item.FullPath}' route=inspector");
            await OpenItemInInspectorAsync(item);
            return;
        }

        try
        {
            DebugUxTrace($"Activate file path='{item.FullPath}' route=windows-default");
            var file = await StorageFile.GetFileFromPathAsync(item.FullPath);
            var launched = await Launcher.LaunchFileAsync(file);
            if (!launched)
            {
                StatusText.Text = $"No default app is registered for {item.Name}";
                DebugUxTrace($"Windows default activation returned false path='{item.FullPath}'");
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Could not open {item.Name}";
            DebugUxTrace($"Windows default activation failed path='{item.FullPath}' error='{ex.Message}'");
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

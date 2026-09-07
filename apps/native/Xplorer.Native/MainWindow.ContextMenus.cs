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
    private const long MouseDoubleClickWindowMs = 600;

    private string? _lastItemClickPath;
    private long _lastItemClickTick;
    private string? _lastActivatedPath;
    private long _lastActivationDispatchTick;

    private CancellationTokenSource? _pendingRightClickCancellation;
    private string? _pendingRightClickKey;
    private long _pendingRightClickTick;

    private enum RightClickGestureKind
    {
        Cancelled,
        Single,
        Double,
    }

    /// <summary>
    /// WinUI's ItemClick path is the Windows 10 fallback for deeply templated rows/tiles. Keep the
    /// XAML compact and wire this once after the visual tree is loaded.
    /// </summary>
    private void InitializeMouseActivationGestures()
    {
        FileGrid.IsItemClickEnabled = true;
        FileGrid.ItemClick += FileList_ItemClick;
        FileGrid.KeyDown += FileList_KeyDown;

        FileDetails.IsItemClickEnabled = true;
        FileDetails.ItemClick += FileList_ItemClick;
        FileDetails.KeyDown += FileList_KeyDown;
    }

    /// <summary>
    /// Explorer-style RMB selection plus Xplorer's optional Double-RMB gesture. The first RMB is
    /// held for 600 ms only when the setting is enabled. A second RMB on the exact same selection
    /// cancels that pending normal menu and asks the live Shell IContextMenu for extended verbs.
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
        var gestureKey = BuildRightClickSelectionKey(selectedPaths);

        var gesture = await ClassifyRightClickGestureAsync(gestureKey);
        if (gesture == RightClickGestureKind.Cancelled) return;

        // If the user selected something else while the single-RMB timer was pending, do not pop a
        // stale menu for the old selection.
        if (gesture == RightClickGestureKind.Single)
        {
            var currentKey = BuildRightClickSelectionKey(
                list.SelectedItems.OfType<FileSystemItem>().Select(selected => selected.FullPath));
            if (!string.Equals(currentKey, gestureKey, StringComparison.OrdinalIgnoreCase)) return;
        }

        await ShowItemContextMenuAsync(
            selectedItems,
            selectedPaths,
            forceExtendedVerbs: gesture == RightClickGestureKind.Double);
    }

    private async Task ShowItemContextMenuAsync(
        IReadOnlyList<FileSystemItem> selectedItems,
        IReadOnlyList<string> selectedPaths,
        bool forceExtendedVerbs)
    {
        try
        {
            var canInspect = selectedItems.Count == 1 && CanOpenInInspector(selectedItems[0]);
            var xplorerEntries = XplorerContextMenuConfigService.Load(canInspect);
            using var liveShellMenu = new ExplorerShellMenuService();
            var result = liveShellMenu.ShowForPaths(
                _hwnd,
                selectedPaths,
                xplorerEntries,
                forceExtendedVerbs);

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

    private async Task<RightClickGestureKind> ClassifyRightClickGestureAsync(string key)
    {
        if (!_settingsService.Current.DoubleRmbExtendedMenu)
        {
            CancelPendingRightClickGesture();
            return RightClickGestureKind.Single;
        }

        var now = Environment.TickCount64;
        var elapsed = now - _pendingRightClickTick;
        var isSecondClick = _pendingRightClickCancellation is not null &&
                            string.Equals(_pendingRightClickKey, key, StringComparison.OrdinalIgnoreCase) &&
                            elapsed >= 0 &&
                            elapsed <= MouseDoubleClickWindowMs;

        if (isSecondClick)
        {
            CancelPendingRightClickGesture();
            return RightClickGestureKind.Double;
        }

        CancelPendingRightClickGesture();

        var cancellation = new CancellationTokenSource();
        _pendingRightClickCancellation = cancellation;
        _pendingRightClickKey = key;
        _pendingRightClickTick = now;

        try
        {
            await Task.Delay((int)MouseDoubleClickWindowMs, cancellation.Token);
        }
        catch (OperationCanceledException)
        {
            return RightClickGestureKind.Cancelled;
        }

        if (!ReferenceEquals(_pendingRightClickCancellation, cancellation))
            return RightClickGestureKind.Cancelled;

        _pendingRightClickCancellation = null;
        _pendingRightClickKey = null;
        _pendingRightClickTick = 0;
        cancellation.Dispose();
        return RightClickGestureKind.Single;
    }

    private void CancelPendingRightClickGesture()
    {
        var cancellation = _pendingRightClickCancellation;
        _pendingRightClickCancellation = null;
        _pendingRightClickKey = null;
        _pendingRightClickTick = 0;

        if (cancellation is null) return;
        try { cancellation.Cancel(); }
        catch (ObjectDisposedException) { }
        cancellation.Dispose();
    }

    private static string BuildRightClickSelectionKey(IEnumerable<string> paths) =>
        "item:" + string.Join(
            '\u001F',
            paths
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(Path.GetFullPath)
                .OrderBy(path => path, StringComparer.OrdinalIgnoreCase));

    private static string BuildBackgroundRightClickGestureKey(string folderPath) =>
        "background:" + Path.GetFullPath(folderPath);

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
        CancelPendingRightClickGesture();
        await ActivateFileSystemItemAsync(item);
    }

    /// <summary>
    /// Windows 10 can lose DoubleTapped on deeply templated ListView/GridView content. ItemClick is
    /// the compatibility fallback and uses the same explicit 600 ms gesture window as Double-RMB.
    /// </summary>
    private async void FileList_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter || GetSelectedItem() is not { } item) return;
        e.Handled = true;
        CancelPendingRightClickGesture();
        await ActivateFileSystemItemAsync(item);
    }

    private async void FileList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not FileSystemItem item) return;

        CancelPendingRightClickGesture();

        var now = Environment.TickCount64;
        var isSecondClick = string.Equals(_lastItemClickPath, item.FullPath, StringComparison.OrdinalIgnoreCase) &&
                            now - _lastItemClickTick >= 0 &&
                            now - _lastItemClickTick <= MouseDoubleClickWindowMs;

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

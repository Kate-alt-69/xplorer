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
    private bool _shellMenuLifetimeHooked;

    /// <summary>
    /// Explorer-style RMB behavior: right-clicking an item outside the selection makes it the
    /// selection; right-clicking one of several selected items preserves the full selection.
    ///
    /// IMPORTANT: selection menus are deliberately hosted from a fresh live IContextMenu instance.
    /// Shell cascades created by registry SubCommands/ExtendedSubCommandsKey entries and a number of
    /// installer shell extensions populate children only after WM_INITMENUPOPUP. Replaying a cached
    /// HMENU snapshot severs that live COM owner and produces the tiny/blank submenu seen with custom
    /// .reg cascades. Correct Explorer shell behavior wins over the tiny repeated-RMB cache gain.
    /// </summary>
    private async void FileList_MultiRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        var item = ResolveFileSystemItem(e.OriginalSource);
        if (item is null || sender is not ListViewBase list) return;

        e.Handled = true;
        EnsureShellMenuLifetimeHook();

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
            // A fresh host guarantees that lazy cascades stay attached to their IContextMenu2/3
            // while TrackPopupMenuEx is running. The service itself still keeps its safe cache code
            // for callers that can opt into snapshot replay later once dynamic-popup detection lands.
            using var liveShellMenu = new ShellContextMenuService();
            var result = liveShellMenu.ShowForPaths(_hwnd, selectedPaths);

            // Cancelling a context menu must be essentially free. The old path re-enumerated the
            // whole directory after every RMB close, which made menu spam much more expensive.
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

    private async Task ActivateFileSystemItemAsync(FileSystemItem item)
    {
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

    private void EnsureShellMenuLifetimeHook()
    {
        if (_shellMenuLifetimeHooked) return;
        _shellMenuLifetimeHooked = true;
        Closed += (_, _) => _shellContextMenu.Dispose();
    }
}

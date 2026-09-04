using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    /// <summary>
    /// Explorer-style RMB behavior: right-clicking an item outside the selection makes it the
    /// selection; right-clicking one of several selected items preserves the full selection and
    /// asks Windows for the context menu for all selected PIDLs.
    /// </summary>
    private async void FileList_MultiRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if ((e.OriginalSource as FrameworkElement)?.DataContext is not FileSystemItem item) return;
        if (sender is not ListViewBase list) return;

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
            _shellContextMenu.ShowForPaths(_hwnd, selectedPaths);
            await NavigateAsync(CurrentPath, pushHistory: false);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Shell menu error: {ex.Message}";
        }
    }
}

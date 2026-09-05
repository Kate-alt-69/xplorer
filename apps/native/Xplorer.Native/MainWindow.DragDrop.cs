using Microsoft.UI.Input.DragDrop;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _nativeDragDropInitialized;

    private void InitializeNativeDragDrop()
    {
        if (_nativeDragDropInitialized) return;
        _nativeDragDropInitialized = true;

        ConfigureDropTarget(FileArea);
        ConfigureDropTarget(FileGrid);
        ConfigureDropTarget(FileDetails);
        ConfigureDropTarget(DriveList);

        // ListViewBase's DragItemsStarting cannot be deferred while StorageFile/StorageFolder
        // objects are created. Enabling drag on the generated item container gives us the normal
        // DragStarting deferral and produces a real StorageItems package Explorer can consume.
        FileGrid.ContainerContentChanging += PrepareFileContainerForDrag;
        FileDetails.ContainerContentChanging += PrepareFileContainerForDrag;
    }

    private void ConfigureDropTarget(UIElement element)
    {
        element.AllowDrop = true;
        element.DragOver -= FileDropTarget_DragOver;
        element.Drop -= FileDropTarget_Drop;
        element.DragOver += FileDropTarget_DragOver;
        element.Drop += FileDropTarget_Drop;
    }

    private void PrepareFileContainerForDrag(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        var container = args.ItemContainer;
        container.DragStarting -= FileItem_DragStarting;
        container.DropCompleted -= FileItem_DropCompleted;

        if (args.InRecycleQueue)
        {
            container.CanDrag = false;
            return;
        }

        container.CanDrag = true;
        container.DragStarting += FileItem_DragStarting;
        container.DropCompleted += FileItem_DropCompleted;
    }

    private async void FileItem_DragStarting(UIElement sender, DragStartingEventArgs args)
    {
        var draggedItem = (sender as FrameworkElement)?.DataContext as FileSystemItem;
        if (draggedItem is null)
        {
            args.Cancel = true;
            return;
        }

        var selected = GetSelectedOperationItems();
        var draggedIsSelected = selected.Any(item =>
            string.Equals(item.FullPath, draggedItem.FullPath, StringComparison.OrdinalIgnoreCase));
        var payloadItems = draggedIsSelected
            ? selected
            : new[] { draggedItem };

        var deferral = args.GetDeferral();
        try
        {
            var storageItems = new List<IStorageItem>(payloadItems.Count);
            foreach (var item in payloadItems)
            {
                try
                {
                    IStorageItem storageItem;
                    if (item.IsDirectory)
                        storageItem = await StorageFolder.GetFolderFromPathAsync(item.FullPath);
                    else
                        storageItem = await StorageFile.GetFileFromPathAsync(item.FullPath);
                    storageItems.Add(storageItem);
                }
                catch
                {
                    // Files can disappear or become inaccessible between enumeration and drag.
                }
            }

            if (storageItems.Count == 0)
            {
                args.Cancel = true;
                return;
            }

            args.Data.SetStorageItems(storageItems, readOnly: false);
            args.Data.RequestedOperation = DataPackageOperation.Copy | DataPackageOperation.Move;
            args.AllowedOperations = DataPackageOperation.Copy | DataPackageOperation.Move;
            args.Data.Properties.Title = storageItems.Count == 1
                ? draggedItem.DisplayName
                : $"{storageItems.Count} Xplorer items";
        }
        catch
        {
            args.Cancel = true;
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void FileItem_DropCompleted(UIElement sender, DropCompletedEventArgs args)
    {
        if (args.DropResult == DataPackageOperation.Move)
            _ = NavigateAsync(CurrentPath, pushHistory: false);
    }

    private void FileDropTarget_DragOver(object sender, DragEventArgs e)
    {
        if (!e.DataView.Contains(StandardDataFormats.StorageItems))
        {
            e.AcceptedOperation = DataPackageOperation.None;
            e.Handled = true;
            return;
        }

        var destination = ResolveDropDestination(e.OriginalSource as DependencyObject, sender as UIElement);
        e.AcceptedOperation = destination is null
            ? DataPackageOperation.None
            : ChooseDropOperation(e, null, destination);
        e.Handled = true;
    }

    private async void FileDropTarget_Drop(object sender, DragEventArgs e)
    {
        if (!e.DataView.Contains(StandardDataFormats.StorageItems)) return;

        var destination = ResolveDropDestination(e.OriginalSource as DependencyObject, sender as UIElement);
        if (destination is null)
        {
            e.AcceptedOperation = DataPackageOperation.None;
            e.Handled = true;
            return;
        }

        var deferral = e.GetDeferral();
        try
        {
            var storageItems = await e.DataView.GetStorageItemsAsync();
            var sourcePaths = storageItems
                .Select(item => item.Path)
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (sourcePaths.Length == 0)
            {
                e.AcceptedOperation = DataPackageOperation.None;
                return;
            }

            if (sourcePaths.Any(path => IsInvalidDropDestination(path, destination)))
            {
                StatusText.Text = "Can't drop a folder into itself or one of its descendants.";
                e.AcceptedOperation = DataPackageOperation.None;
                return;
            }

            var operation = ChooseDropOperation(e, sourcePaths, destination);
            if (operation == DataPackageOperation.None)
            {
                e.AcceptedOperation = DataPackageOperation.None;
                return;
            }

            StatusText.Text = operation == DataPackageOperation.Move ? "Moving..." : "Copying...";
            var result = operation == DataPackageOperation.Move
                ? await ShellFileOperationService.MoveAsync(_hwnd, sourcePaths, destination)
                : await ShellFileOperationService.CopyAsync(_hwnd, sourcePaths, destination);

            // Do not report a successful Move/Copy back to the drag source when the Windows Shell
            // operation was cancelled or failed. Some drag sources use DropResult to decide whether
            // to update their own UI/state, so lying here can make a failed drop look destructive.
            e.AcceptedOperation = result.Succeeded ? operation : DataPackageOperation.None;
            await NavigateAsync(CurrentPath, pushHistory: false);
            StatusText.Text = FormatOperationResult(
                result,
                operation == DataPackageOperation.Move ? "Move" : "Copy");
        }
        catch (Exception ex)
        {
            e.AcceptedOperation = DataPackageOperation.None;
            StatusText.Text = $"Drop failed: {ex.Message}";
        }
        finally
        {
            e.Handled = true;
            deferral.Complete();
        }
    }

    private string? ResolveDropDestination(DependencyObject? originalSource, UIElement? eventSource)
    {
        DependencyObject? current = originalSource;
        while (current is not null)
        {
            if (current is FrameworkElement element)
            {
                if (element.DataContext is FileSystemItem item)
                    return item.IsDirectory ? item.FullPath : null;
                if (element.DataContext is DriveItem drive)
                    return drive.RootPath;
            }

            if (ReferenceEquals(current, FileArea) ||
                ReferenceEquals(current, FileGrid) ||
                ReferenceEquals(current, FileDetails))
            {
                return CurrentPath;
            }

            current = VisualTreeHelper.GetParent(current);
        }

        return ReferenceEquals(eventSource, DriveList) ? null : CurrentPath;
    }

    private static DataPackageOperation ChooseDropOperation(
        DragEventArgs e,
        IReadOnlyList<string>? sourcePaths,
        string destination)
    {
        var allowed = e.AllowedOperations;
        var canCopy = (allowed & DataPackageOperation.Copy) != 0;
        var canMove = (allowed & DataPackageOperation.Move) != 0;
        var modifiers = (int)e.Modifiers;

        if ((modifiers & (int)DragDropModifiers.Control) != 0 && canCopy)
            return DataPackageOperation.Copy;
        if ((modifiers & (int)DragDropModifiers.Shift) != 0 && canMove)
            return DataPackageOperation.Move;

        var requested = e.DataView.RequestedOperation;
        if (requested == DataPackageOperation.Move && canMove)
            return DataPackageOperation.Move;
        if (requested == DataPackageOperation.Copy && canCopy)
            return DataPackageOperation.Copy;

        if (sourcePaths is not null && sourcePaths.Count > 0)
        {
            var destinationRoot = Path.GetPathRoot(destination);
            var sameVolume = sourcePaths.All(path =>
                string.Equals(
                    Path.GetPathRoot(path),
                    destinationRoot,
                    StringComparison.OrdinalIgnoreCase));

            if (sameVolume && canMove) return DataPackageOperation.Move;
            if (!sameVolume && canCopy) return DataPackageOperation.Copy;
        }

        if (canMove) return DataPackageOperation.Move;
        if (canCopy) return DataPackageOperation.Copy;
        return DataPackageOperation.None;
    }

    private static bool IsInvalidDropDestination(string source, string destination)
    {
        string sourceFull;
        string destinationFull;
        try
        {
            sourceFull = Path.GetFullPath(source);
            destinationFull = Path.GetFullPath(destination);
        }
        catch
        {
            return true;
        }

        if (string.Equals(sourceFull, destinationFull, StringComparison.OrdinalIgnoreCase))
            return true;
        if (!Directory.Exists(sourceFull)) return false;

        var sourcePrefix = Path.TrimEndingDirectorySeparator(sourceFull) + Path.DirectorySeparatorChar;
        var destinationPrefix = Path.TrimEndingDirectorySeparator(destinationFull) + Path.DirectorySeparatorChar;
        return destinationPrefix.StartsWith(sourcePrefix, StringComparison.OrdinalIgnoreCase);
    }
}

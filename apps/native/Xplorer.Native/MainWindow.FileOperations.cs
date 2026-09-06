using System.Linq;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    /// <summary>
    /// Installs keyboard shortcuts for the statically declared command-bar actions. Copy/Cut use
    /// Explorer's CF_HDROP clipboard format so data can move between Xplorer and Explorer.
    /// Paste/Delete are executed by the Windows Shell.
    /// </summary>
    public void InitializeNativeFileOperations()
    {
        // FileGrid/FileDetails already route DoubleTapped to FileList_ExactDoubleTapped in XAML.
        // Keep one exact pointer-target handler only so a file cannot open twice.
        InstallAccelerator(VirtualKey.C, VirtualKeyModifiers.Control, () => CopySelectionToClipboard(false));
        InstallAccelerator(VirtualKey.X, VirtualKeyModifiers.Control, () => CopySelectionToClipboard(true));
        InstallAsyncAccelerator(VirtualKey.V, VirtualKeyModifiers.Control, PasteFromShellClipboardAsync);
        InstallAsyncAccelerator(VirtualKey.Delete, VirtualKeyModifiers.None, DeleteSelectionAsync);
        InstallAccelerator(VirtualKey.A, VirtualKeyModifiers.Control, SelectAllFiles);
        InstallAsyncAccelerator(VirtualKey.F2, VirtualKeyModifiers.None, RenameSelectionAsync);
        InstallAsyncAccelerator(
            VirtualKey.N,
            VirtualKeyModifiers.Control | VirtualKeyModifiers.Shift,
            CreateNewFolderAsync);
        InitializeKeyboardShortcuts();
    }

    private async void NewFolderButton_Click(object sender, RoutedEventArgs e) =>
        await CreateNewFolderAsync();

    private void CopyButton_Click(object sender, RoutedEventArgs e) =>
        CopySelectionToClipboard(move: false);

    private void CutButton_Click(object sender, RoutedEventArgs e) =>
        CopySelectionToClipboard(move: true);

    private async void PasteButton_Click(object sender, RoutedEventArgs e) =>
        await PasteFromShellClipboardAsync();

    private async void DeleteButton_Click(object sender, RoutedEventArgs e) =>
        await DeleteSelectionAsync();

    private IReadOnlyList<FileSystemItem> GetSelectedOperationItems()
    {
        var list = FileDetails.Visibility == Visibility.Visible
            ? (ListViewBase)FileDetails
            : FileGrid;
        return list.SelectedItems.OfType<FileSystemItem>().ToArray();
    }

    private async Task CreateNewFolderAsync()
    {
        if (IsTextInputFocused()) return;

        try
        {
            var folderPath = GetUniqueNewFolderPath(CurrentPath);
            Directory.CreateDirectory(folderPath);
            await NavigateAsync(CurrentPath, pushHistory: false);

            var created = Items.FirstOrDefault(item =>
                item.IsDirectory &&
                string.Equals(item.FullPath, folderPath, StringComparison.OrdinalIgnoreCase));
            if (created is not null)
            {
                if (FileDetails.Visibility == Visibility.Visible)
                    FileDetails.SelectedItem = created;
                else
                    FileGrid.SelectedItem = created;
            }

            StatusText.Text = $"Created {Path.GetFileName(folderPath)}";
            await RenameSelectionAsync();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Could not create folder: {ex.Message}";
        }
    }

    private static string GetUniqueNewFolderPath(string parent)
    {
        var candidate = Path.Combine(parent, "New folder");
        if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;

        for (var suffix = 2; suffix < int.MaxValue; suffix++)
        {
            candidate = Path.Combine(parent, $"New folder ({suffix})");
            if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
        }

        throw new IOException("No available name for a new folder.");
    }

    private void CopySelectionToClipboard(bool move)
    {
        if (IsTextInputFocused()) return;

        var selected = GetSelectedOperationItems();
        if (selected.Count == 0)
        {
            StatusText.Text = "Select one or more files first.";
            return;
        }

        try
        {
            ShellClipboardService.SetFiles(
                _hwnd,
                selected.Select(item => item.FullPath).ToArray(),
                move);
            StatusText.Text = move
                ? $"{selected.Count} item{(selected.Count == 1 ? string.Empty : "s")} ready to move"
                : $"{selected.Count} item{(selected.Count == 1 ? string.Empty : "s")} copied";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Clipboard error: {ex.Message}";
        }
    }

    private async Task PasteFromShellClipboardAsync()
    {
        if (IsTextInputFocused()) return;

        ShellClipboardFiles? clipboard;
        try
        {
            clipboard = ShellClipboardService.TryGetFiles(_hwnd);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Clipboard error: {ex.Message}";
            return;
        }

        if (clipboard is null || clipboard.Paths.Count == 0)
        {
            StatusText.Text = "The Windows clipboard does not contain files or folders.";
            return;
        }

        try
        {
            StatusText.Text = clipboard.Move ? "Moving..." : "Copying...";
            var result = clipboard.Move
                ? await ShellFileOperationService.MoveAsync(_hwnd, clipboard.Paths, CurrentPath)
                : await ShellFileOperationService.CopyAsync(_hwnd, clipboard.Paths, CurrentPath);

            await NavigateAsync(CurrentPath, pushHistory: false);
            StatusText.Text = FormatOperationResult(result, clipboard.Move ? "Move" : "Copy");
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Paste failed: {ex.Message}";
        }
    }

    private async Task DeleteSelectionAsync()
    {
        if (IsTextInputFocused()) return;

        var selected = GetSelectedOperationItems();
        if (selected.Count == 0)
        {
            StatusText.Text = "Select one or more files first.";
            return;
        }

        try
        {
            StatusText.Text = "Deleting...";
            var result = await ShellFileOperationService.DeleteAsync(
                _hwnd,
                selected.Select(item => item.FullPath).ToArray());
            await NavigateAsync(CurrentPath, pushHistory: false);
            StatusText.Text = FormatOperationResult(result, "Delete");
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Delete failed: {ex.Message}";
        }
    }

    private void SelectAllFiles()
    {
        if (IsTextInputFocused()) return;

        if (FileDetails.Visibility == Visibility.Visible)
            FileDetails.SelectAll();
        else
            FileGrid.SelectAll();
    }

    private bool IsTextInputFocused() =>
        FocusManager.GetFocusedElement(Root.XamlRoot) is TextBox;

    private static string FormatOperationResult(ShellFileOperationResult result, string operation)
    {
        if (result.Succeeded) return $"{operation} completed";
        if (result.Aborted) return $"{operation} cancelled";
        return $"{operation} failed (Shell code 0x{result.ResultCode:X})";
    }

    private void InstallAccelerator(VirtualKey key, VirtualKeyModifiers modifiers, Action action)
    {
        var accelerator = new KeyboardAccelerator
        {
            Key = key,
            Modifiers = modifiers,
        };
        accelerator.Invoked += (_, args) =>
        {
            if (IsTextInputFocused()) return;
            args.Handled = true;
            action();
        };
        Root.KeyboardAccelerators.Add(accelerator);
    }

    private void InstallAsyncAccelerator(
        VirtualKey key,
        VirtualKeyModifiers modifiers,
        Func<Task> action)
    {
        var accelerator = new KeyboardAccelerator
        {
            Key = key,
            Modifiers = modifiers,
        };
        accelerator.Invoked += async (_, args) =>
        {
            if (IsTextInputFocused()) return;
            args.Handled = true;
            await action();
        };
        Root.KeyboardAccelerators.Add(accelerator);
    }
}

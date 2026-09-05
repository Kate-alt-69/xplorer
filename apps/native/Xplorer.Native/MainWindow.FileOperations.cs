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
    /// Wires the existing command-bar controls without making file operations depend on XAML
    /// element names. Copy/Cut use Explorer's CF_HDROP clipboard format, so data can move between
    /// Xplorer and Explorer. Paste/Delete are executed by the Windows Shell.
    /// </summary>
    public void InitializeNativeFileOperations()
    {
        var commandBar = Root.Children.OfType<CommandBar>().FirstOrDefault();
        if (commandBar is not null)
        {
            var newFolderButton = new AppBarButton
            {
                Label = "New folder",
                Icon = new FontIcon { Glyph = "\uE710" },
            };
            newFolderButton.Click += async (_, _) => await CreateNewFolderAsync();
            commandBar.PrimaryCommands.Insert(0, newFolderButton);

            foreach (var command in commandBar.PrimaryCommands)
            {
                if (command is not AppBarButton button) continue;

                switch (button.Label)
                {
                    case "Copy":
                        button.Click += (_, _) => CopySelectionToClipboard(move: false);
                        break;
                    case "Cut":
                        button.Click += (_, _) => CopySelectionToClipboard(move: true);
                        break;
                    case "Paste":
                        button.Click += async (_, _) => await PasteFromShellClipboardAsync();
                        break;
                    case "Delete":
                        button.Click += async (_, _) => await DeleteSelectionAsync();
                        break;
                }
            }
        }

        // FileGrid/FileDetails already route DoubleTapped to FileList_ExactDoubleTapped in XAML.
        // The old rewrite also attached FileList_ItemDoubleTapped here at runtime, leaving two
        // activation paths on the same control. Depending on routed-event ordering that could open a
        // file twice or navigate twice. Keep one exact pointer-target handler only.

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

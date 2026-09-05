using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private static readonly HashSet<string> ReservedWindowsNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    private async Task RenameSelectionAsync()
    {
        var selected = GetSelectedOperationItems();
        if (selected.Count != 1)
        {
            StatusText.Text = selected.Count == 0
                ? "Select one file or folder to rename."
                : "Rename works on one selected item at a time.";
            return;
        }

        var item = selected[0];
        var nameBox = new TextBox
        {
            Text = item.Name,
            MinWidth = 360,
            SelectionStart = 0,
            SelectionLength = GetRenameSelectionLength(item),
        };

        nameBox.Loaded += (_, _) =>
        {
            nameBox.Focus(FocusState.Programmatic);
            nameBox.Select(0, GetRenameSelectionLength(item));
        };

        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "Rename",
            Content = nameBox,
            PrimaryButtonText = "Rename",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return;

        var newName = nameBox.Text.Trim();
        var validationError = ValidateWindowsFileName(newName);
        if (validationError is not null)
        {
            StatusText.Text = validationError;
            return;
        }

        var parent = Path.GetDirectoryName(item.FullPath);
        if (string.IsNullOrWhiteSpace(parent))
        {
            StatusText.Text = "This item cannot be renamed here.";
            return;
        }

        var destination = Path.Combine(parent, newName);
        if (string.Equals(destination, item.FullPath, StringComparison.Ordinal)) return;

        if (!string.Equals(destination, item.FullPath, StringComparison.OrdinalIgnoreCase) &&
            (File.Exists(destination) || Directory.Exists(destination)))
        {
            StatusText.Text = $"An item named '{newName}' already exists.";
            return;
        }

        try
        {
            if (item.IsDirectory)
                Directory.Move(item.FullPath, destination);
            else
                File.Move(item.FullPath, destination);

            await NavigateAsync(CurrentPath, pushHistory: false);
            var renamed = Items.FirstOrDefault(candidate =>
                string.Equals(candidate.FullPath, destination, StringComparison.OrdinalIgnoreCase));
            if (renamed is not null)
            {
                if (FileDetails.Visibility == Visibility.Visible)
                    FileDetails.SelectedItem = renamed;
                else
                    FileGrid.SelectedItem = renamed;
            }

            StatusText.Text = $"Renamed to {newName}";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Rename failed: {ex.Message}";
        }
    }

    private static int GetRenameSelectionLength(FileSystemItem item)
    {
        if (item.IsDirectory) return item.Name.Length;
        var extension = Path.GetExtension(item.Name);
        return Math.Max(0, item.Name.Length - extension.Length);
    }

    private static string? ValidateWindowsFileName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "A file name cannot be empty.";
        if (name is "." or "..") return "That name is reserved by Windows.";
        if (name.EndsWith(' ') || name.EndsWith('.'))
            return "Windows file names cannot end with a space or period.";
        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            return "That name contains a character Windows does not allow.";

        // DOS device names stay reserved even when one or more extensions follow them, e.g.
        // CON.txt and CON.backup.txt. Path.GetFileNameWithoutExtension only strips the last suffix
        // and would therefore miss the latter form.
        var firstDot = name.IndexOf('.');
        var deviceStem = firstDot < 0 ? name : name[..firstDot];
        if (ReservedWindowsNames.Contains(deviceStem))
            return $"'{deviceStem}' is a reserved Windows device name.";

        return null;
    }
}

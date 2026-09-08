using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _backgroundContextMenuParityInitialized;

    /// <summary>
    /// Replace the legacy immediate background RMB handler with the same 600 ms classifier used for
    /// item menus. A second RMB opens the live Shell extended verbs; a normal RMB stays normal. The
    /// legacy method remains compiled as a startup-safe fallback but is no longer subscribed.
    /// </summary>
    private void InitializeBackgroundContextMenuParity()
    {
        if (_backgroundContextMenuParityInitialized) return;
        _backgroundContextMenuParityInitialized = true;
        FileArea.RightTapped -= FileArea_RightTapped;
        FileArea.RightTapped += FileArea_ParityRightTapped;
    }

    private async void FileArea_ParityRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (e.Handled) return;
        e.Handled = true;

        var path = CurrentPath;
        var key = BuildBackgroundRightClickGestureKey(path);
        var gesture = await ClassifyRightClickGestureAsync(key);
        if (gesture == RightClickGestureKind.Cancelled) return;

        // Navigation may have changed while the first RMB waited for a possible second click.
        if (!string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase)) return;

        try
        {
            using var menu = new ExplorerBackgroundShellMenuService();
            var command = menu.Show(
                _hwnd,
                path,
                _settingsService.GetViewMode(path),
                _settingsService.GetSortMode(path),
                forceExtendedVerbs: gesture == RightClickGestureKind.Double);

            switch (command)
            {
                case BackgroundMenuCommand.ViewLarge:
                    await SetViewModeAsync("Large");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.ViewMedium:
                    await SetViewModeAsync("Medium");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.ViewDetails:
                    await SetViewModeAsync("Details");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.SortName:
                    await SetSortModeAsync("Name");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.SortDateModified:
                    await SetSortModeAsync("Date modified");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.SortType:
                    await SetSortModeAsync("Type");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.SortSize:
                    await SetSortModeAsync("Size");
                    RefreshChromeLabels();
                    break;
                case BackgroundMenuCommand.Refresh:
                case BackgroundMenuCommand.ShellCommand:
                    await NavigateAsync(path, pushHistory: false);
                    break;
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Shell menu error: {ex.Message}";
        }
    }
}

using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _nativeDriveUxHooked;

    private void InitializeNativeDriveUx()
    {
        if (_nativeDriveUxHooked) return;
        _nativeDriveUxHooked = true;
        DriveList.RightTapped += DriveList_RightTapped;
    }

    /// <summary>
    /// Drive RMB stays a real Windows Shell menu. In particular, Xplorer never synthesizes an
    /// "Eject" command for fixed/internal disks: Explorer itself decides which storage verbs are
    /// legal for the selected drive, and DriveService separately marks only removable drives as
    /// eject-capable for any Xplorer-owned UI we add later.
    /// </summary>
    private async void DriveList_RightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        var drive = ResolveDriveItem(e.OriginalSource);
        if (drive is null) return;

        e.Handled = true;
        try
        {
            using var shellMenu = new ExplorerShellMenuService();
            var result = shellMenu.ShowForPaths(_hwnd, [drive.RootPath]);
            if (result != ShellMenuShowResult.Invoked) return;

            // Shell commands such as format/properties/eject can return before device state settles.
            // Give Windows a tiny amount of time, then rebuild the drive list and recover the active
            // tab if the volume was actually removed.
            await Task.Delay(180);
            await RefreshDrivesAfterShellCommandAsync();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Drive menu error: {ex.Message}";
        }
    }

    private static DriveItem? ResolveDriveItem(object? originalSource)
    {
        if (originalSource is FrameworkElement direct && direct.DataContext is DriveItem directDrive)
            return directDrive;

        var current = originalSource as DependencyObject;
        for (var depth = 0; current is not null && depth < 20; depth++)
        {
            if (current is FrameworkElement element && element.DataContext is DriveItem drive)
                return drive;
            current = VisualTreeHelper.GetParent(current);
        }

        return null;
    }

    private async Task RefreshDrivesAfterShellCommandAsync()
    {
        RefreshDrives();

        if (Directory.Exists(CurrentPath))
        {
            await NavigateAsync(CurrentPath, pushHistory: false);
            return;
        }

        // If the active tab was inside a drive that just disappeared/ejected, do not leave the UI
        // stranded on a dead path. Keep history intact and move only that tab back to Home.
        StatusText.Text = "Drive is no longer available.";
        await NavigateAsync(_homePath, pushHistory: false);
    }
}

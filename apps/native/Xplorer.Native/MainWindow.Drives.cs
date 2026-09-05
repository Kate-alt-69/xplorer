using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const uint WmDeviceChange = 0x0219;
    private const uint DbtDevNodesChanged = 0x0007;
    private const uint DbtDeviceArrival = 0x8000;
    private const uint DbtDeviceRemoveComplete = 0x8004;
    private const nuint DriveSubclassId = 0x58504C44; // "XPLD"

    private readonly DriveSubclassProc _driveSubclassProc;
    private bool _nativeDriveUxHooked;
    private bool _driveSubclassInstalled;
    private int _driveRefreshQueued;

    private void InitializeNativeDriveUx()
    {
        if (_nativeDriveUxHooked) return;
        _nativeDriveUxHooked = true;
        DriveList.RightTapped += DriveList_RightTapped;

        // Use the real WM_DEVICECHANGE notification instead of polling. SetWindowSubclass supports
        // several independent subclass ids, so this safely coexists with the temporary shell-menu
        // message bridge used while an IContextMenu popup is open.
        _driveSubclassInstalled = SetWindowSubclass(
            _hwnd,
            _driveSubclassProc,
            DriveSubclassId,
            0);

        Closed += (_, _) =>
        {
            if (_driveSubclassInstalled)
            {
                RemoveWindowSubclass(_hwnd, _driveSubclassProc, DriveSubclassId);
                _driveSubclassInstalled = false;
            }
        };
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

    private nint DriveWindowSubclassProc(
        nint hWnd,
        uint message,
        nuint wParam,
        nint lParam,
        nuint subclassId,
        nuint refData)
    {
        if (message == WmDeviceChange)
        {
            var change = unchecked((uint)wParam);
            if (change is DbtDevNodesChanged or DbtDeviceArrival or DbtDeviceRemoveComplete)
                QueueDriveRefresh();
        }

        return DefSubclassProc(hWnd, message, wParam, lParam);
    }

    private void QueueDriveRefresh()
    {
        // Device arrival/removal often emits several WM_DEVICECHANGE messages. Collapse the burst
        // into one dispatcher turn, and do DriveInfo I/O outside the native window procedure.
        if (Interlocked.Exchange(ref _driveRefreshQueued, 1) != 0) return;

        DispatcherQueue.TryEnqueue(async () =>
        {
            Interlocked.Exchange(ref _driveRefreshQueued, 0);
            RefreshDrives();

            if (!Directory.Exists(CurrentPath))
                await NavigateAsync(_homePath, pushHistory: false);
        });
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint DriveSubclassProc(
        nint hWnd,
        uint message,
        nuint wParam,
        nint lParam,
        nuint subclassId,
        nuint refData);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(
        nint hWnd,
        DriveSubclassProc pfnSubclass,
        nuint uIdSubclass,
        nuint dwRefData);

    [DllImport("comctl32.dll")]
    private static extern bool RemoveWindowSubclass(
        nint hWnd,
        DriveSubclassProc pfnSubclass,
        nuint uIdSubclass);

    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint hWnd, uint uMsg, nuint wParam, nint lParam);
}

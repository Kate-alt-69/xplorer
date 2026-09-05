using Microsoft.UI.Xaml.Controls;
using Windows.Storage;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const int WorkspaceRefreshDelayMs = 120;
    private FileSystemWatcher? _workspaceWatcher;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _workspaceRefreshTimer;
    private string? _workspacePath;
    private string? _lastClickedPath;
    private long _lastClickTick;

    /// <summary>
    /// Adds a native ItemClick fallback for Windows 10, keeps the visible directory live, and
    /// tells the Rust worker which workspace deserves immediate indexing priority. None of this
    /// waits for the background index before navigation is allowed.
    /// </summary>
    public void InitializeWorkspaceTracking()
    {
        FileGrid.IsItemClickEnabled = true;
        FileDetails.IsItemClickEnabled = true;
        FileGrid.ItemClick += FileList_ItemClickActivation;
        FileDetails.ItemClick += FileList_ItemClickActivation;
        AddressBox.TextChanged += AddressBox_WorkspaceTextChanged;

        TrackWorkspace(CurrentPath, forceHint: true);
        Closed += (_, _) => DisposeWorkspaceTracking();
    }

    private async void FileList_ItemClickActivation(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not FileSystemItem item) return;

        // WinUI's DoubleTapped routing is inconsistent with Extended selection on some Windows 10
        // builds. Detect the second native ItemClick as a reliable fallback. The existing routed
        // DoubleTapped handler can still run; ActivateItemAsync is idempotent for the same folder.
        var now = Environment.TickCount64;
        var threshold = Math.Clamp((long)GetDoubleClickTime(), 250L, 1000L);
        var isDoubleActivation =
            string.Equals(_lastClickedPath, item.FullPath, StringComparison.OrdinalIgnoreCase)
            && now - _lastClickTick >= 0
            && now - _lastClickTick <= threshold;

        _lastClickedPath = item.FullPath;
        _lastClickTick = now;
        if (!isDoubleActivation) return;

        _lastClickedPath = null;
        _lastClickTick = 0;
        await ActivateItemAsync(item);
    }

    private async Task ActivateItemAsync(FileSystemItem item)
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

    private void AddressBox_WorkspaceTextChanged(object sender, TextChangedEventArgs e)
    {
        var candidate = AddressBox.Text.Trim();
        if (candidate.Length == 0) return;

        try
        {
            if (Directory.Exists(candidate))
                TrackWorkspace(Path.GetFullPath(candidate), forceHint: false);
        }
        catch
        {
            // Partially typed/invalid address-bar text is not a workspace transition.
        }
    }

    private void TrackWorkspace(string path, bool forceHint)
    {
        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(path);
        }
        catch
        {
            return;
        }

        if (!Directory.Exists(fullPath)) return;

        var unchanged = string.Equals(_workspacePath, fullPath, StringComparison.OrdinalIgnoreCase);
        if (unchanged && !forceHint) return;

        _workspacePath = fullPath;
        if (!unchanged)
        {
            _workspaceWatcher?.Dispose();
            _workspaceWatcher = null;

            try
            {
                var watcher = new FileSystemWatcher(fullPath)
                {
                    IncludeSubdirectories = false,
                    NotifyFilter = NotifyFilters.FileName
                        | NotifyFilters.DirectoryName
                        | NotifyFilters.LastWrite
                        | NotifyFilters.Size
                        | NotifyFilters.Attributes,
                    InternalBufferSize = 8 * 1024,
                    EnableRaisingEvents = true,
                };
                watcher.Created += WorkspaceChanged;
                watcher.Deleted += WorkspaceChanged;
                watcher.Changed += WorkspaceChanged;
                watcher.Renamed += WorkspaceRenamed;
                watcher.Error += WorkspaceWatcherError;
                _workspaceWatcher = watcher;
            }
            catch
            {
                // Network/offline/protected directories can reject ReadDirectoryChangesW. Normal
                // navigation still works and manual refresh remains available.
            }
        }

        IndexWorkerService.PrioritizeWorkspace(fullPath);
    }

    private void WorkspaceChanged(object sender, FileSystemEventArgs e) => ScheduleWorkspaceRefresh();
    private void WorkspaceRenamed(object sender, RenamedEventArgs e) => ScheduleWorkspaceRefresh();

    private void WorkspaceWatcherError(object sender, ErrorEventArgs e)
    {
        // A buffer overflow means we may have missed one or more changes. A complete current-folder
        // refresh is cheap and restores the exact visible state without crawling the whole volume.
        ScheduleWorkspaceRefresh();
    }

    private void ScheduleWorkspaceRefresh()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            if (_workspaceRefreshTimer is null)
            {
                _workspaceRefreshTimer = DispatcherQueue.CreateTimer();
                _workspaceRefreshTimer.IsRepeating = false;
                _workspaceRefreshTimer.Interval = TimeSpan.FromMilliseconds(WorkspaceRefreshDelayMs);
                _workspaceRefreshTimer.Tick += async (_, _) =>
                {
                    var path = _workspacePath;
                    if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;

                    // Re-hinting makes the worker refresh only this hot workspace immediately while
                    // unrelated USN traffic can wait for the normal background reconciliation pass.
                    IndexWorkerService.PrioritizeWorkspace(path);
                    await NavigateAsync(path, pushHistory: false);
                };
            }

            _workspaceRefreshTimer.Stop();
            _workspaceRefreshTimer.Start();
        });
    }

    private void DisposeWorkspaceTracking()
    {
        _workspaceWatcher?.Dispose();
        _workspaceRefreshTimer?.Stop();
        _workspaceWatcher = null;
        _workspaceRefreshTimer = null;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDoubleClickTime();
}

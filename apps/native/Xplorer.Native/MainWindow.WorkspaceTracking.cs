using Microsoft.UI.Xaml.Controls;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const int WorkspaceRefreshDelayMs = 70;
    private FileSystemWatcher? _workspaceWatcher;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _workspaceRefreshTimer;
    private string? _workspacePath;
    private readonly object _workspaceDeltaLock = new();
    private readonly Dictionary<string, WorkspaceDeltaKind> _pendingWorkspaceDeltas =
        new(StringComparer.OrdinalIgnoreCase);
    private bool _workspaceForceRefreshPending;

    private enum WorkspaceDeltaKind
    {
        Upsert,
        Delete,
    }

    /// <summary>
    /// Keeps the visible directory live and tells the Rust worker which workspace deserves immediate
    /// indexing priority. Normal file changes become path-level viewport deltas; a complete folder
    /// read is reserved for watcher overflow/errors or recursive-search refreshes.
    /// </summary>
    public void InitializeWorkspaceTracking()
    {
        AddressBox.TextChanged += AddressBox_WorkspaceTextChanged;
        TrackWorkspace(CurrentPath, forceHint: true);
        Closed += (_, _) => DisposeWorkspaceTracking();
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
        try { fullPath = Path.GetFullPath(path); }
        catch { return; }
        if (!Directory.Exists(fullPath)) return;

        var unchanged = string.Equals(_workspacePath, fullPath, StringComparison.OrdinalIgnoreCase);
        if (unchanged && !forceHint) return;
        _workspacePath = fullPath;

        if (!unchanged)
        {
            _workspaceWatcher?.Dispose();
            _workspaceWatcher = null;
            lock (_workspaceDeltaLock)
            {
                _pendingWorkspaceDeltas.Clear();
                _workspaceForceRefreshPending = false;
            }

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

    private void WorkspaceChanged(object sender, FileSystemEventArgs e) =>
        QueueWorkspaceDelta(
            e.FullPath,
            e.ChangeType == WatcherChangeTypes.Deleted ? WorkspaceDeltaKind.Delete : WorkspaceDeltaKind.Upsert);

    private void WorkspaceRenamed(object sender, RenamedEventArgs e)
    {
        QueueWorkspaceDelta(e.OldFullPath, WorkspaceDeltaKind.Delete, schedule: false);
        QueueWorkspaceDelta(e.FullPath, WorkspaceDeltaKind.Upsert);
    }

    private void WorkspaceWatcherError(object sender, ErrorEventArgs e) => ScheduleWorkspaceFullRefresh();

    private void QueueWorkspaceDelta(string path, WorkspaceDeltaKind kind, bool schedule = true)
    {
        lock (_workspaceDeltaLock)
            _pendingWorkspaceDeltas[path] = kind;
        if (schedule) ScheduleWorkspaceTimer();
    }

    private void ScheduleWorkspaceFullRefresh()
    {
        lock (_workspaceDeltaLock)
            _workspaceForceRefreshPending = true;
        ScheduleWorkspaceTimer();
    }

    private void ScheduleWorkspaceTimer()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            if (_workspaceRefreshTimer is null)
            {
                _workspaceRefreshTimer = DispatcherQueue.CreateTimer();
                _workspaceRefreshTimer.IsRepeating = false;
                _workspaceRefreshTimer.Interval = TimeSpan.FromMilliseconds(WorkspaceRefreshDelayMs);
                _workspaceRefreshTimer.Tick += async (_, _) => await ApplyPendingWorkspaceChangesAsync();
            }
            _workspaceRefreshTimer.Stop();
            _workspaceRefreshTimer.Start();
        });
    }

    private async Task ApplyPendingWorkspaceChangesAsync()
    {
        Dictionary<string, WorkspaceDeltaKind> changes;
        bool forceRefresh;
        lock (_workspaceDeltaLock)
        {
            changes = new Dictionary<string, WorkspaceDeltaKind>(
                _pendingWorkspaceDeltas,
                StringComparer.OrdinalIgnoreCase);
            _pendingWorkspaceDeltas.Clear();
            forceRefresh = _workspaceForceRefreshPending;
            _workspaceForceRefreshPending = false;
        }

        var path = _workspacePath;
        if (string.IsNullOrWhiteSpace(path) ||
            !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase) ||
            !Directory.Exists(path))
        {
            return;
        }

        if (forceRefresh || !string.IsNullOrWhiteSpace(_activeSearchQuery))
        {
            DebugUxTrace($"Workspace watcher full reconcile force={forceRefresh} search={!string.IsNullOrWhiteSpace(_activeSearchQuery)}");
            IndexWorkerService.PrioritizeWorkspace(path);
            await NavigateAsync(path, pushHistory: false);
            return;
        }

        if (changes.Count == 0) return;
        var showHidden = _settingsService.Current.ShowHiddenFiles;
        var showExtensions = _settingsService.Current.ShowFileExtensions;
        var sortMode = _settingsService.GetSortMode(path);

        var upsertPaths = changes
            .Where(pair => pair.Value == WorkspaceDeltaKind.Upsert)
            .Select(pair => pair.Key)
            .ToArray();
        var upserts = await Task.Run(() => upsertPaths
            .Select(candidate => IndexedFolderViewService.TryReadSingle(candidate, showHidden, showExtensions))
            .Where(item => item is not null)
            .Cast<FileSystemItem>()
            .ToDictionary(item => item.FullPath, StringComparer.OrdinalIgnoreCase));

        if (!string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase)) return;

        var next = Items.ToDictionary(item => item.FullPath, StringComparer.OrdinalIgnoreCase);
        foreach (var (candidate, kind) in changes)
        {
            if (kind == WorkspaceDeltaKind.Delete)
            {
                next.Remove(candidate);
                continue;
            }

            if (upserts.TryGetValue(candidate, out var item)) next[candidate] = item;
            else next.Remove(candidate); // hidden/deleted between notification and metadata read
        }

        var sorted = IndexedFolderViewService.Sort(next.Values, sortMode);
        ReconcileViewportItems(sorted);
        UpdateStatus();
        IndexWorkerService.PrioritizeWorkspace(path);
        DebugUxTrace($"Workspace watcher delta applied changes={changes.Count} viewport={Items.Count}");
    }

    private void DisposeWorkspaceTracking()
    {
        _workspaceWatcher?.Dispose();
        _workspaceRefreshTimer?.Stop();
        _workspaceWatcher = null;
        _workspaceRefreshTimer = null;
        lock (_workspaceDeltaLock)
        {
            _pendingWorkspaceDeltas.Clear();
            _workspaceForceRefreshPending = false;
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDoubleClickTime();
}

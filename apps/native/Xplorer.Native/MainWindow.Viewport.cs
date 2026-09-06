using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private async Task<List<FileSystemItem>> LoadFolderViewportAsync(
        string fullPath,
        bool showHidden,
        bool showExtensions,
        string sortMode,
        string viewMode,
        int generation,
        Guid tabId)
    {
        DebugUxTrace($"Navigate request path='{fullPath}' view={viewMode} sort={sortMode} search='{_activeSearchQuery}'");

        if (_settingsService.Current.BackgroundIndexing)
            IndexWorkerService.PrioritizeWorkspace(fullPath);

        // Interactive browsing must never block on a whole-volume index walk. Start direct disk
        // enumeration immediately and race it against only the small hot-workspace cache. Whichever
        // produces a usable result first paints the viewport; disk remains the source of truth.
        var diskTask = Task.Run(() =>
            IndexedFolderViewService.EnumerateDisk(fullPath, showHidden, showExtensions, sortMode));

        if (_settingsService.Current.BackgroundIndexing && string.IsNullOrWhiteSpace(_activeSearchQuery))
        {
            var hotTask = Task.Run(() =>
                HotWorkspaceViewService.TryLoad(fullPath, showHidden, showExtensions, sortMode));

            var first = await Task.WhenAny(diskTask, hotTask);
            if (generation != _navigationGeneration || ActiveTabState?.Id != tabId) return [];

            if (ReferenceEquals(first, hotTask))
            {
                var snapshot = await hotTask;
                if (generation != _navigationGeneration || ActiveTabState?.Id != tabId) return [];

                if (snapshot is { Items.Count: > 0 })
                {
                    DebugUxTrace(
                        $"Viewport initial source=workspace-index count={snapshot.Items.Count} generated={snapshot.GeneratedAt?.ToString("O") ?? "<unknown>"}");
                    _ = ReconcileViewportFromDiskTaskAsync(
                        diskTask,
                        fullPath,
                        viewMode,
                        generation,
                        tabId);
                    return snapshot.Items.ToList();
                }
            }
        }

        var disk = await diskTask;
        if (generation != _navigationGeneration || ActiveTabState?.Id != tabId) return [];
        DebugUxTrace($"Viewport initial source=disk count={disk.Count}");
        return disk;
    }

    private async Task ReconcileViewportFromDiskTaskAsync(
        Task<List<FileSystemItem>> diskTask,
        string fullPath,
        string viewMode,
        int generation,
        Guid tabId)
    {
        try
        {
            var live = await diskTask;
            if (generation != _navigationGeneration ||
                ActiveTabState?.Id != tabId ||
                !string.Equals(CurrentPath, fullPath, StringComparison.OrdinalIgnoreCase) ||
                !string.IsNullOrWhiteSpace(_activeSearchQuery))
            {
                return;
            }

            ReconcileViewportItems(live);
            ApplyViewMode(viewMode);
            UpdateStatus();
            DebugUxTrace($"Viewport reconciled source=disk count={live.Count}");
        }
        catch (Exception ex)
        {
            DebugUxTrace($"Viewport disk reconcile failed path='{fullPath}' error='{ex.Message}'");
        }
    }

    /// <summary>
    /// Reorders/reuses the visible collection by path instead of clearing every realized row. When
    /// metadata changed, only that individual model is replaced; unchanged thumbnails and containers
    /// survive refreshes.
    /// </summary>
    private void ReconcileViewportItems(IReadOnlyList<FileSystemItem> target)
    {
        var selectedPaths = GetSelectedOperationItems()
            .Select(item => item.FullPath)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existing = Items.ToDictionary(item => item.FullPath, StringComparer.OrdinalIgnoreCase);
        var desired = new List<FileSystemItem>(target.Count);

        foreach (var incoming in target)
        {
            if (existing.TryGetValue(incoming.FullPath, out var current) && MetadataEquivalent(current, incoming))
                desired.Add(current);
            else
                desired.Add(incoming);
        }

        for (var index = 0; index < desired.Count; index++)
        {
            var item = desired[index];
            if (index < Items.Count && ReferenceEquals(Items[index], item)) continue;

            var oldIndex = Items.IndexOf(item);
            if (oldIndex >= 0) Items.Move(oldIndex, index);
            else Items.Insert(index, item);
        }

        while (Items.Count > desired.Count)
            Items.RemoveAt(Items.Count - 1);

        RestoreViewportSelection(selectedPaths);
    }

    private static bool MetadataEquivalent(FileSystemItem left, FileSystemItem right) =>
        string.Equals(left.Name, right.Name, StringComparison.Ordinal) &&
        left.IsDirectory == right.IsDirectory &&
        left.ShowExtension == right.ShowExtension &&
        left.LastWriteTimeUtc == right.LastWriteTimeUtc &&
        left.SizeBytes == right.SizeBytes;

    private void RestoreViewportSelection(IReadOnlySet<string> paths)
    {
        if (paths.Count == 0) return;
        var list = FileDetails.Visibility == Microsoft.UI.Xaml.Visibility.Visible
            ? (Microsoft.UI.Xaml.Controls.ListViewBase)FileDetails
            : FileGrid;
        list.SelectedItems.Clear();
        foreach (var item in Items)
        {
            if (paths.Contains(item.FullPath)) list.SelectedItems.Add(item);
        }
    }

    private static bool CanOpenInInspector(FileSystemItem item)
    {
        if (item.IsDirectory) return false;
        var extension = Path.GetExtension(item.FullPath);
        if (InspectorImageExtensions.Contains(extension)) return true;
        var size = item.SizeBytes ?? TryGetFileLength(item.FullPath);
        return size <= InspectorMaximumTextBytes && IsInspectorTextCandidate(item.FullPath);
    }

    private async Task OpenItemInInspectorAsync(FileSystemItem item)
    {
        if (!_inspectorWorkspaceInitialized) InitializeInspectorWorkspace();
        var list = FileDetails.Visibility == Microsoft.UI.Xaml.Visibility.Visible
            ? (Microsoft.UI.Xaml.Controls.ListViewBase)FileDetails
            : FileGrid;
        list.SelectedItems.Clear();
        list.SelectedItem = item;
        if (!_inspectorOpen) ShowInspector();
        await RefreshInspectorSelectionAsync();
        DebugUxTrace($"Inspector activation path='{item.FullPath}'");
    }

    private void DebugUxTrace(string message)
    {
        if (!UiStartupDiagnostics.IsEnabled) return;
        CrashLogService.Log($"DEBUG UX: {message}");
    }
}

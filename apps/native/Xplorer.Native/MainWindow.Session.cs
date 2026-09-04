using Microsoft.UI.Xaml.Controls;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const int MaximumRestoredTabs = 32;

    /// <summary>
    /// Replaces the constructor-created fallback tab with the previous native session.
    /// Explicit command-line/shell launches intentionally bypass this so "Open in Xplorer"
    /// opens exactly the folder Windows asked for instead of resurrecting unrelated tabs.
    /// </summary>
    public bool RestorePreviousSession()
    {
        var saved = _settingsService.Current.Session;
        if (saved.Tabs.Count == 0) return false;

        var restorable = saved.Tabs
            .Select((tab, index) => (Tab: tab, SavedIndex: index))
            .Where(entry => IsRestorableFolder(entry.Tab.CurrentPath))
            .Take(MaximumRestoredTabs)
            .ToList();
        if (restorable.Count == 0) return false;

        _suppressTabSelection = true;
        try
        {
            Tabs.TabItems.Clear();

            foreach (var entry in restorable)
            {
                var tab = AddTab(entry.Tab.CurrentPath, select: false);
                if (tab.Tag is not ExplorerTabState state) continue;

                RestoreStack(state.BackHistory, entry.Tab.BackHistory);
                RestoreStack(state.ForwardHistory, entry.Tab.ForwardHistory);
            }

            var selectedIndex = restorable.FindIndex(entry => entry.SavedIndex == saved.SelectedTabIndex);
            if (selectedIndex < 0)
            {
                selectedIndex = restorable
                    .Select((entry, index) => (Distance: Math.Abs(entry.SavedIndex - saved.SelectedTabIndex), Index: index))
                    .OrderBy(candidate => candidate.Distance)
                    .ThenBy(candidate => candidate.Index)
                    .First().Index;
            }

            Tabs.SelectedIndex = selectedIndex;
        }
        finally
        {
            _suppressTabSelection = false;
        }

        if (ActiveTabState is not null)
            _ = NavigateAsync(ActiveTabState.CurrentPath, pushHistory: false);

        return true;
    }

    /// <summary>
    /// Captures tabs and their Back/Forward stacks synchronously during Window.Closed.
    /// The write is deliberately small and atomic so shutdown cannot leave a half-written JSON file.
    /// </summary>
    public void PersistSession()
    {
        var session = new ExplorerSessionSettings
        {
            SelectedTabIndex = Math.Max(0, Tabs.SelectedIndex),
        };

        foreach (var tab in Tabs.TabItems.OfType<TabViewItem>())
        {
            if (tab.Tag is not ExplorerTabState state) continue;
            if (!IsRestorableFolder(state.CurrentPath)) continue;

            session.Tabs.Add(new ExplorerTabSession
            {
                CurrentPath = state.CurrentPath,
                BackHistory = state.BackHistory.ToArray().ToList(),
                ForwardHistory = state.ForwardHistory.ToArray().ToList(),
            });
        }

        _settingsService.Current.Session = session;
        try
        {
            _settingsService.Save();
        }
        catch
        {
            // Session persistence is convenience state. A locked settings file must never make
            // application shutdown fail or hang.
        }
    }

    private static void RestoreStack(Stack<string> target, IReadOnlyList<string> persistedTopFirst)
    {
        target.Clear();
        for (var index = persistedTopFirst.Count - 1; index >= 0; index--)
        {
            var path = persistedTopFirst[index];
            if (!string.IsNullOrWhiteSpace(path)) target.Push(path);
        }
    }

    private static bool IsRestorableFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        try
        {
            return Directory.Exists(path);
        }
        catch
        {
            return false;
        }
    }
}

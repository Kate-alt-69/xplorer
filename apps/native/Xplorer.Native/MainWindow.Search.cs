using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private int _searchGeneration;
    private int _searchTotalCount;
    private string _activeSearchQuery = string.Empty;
    private bool _suppressSearchChange;
    private bool _nativeSearchInitialized;
    private bool _searchUsingIndex;

    /// <summary>
    /// Finishes native search behavior for the compiled SearchBox in MainWindow.xaml. The visual
    /// control itself now exists from the first frame instead of being injected after Loaded; this
    /// initializer only installs the Ctrl+F accelerator and synchronizes the current placeholder.
    /// </summary>
    private void InitializeNativeSearch()
    {
        if (_nativeSearchInitialized) return;
        _nativeSearchInitialized = true;

        RefreshSearchPresentation();

        var accelerator = new KeyboardAccelerator
        {
            Key = VirtualKey.F,
            Modifiers = VirtualKeyModifiers.Control,
        };
        accelerator.Invoked += (_, args) =>
        {
            args.Handled = true;
            FocusSearchBox();
        };
        Root.KeyboardAccelerators.Add(accelerator);
    }

    private void SearchRailButton_Click(object sender, RoutedEventArgs e) => FocusSearchBox();

    private void RefreshSearchPresentation()
    {
        SearchBox.PlaceholderText = _settingsService.Current.BackgroundIndexing
            ? "Search this folder recursively"
            : "Search this folder";
    }

    private void FocusSearchBox()
    {
        SearchBox.Focus(FocusState.Programmatic);
        SearchBox.SelectAll();
    }

    private void AddressBox_TextChangedForSearchReset(object sender, TextChangedEventArgs e)
    {
        // Compiled XAML may raise TextChanged while InitializeComponent is still building the tree.
        // Search behavior becomes live only from ChromeRoot_Loaded onward.
        if (!_nativeSearchInitialized || string.IsNullOrEmpty(SearchBox.Text)) return;

        _suppressSearchChange = true;
        try
        {
            SearchBox.Text = string.Empty;
            _activeSearchQuery = string.Empty;
            _searchUsingIndex = false;
            Interlocked.Increment(ref _searchGeneration);
        }
        finally
        {
            _suppressSearchChange = false;
        }
    }

    private async void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        // Do not navigate from an initialization-time TextChanged event before the first tab exists.
        if (!_nativeSearchInitialized || _suppressSearchChange) return;

        var query = SearchBox.Text.Trim();
        var generation = Interlocked.Increment(ref _searchGeneration);
        _activeSearchQuery = query;

        if (string.IsNullOrEmpty(query))
        {
            _searchTotalCount = 0;
            _searchUsingIndex = false;
            await NavigateAsync(CurrentPath, pushHistory: false);
            return;
        }

        var path = CurrentPath;
        await Task.Delay(140);
        if (generation != _searchGeneration || !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase))
            return;

        var showHidden = _settingsService.Current.ShowHiddenFiles;
        var showExtensions = _settingsService.Current.ShowFileExtensions;

        IndexedSearchService.SearchResult? indexed = null;
        if (_settingsService.Current.BackgroundIndexing)
        {
            indexed = await Task.Run(() =>
                IndexedSearchService.TrySearch(path, query, showHidden, showExtensions));
        }

        if (generation != _searchGeneration ||
            !string.Equals(query, SearchBox.Text.Trim(), StringComparison.Ordinal) ||
            !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        IReadOnlyList<FileSystemItem> matches;
        if (indexed is not null)
        {
            matches = indexed.Items;
            _searchTotalCount = indexed.TotalMatches;
            _searchUsingIndex = true;
        }
        else
        {
            var sortMode = _settingsService.GetSortMode(path);
            var entries = await Task.Run(() => EnumerateFolder(path, showHidden, showExtensions, sortMode));
            if (generation != _searchGeneration ||
                !string.Equals(query, SearchBox.Text.Trim(), StringComparison.Ordinal) ||
                !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            matches = entries.Where(item => MatchesSearch(item, query)).ToList();
            _searchTotalCount = entries.Count;
            _searchUsingIndex = false;
        }

        Items.Clear();
        foreach (var item in matches) Items.Add(item);

        ApplyViewMode(_settingsService.GetViewMode(path));
        UpdateSearchStatus();
    }

    private static bool MatchesSearch(FileSystemItem item, string query)
    {
        var tokens = query.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (tokens.Length == 0) return true;

        return tokens.All(token =>
            item.Name.Contains(token, StringComparison.CurrentCultureIgnoreCase) ||
            item.TypeName.Contains(token, StringComparison.CurrentCultureIgnoreCase));
    }

    private void UpdateSearchStatus()
    {
        if (string.IsNullOrEmpty(_activeSearchQuery)) return;

        var selected = GetSelectedCount();
        string summary;
        if (_searchUsingIndex)
        {
            summary = _searchTotalCount > Items.Count
                ? $"Showing {Items.Count} of {_searchTotalCount} indexed matches"
                : $"{Items.Count} indexed matches";
        }
        else
        {
            summary = $"{Items.Count} of {_searchTotalCount} items";
        }

        StatusText.Text = selected > 0
            ? $"{summary}  •  {selected} selected  •  Search: {_activeSearchQuery}"
            : $"{summary}  •  Search: {_activeSearchQuery}";
    }
}

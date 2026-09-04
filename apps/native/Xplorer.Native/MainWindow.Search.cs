using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.System;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private TextBox? _searchBox;
    private int _searchGeneration;
    private int _searchTotalCount;
    private string _activeSearchQuery = string.Empty;
    private bool _suppressSearchChange;
    private bool _searchRailHooked;

    /// <summary>
    /// Adds a small, deterministic current-folder search box beside the address bar. This is a
    /// normal filename/type filter: no model, embeddings, network request, or background AI runtime.
    /// </summary>
    private void InitializeNativeSearch()
    {
        if (_searchBox is not null || AddressBox.Parent is not Grid addressRow) return;

        addressRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(260) });
        _searchBox = new TextBox
        {
            Width = 260,
            MinWidth = 180,
            PlaceholderText = "Search this folder",
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(_searchBox, addressRow.ColumnDefinitions.Count - 1);
        addressRow.Children.Add(_searchBox);

        _searchBox.TextChanged += SearchBox_TextChanged;
        AddressBox.TextChanged += AddressBox_TextChangedForSearchReset;
        FileGrid.SelectionChanged += SearchSelectionChanged;
        FileDetails.SelectionChanged += SearchSelectionChanged;

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

        Root.Loaded += (_, _) => HookSearchRailButton();
    }

    private void HookSearchRailButton()
    {
        if (_searchRailHooked) return;

        foreach (var button in FindVisualDescendants<Button>(Root))
        {
            if (!string.Equals(
                    ToolTipService.GetToolTip(button)?.ToString(),
                    "Search",
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            button.Click += (_, _) => FocusSearchBox();
            _searchRailHooked = true;
            break;
        }
    }

    private static IEnumerable<T> FindVisualDescendants<T>(DependencyObject root)
        where T : DependencyObject
    {
        var childCount = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < childCount; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match) yield return match;

            foreach (var descendant in FindVisualDescendants<T>(child))
                yield return descendant;
        }
    }

    private void FocusSearchBox()
    {
        if (_searchBox is null) return;
        _searchBox.Focus(FocusState.Programmatic);
        _searchBox.SelectAll();
    }

    private void AddressBox_TextChangedForSearchReset(object sender, TextChangedEventArgs e)
    {
        if (_searchBox is null || string.IsNullOrEmpty(_searchBox.Text)) return;

        _suppressSearchChange = true;
        try
        {
            _searchBox.Text = string.Empty;
            _activeSearchQuery = string.Empty;
            Interlocked.Increment(ref _searchGeneration);
        }
        finally
        {
            _suppressSearchChange = false;
        }
    }

    private async void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSearchChange || _searchBox is null) return;

        var query = _searchBox.Text.Trim();
        var generation = Interlocked.Increment(ref _searchGeneration);
        _activeSearchQuery = query;

        if (string.IsNullOrEmpty(query))
        {
            _searchTotalCount = 0;
            await NavigateAsync(CurrentPath, pushHistory: false);
            return;
        }

        var path = CurrentPath;
        await Task.Delay(140);
        if (generation != _searchGeneration || !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase))
            return;

        var showHidden = _settingsService.Current.ShowHiddenFiles;
        var showExtensions = _settingsService.Current.ShowFileExtensions;
        var sortMode = _settingsService.GetSortMode(path);
        var entries = await Task.Run(() => EnumerateFolder(path, showHidden, showExtensions, sortMode));

        if (generation != _searchGeneration ||
            _searchBox is null ||
            !string.Equals(query, _searchBox.Text.Trim(), StringComparison.Ordinal) ||
            !string.Equals(path, CurrentPath, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var matches = entries.Where(item => MatchesSearch(item, query)).ToList();
        _searchTotalCount = entries.Count;

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

    private void SearchSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_activeSearchQuery)) UpdateSearchStatus();
    }

    private void UpdateSearchStatus()
    {
        if (string.IsNullOrEmpty(_activeSearchQuery)) return;

        var selected = GetSelectedCount();
        StatusText.Text = selected > 0
            ? $"{Items.Count} of {_searchTotalCount} items  •  {selected} selected  •  Search: {_activeSearchQuery}"
            : $"{Items.Count} of {_searchTotalCount} items  •  Search: {_activeSearchQuery}";
    }
}

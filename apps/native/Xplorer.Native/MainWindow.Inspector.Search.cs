using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _inspectorSearchInitialized;
    private bool _inspectorSearchReplaceMode;
    private Border? _inspectorSearchPanel;
    private Button? _inspectorSearchLauncher;
    private Grid? _inspectorReplaceRow;
    private TextBox? _inspectorFindBox;
    private TextBox? _inspectorReplaceBox;
    private CheckBox? _inspectorMatchCase;
    private TextBlock? _inspectorMatchStatus;

    private void EnsureInspectorSearchUi()
    {
        if (_inspectorSearchInitialized) return;
        if (VisualTreeHelper.GetParent(_inspectorTextEditor) is not Grid content) return;
        _inspectorSearchInitialized = true;

        _inspectorSearchLauncher = CreateInspectorButton("\uE721", null, "Find in file (Ctrl+F)");
        _inspectorSearchLauncher.Width = 30;
        _inspectorSearchLauncher.HorizontalAlignment = HorizontalAlignment.Right;
        _inspectorSearchLauncher.VerticalAlignment = VerticalAlignment.Top;
        _inspectorSearchLauncher.Margin = new Thickness(0, 16, 16, 0);
        _inspectorSearchLauncher.Visibility = Visibility.Collapsed;
        _inspectorSearchLauncher.Click += (_, _) => ShowInspectorSearch(replace: false);
        Canvas.SetZIndex(_inspectorSearchLauncher, 250);
        content.Children.Add(_inspectorSearchLauncher);

        var panelContent = new StackPanel { Spacing = 6 };

        var findRow = new Grid { ColumnSpacing = 5 };
        findRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        findRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        findRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        findRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inspectorFindBox = new TextBox
        {
            PlaceholderText = "Find",
            Height = 30,
            MinWidth = 100,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
        };
        _inspectorFindBox.TextChanged += (_, _) => UpdateInspectorSearchStatus();
        _inspectorFindBox.KeyDown += InspectorFindBox_KeyDown;
        findRow.Children.Add(_inspectorFindBox);

        var previous = CreateInspectorButton("\uE70E", null, "Previous match (Shift+Enter / Shift+F3)");
        previous.Width = 30;
        previous.Click += (_, _) => FindInspectorMatch(backwards: true);
        Grid.SetColumn(previous, 1);
        findRow.Children.Add(previous);

        var next = CreateInspectorButton("\uE70D", null, "Next match (Enter / F3)");
        next.Width = 30;
        next.Click += (_, _) => FindInspectorMatch(backwards: false);
        Grid.SetColumn(next, 2);
        findRow.Children.Add(next);

        var close = CreateInspectorButton("\uE711", null, "Close find/replace (Esc)");
        close.Width = 30;
        close.Click += (_, _) => HideInspectorSearch();
        Grid.SetColumn(close, 3);
        findRow.Children.Add(close);
        panelContent.Children.Add(findRow);

        _inspectorReplaceRow = new Grid { ColumnSpacing = 5, Visibility = Visibility.Collapsed };
        _inspectorReplaceRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _inspectorReplaceRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _inspectorReplaceRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _inspectorReplaceBox = new TextBox
        {
            PlaceholderText = "Replace with",
            Height = 30,
            MinWidth = 100,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
        };
        _inspectorReplaceBox.KeyDown += InspectorReplaceBox_KeyDown;
        _inspectorReplaceRow.Children.Add(_inspectorReplaceBox);

        var replaceOne = CreateInspectorButton("\uE8FB", "Replace", "Replace current/next match");
        replaceOne.Click += (_, _) => ReplaceInspectorMatch();
        Grid.SetColumn(replaceOne, 1);
        _inspectorReplaceRow.Children.Add(replaceOne);

        var replaceAll = CreateInspectorButton("\uE8EE", "All", "Replace all matches");
        replaceAll.Click += (_, _) => ReplaceAllInspectorMatches();
        Grid.SetColumn(replaceAll, 2);
        _inspectorReplaceRow.Children.Add(replaceAll);
        panelContent.Children.Add(_inspectorReplaceRow);

        var options = new Grid();
        options.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        options.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _inspectorMatchCase = new CheckBox
        {
            Content = "Match case",
            FontSize = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _inspectorMatchCase.Checked += (_, _) => UpdateInspectorSearchStatus();
        _inspectorMatchCase.Unchecked += (_, _) => UpdateInspectorSearchStatus();
        options.Children.Add(_inspectorMatchCase);

        _inspectorMatchStatus = new TextBlock
        {
            Text = "Find",
            FontSize = 10,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(_inspectorMatchStatus, 1);
        options.Children.Add(_inspectorMatchStatus);
        panelContent.Children.Add(options);

        _inspectorSearchPanel = new Border
        {
            Visibility = Visibility.Collapsed,
            Margin = new Thickness(14),
            Padding = new Thickness(8),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(7),
            Child = panelContent,
        };
        Canvas.SetZIndex(_inspectorSearchPanel, 300);
        content.Children.Add(_inspectorSearchPanel);

        _inspectorTextEditor.AddHandler(
            UIElement.KeyDownEvent,
            new KeyEventHandler(InspectorSearchEditor_KeyDown),
            handledEventsToo: true);

        ApplyInspectorSearchPalette(_inspectorPalette);
    }

    private void ShowInspectorSearchLauncher()
    {
        EnsureInspectorSearchUi();
        if (_inspectorSearchLauncher is not null)
            _inspectorSearchLauncher.Visibility = Visibility.Visible;
    }

    private void HideInspectorSearchUiForModeChange()
    {
        if (_inspectorSearchLauncher is not null)
            _inspectorSearchLauncher.Visibility = Visibility.Collapsed;
        HideInspectorSearch();
    }

    private void ShowInspectorSearch(bool replace)
    {
        if (_inspectorTextEditor.Visibility != Visibility.Visible) return;
        EnsureInspectorSearchUi();
        if (_inspectorSearchPanel is null || _inspectorFindBox is null || _inspectorReplaceRow is null) return;

        _inspectorSearchReplaceMode = replace;
        _inspectorSearchPanel.Visibility = Visibility.Visible;
        _inspectorReplaceRow.Visibility = replace ? Visibility.Visible : Visibility.Collapsed;
        if (_inspectorSearchLauncher is not null)
            _inspectorSearchLauncher.Visibility = Visibility.Collapsed;

        var selection = GetInspectorSelectedText();
        if (!string.IsNullOrEmpty(selection) && selection.Length <= 256 &&
            selection.IndexOfAny(['\r', '\n']) < 0)
        {
            _inspectorFindBox.Text = selection;
        }

        UpdateInspectorSearchStatus();
        _inspectorFindBox.Focus(FocusState.Programmatic);
        _inspectorFindBox.SelectAll();
    }

    private void HideInspectorSearch()
    {
        if (_inspectorSearchPanel is not null)
            _inspectorSearchPanel.Visibility = Visibility.Collapsed;
        if (_inspectorSearchLauncher is not null && _inspectorTextEditor.Visibility == Visibility.Visible)
            _inspectorSearchLauncher.Visibility = Visibility.Visible;
        if (_inspectorTextEditor.Visibility == Visibility.Visible)
            _inspectorTextEditor.Focus(FocusState.Programmatic);
    }

    private void InspectorSearchEditor_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        var control = InspectorIsKeyDown(VirtualKey.Control);
        var shift = InspectorIsKeyDown(VirtualKey.Shift);

        if (control && e.Key == VirtualKey.F)
        {
            e.Handled = true;
            ShowInspectorSearch(replace: false);
            return;
        }
        if (control && e.Key == VirtualKey.H)
        {
            e.Handled = true;
            ShowInspectorSearch(replace: true);
            return;
        }
        if (e.Key == VirtualKey.F3)
        {
            e.Handled = true;
            FindInspectorMatch(backwards: shift);
            return;
        }
        if (e.Key == VirtualKey.Escape && _inspectorSearchPanel?.Visibility == Visibility.Visible)
        {
            e.Handled = true;
            HideInspectorSearch();
        }
    }

    private void InspectorFindBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape)
        {
            e.Handled = true;
            HideInspectorSearch();
            return;
        }
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        FindInspectorMatch(backwards: InspectorIsKeyDown(VirtualKey.Shift));
    }

    private void InspectorReplaceBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Escape)
        {
            e.Handled = true;
            HideInspectorSearch();
            return;
        }
        if (e.Key != VirtualKey.Enter) return;
        e.Handled = true;
        ReplaceInspectorMatch();
    }

    private void FindInspectorMatch(bool backwards)
    {
        if (_inspectorFindBox is null) return;
        var query = _inspectorFindBox.Text;
        if (string.IsNullOrEmpty(query))
        {
            UpdateInspectorSearchStatus();
            return;
        }

        var text = _inspectorTextEditor.Text;
        if (text.Length == 0)
        {
            UpdateInspectorSearchStatus();
            return;
        }

        var comparison = InspectorSearchComparison;
        var start = _inspectorTextEditor.SelectionStart;
        var length = _inspectorTextEditor.SelectionLength;
        int match;
        if (backwards)
        {
            var before = Math.Clamp(start - 1, -1, text.Length - 1);
            match = before >= 0 ? text.LastIndexOf(query, before, comparison) : -1;
            if (match < 0)
                match = text.LastIndexOf(query, comparison);
        }
        else
        {
            var after = Math.Clamp(start + Math.Max(length, 0), 0, text.Length);
            match = text.IndexOf(query, after, comparison);
            if (match < 0 && after > 0)
                match = text.IndexOf(query, 0, comparison);
        }

        if (match < 0)
        {
            _inspectorMatchStatus!.Text = "No matches";
            return;
        }

        _inspectorTextEditor.SelectionStart = match;
        _inspectorTextEditor.SelectionLength = query.Length;
        _inspectorTextEditor.Focus(FocusState.Programmatic);
        UpdateInspectorSearchStatus(match);
    }

    private void ReplaceInspectorMatch()
    {
        if (_inspectorFindBox is null || _inspectorReplaceBox is null) return;
        var query = _inspectorFindBox.Text;
        if (string.IsNullOrEmpty(query)) return;

        if (!InspectorSelectionMatches(query))
            FindInspectorMatch(backwards: false);
        if (!InspectorSelectionMatches(query)) return;

        var start = _inspectorTextEditor.SelectionStart;
        var text = _inspectorTextEditor.Text;
        var replacement = _inspectorReplaceBox.Text ?? string.Empty;
        _inspectorTextEditor.Text = text.Remove(start, query.Length).Insert(start, replacement);
        _inspectorTextEditor.SelectionStart = start;
        _inspectorTextEditor.SelectionLength = replacement.Length;
        _inspectorTextEditor.Focus(FocusState.Programmatic);
        UpdateInspectorSearchStatus(start);
    }

    private void ReplaceAllInspectorMatches()
    {
        if (_inspectorFindBox is null || _inspectorReplaceBox is null) return;
        var query = _inspectorFindBox.Text;
        if (string.IsNullOrEmpty(query)) return;

        var text = _inspectorTextEditor.Text;
        var matches = CountInspectorMatches(text, query);
        if (matches == 0)
        {
            _inspectorMatchStatus!.Text = "No matches";
            return;
        }

        _inspectorTextEditor.Text = text.Replace(
            query,
            _inspectorReplaceBox.Text ?? string.Empty,
            InspectorSearchComparison);
        _inspectorTextEditor.SelectionStart = 0;
        _inspectorTextEditor.SelectionLength = 0;
        _inspectorTextEditor.Focus(FocusState.Programmatic);
        _inspectorMatchStatus!.Text = $"Replaced {matches}";
    }

    private void UpdateInspectorSearchStatus(int selectedMatchStart = -1)
    {
        if (_inspectorMatchStatus is null || _inspectorFindBox is null) return;
        var query = _inspectorFindBox.Text;
        if (string.IsNullOrEmpty(query))
        {
            _inspectorMatchStatus.Text = _inspectorSearchReplaceMode ? "Replace" : "Find";
            return;
        }

        var text = _inspectorTextEditor.Text;
        var total = CountInspectorMatches(text, query);
        if (total == 0)
        {
            _inspectorMatchStatus.Text = "No matches";
            return;
        }

        if (selectedMatchStart < 0 && InspectorSelectionMatches(query))
            selectedMatchStart = _inspectorTextEditor.SelectionStart;

        if (selectedMatchStart < 0)
        {
            _inspectorMatchStatus.Text = $"{total} match{(total == 1 ? string.Empty : "es")}";
            return;
        }

        var ordinal = 0;
        var offset = 0;
        while (offset <= selectedMatchStart)
        {
            var found = text.IndexOf(query, offset, InspectorSearchComparison);
            if (found < 0 || found > selectedMatchStart) break;
            ordinal++;
            offset = found + Math.Max(query.Length, 1);
        }
        _inspectorMatchStatus.Text = $"{Math.Max(ordinal, 1)} / {total}";
    }

    private int CountInspectorMatches(string text, string query)
    {
        if (string.IsNullOrEmpty(query)) return 0;
        var count = 0;
        var offset = 0;
        while (offset <= text.Length - query.Length)
        {
            var found = text.IndexOf(query, offset, InspectorSearchComparison);
            if (found < 0) break;
            count++;
            offset = found + Math.Max(query.Length, 1);
        }
        return count;
    }

    private bool InspectorSelectionMatches(string query)
    {
        var start = _inspectorTextEditor.SelectionStart;
        var length = _inspectorTextEditor.SelectionLength;
        if (length != query.Length || start < 0 || start + length > _inspectorTextEditor.Text.Length)
            return false;
        return string.Equals(
            _inspectorTextEditor.Text.Substring(start, length),
            query,
            InspectorSearchComparison);
    }

    private string GetInspectorSelectedText()
    {
        var start = _inspectorTextEditor.SelectionStart;
        var length = _inspectorTextEditor.SelectionLength;
        var text = _inspectorTextEditor.Text;
        return start >= 0 && length > 0 && start + length <= text.Length
            ? text.Substring(start, length)
            : string.Empty;
    }

    private StringComparison InspectorSearchComparison =>
        _inspectorMatchCase?.IsChecked == true
            ? StringComparison.Ordinal
            : StringComparison.OrdinalIgnoreCase;

    private void ApplyInspectorSearchPalette(InspectorPalette palette)
    {
        if (!_inspectorSearchInitialized) return;
        var surface = new SolidColorBrush(palette.Surface);
        var text = new SolidColorBrush(palette.Text);
        var muted = new SolidColorBrush(palette.MutedText);
        var border = new SolidColorBrush(palette.Border);
        if (_inspectorSearchPanel is not null)
        {
            _inspectorSearchPanel.Background = surface;
            _inspectorSearchPanel.BorderBrush = border;
        }
        if (_inspectorSearchLauncher is not null)
            _inspectorSearchLauncher.Foreground = text;
        if (_inspectorMatchStatus is not null)
            _inspectorMatchStatus.Foreground = muted;
        if (_inspectorMatchCase is not null)
            _inspectorMatchCase.Foreground = text;
    }

    private static bool InspectorIsKeyDown(VirtualKey key) =>
        (InspectorGetKeyState((int)key) & 0x8000) != 0;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern short InspectorGetKeyState(int virtualKey);
}

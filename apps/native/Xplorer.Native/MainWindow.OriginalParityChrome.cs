using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _originalParityChromeInitialized;

    /// <summary>
    /// Mirrors the original Xplorer shell hierarchy without replacing the real Windows caption:
    /// navigation lives directly beside the tab strip, tabs stay compact, and the bottom strip is a
    /// status bar instead of a second duplicate navigation bar. All buttons call the existing native
    /// handlers, so this is a presentation move rather than a second UX implementation.
    /// </summary>
    private void InitializeOriginalParityChrome()
    {
        if (_originalParityChromeInitialized) return;
        _originalParityChromeInitialized = true;

        Tabs.Height = 34;
        Tabs.TabStripHeader = BuildOriginalNavigationHeader();

        // The old native rewrite temporarily duplicated Back/Forward/Up/Refresh at the bottom.
        // Keep those controls alive as the IsEnabled source for the top buttons but remove the
        // duplicate visual row. Terminal is also exposed in the top navigation header now.
        var legacyNavigation = BottomBar.Children
            .OfType<StackPanel>()
            .FirstOrDefault(panel => Grid.GetColumn(panel) == 0);
        if (legacyNavigation is not null)
            legacyNavigation.Visibility = Visibility.Collapsed;
        if (BottomBar.ColumnDefinitions.Count > 0)
            BottomBar.ColumnDefinitions[0].Width = new GridLength(0);
        BottomBar.Height = 26;
        BottomBar.Padding = new Thickness(8, 1, 8, 1);

        Tabs.SelectionChanged += (_, _) => RefreshOriginalTabVisuals();
        DispatcherQueue.TryEnqueue(RefreshOriginalTabVisuals);
    }

    private StackPanel BuildOriginalNavigationHeader()
    {
        var navigation = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 1,
            Margin = new Thickness(4, 0, 5, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var back = CreateOriginalNavButton("\uE72B", "Back", BackButton_Click);
        var forward = CreateOriginalNavButton("\uE72A", "Forward", ForwardButton_Click);
        var up = CreateOriginalNavButton("\uE74A", "Up", UpButton_Click);
        var refresh = CreateOriginalNavButton("\uE72C", "Refresh", RefreshButton_Click);
        var terminal = CreateOriginalNavButton("\uE756", "Terminal", TerminalButton_Click);

        // Keep the exact same enablement model as the existing native navigation logic rather than
        // introducing another history state just for the new visual placement.
        back.SetBinding(Button.IsEnabledProperty, new Microsoft.UI.Xaml.Data.Binding
        {
            Source = BackButton,
            Path = new PropertyPath(nameof(Button.IsEnabled)),
            Mode = Microsoft.UI.Xaml.Data.BindingMode.OneWay,
        });
        forward.SetBinding(Button.IsEnabledProperty, new Microsoft.UI.Xaml.Data.Binding
        {
            Source = ForwardButton,
            Path = new PropertyPath(nameof(Button.IsEnabled)),
            Mode = Microsoft.UI.Xaml.Data.BindingMode.OneWay,
        });

        navigation.Children.Add(back);
        navigation.Children.Add(forward);
        navigation.Children.Add(up);
        navigation.Children.Add(refresh);
        navigation.Children.Add(new Rectangle
        {
            Width = 1,
            Height = 18,
            Margin = new Thickness(4, 0, 4, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Fill = Root.Resources.TryGetValue("XplorerBorderBrush", out var brush) && brush is Brush borderBrush
                ? borderBrush
                : new SolidColorBrush(Color.FromArgb(0x38, 0xff, 0xff, 0xff)),
        });
        navigation.Children.Add(terminal);
        return navigation;
    }

    private Button CreateOriginalNavButton(
        string glyph,
        string toolTip,
        RoutedEventHandler click)
    {
        var button = new Button
        {
            Width = 28,
            MinWidth = 28,
            Height = 28,
            Padding = new Thickness(0),
            CornerRadius = new CornerRadius(4),
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(Color.FromArgb(0x00, 0x00, 0x00, 0x00)),
            Content = new FontIcon
            {
                Glyph = glyph,
                FontSize = 13,
            },
        };
        if (Root.Resources.TryGetValue("XplorerChromeButtonStyle", out var resource) && resource is Style style)
            button.Style = style;
        ToolTipService.SetToolTip(button, toolTip);
        button.Click += click;
        return button;
    }

    private void RefreshOriginalTabVisuals()
    {
        if (!_originalParityChromeInitialized) return;
        var active = ActiveTabState;
        var accent = Root.Resources.TryGetValue("XplorerAccentBrush", out var resource) &&
                     resource is SolidColorBrush accentBrush
            ? accentBrush
            : new SolidColorBrush(Color.FromArgb(0xff, 0x63, 0x66, 0xf1));

        foreach (var tab in Tabs.TabItems.OfType<TabViewItem>())
        {
            tab.MaxWidth = 180;
            tab.MinWidth = 72;
            tab.Padding = new Thickness(12, 0, 8, 0);
            var selected = tab.Tag is Models.ExplorerTabState state && active?.Id == state.Id;
            tab.BorderBrush = accent;
            tab.BorderThickness = selected
                ? new Thickness(0, 0, 0, 2)
                : new Thickness(0);
        }
    }
}

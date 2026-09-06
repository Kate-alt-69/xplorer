using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.System;
using Windows.UI;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const double InspectorMinimumWidth = 280;
    private const double InspectorMaximumWidth = 720;
    private const long InspectorMaximumTextBytes = 4L * 1024 * 1024;

    private static readonly HashSet<string> InspectorTextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
        ".toml", ".ini", ".cfg", ".conf", ".env", ".editorconfig", ".gitattributes", ".gitignore",
        ".cs", ".fs", ".vb", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss",
        ".sass", ".less", ".html", ".htm", ".xhtml", ".py", ".rb", ".rs", ".go", ".java",
        ".kt", ".kts", ".c", ".h", ".cpp", ".hpp", ".cc", ".hh", ".ps1", ".psm1", ".psd1",
        ".bat", ".cmd", ".sh", ".bash", ".zsh", ".fish", ".sql", ".graphql", ".gql", ".sln",
        ".csproj", ".fsproj", ".vbproj", ".props", ".targets", ".gradle", ".properties",
    };

    private static readonly HashSet<string> InspectorImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".ico",
    };

    private bool _inspectorWorkspaceInitialized;
    private bool _inspectorOpen;
    private double _inspectorConfiguredWidth = XplorerThemeDefinition.Default.InspectorWorkspaceWidth;
    private double _inspectorWidth = XplorerThemeDefinition.Default.InspectorWorkspaceWidth;
    private int _inspectorLoadGeneration;
    private string? _inspectorPath;
    private Encoding _inspectorTextEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
    private bool _inspectorSuppressTextChanged;
    private bool _inspectorTextDirty;
    private int _inspectorImagePixelWidth;
    private int _inspectorImagePixelHeight;
    private bool _inspectorSuppressZoom;
    private XplorerThemeDefinition? _pendingInspectorTheme;
    private InspectorPalette _inspectorPalette = InspectorPalette.Dark;

    private Border _inspectorPane = null!;
    private Border _inspectorHeader = null!;
    private Border _inspectorToolbar = null!;
    private Border _inspectorStatusBorder = null!;
    private Button _inspectorCloseButton = null!;
    private Button _inspectorSaveButton = null!;
    private Button _inspectorReloadButton = null!;
    private Button? _inspectorRailButton;
    private TextBlock _inspectorNameText = null!;
    private TextBlock _inspectorMetaText = null!;
    private TextBlock _inspectorPathText = null!;
    private TextBlock _inspectorDetailsText = null!;
    private TextBlock _inspectorEmptyView = null!;
    private TextBlock _inspectorStatusText = null!;
    private TextBlock _inspectorZoomLabel = null!;
    private TextBox _inspectorTextEditor = null!;
    private ScrollViewer _inspectorMetadataView = null!;
    private ScrollViewer _inspectorImageScroll = null!;
    private Image _inspectorImagePreview = null!;
    private StackPanel _inspectorZoomControls = null!;
    private Slider _inspectorImageZoom = null!;

    /// <summary>
    /// Builds the hidden Inspector workspace after MainWindow.xaml is loaded. Because the pane is
    /// closed by default, constructing it here preserves Xplorer's exact first-frame chrome while
    /// keeping the editor independent from the extension rail and the optional workspace watcher.
    /// </summary>
    private void InitializeInspectorWorkspace()
    {
        if (_inspectorWorkspaceInitialized) return;
        _inspectorWorkspaceInitialized = true;

        // Re-purpose the old rail column as the hidden Inspector and move the 48 px rail into a new
        // final column. This avoids changing the compiled first-frame XAML just to host a closed pane.
        var railWidth = ShellGrid.ColumnDefinitions[2].Width;
        ShellGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = railWidth });
        Grid.SetColumn(ExtensionsRail, 3);
        ShellGrid.ColumnDefinitions[2].Width = new GridLength(0);

        _inspectorPane = BuildInspectorPane();
        Grid.SetColumn(_inspectorPane, 2);
        ShellGrid.Children.Add(_inspectorPane);

        FileGrid.SelectionChanged += InspectorSelectionChanged;
        FileDetails.SelectionChanged += InspectorSelectionChanged;

        if (_pendingInspectorTheme is { } custom)
            ApplyInspectorPalette(InspectorPalette.FromTheme(custom));
        else
            ApplyInspectorPalette(_inspectorPalette);
    }

    private Border BuildInspectorPane()
    {
        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(28) });

        var grip = new Border
        {
            Width = 8,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            Background = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0)),
            ManipulationMode = ManipulationModes.TranslateX,
        };
        Grid.SetRowSpan(grip, 5);
        Canvas.SetZIndex(grip, 200);
        ToolTipService.SetToolTip(grip, "Drag to resize Inspector • double-click to reset");
        grip.ManipulationDelta += InspectorResizeGrip_ManipulationDelta;
        grip.DoubleTapped += InspectorResizeGrip_DoubleTapped;
        root.Children.Add(grip);

        var headerGrid = new Grid { Padding = new Thickness(14, 7, 7, 7) };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var headerTitle = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        headerTitle.Children.Add(new FontIcon { Glyph = "\uE890", FontSize = 15 });
        headerTitle.Children.Add(new TextBlock
        {
            Text = "Inspector",
            FontSize = 14,
            FontWeight = Windows.UI.Text.FontWeights.SemiBold,
        });
        headerGrid.Children.Add(headerTitle);
        _inspectorCloseButton = CreateInspectorButton("\uE711", null, "Close Inspector");
        _inspectorCloseButton.Width = 30;
        Grid.SetColumn(_inspectorCloseButton, 1);
        _inspectorCloseButton.Click += InspectorCloseButton_Click;
        headerGrid.Children.Add(_inspectorCloseButton);
        _inspectorHeader = new Border { Child = headerGrid, BorderThickness = new Thickness(0, 0, 0, 1) };
        Grid.SetRow(_inspectorHeader, 0);
        root.Children.Add(_inspectorHeader);

        var identity = new StackPanel { Margin = new Thickness(14, 11, 12, 10), Spacing = 3 };
        _inspectorNameText = new TextBlock
        {
            Text = "No selection",
            FontSize = 14,
            FontWeight = Windows.UI.Text.FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        _inspectorMetaText = new TextBlock
        {
            Text = "Select a file or folder to inspect",
            FontSize = 11,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        _inspectorPathText = new TextBlock
        {
            FontSize = 10,
            TextTrimming = TextTrimming.CharacterEllipsis,
            IsTextSelectionEnabled = true,
        };
        identity.Children.Add(_inspectorNameText);
        identity.Children.Add(_inspectorMetaText);
        identity.Children.Add(_inspectorPathText);
        Grid.SetRow(identity, 1);
        root.Children.Add(identity);

        var toolbarGrid = new Grid { Padding = new Thickness(10, 4, 10, 4), MinHeight = 38 };
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 5,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _inspectorSaveButton = CreateInspectorButton("\uE74E", "Save", "Save file");
        _inspectorSaveButton.Visibility = Visibility.Collapsed;
        _inspectorSaveButton.IsEnabled = false;
        _inspectorSaveButton.Click += InspectorSaveButton_Click;
        _inspectorReloadButton = CreateInspectorButton("\uE72C", "Reload", "Reload from disk");
        _inspectorReloadButton.Visibility = Visibility.Collapsed;
        _inspectorReloadButton.Click += InspectorReloadButton_Click;
        actions.Children.Add(_inspectorSaveButton);
        actions.Children.Add(_inspectorReloadButton);
        toolbarGrid.Children.Add(actions);

        _inspectorZoomLabel = new TextBlock
        {
            Text = "100%",
            Width = 38,
            TextAlignment = TextAlignment.Right,
            FontSize = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _inspectorImageZoom = new Slider
        {
            Width = 100,
            Minimum = 25,
            Maximum = 400,
            Value = 100,
            StepFrequency = 25,
        };
        _inspectorImageZoom.ValueChanged += InspectorImageZoom_ValueChanged;
        _inspectorZoomControls = new StackPanel
        {
            Visibility = Visibility.Collapsed,
            Orientation = Orientation.Horizontal,
            Spacing = 7,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _inspectorZoomControls.Children.Add(_inspectorZoomLabel);
        _inspectorZoomControls.Children.Add(_inspectorImageZoom);
        toolbarGrid.Children.Add(_inspectorZoomControls);
        _inspectorToolbar = new Border
        {
            Child = toolbarGrid,
            BorderThickness = new Thickness(0, 1, 0, 1),
        };
        Grid.SetRow(_inspectorToolbar, 2);
        root.Children.Add(_inspectorToolbar);

        var content = new Grid { MinHeight = 0 };
        _inspectorEmptyView = new TextBlock
        {
            Text = "Select a file or folder to inspect",
            Margin = new Thickness(22),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 12,
        };
        content.Children.Add(_inspectorEmptyView);

        _inspectorDetailsText = new TextBlock
        {
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };
        _inspectorMetadataView = new ScrollViewer
        {
            Visibility = Visibility.Collapsed,
            Padding = new Thickness(14, 10, 14, 10),
            Content = _inspectorDetailsText,
        };
        content.Children.Add(_inspectorMetadataView);

        _inspectorTextEditor = new TextBox
        {
            Visibility = Visibility.Collapsed,
            Margin = new Thickness(10),
            Padding = new Thickness(12, 10, 12, 10),
            AcceptsReturn = true,
            IsSpellCheckEnabled = false,
            IsTextPredictionEnabled = false,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
        };
        ScrollViewer.SetHorizontalScrollBarVisibility(_inspectorTextEditor, ScrollBarVisibility.Auto);
        ScrollViewer.SetVerticalScrollBarVisibility(_inspectorTextEditor, ScrollBarVisibility.Auto);
        _inspectorTextEditor.TextChanged += InspectorTextEditor_TextChanged;
        _inspectorTextEditor.SelectionChanged += InspectorTextEditor_SelectionChanged;
        _inspectorTextEditor.KeyDown += InspectorTextEditor_KeyDown;
        content.Children.Add(_inspectorTextEditor);

        _inspectorImagePreview = new Image
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Stretch = Stretch.Fill,
        };
        var imageCanvas = new Grid { MinWidth = 240, MinHeight = 240, Padding = new Thickness(16) };
        imageCanvas.Children.Add(_inspectorImagePreview);
        _inspectorImageScroll = new ScrollViewer
        {
            Visibility = Visibility.Collapsed,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = imageCanvas,
        };
        content.Children.Add(_inspectorImageScroll);
        Grid.SetRow(content, 3);
        root.Children.Add(content);

        _inspectorStatusText = new TextBlock
        {
            Text = "Inspector ready",
            FontSize = 10,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        _inspectorStatusBorder = new Border
        {
            Padding = new Thickness(10, 0, 10, 0),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Child = _inspectorStatusText,
        };
        Grid.SetRow(_inspectorStatusBorder, 4);
        root.Children.Add(_inspectorStatusBorder);

        return new Border
        {
            Visibility = Visibility.Collapsed,
            BorderThickness = new Thickness(1, 0, 0, 0),
            Child = root,
        };
    }

    private Button CreateInspectorButton(string glyph, string? text, string tooltip)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
        content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12 });
        if (!string.IsNullOrEmpty(text))
            content.Children.Add(new TextBlock { Text = text, FontSize = 11 });

        var button = new Button
        {
            Height = 28,
            MinWidth = string.IsNullOrEmpty(text) ? 28 : 56,
            Padding = string.IsNullOrEmpty(text) ? new Thickness(0) : new Thickness(9, 2, 9, 2),
            CornerRadius = new CornerRadius(4),
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0)),
            Content = content,
        };
        ToolTipService.SetToolTip(button, tooltip);
        return button;
    }

    private async void InspectorRailButton_Click(object sender, RoutedEventArgs e)
    {
        _inspectorRailButton = sender as Button;
        if (!_inspectorWorkspaceInitialized) InitializeInspectorWorkspace();

        if (_inspectorOpen)
        {
            HideInspector();
            return;
        }

        ShowInspector();
        await RefreshInspectorSelectionAsync();
    }

    private void InspectorCloseButton_Click(object sender, RoutedEventArgs e) => HideInspector();

    private void ShowInspector()
    {
        _inspectorOpen = true;
        _inspectorPane.Visibility = Visibility.Visible;
        ShellGrid.ColumnDefinitions[2].Width = new GridLength(
            Math.Clamp(_inspectorWidth, InspectorMinimumWidth, InspectorMaximumWidth));
        if (_inspectorRailButton is not null) _inspectorRailButton.Opacity = 1;
        _inspectorStatusText.Text = _inspectorTextDirty
            ? "Unsaved changes are preserved while Inspector is hidden"
            : "Inspector ready";
    }

    private void HideInspector()
    {
        if (!_inspectorWorkspaceInitialized) return;
        _inspectorOpen = false;
        ShellGrid.ColumnDefinitions[2].Width = new GridLength(0);
        _inspectorPane.Visibility = Visibility.Collapsed;
        if (_inspectorRailButton is not null) _inspectorRailButton.Opacity = 0.82;
    }

    private void InspectorResizeGrip_ManipulationDelta(object sender, ManipulationDeltaRoutedEventArgs e)
    {
        if (!_inspectorOpen) return;
        var current = _inspectorPane.ActualWidth > 0 ? _inspectorPane.ActualWidth : _inspectorWidth;
        _inspectorWidth = Math.Clamp(
            current - e.Delta.Translation.X,
            InspectorMinimumWidth,
            InspectorMaximumWidth);
        ShellGrid.ColumnDefinitions[2].Width = new GridLength(_inspectorWidth);
        e.Handled = true;
    }

    private void InspectorResizeGrip_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        _inspectorWidth = _inspectorConfiguredWidth;
        if (_inspectorOpen) ShellGrid.ColumnDefinitions[2].Width = new GridLength(_inspectorWidth);
        e.Handled = true;
    }

    private void InspectorSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        _ = RefreshInspectorSelectionAsync();
}

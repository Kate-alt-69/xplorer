using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private void SetExtensionsRailWidth(double width)
    {
        var index = _inspectorWorkspaceInitialized ? 3 : 2;
        if (ShellGrid.ColumnDefinitions.Count > index)
            ShellGrid.ColumnDefinitions[index].Width = new GridLength(width);
    }

    private void ApplyInspectorThemeResources(XplorerThemeDefinition theme)
    {
        _pendingInspectorTheme = theme;
        _inspectorConfiguredWidth = Math.Clamp(
            theme.InspectorWorkspaceWidth,
            InspectorMinimumWidth,
            InspectorMaximumWidth);
        _inspectorWidth = _inspectorConfiguredWidth;
        _inspectorPalette = InspectorPalette.FromTheme(theme);
        if (_inspectorWorkspaceInitialized)
        {
            ApplyInspectorPalette(_inspectorPalette);
            if (_inspectorOpen) ShellGrid.ColumnDefinitions[2].Width = new GridLength(_inspectorWidth);
        }
    }

    private void ResetInspectorBuiltInLayout()
    {
        _pendingInspectorTheme = null;
        _inspectorConfiguredWidth = XplorerThemeDefinition.Default.InspectorWorkspaceWidth;
        _inspectorWidth = _inspectorConfiguredWidth;
        if (_inspectorWorkspaceInitialized && _inspectorOpen)
            ShellGrid.ColumnDefinitions[2].Width = new GridLength(_inspectorWidth);
    }

    private void ApplyBuiltInInspectorPalette(bool light)
    {
        _pendingInspectorTheme = null;
        _inspectorPalette = light ? InspectorPalette.Light : InspectorPalette.Dark;
        if (_inspectorWorkspaceInitialized) ApplyInspectorPalette(_inspectorPalette);
    }

    private void ApplyInspectorPalette(InspectorPalette palette)
    {
        var background = new SolidColorBrush(palette.Background);
        var surface = new SolidColorBrush(palette.Surface);
        var text = new SolidColorBrush(palette.Text);
        var muted = new SolidColorBrush(palette.MutedText);
        var editorBackground = new SolidColorBrush(palette.EditorBackground);
        var editorForeground = new SolidColorBrush(palette.EditorForeground);
        var gutter = new SolidColorBrush(palette.Gutter);
        var selection = new SolidColorBrush(palette.Selection);
        var canvas = new SolidColorBrush(palette.Canvas);
        var border = new SolidColorBrush(palette.Border);
        var accent = new SolidColorBrush(palette.Accent);

        _inspectorPane.Background = background;
        _inspectorPane.BorderBrush = border;
        _inspectorHeader.Background = surface;
        _inspectorHeader.BorderBrush = border;
        _inspectorToolbar.Background = surface;
        _inspectorToolbar.BorderBrush = border;
        _inspectorStatusBorder.Background = gutter;
        _inspectorStatusBorder.BorderBrush = border;
        _inspectorNameText.Foreground = text;
        _inspectorMetaText.Foreground = muted;
        _inspectorPathText.Foreground = muted;
        _inspectorDetailsText.Foreground = editorForeground;
        _inspectorEmptyView.Foreground = muted;
        _inspectorStatusText.Foreground = muted;
        _inspectorZoomLabel.Foreground = muted;
        _inspectorTextEditor.Background = editorBackground;
        _inspectorTextEditor.Foreground = editorForeground;
        _inspectorTextEditor.BorderBrush = border;
        _inspectorTextEditor.SelectionHighlightColor = selection;
        _inspectorImageScroll.Background = canvas;
        _inspectorCloseButton.Foreground = text;
        _inspectorSaveButton.Foreground = text;
        _inspectorReloadButton.Foreground = text;

        // Scope native control states to the Inspector rather than borrowing the file browser's
        // selection/hover language. A theme can therefore rewrite editor chrome independently.
        _inspectorPane.Resources["ButtonForeground"] = text;
        _inspectorPane.Resources["ButtonBackground"] = new SolidColorBrush(Color.FromArgb(0, 0, 0, 0));
        _inspectorPane.Resources["ButtonBackgroundPointerOver"] = surface;
        _inspectorPane.Resources["ButtonBackgroundPressed"] = gutter;
        _inspectorPane.Resources["TextControlBackground"] = editorBackground;
        _inspectorPane.Resources["TextControlBackgroundPointerOver"] = editorBackground;
        _inspectorPane.Resources["TextControlBackgroundFocused"] = editorBackground;
        _inspectorPane.Resources["TextControlForeground"] = editorForeground;
        _inspectorPane.Resources["TextControlBorderBrush"] = border;
        _inspectorPane.Resources["TextControlBorderBrushPointerOver"] = accent;
        _inspectorPane.Resources["TextControlBorderBrushFocused"] = accent;
    }

    private sealed record InspectorPalette(
        Color Background,
        Color Surface,
        Color Text,
        Color MutedText,
        Color EditorBackground,
        Color EditorForeground,
        Color Gutter,
        Color Selection,
        Color Canvas,
        Color Border,
        Color Accent)
    {
        public static InspectorPalette Dark { get; } = FromTheme(XplorerThemeDefinition.Default);

        public static InspectorPalette Light { get; } = new(
            Color.FromArgb(0xff, 0xf8, 0xfa, 0xfc),
            Color.FromArgb(0xff, 0xff, 0xff, 0xff),
            Color.FromArgb(0xff, 0x1e, 0x29, 0x3b),
            Color.FromArgb(0xff, 0x64, 0x74, 0x8b),
            Color.FromArgb(0xff, 0xff, 0xff, 0xff),
            Color.FromArgb(0xff, 0x1e, 0x29, 0x3b),
            Color.FromArgb(0xff, 0xf1, 0xf5, 0xf9),
            Color.FromArgb(0x40, 0x3b, 0x82, 0xf6),
            Color.FromArgb(0xff, 0xe2, 0xe8, 0xf0),
            Color.FromArgb(0xff, 0xcb, 0xd5, 0xe1),
            Color.FromArgb(0xff, 0x3b, 0x82, 0xf6));

        public static InspectorPalette FromTheme(XplorerThemeDefinition theme) => new(
            theme.InspectorBackground,
            theme.InspectorSurface,
            theme.InspectorText,
            theme.InspectorMutedText,
            theme.InspectorEditorBackground,
            theme.InspectorEditorForeground,
            theme.InspectorGutter,
            theme.InspectorSelection,
            theme.InspectorCanvas,
            theme.InspectorBorder,
            theme.InspectorAccent);
    }
}

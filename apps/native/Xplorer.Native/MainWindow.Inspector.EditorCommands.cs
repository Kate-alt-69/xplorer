using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _inspectorCommandAcceleratorsInitialized;

    private void EnsureInspectorCommandAccelerators()
    {
        if (_inspectorCommandAcceleratorsInitialized) return;
        _inspectorCommandAcceleratorsInitialized = true;

        var save = new KeyboardAccelerator
        {
            Key = VirtualKey.S,
            Modifiers = VirtualKeyModifiers.Control,
        };
        save.Invoked += async (_, args) =>
        {
            if (!_inspectorOpen) return;
            args.Handled = true;
            if (_inspectorImageScroll.Visibility == Visibility.Visible)
                await SaveInspectorImageAsync();
            else if (_inspectorTextEditor.Visibility == Visibility.Visible)
                await SaveInspectorTextBufferAsync();
        };
        _inspectorPane.KeyboardAccelerators.Add(save);

        var goToLine = new KeyboardAccelerator
        {
            Key = VirtualKey.G,
            Modifiers = VirtualKeyModifiers.Control,
        };
        goToLine.Invoked += async (_, args) =>
        {
            if (!_inspectorOpen || _inspectorTextEditor.Visibility != Visibility.Visible) return;
            args.Handled = true;
            await ShowInspectorGoToLineAsync();
        };
        _inspectorPane.KeyboardAccelerators.Add(goToLine);
    }

    private async Task SaveInspectorTextBufferAsync()
    {
        if (!_inspectorTextDirty || string.IsNullOrWhiteSpace(_inspectorPath)) return;

        try
        {
            _inspectorSaveButton.IsEnabled = false;
            _inspectorStatusText.Text = "Saving…";
            using var stream = new FileStream(
                _inspectorPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.Read,
                4096,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var writer = new StreamWriter(stream, _inspectorTextEncoding, 4096, leaveOpen: false);
            await writer.WriteAsync(_inspectorTextEditor.Text);
            await writer.FlushAsync();
            _inspectorTextDirty = false;
            UpdateInspectorTextStatus();
        }
        catch (Exception ex)
        {
            _inspectorSaveButton.IsEnabled = true;
            _inspectorStatusText.Text = $"Save failed: {ex.Message}";
        }
    }

    private async Task ShowInspectorGoToLineAsync()
    {
        var text = _inspectorTextEditor.Text;
        var lineCount = 1;
        for (var index = 0; index < text.Length; index++)
            if (text[index] == '\n') lineCount++;

        var currentLine = InspectorLineFromOffset(text, _inspectorTextEditor.SelectionStart);
        var lineBox = new TextBox
        {
            Text = currentLine.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Width = 160,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        var content = new StackPanel { Spacing = 8 };
        content.Children.Add(new TextBlock { Text = $"Line number (1–{lineCount})" });
        content.Children.Add(lineBox);

        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "Go to line",
            Content = content,
            PrimaryButtonText = "Go",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary) return;

        if (!int.TryParse(lineBox.Text, out var requested))
        {
            _inspectorStatusText.Text = "Go to line: enter a valid line number";
            return;
        }
        requested = Math.Clamp(requested, 1, lineCount);
        var offset = InspectorOffsetForLine(text, requested);
        _inspectorTextEditor.SelectionStart = offset;
        _inspectorTextEditor.SelectionLength = 0;
        _inspectorTextEditor.Focus(FocusState.Programmatic);
        UpdateInspectorTextStatus();
    }

    private static int InspectorLineFromOffset(string text, int offset)
    {
        var bounded = Math.Clamp(offset, 0, text.Length);
        var line = 1;
        for (var index = 0; index < bounded; index++)
            if (text[index] == '\n') line++;
        return line;
    }

    private static int InspectorOffsetForLine(string text, int line)
    {
        if (line <= 1) return 0;
        var current = 1;
        for (var index = 0; index < text.Length; index++)
        {
            if (text[index] != '\n') continue;
            current++;
            if (current == line) return index + 1;
        }
        return text.Length;
    }
}

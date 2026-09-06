using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.System;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private async Task RefreshInspectorSelectionAsync()
    {
        if (!_inspectorOpen) return;

        var item = GetSelectedItem();
        if (_inspectorTextDirty &&
            !string.IsNullOrWhiteSpace(_inspectorPath) &&
            !string.Equals(item?.FullPath, _inspectorPath, StringComparison.OrdinalIgnoreCase))
        {
            _inspectorStatusText.Text = "Unsaved changes — Save or Reload before inspecting another item";
            return;
        }

        if (_inspectorTextDirty &&
            item is not null &&
            string.Equals(item.FullPath, _inspectorPath, StringComparison.OrdinalIgnoreCase))
        {
            UpdateInspectorTextStatus();
            return;
        }

        var generation = Interlocked.Increment(ref _inspectorLoadGeneration);
        ResetInspectorViews();

        if (item is null)
        {
            _inspectorPath = null;
            _inspectorNameText.Text = "No selection";
            _inspectorMetaText.Text = "Select a file or folder to inspect";
            _inspectorPathText.Text = string.Empty;
            _inspectorEmptyView.Visibility = Visibility.Visible;
            _inspectorStatusText.Text = "Inspector ready";
            return;
        }

        _inspectorPath = item.FullPath;
        _inspectorNameText.Text = item.DisplayName;
        _inspectorMetaText.Text = string.IsNullOrWhiteSpace(item.SizeText)
            ? $"{item.TypeName}  •  {item.ModifiedText}"
            : $"{item.TypeName}  •  {item.SizeText}  •  {item.ModifiedText}";
        _inspectorPathText.Text = item.FullPath;
        _inspectorReloadButton.Visibility = Visibility.Visible;

        if (item.IsDirectory)
        {
            ShowInspectorMetadata(item, "Folder metadata");
            return;
        }

        var extension = Path.GetExtension(item.FullPath);
        if (InspectorImageExtensions.Contains(extension))
        {
            await LoadInspectorImageAsync(item, generation);
            return;
        }

        var fileSize = item.SizeBytes ?? TryGetFileLength(item.FullPath);
        if (IsInspectorTextCandidate(item.FullPath) && fileSize <= InspectorMaximumTextBytes)
        {
            await LoadInspectorTextAsync(item, generation);
            return;
        }

        var note = fileSize > InspectorMaximumTextBytes && IsInspectorTextCandidate(item.FullPath)
            ? "Text editing is limited to 4 MiB for a responsive in-app Inspector."
            : "This file currently uses the metadata Inspector view.";
        ShowInspectorMetadata(item, note);
    }

    private void ResetInspectorViews()
    {
        _inspectorEmptyView.Visibility = Visibility.Collapsed;
        _inspectorMetadataView.Visibility = Visibility.Collapsed;
        _inspectorTextEditor.Visibility = Visibility.Collapsed;
        _inspectorImageScroll.Visibility = Visibility.Collapsed;
        _inspectorSaveButton.Visibility = Visibility.Collapsed;
        _inspectorSaveButton.IsEnabled = false;
        _inspectorReloadButton.Visibility = Visibility.Collapsed;
        _inspectorZoomControls.Visibility = Visibility.Collapsed;
        _inspectorImagePreview.Source = null;
        _inspectorImagePreview.Width = double.NaN;
        _inspectorImagePreview.Height = double.NaN;
        _inspectorImagePixelWidth = 0;
        _inspectorImagePixelHeight = 0;
    }

    private void ShowInspectorMetadata(FileSystemItem item, string note)
    {
        _inspectorMetadataView.Visibility = Visibility.Visible;
        _inspectorDetailsText.Text =
            $"Name      {item.Name}\n" +
            $"Type      {item.TypeName}\n" +
            $"Size      {(string.IsNullOrWhiteSpace(item.SizeText) ? "—" : item.SizeText)}\n" +
            $"Modified  {(string.IsNullOrWhiteSpace(item.ModifiedText) ? "—" : item.ModifiedText)}\n\n" +
            $"Path\n{item.FullPath}\n\n{note}";
        _inspectorStatusText.Text = item.IsDirectory ? "Folder" : "Metadata";
    }

    private async Task LoadInspectorTextAsync(FileSystemItem item, int generation)
    {
        try
        {
            using var stream = new FileStream(
                item.FullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                4096,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var reader = new StreamReader(
                stream,
                Encoding.UTF8,
                detectEncodingFromByteOrderMarks: true,
                bufferSize: 4096,
                leaveOpen: false);
            var text = await reader.ReadToEndAsync();
            var encoding = reader.CurrentEncoding;

            if (generation != _inspectorLoadGeneration ||
                !string.Equals(_inspectorPath, item.FullPath, StringComparison.OrdinalIgnoreCase))
                return;

            _inspectorTextEncoding = encoding;
            _inspectorSuppressTextChanged = true;
            _inspectorTextEditor.Text = text;
            _inspectorTextEditor.SelectionStart = 0;
            _inspectorTextEditor.SelectionLength = 0;
            _inspectorSuppressTextChanged = false;
            _inspectorTextDirty = false;
            _inspectorTextEditor.Visibility = Visibility.Visible;
            _inspectorSaveButton.Visibility = Visibility.Visible;
            _inspectorSaveButton.IsEnabled = false;
            _inspectorStatusText.Text = $"Ln 1, Col 1  •  {FormatEncoding(encoding)}";
        }
        catch (Exception ex)
        {
            ShowInspectorMetadata(item, $"Text editor could not open this file: {ex.Message}");
            _inspectorStatusText.Text = "Text open failed";
        }
    }

    private async Task LoadInspectorImageAsync(FileSystemItem item, int generation)
    {
        try
        {
            var file = await StorageFile.GetFileFromPathAsync(item.FullPath);
            using var stream = await file.OpenReadAsync();
            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(stream);

            if (generation != _inspectorLoadGeneration ||
                !string.Equals(_inspectorPath, item.FullPath, StringComparison.OrdinalIgnoreCase))
                return;

            _inspectorImagePixelWidth = bitmap.PixelWidth;
            _inspectorImagePixelHeight = bitmap.PixelHeight;
            _inspectorImagePreview.Source = bitmap;
            _inspectorImageScroll.Visibility = Visibility.Visible;
            _inspectorZoomControls.Visibility = Visibility.Visible;
            _inspectorSuppressZoom = true;
            _inspectorImageZoom.Value = 100;
            _inspectorSuppressZoom = false;
            ApplyInspectorImageZoom();
        }
        catch (Exception ex)
        {
            ShowInspectorMetadata(item, $"Image preview could not decode this file: {ex.Message}");
            _inspectorStatusText.Text = "Image preview failed";
        }
    }

    private async void InspectorSaveButton_Click(object sender, RoutedEventArgs e)
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

    private async void InspectorReloadButton_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_inspectorPath)) return;
        _inspectorTextDirty = false;
        await RefreshInspectorSelectionAsync();
    }

    private void InspectorTextEditor_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_inspectorSuppressTextChanged || _inspectorTextEditor.Visibility != Visibility.Visible) return;
        _inspectorTextDirty = true;
        _inspectorSaveButton.IsEnabled = true;
        UpdateInspectorTextStatus();
    }

    private void InspectorTextEditor_SelectionChanged(object sender, RoutedEventArgs e)
    {
        if (_inspectorTextEditor.Visibility == Visibility.Visible) UpdateInspectorTextStatus();
    }

    private void InspectorTextEditor_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Tab) return;
        var start = _inspectorTextEditor.SelectionStart;
        var length = _inspectorTextEditor.SelectionLength;
        var text = _inspectorTextEditor.Text;
        _inspectorTextEditor.Text = text.Remove(start, length).Insert(start, "\t");
        _inspectorTextEditor.SelectionStart = start + 1;
        _inspectorTextEditor.SelectionLength = 0;
        e.Handled = true;
    }

    private void UpdateInspectorTextStatus()
    {
        if (_inspectorTextEditor.Visibility != Visibility.Visible) return;
        var text = _inspectorTextEditor.Text;
        var selectionStart = Math.Clamp(_inspectorTextEditor.SelectionStart, 0, text.Length);
        var line = 1;
        var lastBreak = -1;
        for (var index = 0; index < selectionStart; index++)
        {
            if (text[index] != '\n') continue;
            line++;
            lastBreak = index;
        }
        var column = selectionStart - lastBreak;
        _inspectorStatusText.Text =
            $"Ln {line}, Col {column}  •  {FormatEncoding(_inspectorTextEncoding)}" +
            (_inspectorTextDirty ? "  •  Modified" : string.Empty);
    }

    private void InspectorImageZoom_ValueChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_inspectorSuppressZoom) return;
        ApplyInspectorImageZoom();
    }

    private void ApplyInspectorImageZoom()
    {
        var zoom = Math.Clamp(_inspectorImageZoom.Value, 25, 400);
        _inspectorZoomLabel.Text = $"{zoom:0}%";
        if (_inspectorImagePixelWidth <= 0 || _inspectorImagePixelHeight <= 0) return;
        var factor = zoom / 100d;
        _inspectorImagePreview.Width = Math.Max(1, _inspectorImagePixelWidth * factor);
        _inspectorImagePreview.Height = Math.Max(1, _inspectorImagePixelHeight * factor);
        _inspectorStatusText.Text =
            $"{_inspectorImagePixelWidth} × {_inspectorImagePixelHeight}  •  {zoom:0}%";
    }

    private static bool IsInspectorTextCandidate(string path)
    {
        var extension = Path.GetExtension(path);
        if (InspectorTextExtensions.Contains(extension)) return true;
        var name = Path.GetFileName(path);
        return string.IsNullOrEmpty(extension) &&
               (name.StartsWith("README", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("LICENSE", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("NOTICE", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("Dockerfile", StringComparison.OrdinalIgnoreCase) ||
                name.StartsWith("Makefile", StringComparison.OrdinalIgnoreCase));
    }

    private static long TryGetFileLength(string path)
    {
        try { return new FileInfo(path).Length; }
        catch { return long.MaxValue; }
    }

    private static string FormatEncoding(Encoding encoding) => encoding.WebName switch
    {
        "utf-8" => "UTF-8",
        "utf-16" => "UTF-16 LE",
        "utf-16BE" => "UTF-16 BE",
        _ => encoding.EncodingName,
    };
}

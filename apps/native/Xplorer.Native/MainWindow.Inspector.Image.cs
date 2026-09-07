using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics.Imaging;
using Windows.Storage;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _inspectorImageEditorInitialized;
    private bool _inspectorImageDirty;
    private int _inspectorImageQuarterTurns;
    private bool _inspectorImageFlipHorizontal;
    private StackPanel? _inspectorImageActions;
    private Grid? _inspectorImageCanvas;

    private void EnsureInspectorImageEditor()
    {
        if (_inspectorImageEditorInitialized) return;
        if (_inspectorToolbar.Child is not Grid toolbarGrid) return;

        StackPanel? primaryActions = null;
        foreach (var child in toolbarGrid.Children)
        {
            if (child is StackPanel panel && !ReferenceEquals(panel, _inspectorZoomControls))
            {
                primaryActions = panel;
                break;
            }
        }
        if (primaryActions is null) return;

        _inspectorImageEditorInitialized = true;
        _inspectorImageCanvas = _inspectorImageScroll.Content as Grid;
        _inspectorImagePreview.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);

        _inspectorImageActions = new StackPanel
        {
            Visibility = Visibility.Collapsed,
            Orientation = Orientation.Horizontal,
            Spacing = 3,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var rotateLeft = CreateInspectorButton("\uE7AD", null, "Rotate left 90°");
        rotateLeft.Width = 30;
        rotateLeft.Click += (_, _) => RotateInspectorImage(-1);
        _inspectorImageActions.Children.Add(rotateLeft);

        var rotateRight = CreateInspectorButton("\uE7AD", null, "Rotate right 90°");
        rotateRight.Width = 30;
        rotateRight.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        rotateRight.RenderTransform = new CompositeTransform { ScaleX = -1 };
        rotateRight.Click += (_, _) => RotateInspectorImage(1);
        _inspectorImageActions.Children.Add(rotateRight);

        var flip = CreateInspectorButton("\uE8B0", null, "Flip image");
        flip.Width = 30;
        var flipMenu = new MenuFlyout();
        var horizontal = new MenuFlyoutItem { Text = "Flip horizontal" };
        horizontal.Click += (_, _) => FlipInspectorImage(horizontal: true);
        flipMenu.Items.Add(horizontal);
        var vertical = new MenuFlyoutItem { Text = "Flip vertical" };
        vertical.Click += (_, _) => FlipInspectorImage(horizontal: false);
        flipMenu.Items.Add(vertical);
        var reset = new MenuFlyoutItem { Text = "Reset transform" };
        reset.Click += (_, _) => ResetInspectorImageTransform(markDirty: true);
        flipMenu.Items.Add(new MenuFlyoutSeparator());
        flipMenu.Items.Add(reset);
        flip.Flyout = flipMenu;
        _inspectorImageActions.Children.Add(flip);

        primaryActions.Children.Add(_inspectorImageActions);
    }

    private void ShowInspectorImageEditor()
    {
        EnsureInspectorImageEditor();
        if (_inspectorImageActions is not null)
            _inspectorImageActions.Visibility = Visibility.Visible;
        _inspectorSaveButton.Visibility = Visibility.Visible;
        _inspectorSaveButton.IsEnabled = _inspectorImageDirty;
        ApplyInspectorImageTransformPreview();
    }

    private void ResetInspectorImageEditorState()
    {
        _inspectorImageDirty = false;
        _inspectorImageQuarterTurns = 0;
        _inspectorImageFlipHorizontal = false;
        if (_inspectorImageActions is not null)
            _inspectorImageActions.Visibility = Visibility.Collapsed;
        if (_inspectorImageCanvas is not null)
        {
            _inspectorImageCanvas.Width = double.NaN;
            _inspectorImageCanvas.Height = double.NaN;
        }
        if (_inspectorImageEditorInitialized)
            ApplyInspectorImageTransformPreview();
    }

    private void ResetInspectorImageTransform(bool markDirty)
    {
        var changed = _inspectorImageQuarterTurns != 0 || _inspectorImageFlipHorizontal;
        _inspectorImageQuarterTurns = 0;
        _inspectorImageFlipHorizontal = false;
        if (markDirty && changed)
            MarkInspectorImageModified();
        else
            ApplyInspectorImageTransformPreview();
    }

    private void RotateInspectorImage(int quarterTurns)
    {
        if (_inspectorImageScroll.Visibility != Visibility.Visible) return;
        _inspectorImageQuarterTurns = Mod4(_inspectorImageQuarterTurns + quarterTurns);
        MarkInspectorImageModified();
    }

    private void FlipInspectorImage(bool horizontal)
    {
        if (_inspectorImageScroll.Visibility != Visibility.Visible) return;

        // Canonical transform is Rotation * HorizontalFlip. Windows BitmapTransform performs flip
        // before rotation, so these group updates preserve the exact operation sequence while still
        // fitting every rotate/flip combination into one rotation plus one horizontal flip.
        _inspectorImageQuarterTurns = horizontal
            ? Mod4(-_inspectorImageQuarterTurns)
            : Mod4(2 - _inspectorImageQuarterTurns);
        _inspectorImageFlipHorizontal = !_inspectorImageFlipHorizontal;
        MarkInspectorImageModified();
    }

    private void MarkInspectorImageModified()
    {
        _inspectorImageDirty = true;
        _inspectorSaveButton.Visibility = Visibility.Visible;
        _inspectorSaveButton.IsEnabled = true;
        ApplyInspectorImageTransformPreview();
    }

    private void ApplyInspectorImageTransformPreview()
    {
        if (_inspectorImagePreview is null) return;
        _inspectorImagePreview.RenderTransform = new CompositeTransform
        {
            Rotation = _inspectorImageQuarterTurns * 90d,
            ScaleX = _inspectorImageFlipHorizontal ? -1d : 1d,
            ScaleY = 1d,
        };
        if (_inspectorImagePixelWidth > 0 && _inspectorImagePixelHeight > 0)
            UpdateInspectorImageLayoutForTransform(_inspectorImageZoom.Value);
    }

    private void UpdateInspectorImageLayoutForTransform(double zoom)
    {
        if (_inspectorImagePixelWidth <= 0 || _inspectorImagePixelHeight <= 0) return;
        var factor = Math.Clamp(zoom, 25, 400) / 100d;
        var sourceWidth = Math.Max(1d, _inspectorImagePixelWidth * factor);
        var sourceHeight = Math.Max(1d, _inspectorImagePixelHeight * factor);
        _inspectorImagePreview.Width = sourceWidth;
        _inspectorImagePreview.Height = sourceHeight;

        if (_inspectorImageCanvas is not null)
        {
            var rotated = (_inspectorImageQuarterTurns & 1) != 0;
            var displayWidth = rotated ? sourceHeight : sourceWidth;
            var displayHeight = rotated ? sourceWidth : sourceHeight;
            _inspectorImageCanvas.Width = Math.Max(240d, displayWidth + 32d);
            _inspectorImageCanvas.Height = Math.Max(240d, displayHeight + 32d);
        }
    }

    private void UpdateInspectorImageEditorStatus()
    {
        if (_inspectorImageScroll.Visibility != Visibility.Visible ||
            _inspectorImagePixelWidth <= 0 || _inspectorImagePixelHeight <= 0)
            return;

        var rotated = (_inspectorImageQuarterTurns & 1) != 0;
        var width = rotated ? _inspectorImagePixelHeight : _inspectorImagePixelWidth;
        var height = rotated ? _inspectorImagePixelWidth : _inspectorImagePixelHeight;
        var zoom = Math.Clamp(_inspectorImageZoom.Value, 25, 400);
        _inspectorStatusText.Text =
            $"{width} × {height}  •  {zoom:0}%" +
            (_inspectorImageDirty ? "  •  Modified" : string.Empty);
    }

    private async Task SaveInspectorImageAsync()
    {
        if (!_inspectorImageDirty || string.IsNullOrWhiteSpace(_inspectorPath)) return;

        StorageFile? temporaryFile = null;
        try
        {
            _inspectorSaveButton.IsEnabled = false;
            _inspectorStatusText.Text = "Saving image…";

            var sourceFile = await StorageFile.GetFileFromPathAsync(_inspectorPath);
            var directoryPath = Path.GetDirectoryName(_inspectorPath)
                ?? throw new InvalidOperationException("Image directory could not be resolved.");
            var folder = await StorageFolder.GetFolderFromPathAsync(directoryPath);
            temporaryFile = await folder.CreateFileAsync(
                $".{sourceFile.Name}.xplorer-edit-{Guid.NewGuid():N}.tmp",
                CreationCollisionOption.FailIfExists);

            using (var sourceStream = await sourceFile.OpenReadAsync())
            using (var destinationStream = await temporaryFile.OpenAsync(FileAccessMode.ReadWrite))
            {
                var decoder = await BitmapDecoder.CreateAsync(sourceStream);
                var encoder = await BitmapEncoder.CreateForTranscodingAsync(destinationStream, decoder);
                encoder.BitmapTransform.Flip = _inspectorImageFlipHorizontal
                    ? BitmapFlip.Horizontal
                    : BitmapFlip.None;
                encoder.BitmapTransform.Rotation = ToBitmapRotation(_inspectorImageQuarterTurns);
                await encoder.FlushAsync();
            }

            var temporaryPath = temporaryFile.Path;
            File.Move(temporaryPath, _inspectorPath, overwrite: true);
            temporaryFile = null;

            _inspectorImageDirty = false;
            _inspectorImageQuarterTurns = 0;
            _inspectorImageFlipHorizontal = false;
            _inspectorSaveButton.IsEnabled = false;
            await RefreshInspectorSelectionAsync();
        }
        catch (Exception ex)
        {
            _inspectorSaveButton.IsEnabled = true;
            _inspectorStatusText.Text = $"Image save failed: {ex.Message}";
        }
        finally
        {
            if (temporaryFile is not null)
            {
                try { await temporaryFile.DeleteAsync(StorageDeleteOption.PermanentDelete); }
                catch { }
            }
        }
    }

    private static BitmapRotation ToBitmapRotation(int quarterTurns) => Mod4(quarterTurns) switch
    {
        1 => BitmapRotation.Clockwise90Degrees,
        2 => BitmapRotation.Clockwise180Degrees,
        3 => BitmapRotation.Clockwise270Degrees,
        _ => BitmapRotation.None,
    };

    private static int Mod4(int value)
    {
        var result = value % 4;
        return result < 0 ? result + 4 : result;
    }
}

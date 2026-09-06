using Microsoft.UI.Xaml.Input;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private void ResizeGrip_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        var point = e.GetCurrentPoint(ResizeGrip);
        if (!point.Properties.IsLeftButtonPressed) return;

        _resizing = true;
        _resizePointerId = e.Pointer.PointerId;
        _resizeStart = e.GetCurrentPoint(DialogRoot).Position;
        _resizeStartWidth = DialogRoot.ActualWidth > 0 ? DialogRoot.ActualWidth : DialogRoot.Width;
        _resizeStartHeight = DialogRoot.ActualHeight > 0 ? DialogRoot.ActualHeight : DialogRoot.Height;
        ResizeGrip.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void ResizeGrip_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_resizing || e.Pointer.PointerId != _resizePointerId) return;
        var current = e.GetCurrentPoint(DialogRoot).Position;
        var width = _resizeStartWidth + current.X - _resizeStart.X;
        var height = _resizeStartHeight + current.Y - _resizeStart.Y;
        DialogRoot.Width = Math.Clamp(width, DialogRoot.MinWidth, DialogRoot.MaxWidth);
        DialogRoot.Height = Math.Clamp(height, DialogRoot.MinHeight, DialogRoot.MaxHeight);
        e.Handled = true;
    }

    private void ResizeGrip_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_resizing || e.Pointer.PointerId != _resizePointerId) return;
        _resizing = false;
        _resizePointerId = 0;
        ResizeGrip.ReleasePointerCapture(e.Pointer);
        e.Handled = true;
    }

    private void ResizeGrip_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        DialogRoot.Width = 980;
        DialogRoot.Height = 620;
        e.Handled = true;
    }
}

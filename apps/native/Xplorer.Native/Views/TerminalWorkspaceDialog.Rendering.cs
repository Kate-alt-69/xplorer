using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private void TerminalView_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not TextBox { Tag: TerminalTabState state }) return;
        state.Scroller ??= FindDescendantScrollViewer(state.View);
        ResizeSession(state);
        RefreshTerminalView(state);
    }

    private void TerminalView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is TextBox { Tag: TerminalTabState state }) ResizeSession(state);
    }

    private void ResizeSession(TerminalTabState state)
    {
        var width = Math.Max(0, state.View.ActualWidth - 24);
        var height = Math.Max(0, state.View.ActualHeight - 22);
        var columns = Math.Max(20, (int)Math.Floor(width / 7.9));
        var rows = Math.Max(4, (int)Math.Floor(height / 17.0));
        state.Session?.Resize(columns, rows);
    }

    private void QueueTerminalRefresh(TerminalTabState state)
    {
        if (state.Disposed || Interlocked.Exchange(ref state.RefreshQueued, 1) != 0) return;
        if (!DispatcherQueue.TryEnqueue(() =>
            {
                Interlocked.Exchange(ref state.RefreshQueued, 0);
                if (!state.Disposed) RefreshTerminalView(state);
            }))
        {
            Interlocked.Exchange(ref state.RefreshQueued, 0);
        }
    }

    private void RefreshTerminalView(TerminalTabState state)
    {
        // Use a plain TextBox renderer on Windows 10. The buffer still parses ANSI/VT state, but
        // painting RichEdit character-format ranges while ConPTY is streaming can terminate the
        // native RichEdit host before managed exception handling gets a chance to run.
        var snapshot = state.Buffer.Snapshot().Text;
        var oldLength = state.View.Text?.Length ?? 0;
        var oldSelectionStart = state.View.SelectionStart;
        var oldSelectionLength = state.View.SelectionLength;

        state.Scroller ??= FindDescendantScrollViewer(state.View);
        var oldOffset = state.Scroller?.VerticalOffset ?? 0;
        var followTail = state.Scroller is null
            ? oldSelectionLength == 0 && oldSelectionStart >= oldLength
            : state.Scroller.ScrollableHeight - state.Scroller.VerticalOffset <= 28;

        state.View.Text = snapshot;

        if (followTail)
        {
            state.View.SelectionStart = snapshot.Length;
            state.View.SelectionLength = 0;
        }
        else
        {
            state.View.SelectionStart = Math.Min(oldSelectionStart, snapshot.Length);
            state.View.SelectionLength = Math.Min(
                oldSelectionLength,
                Math.Max(0, snapshot.Length - state.View.SelectionStart));
        }

        DispatcherQueue.TryEnqueue(() =>
        {
            if (state.Disposed) return;
            state.Scroller ??= FindDescendantScrollViewer(state.View);
            if (state.Scroller is null) return;
            var target = followTail
                ? state.Scroller.ScrollableHeight
                : Math.Min(oldOffset, state.Scroller.ScrollableHeight);
            state.Scroller.ChangeView(null, target, null, disableAnimation: true);
        });
    }

    private static ScrollViewer? FindDescendantScrollViewer(DependencyObject root)
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is ScrollViewer scroller) return scroller;
            var nested = FindDescendantScrollViewer(child);
            if (nested is not null) return nested;
        }
        return null;
    }

    private static void ScrollTerminal(TerminalTabState state, VirtualKey key)
    {
        state.Scroller ??= FindDescendantScrollViewer(state.View);
        var scroller = state.Scroller;
        if (scroller is null) return;

        var lineStep = 48d;
        var pageStep = Math.Max(96, scroller.ViewportHeight * 0.85);
        var delta = key switch
        {
            VirtualKey.Up => -lineStep,
            VirtualKey.Down => lineStep,
            VirtualKey.PageUp => -pageStep,
            VirtualKey.PageDown => pageStep,
            _ => 0,
        };
        if (delta == 0) return;

        var target = Math.Clamp(scroller.VerticalOffset + delta, 0, scroller.ScrollableHeight);
        scroller.ChangeView(null, target, null, disableAnimation: true);
    }
}

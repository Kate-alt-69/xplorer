using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Windows.System;
using Windows.UI;
using Windows.UI.Text;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private void TerminalView_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not TextBox { Tag: TerminalTabState state }) return;
        state.Scroller ??= FindDescendantScrollViewer(state.View);
        if (state.Scroller is not null && !state.ScrollSyncAttached)
        {
            state.Scroller.ViewChanged += state.ScrollHandler;
            state.ScrollSyncAttached = true;
        }
        ResizeSession(state);
        RefreshTerminalView(state);
        SyncTerminalDisplayScroll(state);
    }

    private void TerminalView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is not TextBox { Tag: TerminalTabState state }) return;
        ResizeSession(state);
        DispatcherQueue.TryEnqueue(() => SyncTerminalDisplayScroll(state));
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
        var snapshot = state.Buffer.Snapshot();
        var text = snapshot.Text;
        var oldLength = state.View.Text?.Length ?? 0;
        var oldSelectionStart = state.View.SelectionStart;
        var oldSelectionLength = state.View.SelectionLength;

        state.Scroller ??= FindDescendantScrollViewer(state.View);
        if (state.Scroller is not null && !state.ScrollSyncAttached)
        {
            state.Scroller.ViewChanged += state.ScrollHandler;
            state.ScrollSyncAttached = true;
        }

        var oldOffset = state.Scroller?.VerticalOffset ?? 0;
        var oldHorizontalOffset = state.Scroller?.HorizontalOffset ?? 0;
        var followTail = state.Scroller is null
            ? oldSelectionLength == 0 && oldSelectionStart >= oldLength
            : state.Scroller.ScrollableHeight - state.Scroller.VerticalOffset <= 28;

        // TextBox remains the transparent interaction layer: it owns Windows selection, scrollbars,
        // keyboard focus and copy ranges. The TextBlock below it paints exactly the same characters
        // using the VT/ANSI runs already produced by TerminalTextBuffer.
        state.View.Text = text;
        RenderStyledSnapshot(state, snapshot);

        if (followTail)
        {
            state.View.SelectionStart = text.Length;
            state.View.SelectionLength = 0;
        }
        else
        {
            state.View.SelectionStart = Math.Min(oldSelectionStart, text.Length);
            state.View.SelectionLength = Math.Min(
                oldSelectionLength,
                Math.Max(0, text.Length - state.View.SelectionStart));
        }

        DispatcherQueue.TryEnqueue(() =>
        {
            if (state.Disposed) return;
            state.Scroller ??= FindDescendantScrollViewer(state.View);
            if (state.Scroller is null) return;
            if (!state.ScrollSyncAttached)
            {
                state.Scroller.ViewChanged += state.ScrollHandler;
                state.ScrollSyncAttached = true;
            }

            var verticalTarget = followTail
                ? state.Scroller.ScrollableHeight
                : Math.Min(oldOffset, state.Scroller.ScrollableHeight);
            var horizontalTarget = Math.Min(oldHorizontalOffset, state.Scroller.ScrollableWidth);
            state.Scroller.ChangeView(horizontalTarget, verticalTarget, null, disableAnimation: true);
            SyncTerminalDisplayScroll(state);
        });
    }

    private void RenderStyledSnapshot(TerminalTabState state, TerminalSnapshot snapshot)
    {
        state.Display.Inlines.Clear();
        var text = snapshot.Text;
        if (text.Length == 0) return;

        var cursor = 0;
        foreach (var styleRun in snapshot.Runs)
        {
            var start = Math.Clamp(styleRun.Start, 0, text.Length);
            var end = Math.Clamp(styleRun.Start + styleRun.Length, start, text.Length);
            if (start > cursor)
                AppendTerminalRun(state.Display, text[cursor..start], TerminalStyle.Default);
            if (end > start)
                AppendTerminalRun(state.Display, text[start..end], styleRun.Style);
            cursor = Math.Max(cursor, end);
        }

        if (cursor < text.Length)
            AppendTerminalRun(state.Display, text[cursor..], TerminalStyle.Default);
    }

    private static void AppendTerminalRun(TextBlock display, string text, TerminalStyle style)
    {
        if (text.Length == 0) return;

        // TerminalTextBuffer uses a one-character CR paragraph boundary so style offsets remain
        // stable. TextBlock renders LF most consistently across Windows 10/11, so convert only after
        // slicing by those offsets.
        var visibleText = text.Replace("\r", "\n", StringComparison.Ordinal);
        var foreground = ResolveTerminalForeground(style);
        var run = new Run
        {
            Text = visibleText,
            Foreground = new SolidColorBrush(foreground),
            FontWeight = style.Bold ? FontWeights.Bold : FontWeights.Normal,
        };
        display.Inlines.Add(run);
    }

    private static Color ResolveTerminalForeground(TerminalStyle style)
    {
        var color = style.Inverse
            ? style.Background ?? new TerminalColor(
                DefaultTerminalBackground.R,
                DefaultTerminalBackground.G,
                DefaultTerminalBackground.B)
            : style.Foreground ?? new TerminalColor(
                DefaultTerminalForeground.R,
                DefaultTerminalForeground.G,
                DefaultTerminalForeground.B);
        return Color.FromArgb(style.Dim ? (byte)0x9a : (byte)0xff, color.R, color.G, color.B);
    }

    private void SyncTerminalDisplayScroll(TerminalTabState state)
    {
        if (state.Disposed) return;
        state.Scroller ??= FindDescendantScrollViewer(state.View);
        if (state.Scroller is null) return;

        var horizontal = Math.Min(state.Scroller.HorizontalOffset, state.DisplayScroller.ScrollableWidth);
        var vertical = Math.Min(state.Scroller.VerticalOffset, state.DisplayScroller.ScrollableHeight);
        state.DisplayScroller.ChangeView(horizontal, vertical, null, disableAnimation: true);
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

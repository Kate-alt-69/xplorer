using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.System;
using Windows.UI;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private void TerminalView_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not RichEditBox { Tag: TerminalTabState state }) return;
        state.Scroller ??= FindDescendantScrollViewer(state.View);
        ResizeSession(state);
        RefreshTerminalView(state);
    }

    private void TerminalView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is RichEditBox { Tag: TerminalTabState state }) ResizeSession(state);
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
        var selection = state.View.Document.Selection;
        var oldSelectionStart = selection.StartPosition;
        var oldSelectionEnd = selection.EndPosition;

        state.Scroller ??= FindDescendantScrollViewer(state.View);
        var oldOffset = state.Scroller?.VerticalOffset ?? 0;
        var followTail = state.Scroller is null ||
                         state.Scroller.ScrollableHeight - state.Scroller.VerticalOffset <= 28;

        state.View.Document.BatchDisplayUpdates();
        try
        {
            state.View.Document.SetText(TextSetOptions.None, snapshot.Text);
            foreach (var run in snapshot.Runs)
                ApplyStyleRun(state.View, run, snapshot.Text.Length);
        }
        finally
        {
            state.View.Document.ApplyDisplayUpdates();
        }

        var length = snapshot.Text.Length;
        if (followTail)
        {
            selection.SetRange(length, length);
        }
        else
        {
            var start = Math.Clamp(oldSelectionStart, 0, length);
            var end = Math.Clamp(oldSelectionEnd, start, length);
            selection.SetRange(start, end);
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

    private static void ApplyStyleRun(RichEditBox view, TerminalStyleRun run, int documentLength)
    {
        if (run.Length <= 0 || run.Start < 0 || run.Start >= documentLength) return;
        var end = Math.Min(documentLength, run.Start + run.Length);
        if (end <= run.Start) return;

        var range = view.Document.GetRange(run.Start, end);
        var style = run.Style;
        var foreground = style.Foreground?.ToColor() ?? DefaultTerminalForeground;
        var background = style.Background?.ToColor() ?? DefaultTerminalBackground;
        if (style.Inverse) (foreground, background) = (background, foreground);
        if (style.Dim) foreground = Dim(foreground);

        var format = range.CharacterFormat;
        format.ForegroundColor = foreground;
        format.BackgroundColor = background;
        format.Bold = style.Bold ? FormatEffect.On : FormatEffect.Off;
        format.Name = "Consolas";
        format.Size = 13;
        range.CharacterFormat = format;
    }

    private static Color Dim(Color color) => Color.FromArgb(
        color.A,
        (byte)(color.R * 0.62),
        (byte)(color.G * 0.62),
        (byte)(color.B * 0.62));

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

internal static class TerminalColorExtensions
{
    public static Color ToColor(this TerminalColor color) =>
        Color.FromArgb(0xff, color.R, color.G, color.B);
}

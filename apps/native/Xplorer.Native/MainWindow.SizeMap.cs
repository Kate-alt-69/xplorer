using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _sizeMapHooked;

    private void InitializeSizeMap()
    {
        if (_sizeMapHooked) return;

        foreach (var button in FindVisualDescendants<Button>(Root))
        {
            var isSizeMap = FindVisualDescendants<TextBlock>(button)
                .Any(text => string.Equals(text.Text, "Size Map", StringComparison.OrdinalIgnoreCase));
            if (!isSizeMap) continue;

            button.IsEnabled = true;
            ToolTipService.SetToolTip(button, "Show folder space usage");
            button.Click += SizeMapButton_Click;
            _sizeMapHooked = true;
            break;
        }
    }

    private async void SizeMapButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button anchor) return;

        var path = CurrentPath;
        using var cancellation = new CancellationTokenSource();

        var heading = new TextBlock
        {
            Text = "Size Map",
            FontSize = 17,
            FontWeight = Windows.UI.Text.FontWeights.SemiBold,
        };
        var folder = new TextBlock
        {
            Text = path,
            FontSize = 11,
            Opacity = 0.65,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        var progress = new ProgressRing
        {
            Width = 24,
            Height = 24,
            IsActive = true,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 18, 0, 6),
        };
        var progressText = new TextBlock
        {
            Text = "Calculating folder sizes…",
            FontSize = 11,
            Opacity = 0.7,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        var rows = new StackPanel { Spacing = 3 };

        var body = new StackPanel
        {
            Width = 400,
            MaxHeight = 540,
            Spacing = 5,
            Padding = new Thickness(3),
        };
        body.Children.Add(heading);
        body.Children.Add(folder);
        body.Children.Add(progress);
        body.Children.Add(progressText);
        body.Children.Add(rows);

        var scroll = new ScrollViewer
        {
            Content = body,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        var flyout = new Flyout
        {
            Content = scroll,
            Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft,
        };
        flyout.Closed += (_, _) => cancellation.Cancel();
        flyout.ShowAt(anchor);

        IReadOnlyList<SizeMapEntry> entries;
        try
        {
            entries = await Task.Run(() => BuildSizeMap(path, cancellation.Token), cancellation.Token);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            progress.IsActive = false;
            progress.Visibility = Visibility.Collapsed;
            progressText.Text = $"Could not calculate sizes: {ex.Message}";
            return;
        }

        if (cancellation.IsCancellationRequested) return;

        progress.IsActive = false;
        progress.Visibility = Visibility.Collapsed;
        rows.Children.Clear();

        if (entries.Count == 0)
        {
            progressText.Text = "This folder is empty, inaccessible, or contains no measurable items.";
            return;
        }

        var total = entries.Sum(entry => entry.SizeBytes);
        progressText.Text = $"{entries.Count} items  •  {FormatSizeMapBytes(total)} total";
        var largest = Math.Max(1L, entries.Max(entry => entry.SizeBytes));

        foreach (var entry in entries.Take(80))
        {
            rows.Children.Add(CreateSizeMapRow(entry, largest));
        }

        if (entries.Count > 80)
        {
            rows.Children.Add(new TextBlock
            {
                Text = $"+ {entries.Count - 80} smaller items",
                FontSize = 11,
                Opacity = 0.62,
                Margin = new Thickness(8, 6, 0, 2),
            });
        }
    }

    private static FrameworkElement CreateSizeMapRow(SizeMapEntry entry, long largest)
    {
        var grid = new Grid
        {
            MinHeight = 42,
            Padding = new Thickness(7, 5, 7, 5),
            ColumnSpacing = 8,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = entry.IsDirectory ? "\uE8B7" : "\uE8A5",
            FontSize = 14,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var center = new StackPanel
        {
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        center.Children.Add(new TextBlock
        {
            Text = entry.Name,
            FontSize = 12,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        center.Children.Add(new ProgressBar
        {
            Minimum = 0,
            Maximum = 100,
            Value = entry.SizeBytes * 100d / largest,
            Height = 2,
        });

        var size = new TextBlock
        {
            Text = FormatSizeMapBytes(entry.SizeBytes),
            FontSize = 11,
            Opacity = 0.72,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Grid.SetColumn(center, 1);
        Grid.SetColumn(size, 2);
        grid.Children.Add(icon);
        grid.Children.Add(center);
        grid.Children.Add(size);
        return grid;
    }

    private static IReadOnlyList<SizeMapEntry> BuildSizeMap(string path, CancellationToken cancellationToken)
    {
        var entries = new List<SizeMapEntry>();
        IEnumerable<string> children;
        try
        {
            children = Directory.EnumerateFileSystemEntries(path).ToArray();
        }
        catch
        {
            return entries;
        }

        foreach (var child in children)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var attributes = File.GetAttributes(child);
                var isDirectory = attributes.HasFlag(FileAttributes.Directory);
                long size;
                if (isDirectory)
                {
                    // Never recurse through junctions/symlinks: beside avoiding loops, Explorer-like
                    // size accounting should not charge a linked tree to the parent folder twice.
                    size = attributes.HasFlag(FileAttributes.ReparsePoint)
                        ? 0
                        : CalculateDirectorySize(child, cancellationToken);
                }
                else
                {
                    size = new FileInfo(child).Length;
                }

                entries.Add(new SizeMapEntry(Path.GetFileName(child), Math.Max(0, size), isDirectory));
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                // One inaccessible/racing child should not cancel the entire map.
            }
        }

        return entries
            .OrderByDescending(entry => entry.SizeBytes)
            .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
    }

    private static long CalculateDirectorySize(string root, CancellationToken cancellationToken)
    {
        long total = 0;
        var pending = new Stack<string>();
        pending.Push(root);

        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = pending.Pop();

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFileSystemEntries(directory).ToArray();
            }
            catch
            {
                continue;
            }

            foreach (var entry in entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var attributes = File.GetAttributes(entry);
                    if (attributes.HasFlag(FileAttributes.Directory))
                    {
                        if (!attributes.HasFlag(FileAttributes.ReparsePoint))
                            pending.Push(entry);
                        continue;
                    }

                    total = checked(total + new FileInfo(entry).Length);
                }
                catch (OverflowException)
                {
                    return long.MaxValue;
                }
                catch
                {
                    // Keep counting readable items.
                }
            }
        }

        return total;
    }

    private static string FormatSizeMapBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        var units = new[] { "KB", "MB", "GB", "TB", "PB" };
        double value = bytes;
        var unit = -1;
        do
        {
            value /= 1024d;
            unit++;
        }
        while (value >= 1024d && unit < units.Length - 1);

        return $"{value:0.##} {units[unit]}";
    }

    private sealed record SizeMapEntry(string Name, long SizeBytes, bool IsDirectory);
}

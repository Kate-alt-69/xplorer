using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Xplorer.Native.Services;

namespace Xplorer.Native;

/// <summary>
/// Code-only fallback window used when MainWindow.xaml cannot be loaded. It intentionally avoids
/// loading another XAML file, so a broken compiled layout can no longer turn into a completely
/// silent process exit. The window gives the user the exact failing stage and log path.
/// </summary>
public sealed class StartupRecoveryWindow : Window
{
    public StartupRecoveryWindow(string stage, Exception exception)
    {
        Title = "Xplorer startup diagnostics";

        var root = new Grid
        {
            Padding = new Thickness(24),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 17, 17, 22)),
        };
        Content = root;

        var stack = new StackPanel
        {
            Spacing = 14,
            MaxWidth = 900,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
        root.Children.Add(stack);

        stack.Children.Add(new TextBlock
        {
            Text = "Xplorer recovered from a WinUI layout startup failure",
            FontSize = 24,
            FontWeight = Windows.UI.Text.FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
        });

        stack.Children.Add(new TextBlock
        {
            Text = "The native process is still running. The file index is not required for the UI to open; this screen appears because the main XAML layout failed to load.",
            FontSize = 14,
            Opacity = 0.82,
            TextWrapping = TextWrapping.Wrap,
        });

        stack.Children.Add(new TextBlock
        {
            Text = BuildDiagnosticText(stage, exception),
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.Wrap,
        });

        stack.Children.Add(new TextBlock
        {
            Text = $"Startup log: {CrashLogService.StartupLogPath}",
            FontSize = 13,
            IsTextSelectionEnabled = true,
            TextWrapping = TextWrapping.Wrap,
        });

        // Buttons are useful but not essential to the recovery surface. If a control-style problem
        // is part of the original failure, the TextBlock-only diagnostics above remain visible.
        try
        {
            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 10,
            };

            var openLogs = new Button { Content = "Open logs folder" };
            openLogs.Click += (_, _) =>
            {
                try
                {
                    Directory.CreateDirectory(CrashLogService.LogDirectory);
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        UseShellExecute = true,
                        ArgumentList = { CrashLogService.LogDirectory },
                    });
                }
                catch (Exception ex)
                {
                    CrashLogService.LogException("Recovery window open-log-folder", ex);
                }
            };

            var close = new Button { Content = "Close Xplorer" };
            close.Click += (_, _) => Close();

            buttons.Children.Add(openLogs);
            buttons.Children.Add(close);
            stack.Children.Add(buttons);
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Recovery window optional buttons", ex);
        }
    }

    private static string BuildDiagnosticText(string stage, Exception exception)
    {
        var lines = new List<string>
        {
            $"Stage: {stage}",
            $"Exception: {exception.GetType().FullName}",
            $"HRESULT: 0x{unchecked((uint)exception.HResult):X8}",
            $"Message: {exception.Message}",
        };

        var current = exception.InnerException;
        var depth = 1;
        while (current is not null && depth <= 6)
        {
            lines.Add($"Inner {depth}: {current.GetType().FullName} 0x{unchecked((uint)current.HResult):X8}: {current.Message}");
            current = current.InnerException;
            depth++;
        }

        return string.Join(Environment.NewLine, lines);
    }
}

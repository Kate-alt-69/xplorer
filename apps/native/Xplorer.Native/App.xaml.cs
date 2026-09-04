using Microsoft.UI.Xaml;
using Xplorer.Native.Services;

namespace Xplorer.Native;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var rawArgument = args.Arguments?.Trim() ?? string.Empty;
        if (string.Equals(rawArgument, "--unregister-shell", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                ShellIntegrationService.Unregister();
            }
            finally
            {
                Environment.Exit(0);
            }
        }

        var mainWindow = new MainWindow(ParseInitialFolder(rawArgument));
        _window = mainWindow;
        _window.Activate();
    }

    private static string? ParseInitialFolder(string rawArgument)
    {
        if (string.IsNullOrWhiteSpace(rawArgument) || rawArgument.StartsWith("--", StringComparison.Ordinal))
            return null;

        var candidate = rawArgument;
        if (candidate.Length >= 2 && candidate[0] == '"' && candidate[^1] == '"')
            candidate = candidate[1..^1];

        try
        {
            return Directory.Exists(candidate) ? Path.GetFullPath(candidate) : null;
        }
        catch
        {
            return null;
        }
    }
}

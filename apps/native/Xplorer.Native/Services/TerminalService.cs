using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

/// <summary>
/// Resolves the shell used by Xplorer's embedded ConPTY terminal and routes the existing Terminal
/// command into the in-app host. Windows Terminal (wt.exe) is deliberately not a dependency.
/// </summary>
public static class TerminalService
{
    private static readonly object Gate = new();
    private static Action<string, XplorerSettings>? _inAppHost;

    public static IDisposable AttachInAppHost(Action<string, XplorerSettings> host)
    {
        ArgumentNullException.ThrowIfNull(host);
        lock (Gate) _inAppHost = host;
        return new HostRegistration(host);
    }

    public static void Open(string workingDirectory, XplorerSettings settings)
    {
        Action<string, XplorerSettings>? host;
        lock (Gate) host = _inAppHost;
        if (host is null)
            throw new InvalidOperationException("The embedded terminal host is not initialized yet.");
        host(workingDirectory, settings);
    }

    internal static TerminalLaunchSpec ResolveLaunch(XplorerSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.TerminalCommand))
        {
            var custom = settings.TerminalCommand.Trim().Trim('"');
            return new TerminalLaunchSpec(
                custom,
                settings.TerminalArguments?.Trim() ?? string.Empty,
                Path.GetFileNameWithoutExtension(custom) is { Length: > 0 } name ? name : "Terminal");
        }

        var pwsh = FindExecutable("pwsh.exe") ??
                   FindExisting(Path.Combine(
                       Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                       "PowerShell", "7", "pwsh.exe"));
        if (pwsh is not null)
            return new TerminalLaunchSpec(pwsh, "-NoLogo", "PowerShell 7");

        var windowsPowerShell = FindExisting(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
        if (windowsPowerShell is not null)
            return new TerminalLaunchSpec(windowsPowerShell, "-NoLogo", "Windows PowerShell");

        var cmd = FindExisting(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "cmd.exe")) ?? FindExecutable("cmd.exe");
        if (cmd is not null)
            return new TerminalLaunchSpec(cmd, string.Empty, "Command Prompt");

        throw new FileNotFoundException(
            "Xplorer could not find PowerShell 7, Windows PowerShell, or Command Prompt.");
    }

    private static string? FindExecutable(string fileName)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path)) return null;

        foreach (var segment in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var directory = segment.Trim().Trim('"');
                if (directory.Length == 0) continue;
                var candidate = Path.Combine(directory, fileName);
                if (File.Exists(candidate)) return candidate;
            }
            catch
            {
                // Invalid PATH segments are ignored just like Windows process search does.
            }
        }

        return null;
    }

    private static string? FindExisting(string candidate) =>
        File.Exists(candidate) ? candidate : null;

    private sealed class HostRegistration(Action<string, XplorerSettings> host) : IDisposable
    {
        private Action<string, XplorerSettings>? _host = host;

        public void Dispose()
        {
            var registration = Interlocked.Exchange(ref _host, null);
            if (registration is null) return;
            lock (Gate)
            {
                if (ReferenceEquals(_inAppHost, registration))
                    _inAppHost = null;
            }
        }
    }
}

internal sealed record TerminalLaunchSpec(string Executable, string Arguments, string DisplayName);

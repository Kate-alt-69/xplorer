using System.Diagnostics;
using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns the lifecycle boundary between WinUI and the tiny Rust xplorer.exe host. Worker mode is
/// dispatched by the Rust host itself, so --service-worker never loads WinUI or the .NET runtime.
/// </summary>
public static class IndexWorkerService
{
    private const string HostExecutableName = "xplorer.exe";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "Xplorer Index Worker";

    public static void Apply(bool enabled)
    {
        if (enabled) EnsureEnabled();
        else Disable();
    }

    public static void EnsureEnabled()
    {
        var host = ResolveHostPath();
        RunHostCommand(host, "--register-startup", waitForExit: true);
        RunHostCommand(host, "--service-worker", waitForExit: false);
    }

    public static void Disable()
    {
        var host = TryResolveHostPath();
        if (host is not null)
        {
            TryRun(host, "--unregister-startup", waitForExit: true);
            TryRun(host, "--stop-service-worker", waitForExit: true);
        }

        // Cleanup still works if xplorer.exe was manually removed before Xplorer is uninstalled.
        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        runKey?.DeleteValue(RunValueName, throwOnMissingValue: false);
    }

    private static string ResolveHostPath() =>
        TryResolveHostPath()
        ?? throw new FileNotFoundException(
            $"{HostExecutableName} must be installed beside {Path.GetFileName(Environment.ProcessPath)}.",
            Path.Combine(AppContext.BaseDirectory, HostExecutableName));

    private static string? TryResolveHostPath()
    {
        var candidate = Path.Combine(AppContext.BaseDirectory, HostExecutableName);
        return File.Exists(candidate) ? candidate : null;
    }

    private static void TryRun(string host, string argument, bool waitForExit)
    {
        try
        {
            RunHostCommand(host, argument, waitForExit);
        }
        catch
        {
            // Disable/uninstall cleanup should be best-effort and must not block the UI.
        }
    }

    private static void RunHostCommand(string host, string argument, bool waitForExit)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = host,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Could not start {HostExecutableName}.");

        if (!waitForExit) return;
        if (!process.WaitForExit(5000))
            throw new TimeoutException($"{HostExecutableName} did not finish {argument} in time.");
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{HostExecutableName} {argument} exited with code {process.ExitCode}.");
    }
}

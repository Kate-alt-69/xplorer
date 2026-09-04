using System.Diagnostics;
using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns the lifecycle boundary between the WinUI file manager and the tiny Rust index worker.
/// The worker stays a separate process so background mode never loads WinUI or the .NET desktop UI.
/// </summary>
public static class IndexWorkerService
{
    private const string WorkerExecutableName = "xplorer-worker.exe";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "Xplorer Index Worker";

    public static void Apply(bool enabled)
    {
        if (enabled) EnsureEnabled();
        else Disable();
    }

    public static void EnsureEnabled()
    {
        var worker = ResolveWorkerPath();
        RunWorkerCommand(worker, "--register-startup", waitForExit: true);
        RunWorkerCommand(worker, "--service-worker", waitForExit: false);
    }

    public static void Disable()
    {
        var worker = TryResolveWorkerPath();
        if (worker is not null)
        {
            TryRun(worker, "--unregister-startup", waitForExit: true);
            TryRun(worker, "--stop-service-worker", waitForExit: true);
        }

        // Cleanup still works if the binary was manually removed before Xplorer is uninstalled.
        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        runKey?.DeleteValue(RunValueName, throwOnMissingValue: false);
    }

    private static string ResolveWorkerPath() =>
        TryResolveWorkerPath()
        ?? throw new FileNotFoundException(
            $"{WorkerExecutableName} must be installed beside Xplorer.exe.",
            Path.Combine(AppContext.BaseDirectory, WorkerExecutableName));

    private static string? TryResolveWorkerPath()
    {
        var candidate = Path.Combine(AppContext.BaseDirectory, WorkerExecutableName);
        return File.Exists(candidate) ? candidate : null;
    }

    private static void TryRun(string worker, string argument, bool waitForExit)
    {
        try
        {
            RunWorkerCommand(worker, argument, waitForExit);
        }
        catch
        {
            // Disable/uninstall cleanup should be best-effort and must not block the UI.
        }
    }

    private static void RunWorkerCommand(string worker, string argument, bool waitForExit)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = worker,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Could not start {WorkerExecutableName}.");

        if (!waitForExit) return;
        if (!process.WaitForExit(milliseconds: 5000))
            throw new TimeoutException($"{WorkerExecutableName} did not finish {argument} in time.");
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{WorkerExecutableName} {argument} exited with code {process.ExitCode}.");
    }
}

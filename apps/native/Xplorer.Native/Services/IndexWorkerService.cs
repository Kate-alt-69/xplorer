using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns the lifecycle boundary between WinUI and the tiny Rust background host. Worker mode is
/// dispatched by the Rust host itself, so --service-worker never loads WinUI or the .NET runtime.
/// </summary>
public static class IndexWorkerService
{
    private const string HostExecutableName = "xplorer.exe";
    private const string WorkerExecutableName = "xplorer-bgw.exe";
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "Xplorer Index Worker";
    private const string WakeEventName = @"Local\Xplorer.IndexWorker.Wake.v1";
    private const uint EventModifyState = 0x0002;

    public static void Apply(bool enabled)
    {
        if (enabled) EnsureEnabled();
        else Disable();
    }

    public static void EnsureEnabled()
    {
        var worker = ResolveWorkerHostPath();
        RunHostCommand(worker, "--register-startup", waitForExit: true);
        RunHostCommand(worker, "--service-worker", waitForExit: false);
    }

    /// <summary>
    /// Publish the directory the user is actually looking at. This is intentionally direct IPC:
    /// no cmd.exe, powershell.exe or conhost.exe is created just to enumerate files. A tiny atomic
    /// hint file survives worker restarts and a named event wakes an already-running worker.
    /// </summary>
    public static void PrioritizeWorkspace(string folder)
    {
        try
        {
            var fullPath = Path.GetFullPath(folder);
            if (!Directory.Exists(fullPath)) return;

            var indexDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Xplorer",
                "Index");
            Directory.CreateDirectory(indexDirectory);

            var hintPath = Path.Combine(indexDirectory, "workspace.hint");
            var tempPath = Path.Combine(
                indexDirectory,
                $"workspace.hint.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
            File.WriteAllText(tempPath, fullPath, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(tempPath, hintPath, overwrite: true);
            SignalWorkerWake();
        }
        catch
        {
            // Workspace priority is an optimization. Current-folder navigation and refresh must
            // never fail because the worker or its cache directory is unavailable.
        }
    }

    public static void Disable()
    {
        var worker = TryResolveWorkerHostPath() ?? TryResolveHostPath();
        if (worker is not null)
        {
            TryRun(worker, "--unregister-startup", waitForExit: true);
            TryRun(worker, "--stop-service-worker", waitForExit: true);
        }

        // Cleanup still works if the worker binary was manually removed before Xplorer is uninstalled.
        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        runKey?.DeleteValue(RunValueName, throwOnMissingValue: false);
    }

    private static void SignalWorkerWake()
    {
        var handle = OpenEventW(EventModifyState, false, WakeEventName);
        if (handle == nint.Zero) return;
        try
        {
            _ = SetEvent(handle);
        }
        finally
        {
            _ = CloseHandle(handle);
        }
    }

    private static string ResolveWorkerHostPath() =>
        TryResolveWorkerHostPath()
        ?? TryResolveHostPath()
        ?? throw new FileNotFoundException(
            $"{WorkerExecutableName} or {HostExecutableName} must be installed beside {Path.GetFileName(Environment.ProcessPath)}.",
            Path.Combine(AppContext.BaseDirectory, WorkerExecutableName));

    private static string? TryResolveWorkerHostPath()
    {
        var candidate = Path.Combine(AppContext.BaseDirectory, WorkerExecutableName);
        return File.Exists(candidate) ? candidate : null;
    }

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
            ?? throw new InvalidOperationException($"Could not start {Path.GetFileName(host)}.");

        if (!waitForExit) return;
        if (!process.WaitForExit(5000))
            throw new TimeoutException($"{Path.GetFileName(host)} did not finish {argument} in time.");
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{Path.GetFileName(host)} {argument} exited with code {process.ExitCode}.");
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern nint OpenEventW(uint desiredAccess, bool inheritHandle, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetEvent(nint eventHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint handle);
}

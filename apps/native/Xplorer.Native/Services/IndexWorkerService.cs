using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns the lifecycle boundary between WinUI and the Rust background index worker. A provisioned
/// highest-privilege scheduled task is preferred, but browsing never depends on it: failure falls
/// back to the normal per-user worker and direct-disk viewport path.
/// </summary>
public static class IndexWorkerService
{
    private const string HostExecutableName = "xplorer.exe";
    private const string WorkerExecutableName = "xplorer-bgw.exe";
    private const string ScheduledTaskName = "Xplorer Index Worker";
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
        try
        {
            Directory.CreateDirectory(IndexLocationService.ControlDirectory);
            File.Delete(DisabledFlagPath);
        }
        catch
        {
            // Worker enable is still allowed to fall through to the local process path.
        }

        IndexLocationService.PreferConfiguredIndex();
        if (IndexLocationService.PrivilegedIndexConfigured && TryStartProvisionedTask())
            return;

        // A broken/missing task must never strand browsing on a protected stale cache. Use the local
        // worker/index for this UI session and keep disk enumeration authoritative.
        IndexLocationService.UseLocalIndexForSession();
        var worker = ResolveWorkerHostPath();
        var runtimeArguments = LocalWorkerRuntimeArguments();
        RunHostCommand(
            worker,
            ["--register-startup", .. runtimeArguments],
            waitForExit: true);
        RunHostCommand(
            worker,
            ["--service-worker", .. runtimeArguments],
            waitForExit: false);
    }

    /// <summary>
    /// Publish the directory the user is actually looking at through a user-owned control channel.
    /// The elevated worker never trusts this path for its own executable/index location; it only
    /// treats the hint contents as a folder to inspect.
    /// </summary>
    public static void PrioritizeWorkspace(string folder)
    {
        try
        {
            var fullPath = Path.GetFullPath(folder);
            if (!Directory.Exists(fullPath)) return;

            var controlDirectory = IndexLocationService.ControlDirectory;
            Directory.CreateDirectory(controlDirectory);

            var hintPath = Path.Combine(controlDirectory, "workspace.hint");
            var tempPath = Path.Combine(
                controlDirectory,
                $"workspace.hint.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
            File.WriteAllText(tempPath, fullPath, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(tempPath, hintPath, overwrite: true);
            SignalWorkerWake();
        }
        catch
        {
            // Workspace priority is an optimization. Current-folder navigation and refresh must
            // never fail because the worker or its control channel is unavailable.
        }
    }

    public static void Disable()
    {
        try
        {
            Directory.CreateDirectory(IndexLocationService.ControlDirectory);
            File.WriteAllText(DisabledFlagPath, "disabled", new UTF8Encoding(false));
        }
        catch { }

        SignalWorkerWake();
        var worker = TryResolveWorkerHostPath() ?? TryResolveHostPath();
        if (worker is not null)
        {
            TryRun(worker, ["--unregister-startup"], waitForExit: true);
            TryRun(worker, ["--stop-service-worker"], waitForExit: true);
        }

        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        runKey?.DeleteValue(RunValueName, throwOnMissingValue: false);
    }

    private static string DisabledFlagPath => Path.Combine(
        IndexLocationService.ControlDirectory,
        "indexing.disabled");

    private static string[] LocalWorkerRuntimeArguments() =>
    [
        "--data-dir",
        IndexLocationService.LocalIndexDirectory,
        "--control-dir",
        IndexLocationService.ControlDirectory,
    ];

    private static bool TryStartProvisionedTask()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "schtasks.exe"),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                ArgumentList = { "/Run", "/TN", ScheduledTaskName },
            });
            if (process is null) return false;
            if (!process.WaitForExit(5000)) return false;
            if (process.ExitCode == 0) return true;

            // Task Scheduler can return a non-zero result when an instance is already active. If a
            // worker exists, keep the protected index selected and let the wake event do its job.
            return Process.GetProcessesByName("xplorer-bgw").Length > 0;
        }
        catch
        {
            return Process.GetProcessesByName("xplorer-bgw").Length > 0;
        }
    }

    private static void SignalWorkerWake()
    {
        var handle = OpenEventW(EventModifyState, false, WakeEventName);
        if (handle == nint.Zero) return;
        try { _ = SetEvent(handle); }
        finally { _ = CloseHandle(handle); }
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

    private static void TryRun(string host, IReadOnlyList<string> arguments, bool waitForExit)
    {
        try { RunHostCommand(host, arguments, waitForExit); }
        catch { }
    }

    private static void RunHostCommand(string host, IReadOnlyList<string> arguments, bool waitForExit)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = host,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Could not start {Path.GetFileName(host)}.");

        if (!waitForExit) return;
        if (!process.WaitForExit(5000))
            throw new TimeoutException($"{Path.GetFileName(host)} did not finish the worker command in time.");
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{Path.GetFileName(host)} exited with code {process.ExitCode}.");
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern nint OpenEventW(uint desiredAccess, bool inheritHandle, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetEvent(nint eventHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint handle);
}

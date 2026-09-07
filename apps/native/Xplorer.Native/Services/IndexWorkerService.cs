using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns the lifecycle boundary between WinUI and the Rust background index worker. A provisioned
/// protected worker is controlled only through the user-owned control channel; otherwise Xplorer
/// falls back to the per-user worker without requiring elevation from the UI.
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
        try
        {
            Directory.CreateDirectory(IndexLocationService.ControlDirectory);
            File.Delete(DisabledFlagPath);
        }
        catch { }

        IndexLocationService.PreferConfiguredIndex();
        if (IndexLocationService.PrivilegedIndexConfigured)
        {
            // The C# reader derives the protected store from the current SID and never trusts this
            // pointer. It exists only so the standalone Rust -debug executable can report the same
            // active backend without duplicating Windows-token SID lookup code.
            TryWriteDiagnosticIndexPointer(IndexLocationService.ProtectedIndexDirectory);

            // The installer-owned SYSTEM task is configured to start at boot and restart on failure.
            // Cross-session named events are best-effort; the worker also polls this control channel
            // once per second, so no UI elevation or process-name guessing is needed here.
            RemoveLocalStartup();
            SignalWorkerWake();
            return;
        }

        TryDeleteDiagnosticIndexPointer();
        IndexLocationService.UseLocalIndexForSession();
        var worker = ResolveWorkerHostPath();
        var runtimeArguments = LocalWorkerRuntimeArguments();
        RegisterLocalStartup(worker, runtimeArguments);
        RunHostCommand(worker, ["--service-worker", .. runtimeArguments], waitForExit: false);
    }

    /// <summary>
    /// Publish the directory the user is actually looking at through a user-owned control channel.
    /// A privileged worker treats the hint only as an indexing target; executable/data-store paths
    /// are fixed by its protected scheduled-task configuration.
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
            // Hot indexing is an acceleration layer only. Direct-disk navigation stays authoritative.
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
        RemoveLocalStartup();
        // A protected worker remains registered/running but idles while indexing.disabled exists.
        // This is intentional: re-enabling never needs another UAC prompt.
    }

    private static string DisabledFlagPath => Path.Combine(
        IndexLocationService.ControlDirectory,
        "indexing.disabled");

    private static string DiagnosticIndexPointerPath => Path.Combine(
        IndexLocationService.ControlDirectory,
        "protected-index.path");

    private static string[] LocalWorkerRuntimeArguments() =>
    [
        "--data-dir",
        IndexLocationService.LocalIndexDirectory,
        "--control-dir",
        IndexLocationService.ControlDirectory,
    ];

    private static void RegisterLocalStartup(string worker, IReadOnlyList<string> runtimeArguments)
    {
        using var runKey = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("Could not open the Windows startup registry key.");
        var command = new StringBuilder();
        AppendQuoted(command, worker);
        command.Append(" --service-worker");
        foreach (var argument in runtimeArguments)
        {
            command.Append(' ');
            AppendQuoted(command, argument);
        }
        runKey.SetValue(RunValueName, command.ToString(), RegistryValueKind.String);
    }

    private static void RemoveLocalStartup()
    {
        try
        {
            using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            runKey?.DeleteValue(RunValueName, throwOnMissingValue: false);
        }
        catch { }
    }

    private static void TryWriteDiagnosticIndexPointer(string indexDirectory)
    {
        try
        {
            Directory.CreateDirectory(IndexLocationService.ControlDirectory);
            File.WriteAllText(DiagnosticIndexPointerPath, indexDirectory, new UTF8Encoding(false));
        }
        catch { }
    }

    private static void TryDeleteDiagnosticIndexPointer()
    {
        try { File.Delete(DiagnosticIndexPointerPath); }
        catch { }
    }

    private static void AppendQuoted(StringBuilder builder, string value)
    {
        builder.Append('"');
        builder.Append(value.Replace("\"", "\\\"", StringComparison.Ordinal));
        builder.Append('"');
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

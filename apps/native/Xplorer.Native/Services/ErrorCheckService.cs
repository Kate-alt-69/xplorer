using System.Runtime.InteropServices;
using System.Text;

namespace Xplorer.Native.Services;

/// <summary>
/// Tiny process-lifecycle control channel to the sibling errorchk.exe watchdog. Xplorer never scans
/// process names: both sides derive the channel from this UI process id and the per-user control
/// directory. A requested restart is therefore distinguishable from a crash/code-0 early exit.
/// </summary>
public static class ErrorCheckService
{
    private const string EventPrefix = @"Local\Xplorer.ErrorChk.";
    private const uint EventModifyState = 0x0002;

    public static bool NotifyRefresh() => Signal("refresh");

    public static bool RequestRestart(string reason)
    {
        var cleanReason = string.IsNullOrWhiteSpace(reason)
            ? "application requested restart"
            : reason.Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (!Signal($"restart:{cleanReason}"))
            return false;

        CrashLogService.Log($"Watchdog restart requested. Reason='{cleanReason}'.");
        // errorchk already has the original normalized launch arguments and will create the
        // replacement process after this process exits. Exit 0 is intentional/planned here.
        Environment.Exit(0);
        return true;
    }

    private static bool Signal(string command)
    {
        try
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(localAppData)) return false;

            var controlDirectory = Path.Combine(localAppData, "Xplorer", "Control");
            Directory.CreateDirectory(controlDirectory);
            var pid = Environment.ProcessId;
            var commandPath = Path.Combine(controlDirectory, $"errorchk-{pid}.cmd");
            var temporaryPath = commandPath + $".{Guid.NewGuid():N}.tmp";
            File.WriteAllText(temporaryPath, command, new UTF8Encoding(false));
            File.Move(temporaryPath, commandPath, overwrite: true);

            var eventName = $"{EventPrefix}{pid}.v1";
            var handle = OpenEventW(EventModifyState, false, eventName);
            if (handle == nint.Zero)
            {
                try { File.Delete(commandPath); } catch { }
                return false;
            }

            try
            {
                return SetEvent(handle);
            }
            finally
            {
                _ = CloseHandle(handle);
            }
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Could not signal errorchk watchdog", ex);
            return false;
        }
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern nint OpenEventW(uint desiredAccess, bool inheritHandle, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetEvent(nint eventHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint handle);
}

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Reclaims startup-only managed/XAML pages after Xplorer has been idle for a few seconds. This is
/// deliberately one-shot: continuously trimming a UI process would trade memory for page-fault
/// stutter every time the user clicks something.
/// </summary>
public static class UiMemoryService
{
    private const long TrimThresholdBytes = 50L * 1024 * 1024;

    public static void SchedulePostStartupTrim()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(8)).ConfigureAwait(false);
                using var process = Process.GetCurrentProcess();
                process.Refresh();
                var before = process.WorkingSet64;
                if (before < TrimThresholdBytes) return;

                // Startup diagnostics, XAML parsing and initial navigation leave short-lived managed
                // objects behind. One optimized full collection is enough; do not do this per folder.
                GC.Collect(2, GCCollectionMode.Optimized, blocking: true, compacting: false);
                GC.WaitForPendingFinalizers();

                _ = SetProcessWorkingSetSize(process.Handle, (nuint)unchecked((nint)(-1)), (nuint)unchecked((nint)(-1)));
                await Task.Delay(250).ConfigureAwait(false);
                process.Refresh();
                CrashLogService.Log(
                    $"Idle UI memory trim: working set {before / 1024} KiB -> {process.WorkingSet64 / 1024} KiB.");
            }
            catch (Exception ex)
            {
                CrashLogService.LogException("Idle UI memory trim ignored", ex);
            }
        });
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessWorkingSetSize(nint process, nuint minimumWorkingSetSize, nuint maximumWorkingSetSize);
}

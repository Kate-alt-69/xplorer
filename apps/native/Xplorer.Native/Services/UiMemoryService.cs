using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Reclaims transient managed/XAML pages after startup or after a heavy modal UI such as Settings.
/// It never trims continuously while browsing because that would trade a pretty Task Manager number
/// for page-fault stutter on every click.
/// </summary>
public static class UiMemoryService
{
    private const long TrimThresholdBytes = 24L * 1024 * 1024;
    private static int _trimScheduled;

    public static void SchedulePostStartupTrim() =>
        ScheduleTrim("startup", TimeSpan.FromSeconds(8));

    public static void SchedulePostInteractionTrim(string reason) =>
        ScheduleTrim(reason, TimeSpan.FromSeconds(3));

    private static void ScheduleTrim(string reason, TimeSpan delay)
    {
        if (Interlocked.Exchange(ref _trimScheduled, 1) != 0) return;

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(delay).ConfigureAwait(false);
                using var process = Process.GetCurrentProcess();
                process.Refresh();
                var beforeWorkingSet = process.WorkingSet64;
                var beforePrivate = process.PrivateMemorySize64;
                if (beforeWorkingSet < TrimThresholdBytes) return;

                GC.Collect(2, GCCollectionMode.Optimized, blocking: true, compacting: false);
                GC.WaitForPendingFinalizers();

                var trimSentinel = ~((nuint)0);
                _ = SetProcessWorkingSetSize(process.Handle, trimSentinel, trimSentinel);

                await Task.Delay(250).ConfigureAwait(false);
                process.Refresh();
                CrashLogService.Log(
                    $"Idle UI memory trim ({reason}): working set {beforeWorkingSet / 1024} KiB -> {process.WorkingSet64 / 1024} KiB; private {beforePrivate / 1024} KiB -> {process.PrivateMemorySize64 / 1024} KiB.");
            }
            catch (Exception ex)
            {
                CrashLogService.LogException($"Idle UI memory trim ignored ({reason})", ex);
            }
            finally
            {
                Volatile.Write(ref _trimScheduled, 0);
            }
        });
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessWorkingSetSize(nint process, nuint minimumWorkingSetSize, nuint maximumWorkingSetSize);
}

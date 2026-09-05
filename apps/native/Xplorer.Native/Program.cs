using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Xplorer.Native.Services;

namespace Xplorer.Native;

/// <summary>
/// Explicit WinUI entry point so startup failures that happen before App's constructor are logged.
/// The generated XAML entry point is disabled in the project file.
/// </summary>
public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        CrashLogService.Log($"Program.Main entered. Args='{string.Join(' ', args)}'; OS={Environment.OSVersion}; BaseDirectory={AppContext.BaseDirectory}");

        try
        {
            WinRT.ComWrappersSupport.InitializeComWrappers();
            CrashLogService.Log("WinRT COM wrappers initialized.");

            Application.Start(_ =>
            {
                try
                {
                    var dispatcherQueue = DispatcherQueue.GetForCurrentThread();
                    var context = new DispatcherQueueSynchronizationContext(dispatcherQueue);
                    SynchronizationContext.SetSynchronizationContext(context);
                    CrashLogService.Log("WinUI Application.Start callback entered; creating App.");
                    _ = new App();
                }
                catch (Exception ex)
                {
                    CrashLogService.LogException("Program.Application.Start callback", ex);
                    CrashLogService.ShowFatal("WinUI application bootstrap", ex);
                    Environment.ExitCode = 1;
                }
            });

            return Environment.ExitCode;
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Program.Main", ex);
            CrashLogService.ShowFatal("native application entry point", ex);
            return 1;
        }
    }
}

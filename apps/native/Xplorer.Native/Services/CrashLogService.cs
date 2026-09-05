using System.Runtime.InteropServices;
using System.Text;

namespace Xplorer.Native.Services;

/// <summary>
/// Tiny startup/crash logger for failures that happen before the WinUI window becomes usable.
/// Xplorer is a WinExe, so unhandled startup exceptions otherwise disappear without useful console
/// output when launched from PowerShell or the Windows Shell.
/// </summary>
public static class CrashLogService
{
    private static readonly object Sync = new();

    public static string LogDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Logs");

    public static string StartupLogPath { get; } = Path.Combine(LogDirectory, "startup.log");

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            var line = $"[{DateTimeOffset.Now:O}] {message}{Environment.NewLine}";
            lock (Sync)
            {
                File.AppendAllText(StartupLogPath, line, Encoding.UTF8);
            }
        }
        catch
        {
            // Diagnostics must never become another reason the file manager cannot start.
        }
    }

    public static void LogException(string stage, Exception exception)
    {
        var builder = new StringBuilder();
        builder.Append(stage);
        builder.Append(": ");

        Exception? current = exception;
        var depth = 0;
        while (current is not null)
        {
            if (depth > 0)
                builder.AppendLine().Append("  Inner: ");

            builder.Append(current.GetType().FullName);
            builder.Append(" HResult=0x");
            builder.Append(unchecked((uint)current.HResult).ToString("X8"));
            builder.Append(": ");
            builder.Append(current.Message);

            current = current.InnerException;
            depth++;
        }

        builder.AppendLine();
        builder.Append(exception);
        Log(builder.ToString());
    }

    public static void ShowFatal(string stage, Exception exception)
    {
        var message = $"Xplorer could not start during {stage}.\n\n{exception.Message}\n\nA diagnostic log was written to:\n{StartupLogPath}";
        try
        {
            _ = MessageBoxW(IntPtr.Zero, message, "Xplorer startup error", 0x00000010u | 0x00000000u);
        }
        catch
        {
            // If user32 itself is unavailable there is nothing else useful to display here.
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}

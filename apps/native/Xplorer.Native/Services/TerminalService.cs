using System.Diagnostics;
using System.Text;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

public static class TerminalService
{
    public static void Open(string workingDirectory, XplorerSettings settings)
    {
        var arguments = new StringBuilder();
        arguments.Append("-d ").Append(Quote(workingDirectory));

        if (!string.IsNullOrWhiteSpace(settings.TerminalCommand))
        {
            arguments.Append(' ').Append(Quote(settings.TerminalCommand));
            if (!string.IsNullOrWhiteSpace(settings.TerminalArguments))
            {
                arguments.Append(' ').Append(settings.TerminalArguments);
            }
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "wt.exe",
            Arguments = arguments.ToString(),
            UseShellExecute = true,
            WorkingDirectory = workingDirectory,
        });
    }

    private static string Quote(string value) =>
        "\"" + value.Replace("\"", "\\\"") + "\"";
}

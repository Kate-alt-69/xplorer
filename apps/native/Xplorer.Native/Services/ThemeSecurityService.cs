using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Gives imported XML bytes to Windows' Antimalware Scan Interface before Xplorer parses or stages
/// them. AMSI routes to the antimalware provider registered on the machine when one participates;
/// Xplorer never launches a vendor-specific executable or assumes Microsoft Defender is installed.
/// </summary>
public static class ThemeSecurityService
{
    private const int MaximumThemeBytes = 64 * 1024;
    private const int AmsiResultDetected = 32768;

    public sealed record ScanResult(bool Performed, bool Clean, string Message);

    public static async Task<ScanResult> ScanFileAsync(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists)
            throw new FileNotFoundException("The selected theme file no longer exists.", path);
        if (info.Length > MaximumThemeBytes)
            throw new InvalidDataException("Xplorer theme files are limited to 64 KiB.");

        var bytes = await File.ReadAllBytesAsync(path).ConfigureAwait(false);
        nint context = 0;
        try
        {
            var initializeHr = AmsiInitialize("Xplorer Theme Import", out context);
            if (initializeHr < 0 || context == 0)
            {
                return new ScanResult(
                    false,
                    true,
                    $"Windows AMSI could not initialize (0x{initializeHr:X8}). Xplorer's strict data-only XML parser will still validate the file.");
            }

            var scanHr = AmsiScanBuffer(
                context,
                bytes,
                (uint)bytes.Length,
                Path.GetFileName(path),
                0,
                out var result);
            if (scanHr < 0)
            {
                return new ScanResult(
                    false,
                    true,
                    $"The local antimalware provider did not complete the AMSI scan (0x{scanHr:X8}).");
            }

            if (result >= AmsiResultDetected)
            {
                return new ScanResult(
                    true,
                    false,
                    "The local antimalware provider flagged this XML file. Xplorer will not import or preview it.");
            }

            return new ScanResult(
                true,
                true,
                "The XML bytes were accepted by the local Windows AMSI antimalware pipeline.");
        }
        catch (DllNotFoundException)
        {
            return new ScanResult(false, true, "Windows AMSI is not available on this system.");
        }
        catch (EntryPointNotFoundException)
        {
            return new ScanResult(false, true, "Windows AMSI is present but its scanning entry points are unavailable.");
        }
        finally
        {
            if (context != 0)
                AmsiUninitialize(context);
        }
    }

    [DllImport("amsi.dll", CharSet = CharSet.Unicode)]
    private static extern int AmsiInitialize(string appName, out nint amsiContext);

    [DllImport("amsi.dll")]
    private static extern void AmsiUninitialize(nint amsiContext);

    [DllImport("amsi.dll", CharSet = CharSet.Unicode)]
    private static extern int AmsiScanBuffer(
        nint amsiContext,
        byte[] buffer,
        uint length,
        string contentName,
        nint session,
        out int result);
}

using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Best-effort process menu theming for Windows 10 1903+ and Windows 11. Shell context menus are
/// intentionally still real HMENUs so third-party handlers, owner-draw items and cascades keep their
/// native behavior; this only asks UxTheme to use the matching light/dark menu palette.
/// </summary>
internal static class NativeMenuThemeService
{
    private const int SetPreferredAppModeOrdinal = 135;
    private const int FlushMenuThemesOrdinal = 136;
    private const int Windows10_1903Build = 18362;

    private static readonly object Gate = new();
    private static PreferredAppMode? _lastMode;
    private static bool _resolved;
    private static SetPreferredAppModeDelegate? _setPreferredAppMode;
    private static FlushMenuThemesDelegate? _flushMenuThemes;

    public static void Apply(bool dark)
    {
        // Build 17763 exported a different function at ordinal 135. Never call it with the newer
        // SetPreferredAppMode signature. 1903+ keeps the modern contract used by Explorer menus.
        if (!OperatingSystem.IsWindows() || Environment.OSVersion.Version.Build < Windows10_1903Build)
            return;

        var mode = dark ? PreferredAppMode.ForceDark : PreferredAppMode.ForceLight;
        lock (Gate)
        {
            ResolveExports();
            if (_setPreferredAppMode is null || _lastMode == mode) return;

            try
            {
                _setPreferredAppMode(mode);
                _flushMenuThemes?.Invoke();
                _lastMode = mode;
            }
            catch
            {
                // Cosmetic integration must never block startup or a context menu.
                _setPreferredAppMode = null;
                _flushMenuThemes = null;
            }
        }
    }

    private static void ResolveExports()
    {
        if (_resolved) return;
        _resolved = true;

        var module = GetModuleHandleW("uxtheme.dll");
        if (module == 0) module = LoadLibraryW("uxtheme.dll");
        if (module == 0) return;

        var setMode = GetProcAddress(module, (nint)SetPreferredAppModeOrdinal);
        if (setMode != 0)
        {
            _setPreferredAppMode = Marshal.GetDelegateForFunctionPointer<SetPreferredAppModeDelegate>(setMode);
        }

        var flush = GetProcAddress(module, (nint)FlushMenuThemesOrdinal);
        if (flush != 0)
        {
            _flushMenuThemes = Marshal.GetDelegateForFunctionPointer<FlushMenuThemesDelegate>(flush);
        }
    }

    private enum PreferredAppMode
    {
        Default = 0,
        AllowDark = 1,
        ForceDark = 2,
        ForceLight = 3,
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate PreferredAppMode SetPreferredAppModeDelegate(PreferredAppMode mode);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate void FlushMenuThemesDelegate();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint GetModuleHandleW(string lpModuleName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint LoadLibraryW(string lpLibFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint GetProcAddress(nint hModule, nint lpProcName);
}

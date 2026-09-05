using System.Runtime.InteropServices;
using Xplorer.Native.Models;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint MonitorDefaultToNearest = 0x0000_0002;
    private const int SwMaximize = 3;
    private const uint SwShowMaximized = 3;
    private const int MinimumWindowWidth = 640;
    private const int MinimumWindowHeight = 420;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeWindowPlacement
    {
        public uint Length;
        public uint Flags;
        public uint ShowCmd;
        public NativePoint MinPosition;
        public NativePoint MaxPosition;
        public NativeRect NormalPosition;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeMonitorInfo
    {
        public uint Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowPlacement(nint window, ref NativeWindowPlacement placement);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        nint window,
        nint insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    private static extern nint MonitorFromRect(ref NativeRect rect, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfoW(nint monitor, ref NativeMonitorInfo info);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint window, int command);

    public void RestoreWindowPlacement()
    {
        var saved = _settingsService.Current.Session.Window;
        if (!saved.HasValue || saved.Width < MinimumWindowWidth || saved.Height < MinimumWindowHeight)
            return;

        var requested = new NativeRect
        {
            Left = saved.X,
            Top = saved.Y,
            Right = saved.X + saved.Width,
            Bottom = saved.Y + saved.Height,
        };
        var monitor = MonitorFromRect(ref requested, MonitorDefaultToNearest);
        if (monitor == 0) return;

        var monitorInfo = new NativeMonitorInfo { Size = (uint)Marshal.SizeOf<NativeMonitorInfo>() };
        if (!GetMonitorInfoW(monitor, ref monitorInfo)) return;

        var work = monitorInfo.Work;
        var workWidth = Math.Max(MinimumWindowWidth, work.Right - work.Left);
        var workHeight = Math.Max(MinimumWindowHeight, work.Bottom - work.Top);
        var width = Math.Clamp(saved.Width, MinimumWindowWidth, workWidth);
        var height = Math.Clamp(saved.Height, MinimumWindowHeight, workHeight);
        var x = Math.Clamp(saved.X, work.Left, Math.Max(work.Left, work.Right - width));
        var y = Math.Clamp(saved.Y, work.Top, Math.Max(work.Top, work.Bottom - height));

        _ = SetWindowPos(_hwnd, 0, x, y, width, height, SwpNoZOrder | SwpNoActivate);
        if (saved.Maximized)
            _ = ShowWindow(_hwnd, SwMaximize);
    }

    private WindowPlacementSettings CaptureWindowPlacement()
    {
        var placement = new NativeWindowPlacement
        {
            Length = (uint)Marshal.SizeOf<NativeWindowPlacement>(),
        };
        if (!GetWindowPlacement(_hwnd, ref placement))
            return _settingsService.Current.Session.Window;

        var normal = placement.NormalPosition;
        var width = normal.Right - normal.Left;
        var height = normal.Bottom - normal.Top;
        if (width < MinimumWindowWidth || height < MinimumWindowHeight)
            return _settingsService.Current.Session.Window;

        return new WindowPlacementSettings
        {
            HasValue = true,
            X = normal.Left,
            Y = normal.Top,
            Width = width,
            Height = height,
            Maximized = placement.ShowCmd == SwShowMaximized,
        };
    }
}

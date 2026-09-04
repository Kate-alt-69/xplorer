using System.Runtime.InteropServices;
using System.Text;

namespace Xplorer.Native.Services;

/// <summary>
/// Reads and writes the same CF_HDROP + Preferred DropEffect clipboard payload used by Explorer.
/// That keeps Copy/Cut interoperable with Windows Explorer instead of creating an Xplorer-only
/// in-memory clipboard.
/// </summary>
public static class ShellClipboardService
{
    private const uint CfHDrop = 15;
    private const uint GmemMoveable = 0x0002;
    private const uint GmemZeroInit = 0x0040;
    private const uint DropEffectCopy = 1;
    private const uint DropEffectMove = 2;
    private const string PreferredDropEffectName = "Preferred DropEffect";

    public static void SetFiles(nint ownerHwnd, IReadOnlyCollection<string> paths, bool move)
    {
        var normalized = paths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (normalized.Length == 0) return;

        var multiString = string.Join('\0', normalized) + "\0\0";
        var pathBytes = Encoding.Unicode.GetBytes(multiString);
        var headerSize = Marshal.SizeOf<DROPFILES>();
        var hDrop = GlobalAlloc(GmemMoveable | GmemZeroInit, (nuint)(headerSize + pathBytes.Length));
        if (hDrop == 0) throw new OutOfMemoryException("Unable to allocate shell clipboard data.");

        var hDropTransferred = false;
        nint dropEffectHandle = 0;
        var dropEffectTransferred = false;
        var opened = false;

        try
        {
            var memory = GlobalLock(hDrop);
            if (memory == 0) throw new InvalidOperationException("Unable to lock shell clipboard data.");
            try
            {
                var header = new DROPFILES
                {
                    pFiles = (uint)headerSize,
                    fWide = 1,
                };
                Marshal.StructureToPtr(header, memory, false);
                Marshal.Copy(pathBytes, 0, memory + headerSize, pathBytes.Length);
            }
            finally
            {
                GlobalUnlock(hDrop);
            }

            if (!OpenClipboard(ownerHwnd))
                throw new InvalidOperationException("Windows clipboard is currently busy.");
            opened = true;

            if (!EmptyClipboard()) throw new InvalidOperationException("Unable to clear the Windows clipboard.");
            if (SetClipboardData(CfHDrop, hDrop) == 0)
                throw new InvalidOperationException("Unable to publish files to the Windows clipboard.");
            hDropTransferred = true;

            var preferredDropEffect = RegisterClipboardFormatW(PreferredDropEffectName);
            if (preferredDropEffect != 0)
            {
                dropEffectHandle = GlobalAlloc(GmemMoveable | GmemZeroInit, sizeof(uint));
                if (dropEffectHandle != 0)
                {
                    var effectMemory = GlobalLock(dropEffectHandle);
                    if (effectMemory != 0)
                    {
                        try
                        {
                            Marshal.WriteInt32(effectMemory, move ? (int)DropEffectMove : (int)DropEffectCopy);
                        }
                        finally
                        {
                            GlobalUnlock(dropEffectHandle);
                        }

                        if (SetClipboardData(preferredDropEffect, dropEffectHandle) != 0)
                            dropEffectTransferred = true;
                    }
                }
            }
        }
        finally
        {
            if (opened) CloseClipboard();
            if (!hDropTransferred && hDrop != 0) GlobalFree(hDrop);
            if (!dropEffectTransferred && dropEffectHandle != 0) GlobalFree(dropEffectHandle);
        }
    }

    public static ShellClipboardFiles? TryGetFiles(nint ownerHwnd)
    {
        var opened = false;
        try
        {
            if (!OpenClipboard(ownerHwnd)) return null;
            opened = true;
            if (!IsClipboardFormatAvailable(CfHDrop)) return null;

            var hDrop = GetClipboardData(CfHDrop);
            if (hDrop == 0) return null;

            var count = DragQueryFileW(hDrop, uint.MaxValue, null, 0);
            if (count == 0) return null;

            var paths = new List<string>((int)count);
            for (uint index = 0; index < count; index++)
            {
                var length = DragQueryFileW(hDrop, index, null, 0);
                var buffer = new StringBuilder((int)length + 1);
                if (DragQueryFileW(hDrop, index, buffer, (uint)buffer.Capacity) > 0)
                    paths.Add(buffer.ToString());
            }

            if (paths.Count == 0) return null;

            var move = false;
            var preferredDropEffect = RegisterClipboardFormatW(PreferredDropEffectName);
            if (preferredDropEffect != 0 && IsClipboardFormatAvailable(preferredDropEffect))
            {
                var effectHandle = GetClipboardData(preferredDropEffect);
                if (effectHandle != 0)
                {
                    var effectMemory = GlobalLock(effectHandle);
                    if (effectMemory != 0)
                    {
                        try
                        {
                            var effect = unchecked((uint)Marshal.ReadInt32(effectMemory));
                            move = (effect & DropEffectMove) != 0;
                        }
                        finally
                        {
                            GlobalUnlock(effectHandle);
                        }
                    }
                }
            }

            return new ShellClipboardFiles(paths, move);
        }
        finally
        {
            if (opened) CloseClipboard();
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DROPFILES
    {
        public uint pFiles;
        public POINT pt;
        public int fNC;
        public int fWide;
    }

    [DllImport("user32.dll")]
    private static extern bool OpenClipboard(nint hWndNewOwner);

    [DllImport("user32.dll")]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll")]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll")]
    private static extern nint SetClipboardData(uint uFormat, nint hMem);

    [DllImport("user32.dll")]
    private static extern nint GetClipboardData(uint uFormat);

    [DllImport("user32.dll")]
    private static extern bool IsClipboardFormatAvailable(uint format);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterClipboardFormatW(string lpszFormat);

    [DllImport("kernel32.dll")]
    private static extern nint GlobalAlloc(uint uFlags, nuint dwBytes);

    [DllImport("kernel32.dll")]
    private static extern nint GlobalLock(nint hMem);

    [DllImport("kernel32.dll")]
    private static extern bool GlobalUnlock(nint hMem);

    [DllImport("kernel32.dll")]
    private static extern nint GlobalFree(nint hMem);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint DragQueryFileW(nint hDrop, uint iFile, StringBuilder? lpszFile, uint cch);
}

public sealed record ShellClipboardFiles(IReadOnlyList<string> Paths, bool Move);

using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Hosts the Windows Shell's own item context menu instead of recreating it in XAML.
/// This gives files/folders their registered Windows verbs and third-party shell entries.
/// </summary>
public sealed class ShellContextMenuService
{
    private const uint CmfNormal = 0x00000000;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmReturnCmd = 0x0100;
    private static readonly Guid IidShellFolder = new("000214E6-0000-0000-C000-000000000046");
    private static readonly Guid IidContextMenu = new("000214E4-0000-0000-C000-000000000046");

    public void ShowForPath(nint ownerHwnd, string path)
    {
        nint absolutePidl = 0;
        nint shellFolderPtr = 0;
        nint contextMenuPtr = 0;
        nint menu = 0;
        IShellFolder? shellFolder = null;
        IContextMenu? contextMenu = null;

        try
        {
            Marshal.ThrowExceptionForHR(SHParseDisplayName(path, 0, out absolutePidl, 0, out _));

            var shellFolderIid = IidShellFolder;
            Marshal.ThrowExceptionForHR(
                SHBindToParent(absolutePidl, ref shellFolderIid, out shellFolderPtr, out var childPidl));

            shellFolder = (IShellFolder)Marshal.GetObjectForIUnknown(shellFolderPtr);
            var children = new[] { childPidl };
            var contextMenuIid = IidContextMenu;
            Marshal.ThrowExceptionForHR(
                shellFolder.GetUIObjectOf(ownerHwnd, 1, children, ref contextMenuIid, 0, out contextMenuPtr));

            contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(contextMenuPtr);
            menu = CreatePopupMenu();
            if (menu == 0) return;

            Marshal.ThrowExceptionForHR(contextMenu.QueryContextMenu(menu, 0, 1, 0x7FFF, CmfNormal));
            if (!GetCursorPos(out var point)) return;

            SetForegroundWindow(ownerHwnd);
            var command = TrackPopupMenuEx(
                menu,
                TpmRightButton | TpmReturnCmd,
                point.X,
                point.Y,
                ownerHwnd,
                0);

            if (command == 0) return;

            var invoke = new CMINVOKECOMMANDINFO
            {
                cbSize = Marshal.SizeOf<CMINVOKECOMMANDINFO>(),
                hwnd = ownerHwnd,
                lpVerb = (nint)(command - 1),
                nShow = 1,
            };

            var invokePtr = Marshal.AllocHGlobal(invoke.cbSize);
            try
            {
                Marshal.StructureToPtr(invoke, invokePtr, false);
                Marshal.ThrowExceptionForHR(contextMenu.InvokeCommand(invokePtr));
            }
            finally
            {
                Marshal.FreeHGlobal(invokePtr);
            }
        }
        finally
        {
            if (menu != 0) DestroyMenu(menu);
            if (contextMenu is not null) Marshal.FinalReleaseComObject(contextMenu);
            if (shellFolder is not null) Marshal.FinalReleaseComObject(shellFolder);
            if (contextMenuPtr != 0) Marshal.Release(contextMenuPtr);
            if (shellFolderPtr != 0) Marshal.Release(shellFolderPtr);
            if (absolutePidl != 0) CoTaskMemFree(absolutePidl);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CMINVOKECOMMANDINFO
    {
        public int cbSize;
        public uint fMask;
        public nint hwnd;
        public nint lpVerb;
        public nint lpParameters;
        public nint lpDirectory;
        public int nShow;
        public uint dwHotKey;
        public nint hIcon;
    }

    [ComImport]
    [Guid("000214E6-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellFolder
    {
        [PreserveSig] int ParseDisplayName(nint hwnd, nint pbc, nint pszDisplayName, nint pchEaten, nint ppidl, nint pdwAttributes);
        [PreserveSig] int EnumObjects(nint hwnd, uint grfFlags, out nint ppenumIDList);
        [PreserveSig] int BindToObject(nint pidl, nint pbc, ref Guid riid, out nint ppv);
        [PreserveSig] int BindToStorage(nint pidl, nint pbc, ref Guid riid, out nint ppv);
        [PreserveSig] int CompareIDs(nint lParam, nint pidl1, nint pidl2);
        [PreserveSig] int CreateViewObject(nint hwndOwner, ref Guid riid, out nint ppv);
        [PreserveSig] int GetAttributesOf(uint cidl, nint apidl, ref uint rgfInOut);
        [PreserveSig]
        int GetUIObjectOf(
            nint hwndOwner,
            uint cidl,
            [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] nint[] apidl,
            ref Guid riid,
            nint rgfReserved,
            out nint ppv);
        [PreserveSig] int GetDisplayNameOf(nint pidl, uint uFlags, nint pName);
        [PreserveSig] int SetNameOf(nint hwnd, nint pidl, nint pszName, uint uFlags, out nint ppidlOut);
    }

    [ComImport]
    [Guid("000214E4-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(nint hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
        [PreserveSig] int InvokeCommand(nint pici);
        [PreserveSig] int GetCommandString(nuint idCmd, uint uType, nint pReserved, nint pszName, uint cchMax);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHParseDisplayName(
        string pszName,
        nint pbc,
        out nint ppidl,
        uint sfgaoIn,
        out uint psfgaoOut);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHBindToParent(
        nint pidl,
        ref Guid riid,
        out nint ppv,
        out nint ppidlLast);

    [DllImport("user32.dll")]
    private static extern nint CreatePopupMenu();

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(nint hMenu);

    [DllImport("user32.dll")]
    private static extern uint TrackPopupMenuEx(
        nint hmenu,
        uint fuFlags,
        int x,
        int y,
        nint hwnd,
        nint lptpm);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(nint pv);
}

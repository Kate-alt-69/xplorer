using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Live Windows Shell folder-background menu used by the normal/Double-RMB gesture. Xplorer owns
/// only View/Sort/Refresh; every other verb remains on the real IContextMenu so lazy registry
/// cascades and owner-drawn extensions continue to receive their native menu messages.
/// </summary>
internal sealed class ExplorerBackgroundShellMenuService : IDisposable
{
    private const uint CmfNormal = 0x00000000;
    private const uint CmfExtendedVerbs = 0x00000100;
    private const uint MfString = 0x0000;
    private const uint MfChecked = 0x0008;
    private const uint MfPopup = 0x0010;
    private const uint MfSeparator = 0x0800;
    private const uint TpmReturnCmd = 0x0100;
    private const uint WmDrawItem = 0x002B;
    private const uint WmMeasureItem = 0x002C;
    private const uint WmInitMenuPopup = 0x0117;
    private const uint WmMenuChar = 0x0120;
    private const uint WmNull = 0x0000;
    private const uint ShellCommandFirst = 0x1000;
    private const uint ShellCommandLast = 0x7FFF;
    private const int VkShift = 0x10;
    private const int S_OK = 0;
    private const nuint SubclassId = 0x58504C42; // XPLB

    private const uint CmdViewLarge = 1;
    private const uint CmdViewMedium = 2;
    private const uint CmdViewDetails = 3;
    private const uint CmdSortName = 10;
    private const uint CmdSortDate = 11;
    private const uint CmdSortType = 12;
    private const uint CmdSortSize = 13;
    private const uint CmdRefresh = 20;

    private static readonly Guid IidShellFolder = new("000214E6-0000-0000-C000-000000000046");
    private static readonly Guid IidContextMenu = new("000214E4-0000-0000-C000-000000000046");

    private readonly SubclassProc _subclassProc;
    private IContextMenu2? _activeContextMenu2;
    private IContextMenu3? _activeContextMenu3;
    private nint _subclassHwnd;
    private bool _disposed;

    public ExplorerBackgroundShellMenuService()
    {
        _subclassProc = WindowSubclassProc;
    }

    public BackgroundMenuCommand Show(
        nint ownerHwnd,
        string folderPath,
        string viewMode,
        string sortMode,
        bool forceExtendedVerbs)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        nint absolutePidl = 0;
        nint desktopPtr = 0;
        nint folderPtr = 0;
        nint contextMenuPtr = 0;
        nint menu = 0;
        IShellFolder? desktop = null;
        IShellFolder? folder = null;
        IContextMenu? contextMenu = null;

        try
        {
            Marshal.ThrowExceptionForHR(
                SHParseDisplayName(Path.GetFullPath(folderPath), 0, out absolutePidl, 0, out _));
            Marshal.ThrowExceptionForHR(SHGetDesktopFolder(out desktopPtr));
            desktop = (IShellFolder)Marshal.GetObjectForIUnknown(desktopPtr);

            var folderIid = IidShellFolder;
            Marshal.ThrowExceptionForHR(
                desktop.BindToObject(absolutePidl, 0, ref folderIid, out folderPtr));
            folder = (IShellFolder)Marshal.GetObjectForIUnknown(folderPtr);

            var contextMenuIid = IidContextMenu;
            var createViewHr = folder.CreateViewObject(ownerHwnd, ref contextMenuIid, out contextMenuPtr);
            if (createViewHr >= 0 && contextMenuPtr != 0)
                contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(contextMenuPtr);

            menu = CreatePopupMenu();
            if (menu == 0) return BackgroundMenuCommand.None;

            BuildXplorerCommands(menu, viewMode, sortMode);

            if (contextMenu is not null)
            {
                var flags = CmfNormal;
                if (forceExtendedVerbs || (GetKeyState(VkShift) & 0x8000) != 0)
                    flags |= CmfExtendedVerbs;

                var insertAt = (uint)Math.Max(0, GetMenuItemCount(menu));
                Marshal.ThrowExceptionForHR(
                    contextMenu.QueryContextMenu(
                        menu,
                        insertAt,
                        ShellCommandFirst,
                        ShellCommandLast,
                        flags));
            }

            var command = TrackNativeMenu(ownerHwnd, menu, contextMenu);
            if (command == 0) return BackgroundMenuCommand.None;

            if (command >= ShellCommandFirst && command <= ShellCommandLast && contextMenu is not null)
            {
                InvokeShellCommand(contextMenu, ownerHwnd, command - ShellCommandFirst);
                return BackgroundMenuCommand.ShellCommand;
            }

            return command switch
            {
                CmdViewLarge => BackgroundMenuCommand.ViewLarge,
                CmdViewMedium => BackgroundMenuCommand.ViewMedium,
                CmdViewDetails => BackgroundMenuCommand.ViewDetails,
                CmdSortName => BackgroundMenuCommand.SortName,
                CmdSortDate => BackgroundMenuCommand.SortDateModified,
                CmdSortType => BackgroundMenuCommand.SortType,
                CmdSortSize => BackgroundMenuCommand.SortSize,
                CmdRefresh => BackgroundMenuCommand.Refresh,
                _ => BackgroundMenuCommand.None,
            };
        }
        finally
        {
            EndMessageForwarding();
            if (menu != 0) DestroyMenu(menu);
            if (contextMenu is not null) Marshal.FinalReleaseComObject(contextMenu);
            if (folder is not null) Marshal.FinalReleaseComObject(folder);
            if (desktop is not null) Marshal.FinalReleaseComObject(desktop);
            if (contextMenuPtr != 0) Marshal.Release(contextMenuPtr);
            if (folderPtr != 0) Marshal.Release(folderPtr);
            if (desktopPtr != 0) Marshal.Release(desktopPtr);
            if (absolutePidl != 0) CoTaskMemFree(absolutePidl);
        }
    }

    private static void BuildXplorerCommands(nint menu, string viewMode, string sortMode)
    {
        var view = CreatePopupMenu();
        if (view != 0)
        {
            AppendMenuW(view, MfString | Checked(viewMode, "Large"), CmdViewLarge, "Large icons");
            AppendMenuW(view, MfString | Checked(viewMode, "Medium"), CmdViewMedium, "Medium icons");
            AppendMenuW(view, MfString | Checked(viewMode, "Details"), CmdViewDetails, "Details");
            AppendMenuW(menu, MfPopup, (nuint)view, "View");
        }

        var sort = CreatePopupMenu();
        if (sort != 0)
        {
            AppendMenuW(sort, MfString | Checked(sortMode, "Name"), CmdSortName, "Name");
            AppendMenuW(sort, MfString | Checked(sortMode, "Date modified"), CmdSortDate, "Date modified");
            AppendMenuW(sort, MfString | Checked(sortMode, "Type"), CmdSortType, "Type");
            AppendMenuW(sort, MfString | Checked(sortMode, "Size"), CmdSortSize, "Size");
            AppendMenuW(menu, MfPopup, (nuint)sort, "Sort by");
        }

        AppendMenuW(menu, MfString, CmdRefresh, "Refresh");
        AppendMenuW(menu, MfSeparator, 0, null);
    }

    private static uint Checked(string actual, string expected) =>
        string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase) ? MfChecked : 0;

    private uint TrackNativeMenu(nint ownerHwnd, nint menu, IContextMenu? contextMenu)
    {
        if (!GetCursorPos(out var point)) return 0;

        BeginMessageForwarding(ownerHwnd, contextMenu);
        SetForegroundWindow(ownerHwnd);
        var command = TrackPopupMenuEx(
            menu,
            TpmReturnCmd,
            point.X,
            point.Y,
            ownerHwnd,
            0);

        // Do not opt into TPM_RIGHTBUTTON: RMB opens/dismisses; LMB activates commands, matching the
        // item-menu behavior and the user's expected Explorer interaction model.
        PostMessageW(ownerHwnd, WmNull, 0, 0);
        return command;
    }

    private void BeginMessageForwarding(nint ownerHwnd, IContextMenu? contextMenu)
    {
        EndMessageForwarding();
        if (contextMenu is null) return;

        _activeContextMenu3 = contextMenu as IContextMenu3;
        _activeContextMenu2 = _activeContextMenu3 ?? contextMenu as IContextMenu2;
        if (_activeContextMenu2 is null) return;

        if (SetWindowSubclass(ownerHwnd, _subclassProc, SubclassId, 0))
            _subclassHwnd = ownerHwnd;
    }

    private void EndMessageForwarding()
    {
        if (_subclassHwnd != 0)
        {
            RemoveWindowSubclass(_subclassHwnd, _subclassProc, SubclassId);
            _subclassHwnd = 0;
        }
        _activeContextMenu3 = null;
        _activeContextMenu2 = null;
    }

    private nint WindowSubclassProc(
        nint hWnd,
        uint message,
        nuint wParam,
        nint lParam,
        nuint subclassId,
        nuint refData)
    {
        if (message is WmInitMenuPopup or WmDrawItem or WmMeasureItem or WmMenuChar)
        {
            if (_activeContextMenu3 is not null)
            {
                var hr = _activeContextMenu3.HandleMenuMsg2(message, (nint)wParam, lParam, out var result);
                if (hr == S_OK) return result;

                if (message != WmMenuChar && _activeContextMenu2 is not null)
                {
                    var fallbackHr = _activeContextMenu2.HandleMenuMsg(message, (nint)wParam, lParam);
                    if (fallbackHr == S_OK) return 0;
                }
            }
            else if (_activeContextMenu2 is not null)
            {
                var hr = _activeContextMenu2.HandleMenuMsg(message, (nint)wParam, lParam);
                if (hr == S_OK) return 0;
            }
        }

        return DefSubclassProc(hWnd, message, wParam, lParam);
    }

    private static void InvokeShellCommand(IContextMenu contextMenu, nint ownerHwnd, uint commandOffset)
    {
        var invoke = new CMINVOKECOMMANDINFO
        {
            cbSize = Marshal.SizeOf<CMINVOKECOMMANDINFO>(),
            hwnd = ownerHwnd,
            lpVerb = (nint)commandOffset,
            nShow = 1,
        };

        var ptr = Marshal.AllocHGlobal(invoke.cbSize);
        try
        {
            Marshal.StructureToPtr(invoke, ptr, false);
            Marshal.ThrowExceptionForHR(contextMenu.InvokeCommand(ptr));
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        EndMessageForwarding();
        GC.SuppressFinalize(this);
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

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate nint SubclassProc(
        nint hWnd,
        uint message,
        nuint wParam,
        nint lParam,
        nuint subclassId,
        nuint refData);

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
        [PreserveSig] int GetUIObjectOf(nint hwndOwner, uint cidl, nint apidl, ref Guid riid, nint reserved, out nint ppv);
        [PreserveSig] int GetDisplayNameOf(nint pidl, uint flags, nint name);
        [PreserveSig] int SetNameOf(nint hwnd, nint pidl, nint name, uint flags, out nint ppidlOut);
    }

    [ComImport]
    [Guid("000214E4-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(nint hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint flags);
        [PreserveSig] int InvokeCommand(nint commandInfo);
        [PreserveSig] int GetCommandString(nuint idCmd, uint type, nint reserved, nint name, uint maxChars);
    }

    [ComImport]
    [Guid("000214F4-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu2 : IContextMenu
    {
        [PreserveSig] int HandleMenuMsg(uint message, nint wParam, nint lParam);
    }

    [ComImport]
    [Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu3 : IContextMenu2
    {
        [PreserveSig] int HandleMenuMsg2(uint message, nint wParam, nint lParam, out nint result);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHParseDisplayName(string name, nint bindContext, out nint pidl, uint attributesIn, out uint attributesOut);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHGetDesktopFolder(out nint shellFolder);

    [DllImport("user32.dll")]
    private static extern nint CreatePopupMenu();

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(nint menu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(nint menu, uint flags, nuint newItem, string? text);

    [DllImport("user32.dll")]
    private static extern int GetMenuItemCount(nint menu);

    [DllImport("user32.dll")]
    private static extern uint TrackPopupMenuEx(nint menu, uint flags, int x, int y, nint owner, nint parameters);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint window);

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int key);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool PostMessageW(nint window, uint message, nuint wParam, nint lParam);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(nint window, SubclassProc callback, nuint id, nuint data);

    [DllImport("comctl32.dll")]
    private static extern bool RemoveWindowSubclass(nint window, SubclassProc callback, nuint id);

    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(nint memory);
}

using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Hosts the Windows Shell's own context menus. Dynamic/owner-drawn shell extensions are
/// supported by forwarding menu messages to IContextMenu2/IContextMenu3 while the popup is open.
/// </summary>
public sealed class ShellContextMenuService
{
    private const uint CmfNormal = 0x00000000;
    private const uint TpmRightButton = 0x0002;
    private const uint TpmReturnCmd = 0x0100;
    private const uint MfString = 0x0000;
    private const uint MfChecked = 0x0008;
    private const uint MfPopup = 0x0010;
    private const uint MfSeparator = 0x0800;
    private const uint WmDrawItem = 0x002B;
    private const uint WmMeasureItem = 0x002C;
    private const uint WmInitMenuPopup = 0x0117;
    private const uint WmMenuChar = 0x0120;
    private const uint WmNull = 0x0000;
    private const uint ShellCommandFirst = 0x1000;
    private const uint ShellCommandLast = 0x7FFF;
    private const nuint SubclassId = 0x58504C52; // "XPLR"

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

    public ShellContextMenuService()
    {
        _subclassProc = WindowSubclassProc;
    }

    public void ShowForPath(nint ownerHwnd, string path) => ShowForPaths(ownerHwnd, [path]);

    /// <summary>
    /// Shows one Windows Shell context menu for the entire selection, just like Explorer. Shell
    /// extensions therefore receive every selected child PIDL instead of only the item that was
    /// right-clicked. Selections must share a parent folder, which is naturally true for one file view.
    /// </summary>
    public void ShowForPaths(nint ownerHwnd, IReadOnlyCollection<string> paths)
    {
        var normalized = paths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (normalized.Length == 0) return;

        var firstParent = Path.GetDirectoryName(normalized[0]);
        if (firstParent is null || normalized.Any(path =>
                !string.Equals(Path.GetDirectoryName(path), firstParent, StringComparison.OrdinalIgnoreCase)))
        {
            // A shell IContextMenu selection belongs to one parent IShellFolder. A normal Xplorer
            // selection can never cross folders, but fail safely if a caller ever supplies one.
            normalized = [normalized[0]];
        }

        var absolutePidls = new List<nint>(normalized.Length);
        var childPidls = new nint[normalized.Length];
        nint shellFolderPtr = 0;
        nint contextMenuPtr = 0;
        nint menu = 0;
        IShellFolder? shellFolder = null;
        IContextMenu? contextMenu = null;

        try
        {
            for (var index = 0; index < normalized.Length; index++)
            {
                Marshal.ThrowExceptionForHR(
                    SHParseDisplayName(normalized[index], 0, out var absolutePidl, 0, out _));
                absolutePidls.Add(absolutePidl);

                var shellFolderIid = IidShellFolder;
                var bindHr = SHBindToParent(
                    absolutePidl,
                    ref shellFolderIid,
                    out var boundFolderPtr,
                    out var childPidl);
                if (bindHr < 0)
                {
                    if (boundFolderPtr != 0) Marshal.Release(boundFolderPtr);
                    Marshal.ThrowExceptionForHR(bindHr);
                }

                childPidls[index] = childPidl;
                if (index == 0)
                {
                    shellFolderPtr = boundFolderPtr;
                    shellFolder = (IShellFolder)Marshal.GetObjectForIUnknown(shellFolderPtr);
                }
                else if (boundFolderPtr != 0)
                {
                    // Only the first parent interface is required. The relative child PIDL remains
                    // valid because its containing absolute PIDL stays allocated until menu cleanup.
                    Marshal.Release(boundFolderPtr);
                }
            }

            if (shellFolder is null) return;

            var contextMenuIid = IidContextMenu;
            Marshal.ThrowExceptionForHR(
                shellFolder.GetUIObjectOf(
                    ownerHwnd,
                    (uint)childPidls.Length,
                    childPidls,
                    ref contextMenuIid,
                    0,
                    out contextMenuPtr));

            contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(contextMenuPtr);
            menu = CreatePopupMenu();
            if (menu == 0) return;

            Marshal.ThrowExceptionForHR(
                contextMenu.QueryContextMenu(menu, 0, ShellCommandFirst, ShellCommandLast, CmfNormal));

            var command = TrackNativeMenu(ownerHwnd, menu, contextMenu);
            if (command < ShellCommandFirst || command > ShellCommandLast) return;

            InvokeShellCommand(contextMenu, ownerHwnd, command - ShellCommandFirst);
        }
        finally
        {
            EndMessageForwarding();
            if (menu != 0) DestroyMenu(menu);
            if (contextMenu is not null) Marshal.FinalReleaseComObject(contextMenu);
            if (shellFolder is not null) Marshal.FinalReleaseComObject(shellFolder);
            if (contextMenuPtr != 0) Marshal.Release(contextMenuPtr);
            if (shellFolderPtr != 0) Marshal.Release(shellFolderPtr);
            foreach (var absolutePidl in absolutePidls)
            {
                if (absolutePidl != 0) CoTaskMemFree(absolutePidl);
            }
        }
    }

    /// <summary>
    /// Shows a folder-background menu. Xplorer owns View/Sort/Refresh because those are view
    /// operations, while Windows owns the remaining folder-background verbs and extension items.
    /// </summary>
    public BackgroundMenuCommand ShowForBackground(
        nint ownerHwnd,
        string folderPath,
        string viewMode,
        string sortMode)
    {
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
                SHParseDisplayName(folderPath, 0, out absolutePidl, 0, out _));
            Marshal.ThrowExceptionForHR(SHGetDesktopFolder(out desktopPtr));
            desktop = (IShellFolder)Marshal.GetObjectForIUnknown(desktopPtr);

            var folderIid = IidShellFolder;
            Marshal.ThrowExceptionForHR(
                desktop.BindToObject(absolutePidl, 0, ref folderIid, out folderPtr));
            folder = (IShellFolder)Marshal.GetObjectForIUnknown(folderPtr);

            var contextMenuIid = IidContextMenu;
            var createViewHr = folder.CreateViewObject(ownerHwnd, ref contextMenuIid, out contextMenuPtr);
            if (createViewHr >= 0 && contextMenuPtr != 0)
            {
                contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(contextMenuPtr);
            }

            menu = CreatePopupMenu();
            if (menu == 0) return BackgroundMenuCommand.None;

            BuildViewCommands(menu, viewMode, sortMode);

            if (contextMenu is not null)
            {
                var insertAt = (uint)Math.Max(0, GetMenuItemCount(menu));
                Marshal.ThrowExceptionForHR(
                    contextMenu.QueryContextMenu(
                        menu,
                        insertAt,
                        ShellCommandFirst,
                        ShellCommandLast,
                        CmfNormal));
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

    private static void BuildViewCommands(nint menu, string viewMode, string sortMode)
    {
        var viewMenu = CreatePopupMenu();
        if (viewMenu != 0)
        {
            AppendMenuW(viewMenu, MfString | Checked(viewMode, "Large"), CmdViewLarge, "Large icons");
            AppendMenuW(viewMenu, MfString | Checked(viewMode, "Medium"), CmdViewMedium, "Medium icons");
            AppendMenuW(viewMenu, MfString | Checked(viewMode, "Details"), CmdViewDetails, "Details");
            AppendMenuW(menu, MfPopup, (nuint)viewMenu, "View");
        }

        var sortMenu = CreatePopupMenu();
        if (sortMenu != 0)
        {
            AppendMenuW(sortMenu, MfString | Checked(sortMode, "Name"), CmdSortName, "Name");
            AppendMenuW(sortMenu, MfString | Checked(sortMode, "Date modified"), CmdSortDate, "Date modified");
            AppendMenuW(sortMenu, MfString | Checked(sortMode, "Type"), CmdSortType, "Type");
            AppendMenuW(sortMenu, MfString | Checked(sortMode, "Size"), CmdSortSize, "Size");
            AppendMenuW(menu, MfPopup, (nuint)sortMenu, "Sort by");
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
            TpmRightButton | TpmReturnCmd,
            point.X,
            point.Y,
            ownerHwnd,
            0);

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
        {
            _subclassHwnd = ownerHwnd;
        }
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
        if (IsShellMenuMessage(message))
        {
            if (_activeContextMenu3 is not null)
            {
                var hr = _activeContextMenu3.HandleMenuMsg2(
                    message,
                    (nint)wParam,
                    lParam,
                    out var result);
                if (hr >= 0) return result;
            }
            else if (_activeContextMenu2 is not null)
            {
                var hr = _activeContextMenu2.HandleMenuMsg(message, (nint)wParam, lParam);
                if (hr >= 0) return 0;
            }
        }

        return DefSubclassProc(hWnd, message, wParam, lParam);
    }

    private static bool IsShellMenuMessage(uint message) =>
        message is WmInitMenuPopup or WmDrawItem or WmMeasureItem or WmMenuChar;

    private static void InvokeShellCommand(IContextMenu contextMenu, nint ownerHwnd, uint commandOffset)
    {
        var invoke = new CMINVOKECOMMANDINFO
        {
            cbSize = Marshal.SizeOf<CMINVOKECOMMANDINFO>(),
            hwnd = ownerHwnd,
            lpVerb = (nint)commandOffset,
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

    [ComImport]
    [Guid("000214F4-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu2 : IContextMenu
    {
        [PreserveSig] int HandleMenuMsg(uint uMsg, nint wParam, nint lParam);
    }

    [ComImport]
    [Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu3 : IContextMenu2
    {
        [PreserveSig] int HandleMenuMsg2(uint uMsg, nint wParam, nint lParam, out nint plResult);
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

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHGetDesktopFolder(out nint ppshf);

    [DllImport("user32.dll")]
    private static extern nint CreatePopupMenu();

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(nint hMenu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(nint hMenu, uint uFlags, nuint uIDNewItem, string? lpNewItem);

    [DllImport("user32.dll")]
    private static extern int GetMenuItemCount(nint hMenu);

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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool PostMessageW(nint hWnd, uint msg, nuint wParam, nint lParam);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(
        nint hWnd,
        SubclassProc pfnSubclass,
        nuint uIdSubclass,
        nuint dwRefData);

    [DllImport("comctl32.dll")]
    private static extern bool RemoveWindowSubclass(
        nint hWnd,
        SubclassProc pfnSubclass,
        nuint uIdSubclass);

    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint hWnd, uint uMsg, nuint wParam, nint lParam);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(nint pv);
}

public enum BackgroundMenuCommand
{
    None,
    ShellCommand,
    ViewLarge,
    ViewMedium,
    ViewDetails,
    SortName,
    SortDateModified,
    SortType,
    SortSize,
    Refresh,
}

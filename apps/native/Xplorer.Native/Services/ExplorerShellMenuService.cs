using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Compatibility-first host for item context menus. Unlike the metadata snapshot cache this keeps
/// the Shell's live IContextMenu/IContextMenu2/IContextMenu3 object attached for the entire popup
/// lifetime, asks the Shell to synchronously materialize cascades, and advertises the item-view and
/// rename capabilities that Xplorer actually provides.
/// </summary>
internal sealed class ExplorerShellMenuService : IDisposable
{
    private const uint CmfExplore = 0x00000004;
    private const uint CmfCanRename = 0x00000010;
    private const uint CmfItemMenu = 0x00000080;
    private const uint CmfExtendedVerbs = 0x00000100;
    private const uint CmfSyncCascadeMenu = 0x00001000;

    private const uint TpmRightButton = 0x0002;
    private const uint TpmReturnCmd = 0x0100;
    private const uint WmDrawItem = 0x002B;
    private const uint WmMeasureItem = 0x002C;
    private const uint WmInitMenuPopup = 0x0117;
    private const uint WmMenuChar = 0x0120;
    private const uint WmNull = 0x0000;
    private const uint ShellCommandFirst = 0x1000;
    private const uint ShellCommandLast = 0x7FFF;
    private const int VkShift = 0x10;
    private const nuint SubclassId = 0x58504C4D; // "XPLM"

    private static readonly Guid IidShellFolder = new("000214E6-0000-0000-C000-000000000046");
    private static readonly Guid IidContextMenu = new("000214E4-0000-0000-C000-000000000046");

    private readonly SubclassProc _subclassProc;
    private IContextMenu2? _activeContextMenu2;
    private IContextMenu3? _activeContextMenu3;
    private nint _subclassHwnd;
    private bool _disposed;

    public ExplorerShellMenuService()
    {
        _subclassProc = WindowSubclassProc;
    }

    public ShellMenuShowResult ShowForPaths(nint ownerHwnd, IReadOnlyCollection<string> paths)
    {
        ThrowIfDisposed();
        var normalized = NormalizeSelection(paths);
        if (normalized.Length == 0) return ShellMenuShowResult.Cancelled;

        using var shell = CreateSelectionContext(ownerHwnd, normalized);
        var menu = CreatePopupMenu();
        if (menu == 0) return ShellMenuShowResult.Cancelled;

        try
        {
            var queryFlags = CmfCanRename | CmfItemMenu | CmfSyncCascadeMenu;

            // Explorer exposes extra shell verbs only for Shift+RMB. Preserve that contract instead
            // of permanently flooding the normal menu with extended commands.
            if ((GetKeyState(VkShift) & 0x8000) != 0)
                queryFlags |= CmfExtendedVerbs;

            // CMF_EXPLORE is intentionally included for compatibility with older namespace/context
            // handlers that key their Explorer-specific verbs off this flag. Xplorer is acting as a
            // file-system browser here and supports the corresponding navigation/rename semantics.
            queryFlags |= CmfExplore;

            Marshal.ThrowExceptionForHR(
                shell.ContextMenu.QueryContextMenu(
                    menu,
                    0,
                    ShellCommandFirst,
                    ShellCommandLast,
                    queryFlags));

            var command = TrackNativeMenu(ownerHwnd, menu, shell.ContextMenu);
            if (command < ShellCommandFirst || command > ShellCommandLast)
                return ShellMenuShowResult.Cancelled;

            InvokeShellCommand(shell.ContextMenu, ownerHwnd, command - ShellCommandFirst);
            return ShellMenuShowResult.Invoked;
        }
        finally
        {
            EndMessageForwarding();
            DestroyMenu(menu);
        }
    }

    private static string[] NormalizeSelection(IReadOnlyCollection<string> paths)
    {
        var normalized = paths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (normalized.Length == 0) return normalized;

        var firstParent = Path.GetDirectoryName(normalized[0]);
        if (firstParent is null || normalized.Any(path =>
                !string.Equals(Path.GetDirectoryName(path), firstParent, StringComparison.OrdinalIgnoreCase)))
        {
            // Windows obtains one parent IShellFolder for a multi-selection. If a synthetic caller
            // ever hands us paths from different parents, fail soft to the exact clicked item rather
            // than building an invalid PIDL array.
            return [normalized[0]];
        }

        return normalized;
    }

    private static SelectionShellContext CreateSelectionContext(nint ownerHwnd, string[] normalized)
    {
        var absolutePidls = new List<nint>(normalized.Length);
        var childPidls = new nint[normalized.Length];
        nint shellFolderPtr = 0;
        nint contextMenuPtr = 0;
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
                    Marshal.Release(boundFolderPtr);
                }
            }

            if (shellFolder is null)
                throw new InvalidOperationException("Could not resolve the Shell parent folder.");

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

            return new SelectionShellContext(
                absolutePidls,
                shellFolderPtr,
                contextMenuPtr,
                shellFolder,
                contextMenu);
        }
        catch
        {
            if (contextMenu is not null) Marshal.FinalReleaseComObject(contextMenu);
            if (shellFolder is not null) Marshal.FinalReleaseComObject(shellFolder);
            if (contextMenuPtr != 0) Marshal.Release(contextMenuPtr);
            if (shellFolderPtr != 0) Marshal.Release(shellFolderPtr);
            foreach (var pidl in absolutePidls)
                if (pidl != 0) CoTaskMemFree(pidl);
            throw;
        }
    }

    private uint TrackNativeMenu(nint ownerHwnd, nint menu, IContextMenu contextMenu)
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

        // Required by the documented TrackPopupMenu owner-window pattern so the popup reliably
        // dismisses and focus returns to the foreground window.
        PostMessageW(ownerHwnd, WmNull, 0, 0);
        return command;
    }

    private void BeginMessageForwarding(nint ownerHwnd, IContextMenu contextMenu)
    {
        EndMessageForwarding();

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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        EndMessageForwarding();
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ExplorerShellMenuService));
    }

    private sealed class SelectionShellContext : IDisposable
    {
        private readonly List<nint> _absolutePidls;
        private readonly nint _shellFolderPtr;
        private readonly nint _contextMenuPtr;
        private readonly IShellFolder _shellFolder;
        public IContextMenu ContextMenu { get; }

        public SelectionShellContext(
            List<nint> absolutePidls,
            nint shellFolderPtr,
            nint contextMenuPtr,
            IShellFolder shellFolder,
            IContextMenu contextMenu)
        {
            _absolutePidls = absolutePidls;
            _shellFolderPtr = shellFolderPtr;
            _contextMenuPtr = contextMenuPtr;
            _shellFolder = shellFolder;
            ContextMenu = contextMenu;
        }

        public void Dispose()
        {
            Marshal.FinalReleaseComObject(ContextMenu);
            Marshal.FinalReleaseComObject(_shellFolder);
            if (_contextMenuPtr != 0) Marshal.Release(_contextMenuPtr);
            if (_shellFolderPtr != 0) Marshal.Release(_shellFolderPtr);
            foreach (var pidl in _absolutePidls)
                if (pidl != 0) CoTaskMemFree(pidl);
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
    private static extern int SHBindToParent(nint pidl, ref Guid riid, out nint ppv, out nint ppidlLast);

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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool PostMessageW(nint hWnd, uint msg, nuint wParam, nint lParam);

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int nVirtKey);

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

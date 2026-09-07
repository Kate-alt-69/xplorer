using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Xplorer.Native.Services;

/// <summary>
/// Compatibility-first host for item context menus. The real Shell IContextMenu remains alive for
/// the entire popup lifetime so registry cascades and owner-drawn extensions behave exactly as they
/// do in Explorer. Single-RMB deliberately exposes only the compact/core shell surface; Double-RMB
/// (or Shift+RMB) leaves the complete live Shell menu intact, including third-party/custom cascades.
/// </summary>
internal sealed class ExplorerShellMenuService : IDisposable
{
    private const uint CmfExplore = 0x00000004;
    private const uint CmfCanRename = 0x00000010;
    private const uint CmfItemMenu = 0x00000080;
    private const uint CmfExtendedVerbs = 0x00000100;
    private const uint CmfSyncCascadeMenu = 0x00001000;

    private const uint MfString = 0x0000;
    private const uint MfByPosition = 0x0400;
    private const uint MfSeparator = 0x0800;
    private const uint TpmReturnCmd = 0x0100;
    private const uint WmDrawItem = 0x002B;
    private const uint WmMeasureItem = 0x002C;
    private const uint WmInitMenuPopup = 0x0117;
    private const uint WmMenuChar = 0x0120;
    private const uint WmNull = 0x0000;
    private const uint GcsVerbW = 0x00000004;
    private const uint InvalidMenuItemId = 0xFFFFFFFF;
    private const uint XplorerCommandFirst = 0x0100;
    private const uint ShellCommandFirst = 0x1000;
    private const uint ShellCommandLast = 0x7FFF;
    private const int VkShift = 0x10;
    private const nuint SubclassId = 0x58504C4D; // "XPLM"
    private const int S_OK = 0;

    private static readonly Guid IidShellFolder = new("000214E6-0000-0000-C000-000000000046");
    private static readonly Guid IidContextMenu = new("000214E4-0000-0000-C000-000000000046");

    // Canonical verbs are locale-independent, unlike menu labels. Keep this intentionally small:
    // single RMB is Xplorer's fast/core surface, while Double-RMB is the compatibility escape hatch.
    private static readonly HashSet<string> CompactCanonicalVerbs = new(StringComparer.OrdinalIgnoreCase)
    {
        "open",
        "explore",
        "opennewwindow",
        "opennewprocess",
        "openas",
        "openwith",
        "runas",
        "cut",
        "copy",
        "paste",
        "delete",
        "rename",
        "properties",
        "sendto",
        "link",
        "pintohome",
        "unpinfromhome",
        "pinunpinstart",
        "windows.share",
        "share",
        "print",
        "edit",
    };

    // Some built-in shell cascades expose no command id on their root item, so GetCommandString
    // cannot identify them. These labels are only a fallback for the small set worth keeping.
    private static readonly HashSet<string> CompactFallbackLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "Open",
        "Open in new window",
        "Open in new process",
        "Open with",
        "Open in Terminal",
        "Pin to Quick access",
        "Unpin from Quick access",
        "Pin to Start",
        "Unpin from Start",
        "Send to",
        "Cut",
        "Copy",
        "Create shortcut",
        "Delete",
        "Rename",
        "Properties",
        "Share",
        "Print",
        "Edit",
    };

    // Installer/custom registrations that the user explicitly wants behind Double-RMB. The deny
    // check runs before the allow list so a handler that reuses a generic verb cannot leak back into
    // the compact menu merely because its display text happens to wrap a core action.
    private static readonly string[] ExtendedOnlyLabelFragments =
    [
        "7-Zip",
        "Git GUI",
        "Git Bash",
        "VLC",
        "Visual Studio",
        "VS Code",
        "Terminal Tools",
    ];

    private readonly SubclassProc _subclassProc;
    private IContextMenu2? _activeContextMenu2;
    private IContextMenu3? _activeContextMenu3;
    private nint _subclassHwnd;
    private bool _disposed;

    public ExplorerShellMenuService()
    {
        _subclassProc = WindowSubclassProc;
    }

    public ExplorerShellMenuResult ShowForPaths(
        nint ownerHwnd,
        IReadOnlyCollection<string> paths,
        IReadOnlyList<XplorerContextMenuEntry>? xplorerEntries = null,
        bool forceExtendedVerbs = false)
    {
        ThrowIfDisposed();
        var normalized = NormalizeSelection(paths);
        if (normalized.Length == 0) return ExplorerShellMenuResult.Cancelled;

        using var shell = CreateSelectionContext(ownerHwnd, normalized);
        var menu = CreatePopupMenu();
        if (menu == 0) return ExplorerShellMenuResult.Cancelled;

        try
        {
            var xplorerCommands = AppendXplorerCommands(menu, xplorerEntries);
            var shellInsertIndex = (uint)Math.Max(0, GetMenuItemCount(menu));
            var extendedRequested = forceExtendedVerbs || (GetKeyState(VkShift) & 0x8000) != 0;

            var queryFlags = CmfCanRename | CmfItemMenu | CmfSyncCascadeMenu | CmfExplore;
            if (extendedRequested)
                queryFlags |= CmfExtendedVerbs;

            Marshal.ThrowExceptionForHR(
                shell.ContextMenu.QueryContextMenu(
                    menu,
                    shellInsertIndex,
                    ShellCommandFirst,
                    ShellCommandLast,
                    queryFlags));

            // Do not synthesize a second menu or clone submenu handles: keeping the same HMENU is
            // what lets IContextMenu2/3 owner-draw and lazy registry cascades continue to work. For
            // compact RMB we only remove root entries from that live menu. Double-RMB is untouched.
            if (!extendedRequested)
                PruneToCompactShellSurface(menu, shell.ContextMenu, shellInsertIndex);

            var command = TrackNativeMenu(ownerHwnd, menu, shell.ContextMenu);
            if (xplorerCommands.TryGetValue(command, out var xplorerCommand))
                return ExplorerShellMenuResult.ForXplorer(xplorerCommand);

            if (command < ShellCommandFirst || command > ShellCommandLast)
                return ExplorerShellMenuResult.Cancelled;

            InvokeShellCommand(shell.ContextMenu, ownerHwnd, command - ShellCommandFirst);
            return ExplorerShellMenuResult.ShellInvoked;
        }
        finally
        {
            EndMessageForwarding();
            DestroyMenu(menu);
        }
    }

    private static Dictionary<uint, XplorerContextCommand> AppendXplorerCommands(
        nint menu,
        IReadOnlyList<XplorerContextMenuEntry>? entries)
    {
        var map = new Dictionary<uint, XplorerContextCommand>();
        if (entries is null || entries.Count == 0) return map;

        var next = XplorerCommandFirst;
        foreach (var entry in entries.Take(64))
        {
            if (!AppendMenuW(menu, MfString, next, entry.Label))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not add an Xplorer context-menu command.");
            map[next] = entry.Command;
            next++;
        }

        if (map.Count > 0 && !AppendMenuW(menu, MfSeparator, 0, null))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not add the Xplorer context-menu separator.");
        return map;
    }

    private static void PruneToCompactShellSurface(nint menu, IContextMenu contextMenu, uint shellInsertIndex)
    {
        var firstShellPosition = checked((int)shellInsertIndex);
        for (var position = GetMenuItemCount(menu) - 1; position >= firstShellPosition; position--)
        {
            if (IsSeparator(menu, position)) continue;

            var label = GetMenuLabel(menu, position);
            if (ExtendedOnlyLabelFragments.Any(fragment =>
                    label.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            {
                _ = RemoveMenu(menu, (uint)position, MfByPosition);
                continue;
            }

            var commandId = GetMenuItemID(menu, position);
            var keep = false;
            if (commandId is >= ShellCommandFirst and <= ShellCommandLast)
            {
                var verb = TryGetCanonicalVerb(contextMenu, commandId - ShellCommandFirst);
                keep = !string.IsNullOrWhiteSpace(verb) && CompactCanonicalVerbs.Contains(verb);
            }

            if (!keep)
                keep = CompactFallbackLabels.Contains(NormalizeMenuLabel(label));

            if (!keep)
                _ = RemoveMenu(menu, (uint)position, MfByPosition);
        }

        NormalizeSeparators(menu, firstShellPosition);
    }

    private static string? TryGetCanonicalVerb(IContextMenu contextMenu, uint commandOffset)
    {
        const int capacity = 256;
        var buffer = Marshal.AllocHGlobal(capacity * sizeof(char));
        try
        {
            Marshal.WriteInt16(buffer, 0);
            var hr = contextMenu.GetCommandString(commandOffset, GcsVerbW, 0, buffer, capacity);
            if (hr < 0) return null;
            return Marshal.PtrToStringUni(buffer)?.Trim();
        }
        catch
        {
            // Third-party IContextMenu implementations are allowed to decline GetCommandString.
            // Falling back to a tiny display-label allow list is safer than promoting an unknown
            // extension into the compact menu.
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string GetMenuLabel(nint menu, int position)
    {
        var builder = new StringBuilder(512);
        var copied = GetMenuStringW(menu, (uint)position, builder, builder.Capacity, MfByPosition);
        return copied > 0 ? builder.ToString() : string.Empty;
    }

    private static string NormalizeMenuLabel(string label)
    {
        var normalized = label.Replace("&", string.Empty, StringComparison.Ordinal).Trim();
        while (normalized.EndsWith("...", StringComparison.Ordinal) || normalized.EndsWith('…'))
            normalized = normalized.TrimEnd('.', '…').TrimEnd();
        return normalized;
    }

    private static bool IsSeparator(nint menu, int position)
    {
        var state = GetMenuState(menu, (uint)position, MfByPosition);
        return state != uint.MaxValue && (state & MfSeparator) != 0;
    }

    private static void NormalizeSeparators(nint menu, int firstShellPosition)
    {
        // Remove trailing shell separators first.
        while (GetMenuItemCount(menu) > firstShellPosition)
        {
            var last = GetMenuItemCount(menu) - 1;
            if (!IsSeparator(menu, last)) break;
            _ = RemoveMenu(menu, (uint)last, MfByPosition);
        }

        // The Xplorer-command block already ends with a separator. A Shell separator immediately
        // after it would create a double rule; later consecutive rules are cleaned the same way.
        var position = Math.Max(0, firstShellPosition);
        var previousWasSeparator = position > 0 && IsSeparator(menu, position - 1);
        while (position < GetMenuItemCount(menu))
        {
            if (!IsSeparator(menu, position))
            {
                previousWasSeparator = false;
                position++;
                continue;
            }

            if (previousWasSeparator)
            {
                _ = RemoveMenu(menu, (uint)position, MfByPosition);
                continue;
            }

            previousWasSeparator = true;
            position++;
        }

        // If every shell item was filtered, do not leave the Xplorer block with a dangling rule.
        if (GetMenuItemCount(menu) == firstShellPosition &&
            firstShellPosition > 0 &&
            IsSeparator(menu, firstShellPosition - 1))
        {
            _ = RemoveMenu(menu, (uint)(firstShellPosition - 1), MfByPosition);
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
            TpmReturnCmd,
            point.X,
            point.Y,
            ownerHwnd,
            0);

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

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool AppendMenuW(nint hMenu, uint uFlags, nuint uIDNewItem, string? lpNewItem);

    [DllImport("user32.dll")]
    private static extern int GetMenuItemCount(nint hMenu);

    [DllImport("user32.dll")]
    private static extern uint GetMenuItemID(nint hMenu, int nPos);

    [DllImport("user32.dll")]
    private static extern uint GetMenuState(nint hMenu, uint uId, uint uFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetMenuStringW(
        nint hMenu,
        uint uIdItem,
        StringBuilder lpString,
        int cchMax,
        uint flags);

    [DllImport("user32.dll")]
    private static extern bool RemoveMenu(nint hMenu, uint uPosition, uint uFlags);

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

internal readonly record struct ExplorerShellMenuResult(
    bool ShellWasInvoked,
    XplorerContextCommand? XplorerCommand)
{
    public static ExplorerShellMenuResult Cancelled => new(false, null);
    public static ExplorerShellMenuResult ShellInvoked => new(true, null);
    public static ExplorerShellMenuResult ForXplorer(XplorerContextCommand command) => new(false, command);
}

using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Hosts Windows Shell context menus while keeping repeated right-clicks cheap. The first menu for
/// an exact selection is queried from the Shell normally and snapshotted as plain menu metadata.
/// Repeated opens rebuild only that cached text/state/bitmap tree; no Shell COM objects are retained.
/// If a cached command is clicked, Xplorer reacquires a fresh IContextMenu and resolves/invokes the
/// command after the user's click. This prevents repeated RMB spam from reloading every extension.
/// </summary>
public sealed class ShellContextMenuService : IDisposable
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
    private const uint CachedCommandFirst = 0x9000;
    private const uint CachedCommandLast = 0xEFFF;
    private const nuint SubclassId = 0x58504C52; // "XPLR"

    private const uint MiimState = 0x00000001;
    private const uint MiimId = 0x00000002;
    private const uint MiimSubmenu = 0x00000004;
    private const uint MiimString = 0x00000040;
    private const uint MiimBitmap = 0x00000080;
    private const uint MiimFtype = 0x00000100;
    private const uint MftOwnerDraw = 0x00000100;
    private const uint MftSeparator = 0x00000800;
    private const uint GcsVerbW = 0x00000004;
    private const uint ImageBitmap = 0;
    private const uint LrCreatedibsection = 0x00002000;

    private const int CacheCapacity = 24;
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(90);

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
    private readonly Dictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly LinkedList<string> _lru = new();
    private IContextMenu2? _activeContextMenu2;
    private IContextMenu3? _activeContextMenu3;
    private nint _subclassHwnd;
    private bool _disposed;

    public ShellContextMenuService()
    {
        _subclassProc = WindowSubclassProc;
    }

    public ShellMenuShowResult ShowForPath(nint ownerHwnd, string path) => ShowForPaths(ownerHwnd, [path]);

    /// <summary>
    /// Shows one Windows Shell context menu for the entire selection. Exact selections are cached as
    /// inert menu metadata; the cache never owns an IShellFolder/IContextMenu RCW or PIDL.
    /// </summary>
    public ShellMenuShowResult ShowForPaths(nint ownerHwnd, IReadOnlyCollection<string> paths)
    {
        ThrowIfDisposed();
        var normalized = NormalizeSelection(paths);
        if (normalized.Length == 0) return ShellMenuShowResult.Cancelled;

        var key = BuildCacheKey(normalized);
        if (TryGetCached(key, out var cached))
        {
            var cachedCommand = ShowCachedMenu(ownerHwnd, cached!);
            if (cachedCommand is null) return ShellMenuShowResult.Cancelled;

            var invoked = InvokeCachedCommand(ownerHwnd, normalized, cachedCommand);
            if (invoked)
            {
                // A command may alter state/verbs. Preserve correctness by forcing one fresh query
                // on the next RMB after an actual action while keeping cancel/spam paths hot.
                RemoveCacheEntry(key);
                return ShellMenuShowResult.Invoked;
            }

            RemoveCacheEntry(key);
            return ShellMenuShowResult.Cancelled;
        }

        using var shell = CreateSelectionContext(ownerHwnd, normalized);
        var menu = CreatePopupMenu();
        if (menu == 0) return ShellMenuShowResult.Cancelled;

        try
        {
            Marshal.ThrowExceptionForHR(
                shell.ContextMenu.QueryContextMenu(menu, 0, ShellCommandFirst, ShellCommandLast, CmfNormal));

            var snapshot = TrySnapshotMenu(menu, shell.ContextMenu);
            if (snapshot is not null && snapshot.Items.Count > 0)
                StoreCacheEntry(key, snapshot);

            var command = TrackNativeMenu(ownerHwnd, menu, shell.ContextMenu);
            if (command < ShellCommandFirst || command > ShellCommandLast)
                return ShellMenuShowResult.Cancelled;

            InvokeShellCommand(shell.ContextMenu, ownerHwnd, command - ShellCommandFirst);
            RemoveCacheEntry(key);
            return ShellMenuShowResult.Invoked;
        }
        finally
        {
            EndMessageForwarding();
            DestroyMenu(menu);
        }
    }

    /// <summary>
    /// Shows a folder-background menu. Xplorer owns View/Sort/Refresh while Windows owns the
    /// remaining folder-background verbs and extension items. This path remains uncached because
    /// its view/sort checked state is tiny and changes frequently; item-menu caching is the hot path.
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
                contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(contextMenuPtr);

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

        Array.Sort(normalized, StringComparer.OrdinalIgnoreCase);
        return normalized;
    }

    private static string BuildCacheKey(IEnumerable<string> normalized) =>
        string.Join('\u001F', normalized);

    private bool TryGetCached(string key, out CacheEntry? entry)
    {
        entry = null;
        PruneExpiredEntries();
        if (!_cache.TryGetValue(key, out var cached)) return false;

        cached.LastUsedUtc = DateTimeOffset.UtcNow;
        TouchLru(key);
        entry = cached;
        return true;
    }

    private void StoreCacheEntry(string key, MenuSnapshot snapshot)
    {
        RemoveCacheEntry(key);
        var entry = new CacheEntry(snapshot);
        _cache[key] = entry;
        _lru.AddFirst(key);

        while (_cache.Count > CacheCapacity && _lru.Last is not null)
            RemoveCacheEntry(_lru.Last.Value);
    }

    private void TouchLru(string key)
    {
        var node = _lru.Find(key);
        if (node is not null) _lru.Remove(node);
        _lru.AddFirst(key);
    }

    private void PruneExpiredEntries()
    {
        var cutoff = DateTimeOffset.UtcNow - CacheLifetime;
        var expired = _cache
            .Where(pair => pair.Value.LastUsedUtc < cutoff)
            .Select(pair => pair.Key)
            .ToArray();
        foreach (var key in expired) RemoveCacheEntry(key);
    }

    private void RemoveCacheEntry(string key)
    {
        if (_cache.Remove(key, out var entry)) entry.Dispose();
        var node = _lru.Find(key);
        if (node is not null) _lru.Remove(node);
    }

    private CachedMenuItem? ShowCachedMenu(nint ownerHwnd, CacheEntry entry)
    {
        var menu = CreatePopupMenu();
        if (menu == 0) return null;

        var commandMap = new Dictionary<uint, CachedMenuItem>();
        var nextCommand = CachedCommandFirst;
        try
        {
            BuildNativeMenuFromSnapshot(menu, entry.Snapshot.Items, commandMap, ref nextCommand);
            var command = TrackNativeMenu(ownerHwnd, menu, null);
            return commandMap.TryGetValue(command, out var selected) ? selected : null;
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private static void BuildNativeMenuFromSnapshot(
        nint menu,
        IReadOnlyList<CachedMenuItem> items,
        IDictionary<uint, CachedMenuItem> commandMap,
        ref uint nextCommand)
    {
        foreach (var item in items)
        {
            if ((item.Type & MftSeparator) != 0)
            {
                AppendMenuW(menu, MfSeparator, 0, null);
                continue;
            }

            if (item.Children.Count > 0)
            {
                var submenu = CreatePopupMenu();
                if (submenu == 0) continue;
                BuildNativeMenuFromSnapshot(submenu, item.Children, commandMap, ref nextCommand);
                AppendMenuW(menu, MfPopup | CheckedFromState(item.State), (nuint)submenu, item.Text);
                var popupPosition = (uint)(GetMenuItemCount(menu) - 1);
                ApplyCachedState(menu, popupPosition, item.State, byPosition: true);
                ApplyCachedBitmap(menu, item, byPosition: true, popupPosition);
                continue;
            }

            if (nextCommand > CachedCommandLast) break;
            var command = nextCommand++;
            commandMap[command] = item;
            AppendMenuW(menu, MfString | CheckedFromState(item.State), command, item.Text);
            ApplyCachedState(menu, command, item.State, byPosition: false);
            ApplyCachedBitmap(menu, item, byPosition: false, command);
        }
    }

    private static uint CheckedFromState(uint state) => (state & 0x00000008) != 0 ? MfChecked : 0;

    private static void ApplyCachedState(nint menu, uint item, uint state, bool byPosition)
    {
        var info = new MENUITEMINFO
        {
            cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
            fMask = MiimState,
            fState = state,
        };
        _ = SetMenuItemInfoW(menu, item, byPosition, ref info);
    }

    private static void ApplyCachedBitmap(nint menu, CachedMenuItem item, bool byPosition, uint itemId)
    {
        if (item.Bitmap == 0) return;
        var info = new MENUITEMINFO
        {
            cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
            fMask = MiimBitmap,
            hbmpItem = item.Bitmap,
        };
        _ = SetMenuItemInfoW(menu, itemId, byPosition, ref info);
    }

    private bool InvokeCachedCommand(nint ownerHwnd, string[] normalized, CachedMenuItem cached)
    {
        using var shell = CreateSelectionContext(ownerHwnd, normalized);
        var menu = CreatePopupMenu();
        if (menu == 0) return false;

        try
        {
            Marshal.ThrowExceptionForHR(
                shell.ContextMenu.QueryContextMenu(menu, 0, ShellCommandFirst, ShellCommandLast, CmfNormal));

            var offset = ResolveFreshCommandOffset(shell.ContextMenu, menu, cached);
            if (offset is null) return false;
            InvokeShellCommand(shell.ContextMenu, ownerHwnd, offset.Value);
            return true;
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private static uint? ResolveFreshCommandOffset(IContextMenu contextMenu, nint menu, CachedMenuItem cached)
    {
        var ids = EnumerateCommandIds(menu).ToArray();
        if (!string.IsNullOrWhiteSpace(cached.CanonicalVerb))
        {
            foreach (var id in ids)
            {
                if (id < ShellCommandFirst || id > ShellCommandLast) continue;
                var offset = id - ShellCommandFirst;
                var verb = TryGetCanonicalVerb(contextMenu, offset);
                if (string.Equals(verb, cached.CanonicalVerb, StringComparison.OrdinalIgnoreCase))
                    return offset;
            }
        }

        var preferredId = ShellCommandFirst + cached.SourceCommandOffset;
        if (ids.Contains(preferredId))
        {
            var label = TryGetMenuTextByCommand(menu, preferredId);
            if (string.Equals(NormalizeMenuText(label), cached.NormalizedText, StringComparison.OrdinalIgnoreCase))
                return cached.SourceCommandOffset;
        }

        foreach (var id in ids)
        {
            if (id < ShellCommandFirst || id > ShellCommandLast) continue;
            var label = TryGetMenuTextByCommand(menu, id);
            if (string.Equals(NormalizeMenuText(label), cached.NormalizedText, StringComparison.OrdinalIgnoreCase))
                return id - ShellCommandFirst;
        }

        return null;
    }

    private static IEnumerable<uint> EnumerateCommandIds(nint menu)
    {
        var count = GetMenuItemCount(menu);
        for (var index = 0; index < count; index++)
        {
            var info = ReadMenuItemInfo(menu, (uint)index);
            if (info is null) continue;
            if (info.Value.hSubMenu != 0)
            {
                foreach (var child in EnumerateCommandIds(info.Value.hSubMenu)) yield return child;
            }
            else if (info.Value.wID != 0)
            {
                yield return info.Value.wID;
            }
        }
    }

    private static string? TryGetMenuTextByCommand(nint menu, uint commandId)
    {
        var count = GetMenuItemCount(menu);
        for (var index = 0; index < count; index++)
        {
            var info = ReadMenuItemInfo(menu, (uint)index);
            if (info is null) continue;
            if (info.Value.hSubMenu != 0)
            {
                var nested = TryGetMenuTextByCommand(info.Value.hSubMenu, commandId);
                if (nested is not null) return nested;
            }
            else if (info.Value.wID == commandId)
            {
                return ReadMenuText(menu, (uint)index);
            }
        }
        return null;
    }

    private static MenuSnapshot? TrySnapshotMenu(nint menu, IContextMenu contextMenu)
    {
        var ownedBitmaps = new List<nint>();
        try
        {
            var items = SnapshotMenuItems(menu, contextMenu, ownedBitmaps);
            if (items.Count == 0)
            {
                foreach (var bitmap in ownedBitmaps) DeleteObject(bitmap);
                return null;
            }
            return new MenuSnapshot(items, ownedBitmaps);
        }
        catch
        {
            foreach (var bitmap in ownedBitmaps) DeleteObject(bitmap);
            return null;
        }
    }

    private static List<CachedMenuItem> SnapshotMenuItems(
        nint menu,
        IContextMenu contextMenu,
        ICollection<nint> ownedBitmaps)
    {
        var result = new List<CachedMenuItem>();
        var count = GetMenuItemCount(menu);
        for (var index = 0; index < count; index++)
        {
            var info = ReadMenuItemInfo(menu, (uint)index);
            if (info is null) continue;

            if ((info.Value.fType & MftSeparator) != 0)
            {
                result.Add(CachedMenuItem.Separator());
                continue;
            }

            var text = ReadMenuText(menu, (uint)index);
            if (string.IsNullOrWhiteSpace(text) && info.Value.hSubMenu == 0)
            {
                // Truly owner-drawn command with no discoverable label cannot be replayed safely.
                continue;
            }

            var children = info.Value.hSubMenu != 0
                ? SnapshotMenuItems(info.Value.hSubMenu, contextMenu, ownedBitmaps)
                : [];

            uint sourceOffset = uint.MaxValue;
            string? canonicalVerb = null;
            if (info.Value.hSubMenu == 0 &&
                info.Value.wID >= ShellCommandFirst && info.Value.wID <= ShellCommandLast)
            {
                sourceOffset = info.Value.wID - ShellCommandFirst;
                canonicalVerb = TryGetCanonicalVerb(contextMenu, sourceOffset);
            }

            var copiedBitmap = CopyMenuBitmap(info.Value.hbmpItem, ownedBitmaps);
            result.Add(new CachedMenuItem(
                text ?? string.Empty,
                NormalizeMenuText(text),
                info.Value.fType & ~MftOwnerDraw,
                info.Value.fState,
                sourceOffset,
                canonicalVerb,
                copiedBitmap,
                children));
        }
        return result;
    }

    private static nint CopyMenuBitmap(nint bitmap, ICollection<nint> ownedBitmaps)
    {
        if (bitmap == 0) return 0;
        if (bitmap.ToInt64() < 0) return bitmap; // HBMMENU_* pseudo handles are stable constants.

        var copy = CopyImage(bitmap, ImageBitmap, 0, 0, LrCreatedibsection);
        if (copy != 0)
        {
            ownedBitmaps.Add(copy);
            return copy;
        }
        return 0;
    }

    private static MENUITEMINFO? ReadMenuItemInfo(nint menu, uint position)
    {
        var info = new MENUITEMINFO
        {
            cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
            fMask = MiimState | MiimId | MiimSubmenu | MiimFtype | MiimBitmap,
        };
        return GetMenuItemInfoW(menu, position, true, ref info) ? info : null;
    }

    private static string ReadMenuText(nint menu, uint position)
    {
        var query = new MENUITEMINFO
        {
            cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
            fMask = MiimString,
            dwTypeData = 0,
            cch = 0,
        };
        if (!GetMenuItemInfoW(menu, position, true, ref query)) return string.Empty;

        var chars = Math.Clamp((int)query.cch + 1, 2, 4096);
        var buffer = Marshal.AllocHGlobal(chars * sizeof(char));
        try
        {
            var read = new MENUITEMINFO
            {
                cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
                fMask = MiimString,
                dwTypeData = buffer,
                cch = (uint)chars,
            };
            if (!GetMenuItemInfoW(menu, position, true, ref read)) return string.Empty;
            return Marshal.PtrToStringUni(buffer, (int)read.cch) ?? string.Empty;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string? TryGetCanonicalVerb(IContextMenu contextMenu, uint commandOffset)
    {
        const int chars = 260;
        var buffer = Marshal.AllocHGlobal(chars * sizeof(char));
        try
        {
            Marshal.WriteInt16(buffer, 0);
            var hr = contextMenu.GetCommandString(commandOffset, GcsVerbW, 0, buffer, (uint)chars);
            if (hr < 0) return null;
            var value = Marshal.PtrToStringUni(buffer);
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string NormalizeMenuText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var accelerator = text.IndexOf('\t');
        if (accelerator >= 0) text = text[..accelerator];
        return text.Replace("&&", "\u0001", StringComparison.Ordinal)
            .Replace("&", string.Empty, StringComparison.Ordinal)
            .Replace("\u0001", "&", StringComparison.Ordinal)
            .Trim();
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

            if (shellFolder is null) throw new InvalidOperationException("Could not resolve the Shell parent folder.");
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
            return new SelectionShellContext(absolutePidls, shellFolderPtr, contextMenuPtr, shellFolder, contextMenu);
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
        if (IsShellMenuMessage(message))
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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        EndMessageForwarding();
        foreach (var entry in _cache.Values) entry.Dispose();
        _cache.Clear();
        _lru.Clear();
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ShellContextMenuService));
    }

    private sealed class CacheEntry : IDisposable
    {
        public CacheEntry(MenuSnapshot snapshot)
        {
            Snapshot = snapshot;
            LastUsedUtc = DateTimeOffset.UtcNow;
        }

        public MenuSnapshot Snapshot { get; }
        public DateTimeOffset LastUsedUtc { get; set; }
        public void Dispose() => Snapshot.Dispose();
    }

    private sealed class MenuSnapshot : IDisposable
    {
        private readonly IReadOnlyList<nint> _ownedBitmaps;
        public MenuSnapshot(IReadOnlyList<CachedMenuItem> items, IReadOnlyList<nint> ownedBitmaps)
        {
            Items = items;
            _ownedBitmaps = ownedBitmaps;
        }

        public IReadOnlyList<CachedMenuItem> Items { get; }
        public void Dispose()
        {
            foreach (var bitmap in _ownedBitmaps)
                if (bitmap != 0) DeleteObject(bitmap);
        }
    }

    private sealed record CachedMenuItem(
        string Text,
        string NormalizedText,
        uint Type,
        uint State,
        uint SourceCommandOffset,
        string? CanonicalVerb,
        nint Bitmap,
        IReadOnlyList<CachedMenuItem> Children)
    {
        public static CachedMenuItem Separator() =>
            new(string.Empty, string.Empty, MftSeparator, 0, uint.MaxValue, null, 0, []);
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

    [StructLayout(LayoutKind.Sequential)]
    private struct MENUITEMINFO
    {
        public uint cbSize;
        public uint fMask;
        public uint fType;
        public uint fState;
        public uint wID;
        public nint hSubMenu;
        public nint hbmpChecked;
        public nint hbmpUnchecked;
        public nuint dwItemData;
        public nint dwTypeData;
        public uint cch;
        public nint hbmpItem;
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
    private static extern int SHParseDisplayName(string pszName, nint pbc, out nint ppidl, uint sfgaoIn, out uint psfgaoOut);

    [DllImport("shell32.dll", PreserveSig = true)]
    private static extern int SHBindToParent(nint pidl, ref Guid riid, out nint ppv, out nint ppidlLast);

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

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetMenuItemInfoW(nint hMenu, uint item, bool byPosition, ref MENUITEMINFO info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetMenuItemInfoW(nint hMenu, uint item, bool byPosition, ref MENUITEMINFO info);

    [DllImport("user32.dll")]
    private static extern uint TrackPopupMenuEx(nint hmenu, uint fuFlags, int x, int y, nint hwnd, nint lptpm);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool PostMessageW(nint hWnd, uint msg, nuint wParam, nint lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint CopyImage(nint h, uint type, int cx, int cy, uint flags);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(nint hObject);

    [DllImport("comctl32.dll")]
    private static extern bool SetWindowSubclass(nint hWnd, SubclassProc pfnSubclass, nuint uIdSubclass, nuint dwRefData);

    [DllImport("comctl32.dll")]
    private static extern bool RemoveWindowSubclass(nint hWnd, SubclassProc pfnSubclass, nuint uIdSubclass);

    [DllImport("comctl32.dll")]
    private static extern nint DefSubclassProc(nint hWnd, uint uMsg, nuint wParam, nint lParam);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(nint pv);
}

public enum ShellMenuShowResult
{
    Cancelled,
    Invoked,
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

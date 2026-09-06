using System.Text;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

/// <summary>
/// Supplies the visible folder viewport from Xplorer's immutable worker indexes before touching the
/// live directory. The hot workspace cache is preferred because it is rooted at the folder the user
/// is browsing and already contains a few descendant levels. A volume snapshot + USN delta overlay
/// is the second choice. Both are only acceleration layers: callers reconcile against disk later.
/// </summary>
public static class IndexedFolderViewService
{
    private static readonly byte[] WorkspaceMagic = "XPLWSP01"u8.ToArray();
    private static readonly byte[] SnapshotMagic = "XPLIDX01"u8.ToArray();
    private static readonly byte[] DeltaMagic = "XPLDLT01"u8.ToArray();
    private const uint WorkspaceVersion = 1;
    private const uint SnapshotVersion = 2;
    private const uint DeltaVersion = 1;
    private const byte DeltaUpsert = 1;
    private const byte DeltaDelete = 2;
    private const byte FlagDirectory = 1 << 0;
    private const byte FlagHidden = 1 << 2;
    private const int WorkspaceRecordFixedSize = 32;
    private const int SnapshotHeaderSize = 24;
    private const int SnapshotRecordFixedSize = 32;
    private const int DeltaHeaderSize = 16;
    private const int DeltaRecordFixedSize = 40;
    private const int MaximumRecordSize = 1024 * 1024;

    public sealed record FolderSnapshot(
        IReadOnlyList<FileSystemItem> Items,
        string Source,
        DateTimeOffset? GeneratedAt);

    private sealed record IndexEntry(
        string RelativePath,
        byte Flags,
        uint Attributes,
        ulong Size,
        ulong LastWriteTime);

    private sealed record DeltaEntry(byte Kind, IndexEntry Entry);

    public static FolderSnapshot? TryLoad(
        string folder,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        try
        {
            var fullFolder = Path.GetFullPath(folder);
            return TryLoadWorkspace(fullFolder, showHidden, showExtensions, sortMode)
                ?? TryLoadVolume(fullFolder, showHidden, showExtensions, sortMode);
        }
        catch
        {
            // Indexes are an optimization. Any stale/corrupt/locked snapshot falls back to disk.
            return null;
        }
    }

    public static List<FileSystemItem> EnumerateDisk(
        string folder,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        var result = new List<FileSystemItem>();
        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(folder))
            {
                var item = TryReadSingle(path, showHidden, showExtensions);
                if (item is not null) result.Add(item);
            }
        }
        catch
        {
            // Inaccessible/offline directories stay navigable; the viewport simply remains empty.
        }

        return Sort(result, sortMode);
    }

    public static FileSystemItem? TryReadSingle(string path, bool showHidden, bool showExtensions)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if (!showHidden && attributes.HasFlag(FileAttributes.Hidden)) return null;

            var isDirectory = attributes.HasFlag(FileAttributes.Directory);
            return new FileSystemItem
            {
                FullPath = path,
                Name = Path.GetFileName(path),
                IsDirectory = isDirectory,
                ShowExtension = showExtensions,
                LastWriteTimeUtc = File.GetLastWriteTimeUtc(path),
                SizeBytes = isDirectory ? null : new FileInfo(path).Length,
            };
        }
        catch
        {
            return null;
        }
    }

    public static List<FileSystemItem> Sort(IEnumerable<FileSystemItem> items, string sortMode)
    {
        var directoriesFirst = items.OrderByDescending(item => item.IsDirectory);
        return sortMode switch
        {
            "Date modified" => directoriesFirst
                .ThenByDescending(item => item.LastWriteTimeUtc)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            "Type" => directoriesFirst
                .ThenBy(item => item.TypeName, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            "Size" => directoriesFirst
                .ThenByDescending(item => item.SizeBytes ?? -1)
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
            _ => directoriesFirst
                .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
        };
    }

    private static FolderSnapshot? TryLoadWorkspace(
        string fullFolder,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        var path = Path.Combine(IndexDirectory, "workspace.xwidx");
        if (!File.Exists(path)) return null;

        using var stream = OpenReadShared(path);
        using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);
        if (stream.Length < 24) return null;
        if (!reader.ReadBytes(8).AsSpan().SequenceEqual(WorkspaceMagic)) return null;
        if (reader.ReadUInt32() != WorkspaceVersion) return null;

        var generatedUnix = reader.ReadUInt64();
        var rootUnits = reader.ReadUInt32();
        if (rootUnits > 32768 || stream.Position + checked((long)rootUnits * 2) > stream.Length) return null;
        var rootByteCount = checked((int)rootUnits * 2);
        var rootBytes = reader.ReadBytes(rootByteCount);
        if (rootBytes.Length != rootByteCount) return null;
        var cachedRoot = Path.GetFullPath(Encoding.Unicode.GetString(rootBytes));

        var targetRelative = Path.GetRelativePath(cachedRoot, fullFolder);
        if (targetRelative == ".") targetRelative = string.Empty;
        targetRelative = NormalizeRelativeTrusted(targetRelative);
        if (Path.IsPathRooted(targetRelative) || targetRelative.Split(Path.DirectorySeparatorChar).Any(segment => segment == ".."))
            return null;

        var prefix = string.IsNullOrEmpty(targetRelative)
            ? string.Empty
            : targetRelative.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var items = new List<FileSystemItem>();

        while (stream.Position < stream.Length)
        {
            var entry = ReadWorkspaceEntry(reader, stream);
            if (entry is null) return null;
            AddDirectChild(entry, cachedRoot, prefix, showHidden, showExtensions, items);
        }

        DateTimeOffset? generatedAt = null;
        try { generatedAt = DateTimeOffset.FromUnixTimeSeconds(checked((long)generatedUnix)); }
        catch { }

        return new FolderSnapshot(Sort(items, sortMode), "workspace-index", generatedAt);
    }

    private static FolderSnapshot? TryLoadVolume(
        string fullFolder,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        var root = Path.GetPathRoot(fullFolder);
        if (string.IsNullOrWhiteSpace(root) || root.Length < 2 || root[1] != ':') return null;
        var drive = char.ToUpperInvariant(root[0]);
        var snapshotPath = Path.Combine(IndexDirectory, $"{drive}.xidx");
        if (!File.Exists(snapshotPath)) return null;

        var deltas = ReadDeltaOverlay(Path.Combine(IndexDirectory, $"{drive}.xdelta"), drive);
        if (deltas is null) return null;

        var relativeFolder = Path.GetRelativePath(root, fullFolder);
        if (relativeFolder == ".") relativeFolder = string.Empty;
        relativeFolder = NormalizeRelativeTrusted(relativeFolder);
        var prefix = string.IsNullOrEmpty(relativeFolder)
            ? string.Empty
            : relativeFolder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var items = new List<FileSystemItem>();
        ulong snapshotTimestamp = 0;

        using var stream = OpenReadShared(snapshotPath);
        using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);
        if (!ReadAndValidateSnapshotHeader(reader, drive, out snapshotTimestamp)) return null;

        while (stream.Position < stream.Length)
        {
            var entry = ReadSnapshotEntry(reader, stream);
            if (entry is null) return null;
            var effective = entry;
            if (deltas.Remove(entry.RelativePath, out var delta))
            {
                if (delta.Kind == DeltaDelete) continue;
                if (delta.Kind == DeltaUpsert) effective = delta.Entry;
            }
            AddDirectChild(effective, root, prefix, showHidden, showExtensions, items);
        }

        foreach (var delta in deltas.Values)
        {
            if (delta.Kind == DeltaUpsert)
                AddDirectChild(delta.Entry, root, prefix, showHidden, showExtensions, items);
        }

        DateTimeOffset? generatedAt = null;
        try { generatedAt = DateTimeOffset.FromUnixTimeSeconds(checked((long)snapshotTimestamp)); }
        catch { }
        return new FolderSnapshot(Sort(items, sortMode), "volume-index", generatedAt);
    }

    private static void AddDirectChild(
        IndexEntry entry,
        string root,
        string prefix,
        bool showHidden,
        bool showExtensions,
        List<FileSystemItem> items)
    {
        var relative = NormalizeRelativeRecord(entry.RelativePath);
        if (relative is null) return;

        string remainder;
        if (string.IsNullOrEmpty(prefix))
            remainder = relative;
        else if (relative.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            remainder = relative[prefix.Length..];
        else
            return;

        if (string.IsNullOrWhiteSpace(remainder) ||
            remainder.Contains(Path.DirectorySeparatorChar) ||
            remainder.Contains(Path.AltDirectorySeparatorChar))
            return;
        if (!showHidden && (entry.Flags & FlagHidden) != 0) return;

        var isDirectory = (entry.Flags & FlagDirectory) != 0;
        items.Add(new FileSystemItem
        {
            FullPath = Path.Combine(root, relative),
            Name = remainder,
            IsDirectory = isDirectory,
            ShowExtension = showExtensions,
            LastWriteTimeUtc = FromFileTime(entry.LastWriteTime),
            SizeBytes = isDirectory ? null : entry.Size > long.MaxValue ? long.MaxValue : (long)entry.Size,
        });
    }

    private static IndexEntry? ReadWorkspaceEntry(BinaryReader reader, Stream stream)
    {
        if (stream.Position + sizeof(uint) > stream.Length) return null;
        var start = stream.Position;
        var recordLength = reader.ReadUInt32();
        if (recordLength < WorkspaceRecordFixedSize || recordLength > MaximumRecordSize || start + recordLength > stream.Length)
            return null;
        var flags = reader.ReadByte();
        _ = reader.ReadBytes(3);
        var attributes = reader.ReadUInt32();
        var size = reader.ReadUInt64();
        var lastWrite = reader.ReadUInt64();
        var units = reader.ReadUInt32();
        var pathBytes = checked((int)units * 2);
        if (WorkspaceRecordFixedSize + pathBytes != recordLength) return null;
        var bytes = reader.ReadBytes(pathBytes);
        if (bytes.Length != pathBytes) return null;
        var relative = NormalizeRelativeRecord(Encoding.Unicode.GetString(bytes));
        return relative is null ? null : new IndexEntry(relative, flags, attributes, size, lastWrite);
    }

    private static bool ReadAndValidateSnapshotHeader(BinaryReader reader, char drive, out ulong timestamp)
    {
        timestamp = 0;
        if (reader.BaseStream.Length < SnapshotHeaderSize) return false;
        var magic = reader.ReadBytes(8);
        var version = reader.ReadUInt32();
        var storedDrive = reader.ReadUInt16();
        _ = reader.ReadUInt16();
        timestamp = reader.ReadUInt64();
        return magic.AsSpan().SequenceEqual(SnapshotMagic)
               && version == SnapshotVersion
               && char.ToUpperInvariant((char)storedDrive) == drive;
    }

    private static IndexEntry? ReadSnapshotEntry(BinaryReader reader, Stream stream)
    {
        if (stream.Position + sizeof(uint) > stream.Length) return null;
        var start = stream.Position;
        var recordLength = reader.ReadUInt32();
        if (recordLength < SnapshotRecordFixedSize || recordLength > MaximumRecordSize || start + recordLength > stream.Length)
            return null;
        var flags = reader.ReadByte();
        _ = reader.ReadBytes(3);
        var attributes = reader.ReadUInt32();
        var size = reader.ReadUInt64();
        var lastWrite = reader.ReadUInt64();
        var units = reader.ReadUInt32();
        var pathBytes = checked((int)units * 2);
        if (SnapshotRecordFixedSize + pathBytes != recordLength) return null;
        var bytes = reader.ReadBytes(pathBytes);
        if (bytes.Length != pathBytes) return null;
        var relative = NormalizeRelativeRecord(Encoding.Unicode.GetString(bytes));
        return relative is null ? null : new IndexEntry(relative, flags, attributes, size, lastWrite);
    }

    private static Dictionary<string, DeltaEntry>? ReadDeltaOverlay(string path, char drive)
    {
        var result = new Dictionary<string, DeltaEntry>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return result;

        using var stream = OpenReadShared(path);
        using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);
        if (stream.Length < DeltaHeaderSize) return null;
        var magic = reader.ReadBytes(8);
        var version = reader.ReadUInt32();
        var storedDrive = reader.ReadUInt16();
        _ = reader.ReadUInt16();
        if (!magic.AsSpan().SequenceEqual(DeltaMagic) || version != DeltaVersion || char.ToUpperInvariant((char)storedDrive) != drive)
            return null;

        var readableLength = stream.Length;
        while (stream.Position + sizeof(uint) <= readableLength)
        {
            var start = stream.Position;
            var recordLength = reader.ReadUInt32();
            if (recordLength < DeltaRecordFixedSize || recordLength > MaximumRecordSize || start + recordLength > readableLength)
                break;

            var kind = reader.ReadByte();
            if (kind is not DeltaUpsert and not DeltaDelete) return null;
            var flags = reader.ReadByte();
            _ = reader.ReadUInt16();
            var attributes = reader.ReadUInt32();
            var size = reader.ReadUInt64();
            var lastWrite = reader.ReadUInt64();
            _ = reader.ReadInt64();
            var units = reader.ReadUInt32();
            var pathBytes = checked((int)units * 2);
            if (DeltaRecordFixedSize + pathBytes != recordLength) return null;
            var bytes = reader.ReadBytes(pathBytes);
            if (bytes.Length != pathBytes) break;
            var relative = NormalizeRelativeRecord(Encoding.Unicode.GetString(bytes));
            if (relative is null) return null;
            result[relative] = new DeltaEntry(kind, new IndexEntry(relative, flags, attributes, size, lastWrite));
        }
        return result;
    }

    private static FileStream OpenReadShared(string path) => new(
        path,
        FileMode.Open,
        FileAccess.Read,
        FileShare.ReadWrite | FileShare.Delete,
        64 * 1024,
        FileOptions.SequentialScan);

    private static string IndexDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Index");

    private static string NormalizeRelativeTrusted(string value) => value
        .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
        .TrimStart(Path.DirectorySeparatorChar);

    private static string? NormalizeRelativeRecord(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.IndexOf('\0') >= 0) return null;
        var normalized = value
            .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
            .TrimStart(Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(normalized) || Path.IsPathRooted(normalized)) return null;
        foreach (var segment in normalized.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment is "." or ".." || segment.Contains(':')) return null;
        }
        return normalized;
    }

    private static DateTime FromFileTime(ulong fileTime)
    {
        if (fileTime > long.MaxValue) return default;
        try { return DateTime.FromFileTimeUtc((long)fileTime); }
        catch (ArgumentOutOfRangeException) { return default; }
    }
}

using System.Text;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

/// <summary>
/// Reads the Rust worker's immutable metadata snapshot plus its bounded USN delta overlay.
/// Search is local and deterministic: no content reads, network access, model, database server,
/// or long-lived managed index process is involved.
/// </summary>
public static class IndexedSearchService
{
    private static readonly byte[] SnapshotMagic = "XPLIDX01"u8.ToArray();
    private static readonly byte[] DeltaMagic = "XPLDLT01"u8.ToArray();
    private const uint SnapshotVersion = 2;
    private const uint DeltaVersion = 1;
    private const byte DeltaUpsert = 1;
    private const byte DeltaDelete = 2;
    private const byte FlagDirectory = 1 << 0;
    private const byte FlagHidden = 1 << 2;
    private const int SnapshotHeaderSize = 24;
    private const int SnapshotRecordFixedSize = 32;
    private const int DeltaHeaderSize = 16;
    private const int DeltaRecordFixedSize = 40;
    private const int MaximumRecordSize = 1024 * 1024;
    private const int MaximumDisplayedResults = 5000;

    public sealed record SearchResult(IReadOnlyList<FileSystemItem> Items, int TotalMatches);

    private sealed record IndexEntry(
        string RelativePath,
        byte Flags,
        uint Attributes,
        ulong Size,
        ulong LastWriteTime);

    private sealed record DeltaEntry(byte Kind, IndexEntry Entry);

    public static SearchResult? TrySearch(
        string folder,
        string query,
        bool showHidden,
        bool showExtensions)
    {
        try
        {
            var fullFolder = Path.GetFullPath(folder);
            var root = Path.GetPathRoot(fullFolder);
            if (string.IsNullOrWhiteSpace(root) || root.Length < 2 || root[1] != ':') return null;

            var drive = char.ToUpperInvariant(root[0]);
            var indexDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Xplorer",
                "Index");
            var snapshotPath = Path.Combine(indexDirectory, $"{drive}.xidx");
            if (!File.Exists(snapshotPath)) return null;

            var deltaPath = Path.Combine(indexDirectory, $"{drive}.xdelta");
            var deltas = ReadDeltaOverlay(deltaPath, drive);
            var tokens = query.Split(
                ' ',
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (tokens.Length == 0) return new SearchResult([], 0);

            var relativeFolder = Path.GetRelativePath(root, fullFolder);
            if (relativeFolder == ".") relativeFolder = string.Empty;
            relativeFolder = NormalizeRelative(relativeFolder);
            var prefix = string.IsNullOrEmpty(relativeFolder)
                ? string.Empty
                : relativeFolder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;

            var items = new List<FileSystemItem>(Math.Min(MaximumDisplayedResults, 512));
            var totalMatches = 0;

            using var stream = OpenReadShared(snapshotPath);
            using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);
            if (!ReadAndValidateSnapshotHeader(reader, drive)) return null;

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

                AddMatch(effective, root, prefix, tokens, showHidden, showExtensions, items, ref totalMatches);
            }

            // Deltas can describe paths created after the immutable snapshot was written.
            foreach (var delta in deltas.Values)
            {
                if (delta.Kind != DeltaUpsert) continue;
                AddMatch(delta.Entry, root, prefix, tokens, showHidden, showExtensions, items, ref totalMatches);
            }

            items.Sort(static (left, right) =>
            {
                var directoryOrder = right.IsDirectory.CompareTo(left.IsDirectory);
                if (directoryOrder != 0) return directoryOrder;
                var nameOrder = StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name);
                return nameOrder != 0
                    ? nameOrder
                    : StringComparer.OrdinalIgnoreCase.Compare(left.FullPath, right.FullPath);
            });

            return new SearchResult(items, totalMatches);
        }
        catch
        {
            // Indexes are an optimization. Any corrupt/old/locked index falls back to normal
            // current-folder enumeration rather than breaking search.
            return null;
        }
    }

    private static void AddMatch(
        IndexEntry entry,
        string root,
        string prefix,
        IReadOnlyList<string> tokens,
        bool showHidden,
        bool showExtensions,
        List<FileSystemItem> items,
        ref int totalMatches)
    {
        var relative = NormalizeRelative(entry.RelativePath);
        if (!IsWithinSearchFolder(relative, prefix)) return;
        if (!showHidden && (entry.Flags & FlagHidden) != 0) return;

        var name = Path.GetFileName(relative.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(name)) return;

        if (!tokens.All(token =>
                name.Contains(token, StringComparison.CurrentCultureIgnoreCase)
                || relative.Contains(token, StringComparison.CurrentCultureIgnoreCase)))
        {
            return;
        }

        totalMatches++;
        if (items.Count >= MaximumDisplayedResults) return;

        var isDirectory = (entry.Flags & FlagDirectory) != 0;
        items.Add(new FileSystemItem
        {
            FullPath = Path.Combine(root, relative),
            Name = name,
            IsDirectory = isDirectory,
            ShowExtension = showExtensions,
            LastWriteTimeUtc = FromFileTime(entry.LastWriteTime),
            SizeBytes = isDirectory
                ? null
                : entry.Size > long.MaxValue ? long.MaxValue : (long)entry.Size,
        });
    }

    private static bool IsWithinSearchFolder(string relative, string prefix)
    {
        if (string.IsNullOrEmpty(prefix)) return true;
        return relative.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    private static Dictionary<string, DeltaEntry> ReadDeltaOverlay(string path, char drive)
    {
        var result = new Dictionary<string, DeltaEntry>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return result;

        using var stream = OpenReadShared(path);
        using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);
        if (stream.Length < DeltaHeaderSize) return result;
        var magic = reader.ReadBytes(8);
        var version = reader.ReadUInt32();
        var storedDrive = reader.ReadUInt16();
        _ = reader.ReadUInt16();
        if (!magic.AsSpan().SequenceEqual(DeltaMagic)
            || version != DeltaVersion
            || char.ToUpperInvariant((char)storedDrive) != drive)
        {
            return result;
        }

        // Capture the current append boundary so an in-progress worker append cannot produce a
        // false corruption result while this search is reading.
        var readableLength = stream.Length;
        while (stream.Position + sizeof(uint) <= readableLength)
        {
            var start = stream.Position;
            var recordLength = reader.ReadUInt32();
            if (recordLength < DeltaRecordFixedSize
                || recordLength > MaximumRecordSize
                || start + recordLength > readableLength)
            {
                break;
            }

            var kind = reader.ReadByte();
            var flags = reader.ReadByte();
            _ = reader.ReadUInt16();
            var attributes = reader.ReadUInt32();
            var size = reader.ReadUInt64();
            var lastWrite = reader.ReadUInt64();
            _ = reader.ReadInt64(); // source USN
            var pathUnits = reader.ReadUInt32();
            var pathBytes = checked((int)pathUnits * 2);
            if (DeltaRecordFixedSize + pathBytes != recordLength)
            {
                stream.Position = start + recordLength;
                continue;
            }

            var relativeBytes = reader.ReadBytes(pathBytes);
            if (relativeBytes.Length != pathBytes) break;
            var relative = NormalizeRelative(Encoding.Unicode.GetString(relativeBytes));
            if (string.IsNullOrWhiteSpace(relative)) continue;

            var entry = new IndexEntry(relative, flags, attributes, size, lastWrite);
            result[relative] = new DeltaEntry(kind, entry);
        }

        return result;
    }

    private static bool ReadAndValidateSnapshotHeader(BinaryReader reader, char drive)
    {
        if (reader.BaseStream.Length < SnapshotHeaderSize) return false;
        var magic = reader.ReadBytes(8);
        var version = reader.ReadUInt32();
        var storedDrive = reader.ReadUInt16();
        _ = reader.ReadUInt16();
        _ = reader.ReadUInt64(); // snapshot timestamp
        return magic.AsSpan().SequenceEqual(SnapshotMagic)
               && version == SnapshotVersion
               && char.ToUpperInvariant((char)storedDrive) == drive;
    }

    private static IndexEntry? ReadSnapshotEntry(BinaryReader reader, Stream stream)
    {
        if (stream.Position + sizeof(uint) > stream.Length) return null;
        var start = stream.Position;
        var recordLength = reader.ReadUInt32();
        if (recordLength < SnapshotRecordFixedSize
            || recordLength > MaximumRecordSize
            || start + recordLength > stream.Length)
        {
            return null;
        }

        var flags = reader.ReadByte();
        _ = reader.ReadBytes(3);
        var attributes = reader.ReadUInt32();
        var size = reader.ReadUInt64();
        var lastWrite = reader.ReadUInt64();
        var pathUnits = reader.ReadUInt32();
        var pathBytes = checked((int)pathUnits * 2);
        if (SnapshotRecordFixedSize + pathBytes != recordLength) return null;

        var relativeBytes = reader.ReadBytes(pathBytes);
        if (relativeBytes.Length != pathBytes) return null;
        var relative = NormalizeRelative(Encoding.Unicode.GetString(relativeBytes));
        return string.IsNullOrWhiteSpace(relative)
            ? null
            : new IndexEntry(relative, flags, attributes, size, lastWrite);
    }

    private static FileStream OpenReadShared(string path) =>
        new(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            64 * 1024,
            FileOptions.SequentialScan);

    private static string NormalizeRelative(string value) =>
        value.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
            .TrimStart(Path.DirectorySeparatorChar);

    private static DateTime FromFileTime(ulong fileTime)
    {
        if (fileTime > long.MaxValue) return default;
        try
        {
            return DateTime.FromFileTimeUtc((long)fileTime);
        }
        catch (ArgumentOutOfRangeException)
        {
            return default;
        }
    }
}

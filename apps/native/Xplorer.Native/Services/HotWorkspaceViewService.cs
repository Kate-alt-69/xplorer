using System.Text;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

/// <summary>
/// Reads only the small hot workspace cache used for interactive folder browsing. It deliberately
/// never falls back to a whole-volume index: browsing must stay latency-bound by the current folder,
/// not by the size of a drive snapshot.
/// </summary>
public static class HotWorkspaceViewService
{
    private static readonly byte[] WorkspaceMagic = "XPLWSP01"u8.ToArray();
    private const uint WorkspaceVersion = 1;
    private const byte FlagDirectory = 1 << 0;
    private const byte FlagHidden = 1 << 2;
    private const int WorkspaceRecordFixedSize = 32;
    private const int MaximumRecordSize = 1024 * 1024;

    public sealed record FolderSnapshot(
        IReadOnlyList<FileSystemItem> Items,
        DateTimeOffset? GeneratedAt);

    public static FolderSnapshot? TryLoad(
        string folder,
        bool showHidden,
        bool showExtensions,
        string sortMode)
    {
        try
        {
            var fullFolder = Path.GetFullPath(folder);
            var path = Path.Combine(IndexDirectory, "workspace.xwidx");
            if (!File.Exists(path)) return null;

            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                64 * 1024,
                FileOptions.SequentialScan);
            using var reader = new BinaryReader(stream, Encoding.Unicode, leaveOpen: false);

            if (stream.Length < 24) return null;
            if (!reader.ReadBytes(8).AsSpan().SequenceEqual(WorkspaceMagic)) return null;
            if (reader.ReadUInt32() != WorkspaceVersion) return null;

            var generatedUnix = reader.ReadUInt64();
            var rootUnits = reader.ReadUInt32();
            if (rootUnits > 32768 || stream.Position + checked((long)rootUnits * 2) > stream.Length)
                return null;

            var rootByteCount = checked((int)rootUnits * 2);
            var rootBytes = reader.ReadBytes(rootByteCount);
            if (rootBytes.Length != rootByteCount) return null;

            var cachedRoot = Path.GetFullPath(Encoding.Unicode.GetString(rootBytes));
            var targetRelative = Path.GetRelativePath(cachedRoot, fullFolder);
            if (targetRelative == ".") targetRelative = string.Empty;
            targetRelative = NormalizeRelative(targetRelative);
            if (Path.IsPathRooted(targetRelative) ||
                targetRelative.Split(Path.DirectorySeparatorChar).Any(segment => segment == ".."))
            {
                return null;
            }

            var prefix = string.IsNullOrEmpty(targetRelative)
                ? string.Empty
                : targetRelative.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var items = new List<FileSystemItem>();

            while (stream.Position < stream.Length)
            {
                var entry = ReadEntry(reader, stream);
                if (entry is null) return null;

                var relative = NormalizeRelative(entry.Value.RelativePath);
                string remainder;
                if (string.IsNullOrEmpty(prefix))
                    remainder = relative;
                else if (relative.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    remainder = relative[prefix.Length..];
                else
                    continue;

                if (string.IsNullOrWhiteSpace(remainder) ||
                    remainder.Contains(Path.DirectorySeparatorChar) ||
                    remainder.Contains(Path.AltDirectorySeparatorChar))
                    continue;
                if (!showHidden && (entry.Value.Flags & FlagHidden) != 0) continue;

                var isDirectory = (entry.Value.Flags & FlagDirectory) != 0;
                items.Add(new FileSystemItem
                {
                    FullPath = Path.Combine(cachedRoot, relative),
                    Name = remainder,
                    IsDirectory = isDirectory,
                    ShowExtension = showExtensions,
                    LastWriteTimeUtc = FromFileTime(entry.Value.LastWriteTime),
                    SizeBytes = isDirectory
                        ? null
                        : entry.Value.Size > long.MaxValue
                            ? long.MaxValue
                            : (long)entry.Value.Size,
                });
            }

            DateTimeOffset? generatedAt = null;
            try { generatedAt = DateTimeOffset.FromUnixTimeSeconds(checked((long)generatedUnix)); }
            catch { }

            return new FolderSnapshot(
                IndexedFolderViewService.Sort(items, sortMode),
                generatedAt);
        }
        catch
        {
            // The hot cache is an acceleration layer only. Any stale/corrupt/locked cache yields to
            // direct disk enumeration instead of stalling navigation.
            return null;
        }
    }

    private static WorkspaceEntry? ReadEntry(BinaryReader reader, Stream stream)
    {
        if (stream.Position + sizeof(uint) > stream.Length) return null;
        var start = stream.Position;
        var recordLength = reader.ReadUInt32();
        if (recordLength < WorkspaceRecordFixedSize ||
            recordLength > MaximumRecordSize ||
            start + recordLength > stream.Length)
            return null;

        var flags = reader.ReadByte();
        _ = reader.ReadBytes(3);
        _ = reader.ReadUInt32(); // attributes
        var size = reader.ReadUInt64();
        var lastWrite = reader.ReadUInt64();
        var units = reader.ReadUInt32();
        var pathBytes = checked((int)units * 2);
        if (WorkspaceRecordFixedSize + pathBytes != recordLength) return null;

        var bytes = reader.ReadBytes(pathBytes);
        if (bytes.Length != pathBytes) return null;
        var relative = Encoding.Unicode.GetString(bytes);
        if (string.IsNullOrWhiteSpace(relative) || relative.IndexOf('\0') >= 0) return null;
        return new WorkspaceEntry(relative, flags, size, lastWrite);
    }

    private static string NormalizeRelative(string value) => value
        .Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar)
        .TrimStart(Path.DirectorySeparatorChar);

    private static DateTime FromFileTime(ulong fileTime)
    {
        if (fileTime > long.MaxValue) return default;
        try { return DateTime.FromFileTimeUtc((long)fileTime); }
        catch (ArgumentOutOfRangeException) { return default; }
    }

    private static string IndexDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Index");

    private readonly record struct WorkspaceEntry(
        string RelativePath,
        byte Flags,
        ulong Size,
        ulong LastWriteTime);
}

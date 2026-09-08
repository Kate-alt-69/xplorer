using System.Text;
using System.Text.Json;

namespace Xplorer.Native.Services;

internal readonly record struct RecentLocation(
    string Path,
    bool IsDirectory,
    DateTimeOffset LastOpenedUtc);

/// <summary>
/// Tiny native replacement for the original client's recent-files store. It keeps only a bounded
/// MRU list under %LOCALAPPDATA%\Xplorer and rewrites the file only when the head actually changes,
/// so refreshes/search repainting do not create background IO noise.
/// </summary>
internal static class RecentLocationService
{
    private const int MaximumEntries = 32;
    private const int MaximumFileBytes = 64 * 1024;
    private static readonly object Gate = new();
    private static List<RecentLocation>? _entries;

    private static string StorePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "recent.json");

    public static IReadOnlyList<RecentLocation> Get(int limit = 10)
    {
        lock (Gate)
        {
            EnsureLoaded();
            return _entries!
                .Where(IsStillReachable)
                .Take(Math.Clamp(limit, 0, MaximumEntries))
                .ToArray();
        }
    }

    public static bool Record(string path, bool isDirectory)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(path);
        }
        catch
        {
            return false;
        }

        lock (Gate)
        {
            EnsureLoaded();

            if (_entries!.Count > 0 &&
                string.Equals(_entries[0].Path, fullPath, StringComparison.OrdinalIgnoreCase) &&
                _entries[0].IsDirectory == isDirectory)
            {
                return false;
            }

            _entries.RemoveAll(entry =>
                string.Equals(entry.Path, fullPath, StringComparison.OrdinalIgnoreCase));
            _entries.Insert(0, new RecentLocation(fullPath, isDirectory, DateTimeOffset.UtcNow));
            if (_entries.Count > MaximumEntries)
                _entries.RemoveRange(MaximumEntries, _entries.Count - MaximumEntries);

            SaveLocked();
            return true;
        }
    }

    private static void EnsureLoaded()
    {
        if (_entries is not null) return;
        _entries = [];

        try
        {
            var info = new FileInfo(StorePath);
            if (!info.Exists || info.Length <= 0 || info.Length > MaximumFileBytes) return;

            var json = File.ReadAllText(StorePath, Encoding.UTF8);
            var persisted = JsonSerializer.Deserialize<List<PersistedRecentLocation>>(json);
            if (persisted is null) return;

            foreach (var item in persisted.Take(MaximumEntries))
            {
                if (item is null || string.IsNullOrWhiteSpace(item.Path)) continue;
                try
                {
                    _entries.Add(new RecentLocation(
                        Path.GetFullPath(item.Path),
                        item.IsDirectory,
                        item.LastOpenedUtc));
                }
                catch
                {
                    // Ignore malformed/stale individual entries instead of discarding the store.
                }
            }
        }
        catch
        {
            // Recent history is convenience state; corruption/locking must never affect Explorer.
        }
    }

    private static bool IsStillReachable(RecentLocation entry)
    {
        try
        {
            return entry.IsDirectory ? Directory.Exists(entry.Path) : File.Exists(entry.Path);
        }
        catch
        {
            return false;
        }
    }

    private static void SaveLocked()
    {
        try
        {
            var directory = Path.GetDirectoryName(StorePath)!;
            Directory.CreateDirectory(directory);
            var temp = Path.Combine(directory, $"recent.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
            var persisted = _entries!
                .Take(MaximumEntries)
                .Select(entry => new PersistedRecentLocation
                {
                    Path = entry.Path,
                    IsDirectory = entry.IsDirectory,
                    LastOpenedUtc = entry.LastOpenedUtc,
                })
                .ToArray();
            File.WriteAllText(
                temp,
                JsonSerializer.Serialize(persisted),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temp, StorePath, overwrite: true);
        }
        catch
        {
            // Keep the in-memory MRU even when the profile is temporarily read-only/locked.
        }
    }

    private sealed class PersistedRecentLocation
    {
        public string Path { get; set; } = string.Empty;
        public bool IsDirectory { get; set; }
        public DateTimeOffset LastOpenedUtc { get; set; }
    }
}

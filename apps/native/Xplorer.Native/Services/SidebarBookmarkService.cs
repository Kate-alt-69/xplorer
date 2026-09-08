using System.Text;
using System.Text.Json;

namespace Xplorer.Native.Services;

/// <summary>
/// Native persistence for the original Xplorer sidebar's bookmarks section. Only directory paths
/// are stored; invalid/deleted paths are filtered at read time and never block startup.
/// </summary>
internal static class SidebarBookmarkService
{
    private const int MaximumBookmarks = 64;
    private const int MaximumFileBytes = 64 * 1024;
    private static readonly object Gate = new();
    private static List<string>? _paths;

    private static string StorePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "bookmarks.json");

    public static IReadOnlyList<string> Get()
    {
        lock (Gate)
        {
            EnsureLoaded();
            return _paths!
                .Where(DirectoryExistsSafe)
                .Take(MaximumBookmarks)
                .ToArray();
        }
    }

    public static bool Add(string path)
    {
        var normalized = NormalizeDirectory(path);
        if (normalized is null) return false;

        lock (Gate)
        {
            EnsureLoaded();
            if (_paths!.Any(existing =>
                    string.Equals(existing, normalized, StringComparison.OrdinalIgnoreCase)))
            {
                return false;
            }

            _paths.Add(normalized);
            if (_paths.Count > MaximumBookmarks)
                _paths.RemoveRange(MaximumBookmarks, _paths.Count - MaximumBookmarks);
            SaveLocked();
            return true;
        }
    }

    public static bool Remove(string path)
    {
        lock (Gate)
        {
            EnsureLoaded();
            var removed = _paths!.RemoveAll(existing =>
                string.Equals(existing, path, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removed) SaveLocked();
            return removed;
        }
    }

    private static void EnsureLoaded()
    {
        if (_paths is not null) return;
        _paths = [];

        try
        {
            var info = new FileInfo(StorePath);
            if (!info.Exists || info.Length <= 0 || info.Length > MaximumFileBytes) return;
            var loaded = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(StorePath, Encoding.UTF8));
            if (loaded is null) return;

            foreach (var path in loaded.Take(MaximumBookmarks))
            {
                var normalized = NormalizeDirectory(path);
                if (normalized is null) continue;
                if (_paths.Any(existing =>
                        string.Equals(existing, normalized, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }
                _paths.Add(normalized);
            }
        }
        catch
        {
            // Bookmarks are convenience state; malformed/locked storage is non-fatal.
        }
    }

    private static string? NormalizeDirectory(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try
        {
            var full = Path.GetFullPath(path);
            return Directory.Exists(full) ? full : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool DirectoryExistsSafe(string path)
    {
        try { return Directory.Exists(path); }
        catch { return false; }
    }

    private static void SaveLocked()
    {
        try
        {
            var directory = Path.GetDirectoryName(StorePath)!;
            Directory.CreateDirectory(directory);
            var temp = Path.Combine(directory, $"bookmarks.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
            File.WriteAllText(
                temp,
                JsonSerializer.Serialize(_paths),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temp, StorePath, overwrite: true);
        }
        catch
        {
            // Keep the in-memory list usable when the profile is temporarily read-only.
        }
    }
}

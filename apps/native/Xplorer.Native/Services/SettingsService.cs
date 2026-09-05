using System.Text.Json;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

public sealed class SettingsService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _settingsPath;

    public SettingsService()
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Xplorer");
        Directory.CreateDirectory(root);
        _settingsPath = Path.Combine(root, "settings.json");
        Current = Load();
    }

    public XplorerSettings Current { get; private set; }

    private XplorerSettings Load()
    {
        try
        {
            if (!File.Exists(_settingsPath)) return new XplorerSettings();
            return JsonSerializer.Deserialize<XplorerSettings>(File.ReadAllText(_settingsPath), JsonOptions)
                   ?? new XplorerSettings();
        }
        catch
        {
            return new XplorerSettings();
        }
    }

    /// <summary>
    /// Reloads a complete settings file only after it can be parsed successfully. FileSystemWatcher
    /// can observe the temporary gap of an atomic replace, so a transient read must never replace
    /// live settings with defaults.
    /// </summary>
    public bool TryReload()
    {
        try
        {
            if (!File.Exists(_settingsPath)) return false;
            var reloaded = JsonSerializer.Deserialize<XplorerSettings>(File.ReadAllText(_settingsPath), JsonOptions);
            if (reloaded is null) return false;
            Current = reloaded;
            return true;
        }
        catch
        {
            return false;
        }
    }

    public string GetViewMode(string folder)
    {
        if (Current.RememberViewPerFolder &&
            Current.FolderOverrides.TryGetValue(folder, out var folderSettings))
        {
            return folderSettings.ViewMode;
        }

        return Current.DefaultViewMode;
    }

    public string GetSortMode(string folder)
    {
        if (Current.RememberViewPerFolder &&
            Current.FolderOverrides.TryGetValue(folder, out var folderSettings))
        {
            return folderSettings.SortMode;
        }

        return Current.DefaultSortMode;
    }

    public async Task SetViewModeAsync(string folder, string viewMode)
    {
        if (Current.RememberViewPerFolder)
        {
            var folderSettings = GetOrCreateFolderOverride(folder);
            folderSettings.ViewMode = viewMode;
        }
        else
        {
            Current.DefaultViewMode = viewMode;
        }

        await SaveAsync();
    }

    public async Task SetSortModeAsync(string folder, string sortMode)
    {
        if (Current.RememberViewPerFolder)
        {
            var folderSettings = GetOrCreateFolderOverride(folder);
            folderSettings.SortMode = sortMode;
        }
        else
        {
            Current.DefaultSortMode = sortMode;
        }

        await SaveAsync();
    }

    private FolderViewSettings GetOrCreateFolderOverride(string folder)
    {
        if (Current.FolderOverrides.TryGetValue(folder, out var existing)) return existing;

        var created = new FolderViewSettings
        {
            ViewMode = Current.DefaultViewMode,
            SortMode = Current.DefaultSortMode,
        };
        Current.FolderOverrides[folder] = created;
        return created;
    }

    public void Save()
    {
        var tempPath = _settingsPath + ".tmp";
        var json = JsonSerializer.Serialize(Current, JsonOptions);
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _settingsPath, overwrite: true);
    }

    public async Task SaveAsync()
    {
        var tempPath = _settingsPath + ".tmp";
        var json = JsonSerializer.Serialize(Current, JsonOptions);
        await File.WriteAllTextAsync(tempPath, json);
        File.Move(tempPath, _settingsPath, overwrite: true);
    }
}

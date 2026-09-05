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
            var loaded = JsonSerializer.Deserialize<XplorerSettings>(File.ReadAllText(_settingsPath), JsonOptions);
            return loaded is null ? new XplorerSettings() : Normalize(loaded);
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
            Current = Normalize(reloaded);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static XplorerSettings Normalize(XplorerSettings settings)
    {
        settings.Theme = string.IsNullOrWhiteSpace(settings.Theme) ? "System" : settings.Theme;
        settings.ThemeFileName = string.IsNullOrWhiteSpace(settings.ThemeFileName) ? "default.xml" : settings.ThemeFileName;
        settings.DefaultViewMode = string.IsNullOrWhiteSpace(settings.DefaultViewMode) ? "Medium" : settings.DefaultViewMode;
        settings.DefaultSortMode = string.IsNullOrWhiteSpace(settings.DefaultSortMode) ? "Name" : settings.DefaultSortMode;
        settings.TerminalCommand ??= string.Empty;
        settings.TerminalArguments ??= string.Empty;

        // System.Text.Json recreates dictionaries with its default comparer. Rebuild this one so
        // Windows paths remain case-insensitive after restart just like they are during first run.
        var normalizedOverrides = new Dictionary<string, FolderViewSettings>(StringComparer.OrdinalIgnoreCase);
        if (settings.FolderOverrides is not null)
        {
            foreach (var pair in settings.FolderOverrides)
            {
                if (string.IsNullOrWhiteSpace(pair.Key) || pair.Value is null) continue;
                normalizedOverrides[pair.Key] = pair.Value;
            }
        }
        settings.FolderOverrides = normalizedOverrides;

        settings.Session ??= new ExplorerSessionSettings();
        settings.Session.Tabs ??= [];
        settings.Session.Window ??= new WindowPlacementSettings();
        foreach (var tab in settings.Session.Tabs)
        {
            tab.CurrentPath ??= string.Empty;
            tab.BackHistory ??= [];
            tab.ForwardHistory ??= [];
        }

        return settings;
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

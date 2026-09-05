using System.Text.Json;
using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

public sealed class SettingsService
{
    private const long MaximumSettingsBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly string[] AllowedThemes = ["System", "Dark", "Light", "Custom XML"];
    private static readonly string[] AllowedViewModes = ["Medium", "Large", "Details"];
    private static readonly string[] AllowedSortModes = ["Name", "Date modified", "Type", "Size"];

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

    /// <summary>
    /// Raised only after the settings file has been replaced successfully. MainWindow uses this to
    /// apply auto-saved Settings-dialog changes immediately without waiting for FileSystemWatcher.
    /// </summary>
    public event EventHandler? Saved;

    private XplorerSettings Load()
    {
        try
        {
            if (!File.Exists(_settingsPath)) return new XplorerSettings();
            if (new FileInfo(_settingsPath).Length > MaximumSettingsBytes) return new XplorerSettings();
            var loaded = JsonSerializer.Deserialize<XplorerSettings>(File.ReadAllText(_settingsPath), JsonOptions);
            return loaded is null ? new XplorerSettings() : Normalize(loaded);
        }
        catch
        {
            return new XplorerSettings();
        }
    }

    public bool TryReload()
    {
        try
        {
            if (!File.Exists(_settingsPath)) return false;
            if (new FileInfo(_settingsPath).Length > MaximumSettingsBytes) return false;
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
        settings.Theme = NormalizeChoice(settings.Theme, AllowedThemes, "System");
        settings.ThemeFileName = string.IsNullOrWhiteSpace(settings.ThemeFileName) ? "default.xml" : settings.ThemeFileName.Trim();
        settings.DefaultViewMode = NormalizeChoice(settings.DefaultViewMode, AllowedViewModes, "Medium");
        settings.DefaultSortMode = NormalizeChoice(settings.DefaultSortMode, AllowedSortModes, "Name");
        settings.TerminalCommand ??= string.Empty;
        settings.TerminalArguments ??= string.Empty;

        var normalizedOverrides = new Dictionary<string, FolderViewSettings>(StringComparer.OrdinalIgnoreCase);
        if (settings.FolderOverrides is not null)
        {
            foreach (var pair in settings.FolderOverrides)
            {
                if (string.IsNullOrWhiteSpace(pair.Key) || pair.Value is null) continue;

                string folder;
                try { folder = Path.GetFullPath(pair.Key.Trim()); }
                catch { continue; }

                normalizedOverrides[folder] = new FolderViewSettings
                {
                    ViewMode = NormalizeChoice(pair.Value.ViewMode, AllowedViewModes, settings.DefaultViewMode),
                    SortMode = NormalizeChoice(pair.Value.SortMode, AllowedSortModes, settings.DefaultSortMode),
                };
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

    private static string NormalizeChoice(string? value, IReadOnlyList<string> allowed, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var match = allowed.FirstOrDefault(candidate =>
            string.Equals(candidate, value.Trim(), StringComparison.OrdinalIgnoreCase));
        return match ?? fallback;
    }

    public string GetViewMode(string folder)
    {
        folder = NormalizeFolderKey(folder);
        if (Current.RememberViewPerFolder &&
            Current.FolderOverrides.TryGetValue(folder, out var folderSettings))
            return folderSettings.ViewMode;
        return Current.DefaultViewMode;
    }

    public string GetSortMode(string folder)
    {
        folder = NormalizeFolderKey(folder);
        if (Current.RememberViewPerFolder &&
            Current.FolderOverrides.TryGetValue(folder, out var folderSettings))
            return folderSettings.SortMode;
        return Current.DefaultSortMode;
    }

    public async Task SetViewModeAsync(string folder, string viewMode)
    {
        viewMode = NormalizeChoice(viewMode, AllowedViewModes, Current.DefaultViewMode);
        if (Current.RememberViewPerFolder)
            GetOrCreateFolderOverride(folder).ViewMode = viewMode;
        else
            Current.DefaultViewMode = viewMode;
        await SaveAsync();
    }

    public async Task SetSortModeAsync(string folder, string sortMode)
    {
        sortMode = NormalizeChoice(sortMode, AllowedSortModes, Current.DefaultSortMode);
        if (Current.RememberViewPerFolder)
            GetOrCreateFolderOverride(folder).SortMode = sortMode;
        else
            Current.DefaultSortMode = sortMode;
        await SaveAsync();
    }

    private FolderViewSettings GetOrCreateFolderOverride(string folder)
    {
        folder = NormalizeFolderKey(folder);
        if (Current.FolderOverrides.TryGetValue(folder, out var existing)) return existing;

        var created = new FolderViewSettings
        {
            ViewMode = Current.DefaultViewMode,
            SortMode = Current.DefaultSortMode,
        };
        Current.FolderOverrides[folder] = created;
        return created;
    }

    private static string NormalizeFolderKey(string folder)
    {
        try { return Path.GetFullPath(folder); }
        catch { return folder; }
    }

    public void Save()
    {
        var json = JsonSerializer.Serialize(Current, JsonOptions);
        var tempPath = CreateUniqueTempPath();
        try
        {
            File.WriteAllText(tempPath, json);
            File.Move(tempPath, _settingsPath, overwrite: true);
            Saved?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            TryDeleteTemp(tempPath);
        }
    }

    public async Task SaveAsync()
    {
        var json = JsonSerializer.Serialize(Current, JsonOptions);
        var tempPath = CreateUniqueTempPath();
        try
        {
            await File.WriteAllTextAsync(tempPath, json);
            File.Move(tempPath, _settingsPath, overwrite: true);
            Saved?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            TryDeleteTemp(tempPath);
        }
    }

    private string CreateUniqueTempPath() =>
        $"{_settingsPath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";

    private static void TryDeleteTemp(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // A failed cleanup should not hide the original save result.
        }
    }
}

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

    public string GetViewMode(string folder)
    {
        if (Current.RememberViewPerFolder &&
            Current.FolderOverrides.TryGetValue(folder, out var folderSettings))
        {
            return folderSettings.ViewMode;
        }

        return Current.DefaultViewMode;
    }

    public async Task SetViewModeAsync(string folder, string viewMode)
    {
        if (Current.RememberViewPerFolder)
        {
            Current.FolderOverrides[folder] = new FolderViewSettings { ViewMode = viewMode };
        }
        else
        {
            Current.DefaultViewMode = viewMode;
        }

        await SaveAsync();
    }

    public async Task SaveAsync()
    {
        var tempPath = _settingsPath + ".tmp";
        var json = JsonSerializer.Serialize(Current, JsonOptions);
        await File.WriteAllTextAsync(tempPath, json);
        File.Move(tempPath, _settingsPath, overwrite: true);
    }
}

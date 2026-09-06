using System.Text;
using System.Text.Json;

namespace Xplorer.Native.Services;

internal enum XplorerContextCommand
{
    OpenInspector,
    OpenTerminal,
    CopyPath,
}

internal readonly record struct XplorerContextMenuEntry(XplorerContextCommand Command, string Label);

/// <summary>
/// Loads the small user-editable Xplorer-owned section that is prepended to the real Windows Shell
/// HMENU. Only known built-in command IDs are accepted; this config deliberately cannot execute an
/// arbitrary program or replace Shell extension behavior.
/// </summary>
internal static class XplorerContextMenuConfigService
{
    private const int MaximumConfigBytes = 32 * 1024;
    private const int MaximumLabelLength = 80;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private static readonly ConfigFile DefaultConfig = new()
    {
        Version = 1,
        Commands =
        [
            new CommandConfig { Id = "inspector", Label = "Open in Inspector", Enabled = true },
            new CommandConfig { Id = "terminal", Label = "Open terminal here", Enabled = true },
            new CommandConfig { Id = "copyPath", Label = "Copy path", Enabled = true },
        ],
    };

    public static string ConfigPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "context-menu.json");

    public static IReadOnlyList<XplorerContextMenuEntry> Load(bool canInspect)
    {
        EnsureDefaultFile();
        try
        {
            var info = new FileInfo(ConfigPath);
            if (!info.Exists || info.Length <= 0 || info.Length > MaximumConfigBytes)
                return BuildEntries(DefaultConfig, canInspect);

            var text = File.ReadAllText(ConfigPath, Encoding.UTF8);
            var config = JsonSerializer.Deserialize<ConfigFile>(text, JsonOptions);
            if (config is null || config.Version != 1 || config.Commands is null)
                return BuildEntries(DefaultConfig, canInspect);

            return BuildEntries(config, canInspect);
        }
        catch
        {
            // Context-menu customization is cosmetic. A malformed/locked config must never prevent
            // the real Shell menu from opening.
            return BuildEntries(DefaultConfig, canInspect);
        }
    }

    private static void EnsureDefaultFile()
    {
        try
        {
            if (File.Exists(ConfigPath)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
            File.WriteAllText(
                ConfigPath,
                JsonSerializer.Serialize(DefaultConfig, JsonOptions),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        }
        catch
        {
            // The in-memory defaults remain usable on read-only/locked profiles.
        }
    }

    private static IReadOnlyList<XplorerContextMenuEntry> BuildEntries(ConfigFile config, bool canInspect)
    {
        var result = new List<XplorerContextMenuEntry>(3);
        var seen = new HashSet<XplorerContextCommand>();
        foreach (var item in config.Commands ?? [])
        {
            if (item is null || !item.Enabled || !TryParseCommand(item.Id, out var command)) continue;
            if (command == XplorerContextCommand.OpenInspector && !canInspect) continue;
            if (!seen.Add(command)) continue;

            var fallback = DefaultLabel(command);
            var label = SanitizeLabel(item.Label, fallback);
            result.Add(new XplorerContextMenuEntry(command, label));
        }
        return result;
    }

    private static bool TryParseCommand(string? id, out XplorerContextCommand command)
    {
        command = default;
        if (string.Equals(id, "inspector", StringComparison.OrdinalIgnoreCase))
        {
            command = XplorerContextCommand.OpenInspector;
            return true;
        }
        if (string.Equals(id, "terminal", StringComparison.OrdinalIgnoreCase))
        {
            command = XplorerContextCommand.OpenTerminal;
            return true;
        }
        if (string.Equals(id, "copyPath", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(id, "copy-path", StringComparison.OrdinalIgnoreCase))
        {
            command = XplorerContextCommand.CopyPath;
            return true;
        }
        return false;
    }

    private static string SanitizeLabel(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var label = value.Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Trim();
        if (label.Length == 0) return fallback;
        return label.Length <= MaximumLabelLength ? label : label[..MaximumLabelLength];
    }

    private static string DefaultLabel(XplorerContextCommand command) => command switch
    {
        XplorerContextCommand.OpenInspector => "Open in Inspector",
        XplorerContextCommand.OpenTerminal => "Open terminal here",
        XplorerContextCommand.CopyPath => "Copy path",
        _ => "Xplorer command",
    };

    private sealed class ConfigFile
    {
        public int Version { get; set; }
        public List<CommandConfig?>? Commands { get; set; }
    }

    private sealed class CommandConfig
    {
        public string? Id { get; set; }
        public string? Label { get; set; }
        public bool Enabled { get; set; } = true;
    }
}

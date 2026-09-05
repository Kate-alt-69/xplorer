namespace Xplorer.Native.Models;

public sealed class XplorerSettings
{
    public string Theme { get; set; } = "System";
    public string ThemeFileName { get; set; } = "default.xml";
    public string DefaultViewMode { get; set; } = "Medium";
    public string DefaultSortMode { get; set; } = "Name";
    public bool ShowHiddenFiles { get; set; }
    public bool ShowFileExtensions { get; set; } = true;
    public bool RememberViewPerFolder { get; set; }
    public string TerminalCommand { get; set; } = string.Empty;
    public string TerminalArguments { get; set; } = string.Empty;

    // Xplorer is a file manager, so fresh installs expose its owned HKCU "Open in Xplorer" verbs
    // immediately. This never replaces explorer.exe or system file-open handlers, and the setting
    // remains user-toggleable; ShellIntegrationService removes only registry keys carrying our
    // ownership marker when disabled/uninstalled.
    public bool WindowsShellContextMenu { get; set; } = true;

    public bool BackgroundIndexing { get; set; } = true;
    public Dictionary<string, FolderViewSettings> FolderOverrides { get; set; } =
        new(StringComparer.OrdinalIgnoreCase);
    public ExplorerSessionSettings Session { get; set; } = new();
}

public sealed class FolderViewSettings
{
    public string ViewMode { get; set; } = "Medium";
    public string SortMode { get; set; } = "Name";
}

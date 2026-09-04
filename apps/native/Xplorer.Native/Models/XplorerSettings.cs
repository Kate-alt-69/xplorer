namespace Xplorer.Native.Models;

public sealed class XplorerSettings
{
    public string Theme { get; set; } = "System";
    public string DefaultViewMode { get; set; } = "Medium";
    public string DefaultSortMode { get; set; } = "Name";
    public bool ShowHiddenFiles { get; set; }
    public bool ShowFileExtensions { get; set; } = true;
    public bool RememberViewPerFolder { get; set; }
    public string TerminalCommand { get; set; } = string.Empty;
    public string TerminalArguments { get; set; } = string.Empty;
    public bool WindowsShellContextMenu { get; set; }
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

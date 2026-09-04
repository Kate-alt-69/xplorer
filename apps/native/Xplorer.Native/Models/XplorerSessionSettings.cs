namespace Xplorer.Native.Models;

public sealed class ExplorerSessionSettings
{
    public List<ExplorerTabSession> Tabs { get; set; } = [];
    public int SelectedTabIndex { get; set; }
}

public sealed class ExplorerTabSession
{
    public string CurrentPath { get; set; } = string.Empty;
    public List<string> BackHistory { get; set; } = [];
    public List<string> ForwardHistory { get; set; } = [];
}

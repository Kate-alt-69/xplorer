namespace Xplorer.Native.Models;

public sealed class ExplorerSessionSettings
{
    public List<ExplorerTabSession> Tabs { get; set; } = [];
    public int SelectedTabIndex { get; set; }
    public WindowPlacementSettings Window { get; set; } = new();
}

public sealed class ExplorerTabSession
{
    public string CurrentPath { get; set; } = string.Empty;
    public List<string> BackHistory { get; set; } = [];
    public List<string> ForwardHistory { get; set; } = [];
}

public sealed class WindowPlacementSettings
{
    public bool HasValue { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
}

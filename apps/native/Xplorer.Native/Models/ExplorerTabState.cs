namespace Xplorer.Native.Models;

public sealed class ExplorerTabState
{
    public Guid Id { get; } = Guid.NewGuid();
    public required string CurrentPath { get; set; }
    public Stack<string> BackHistory { get; } = new();
    public Stack<string> ForwardHistory { get; } = new();
}

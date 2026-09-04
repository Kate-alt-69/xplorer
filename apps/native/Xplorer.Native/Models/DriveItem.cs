namespace Xplorer.Native.Models;

public sealed class DriveItem
{
    public required string RootPath { get; init; }
    public required string DisplayName { get; init; }
    public required string FreeSpaceText { get; init; }
    public required double UsedPercent { get; init; }
    public required bool CanEject { get; init; }
}

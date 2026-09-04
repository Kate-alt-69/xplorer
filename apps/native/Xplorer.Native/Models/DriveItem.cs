namespace Xplorer.Native.Models;

/// <summary>
/// XAML-visible drive model. Public setters are intentional: WinUI's generated XamlTypeInfo
/// creates model instances through reflection and cannot assign C# required/init-only members.
/// </summary>
public sealed class DriveItem
{
    public string RootPath { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string FreeSpaceText { get; set; } = string.Empty;
    public double UsedPercent { get; set; }
    public bool CanEject { get; set; }
}

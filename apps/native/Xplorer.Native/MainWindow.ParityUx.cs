using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _fileInteractionParityInitialized;

    /// <summary>
    /// Adds layout-only native parity helpers. File input ownership deliberately stays in
    /// MainWindow.ContextMenus.cs/XAML so a visual-parity feature cannot silently change WinUI's
    /// click/double-click gesture arbitration again.
    /// </summary>
    private void InitializeFileInteractionParity()
    {
        if (_fileInteractionParityInitialized) return;
        _fileInteractionParityInitialized = true;

        // Do NOT set FileGrid/FileDetails.IsItemClickEnabled here and do not subscribe ItemClick.
        // On Windows 10 that changes ListViewBase gesture arbitration and can swallow the native
        // DoubleTapped route used for reliable folder activation. Keyboard activation is likewise
        // owned by InitializeMouseActivationGestures so it can only be wired once.

        // MainWindow.xaml explicitly owns the transparent file surfaces. Do not ClearValue or set
        // these to null here: that would allow the stock WinUI ListView/GridView background to
        // bleed through when switching view modes.

        if (SidebarBorder.Child is not Grid sidebarGrid) return;

        var grip = new Border
        {
            Width = 8,
            Background = null,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Stretch,
            ManipulationMode = ManipulationModes.TranslateX,
        };
        Grid.SetRowSpan(grip, Math.Max(1, sidebarGrid.RowDefinitions.Count));
        Canvas.SetZIndex(grip, 100);
        ToolTipService.SetToolTip(grip, "Drag to resize sidebar • double-click to reset");
        grip.ManipulationDelta += SidebarResizeGrip_ManipulationDelta;
        grip.DoubleTapped += SidebarResizeGrip_DoubleTapped;
        sidebarGrid.Children.Add(grip);
    }
}

using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private bool _fileInteractionParityInitialized;

    /// <summary>
    /// Completes the native file-view input contract on Windows 10/11 and adds the resize hit target
    /// between navigation chrome and the file surface. The grip is intentionally transparent so it
    /// does not alter Xplorer's first-frame geometry or theme.
    /// </summary>
    private void InitializeFileInteractionParity()
    {
        if (_fileInteractionParityInitialized) return;
        _fileInteractionParityInitialized = true;

        FileGrid.IsItemClickEnabled = true;
        FileDetails.IsItemClickEnabled = true;
        FileGrid.ItemClick += FileList_ItemClick;
        FileDetails.ItemClick += FileList_ItemClick;
        FileGrid.KeyDown += FileList_KeyDown;
        FileDetails.KeyDown += FileList_KeyDown;

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

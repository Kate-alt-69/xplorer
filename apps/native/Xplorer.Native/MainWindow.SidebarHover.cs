using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private readonly List<Button> _sidebarLocationButtons = [];

    private void InitializeSidebarHoverRecovery()
    {
        if (_sidebarLocationButtons.Count > 0) return;

        CollectSidebarLocationButtons(SidebarBorder);
        foreach (var button in _sidebarLocationButtons)
        {
            button.PointerEntered += SidebarLocation_PointerEntered;
            button.PointerExited += SidebarLocation_PointerExited;
            ApplySidebarForeground(button, hover: false);
        }

        Closed += (_, _) =>
        {
            foreach (var button in _sidebarLocationButtons)
            {
                button.PointerEntered -= SidebarLocation_PointerEntered;
                button.PointerExited -= SidebarLocation_PointerExited;
            }
            _sidebarLocationButtons.Clear();
        };
    }

    private void CollectSidebarLocationButtons(DependencyObject parent)
    {
        var count = VisualTreeHelper.GetChildrenCount(parent);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            if (child is Button { Tag: string tag } button &&
                tag is "Home" or "Desktop" or "Downloads" or "Documents" or "Pictures")
            {
                _sidebarLocationButtons.Add(button);
            }
            CollectSidebarLocationButtons(child);
        }
    }

    private void SidebarLocation_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Button button) ApplySidebarForeground(button, hover: true);
    }

    private void SidebarLocation_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (sender is Button button) ApplySidebarForeground(button, hover: false);
    }

    private void ApplySidebarForeground(Button button, bool hover)
    {
        var key = hover ? "XplorerTextBrush" : "XplorerTextSecondaryBrush";
        if (Root.Resources.TryGetValue(key, out var local) && local is Brush localBrush)
        {
            button.Foreground = localBrush;
            return;
        }

        if (Application.Current.Resources.TryGetValue(key, out var app) && app is Brush appBrush)
            button.Foreground = appBrush;
    }
}

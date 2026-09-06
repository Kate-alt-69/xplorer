using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Xplorer.Native.Views;

public sealed partial class SettingsDialog
{
    private bool _terminalSettingsLoaded;

    private void SettingsDialog_Loaded(object sender, RoutedEventArgs e)
    {
        if (_terminalSettingsLoaded) return;
        _terminalSettingsLoaded = true;
        SectionList.SelectionChanged += TerminalSettingsSection_SelectionChanged;
        RefreshTerminalSettingsPresentation();
    }

    private void TerminalSettingsSection_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RefreshTerminalSettingsPresentation();

    private void RefreshTerminalSettingsPresentation()
    {
        var terminalSelected = string.Equals(
            (SectionList.SelectedItem as ListViewItem)?.Tag?.ToString(),
            "Terminal",
            StringComparison.OrdinalIgnoreCase);

        TerminalBehaviorCard.Visibility = terminalSelected ? Visibility.Visible : Visibility.Collapsed;
        if (!terminalSelected) return;

        SectionDescription.Text = "Embedded ConPTY shell, terminal tabs and folder-aware session behavior.";

        // BuildTerminalPage is part of the existing dynamic settings renderer. Replace its legacy
        // Windows-Terminal wording after it has rendered; this runs in the same selection event turn
        // so the stale text is never presented as a frame.
        if (PageHost.Children.FirstOrDefault() is TextBlock description)
        {
            description.Text =
                "Xplorer hosts a real Windows pseudoconsole inside the app. Leave Custom command empty for Auto: PowerShell 7, then Windows PowerShell, then Command Prompt. Windows Terminal is not required.";
        }

        WithSuppressedEvents(() =>
            SelectComboItem(
                TerminalFolderBehaviorComboBox,
                NormalizeTerminalFolderBehavior(_settingsService.Current.TerminalFolderChangeBehavior)));
    }

    private async void TerminalFolderBehaviorComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_terminalSettingsLoaded || _suppressEvents) return;

        var settings = _settingsService.Current;
        var old = NormalizeTerminalFolderBehavior(settings.TerminalFolderChangeBehavior);
        var value = NormalizeTerminalFolderBehavior(ReadComboItem(TerminalFolderBehaviorComboBox, old));
        if (string.Equals(old, value, StringComparison.OrdinalIgnoreCase)) return;

        await PersistSimpleAsync(
            target => target.TerminalFolderChangeBehavior = value,
            target => target.TerminalFolderChangeBehavior = old,
            () => SelectComboItem(TerminalFolderBehaviorComboBox, old));
    }

    private static string NormalizeTerminalFolderBehavior(string? value) =>
        string.Equals(value, "Open new tab", StringComparison.OrdinalIgnoreCase)
            ? "Open new tab"
            : "Refresh active tab";
}

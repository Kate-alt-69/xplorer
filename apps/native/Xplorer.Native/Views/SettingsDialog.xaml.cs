using Microsoft.UI.Xaml.Controls;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class SettingsDialog : ContentDialog
{
    private readonly SettingsService _settingsService;

    public SettingsDialog(SettingsService settingsService)
    {
        InitializeComponent();
        _settingsService = settingsService;

        var settings = _settingsService.Current;
        SelectComboItem(ThemeComboBox, settings.Theme);
        SelectComboItem(ViewModeComboBox, settings.DefaultViewMode);
        ShowHiddenSwitch.IsOn = settings.ShowHiddenFiles;
        ShowExtensionsSwitch.IsOn = settings.ShowFileExtensions;
        PerFolderViewSwitch.IsOn = settings.RememberViewPerFolder;
        TerminalCommandBox.Text = settings.TerminalCommand;
        TerminalArgumentsBox.Text = settings.TerminalArguments;

        PrimaryButtonClick += OnPrimaryButtonClick;
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            var settings = _settingsService.Current;
            settings.Theme = ReadComboItem(ThemeComboBox, "System");
            settings.DefaultViewMode = ReadComboItem(ViewModeComboBox, "Medium");
            settings.ShowHiddenFiles = ShowHiddenSwitch.IsOn;
            settings.ShowFileExtensions = ShowExtensionsSwitch.IsOn;
            settings.RememberViewPerFolder = PerFolderViewSwitch.IsOn;
            settings.TerminalCommand = TerminalCommandBox.Text.Trim();
            settings.TerminalArguments = TerminalArgumentsBox.Text.Trim();
            await _settingsService.SaveAsync();
        }
        finally
        {
            deferral.Complete();
        }
    }

    private static string ReadComboItem(ComboBox comboBox, string fallback) =>
        (comboBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? fallback;

    private static void SelectComboItem(ComboBox comboBox, string value)
    {
        foreach (var item in comboBox.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(item.Content?.ToString(), value, StringComparison.OrdinalIgnoreCase))
            {
                comboBox.SelectedItem = item;
                return;
            }
        }
    }
}

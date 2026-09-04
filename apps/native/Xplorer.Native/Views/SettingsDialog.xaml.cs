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
        SelectComboItem(SortModeComboBox, settings.DefaultSortMode);
        ShowHiddenSwitch.IsOn = settings.ShowHiddenFiles;
        ShowExtensionsSwitch.IsOn = settings.ShowFileExtensions;
        PerFolderViewSwitch.IsOn = settings.RememberViewPerFolder;
        TerminalCommandBox.Text = settings.TerminalCommand;
        TerminalArgumentsBox.Text = settings.TerminalArguments;
        WindowsShellMenuSwitch.IsOn = settings.WindowsShellContextMenu;

        PrimaryButtonClick += OnPrimaryButtonClick;
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            IntegrationStatusText.Text = string.Empty;
            var settings = _settingsService.Current;
            settings.Theme = ReadComboItem(ThemeComboBox, "System");
            settings.DefaultViewMode = ReadComboItem(ViewModeComboBox, "Medium");
            settings.DefaultSortMode = ReadComboItem(SortModeComboBox, "Name");
            settings.ShowHiddenFiles = ShowHiddenSwitch.IsOn;
            settings.ShowFileExtensions = ShowExtensionsSwitch.IsOn;
            settings.RememberViewPerFolder = PerFolderViewSwitch.IsOn;
            settings.TerminalCommand = TerminalCommandBox.Text.Trim();
            settings.TerminalArguments = TerminalArgumentsBox.Text.Trim();
            settings.WindowsShellContextMenu = WindowsShellMenuSwitch.IsOn;

            ShellIntegrationService.Apply(settings.WindowsShellContextMenu);
            await _settingsService.SaveAsync();
        }
        catch (Exception ex)
        {
            args.Cancel = true;
            IntegrationStatusText.Text = $"Windows integration could not be updated: {ex.Message}";
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

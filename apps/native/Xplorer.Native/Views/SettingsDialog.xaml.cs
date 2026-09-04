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

        ThemeService.EnsureDefaultThemeFile();
        var settings = _settingsService.Current;
        SelectComboItem(ThemeComboBox, settings.Theme);
        ThemeFileBox.Text = settings.ThemeFileName;
        ThemeFolderText.Text = $"Theme folder: {ThemeService.ThemeDirectory}";
        SelectComboItem(ViewModeComboBox, settings.DefaultViewMode);
        SelectComboItem(SortModeComboBox, settings.DefaultSortMode);
        ShowHiddenSwitch.IsOn = settings.ShowHiddenFiles;
        ShowExtensionsSwitch.IsOn = settings.ShowFileExtensions;
        PerFolderViewSwitch.IsOn = settings.RememberViewPerFolder;
        TerminalCommandBox.Text = settings.TerminalCommand;
        TerminalArgumentsBox.Text = settings.TerminalArguments;
        WindowsShellMenuSwitch.IsOn = settings.WindowsShellContextMenu;
        BackgroundIndexingSwitch.IsOn = settings.BackgroundIndexing;

        PrimaryButtonClick += OnPrimaryButtonClick;
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            IntegrationStatusText.Text = string.Empty;
            var settings = _settingsService.Current;
            var selectedTheme = ReadComboItem(ThemeComboBox, "System");
            var selectedThemeFile = string.IsNullOrWhiteSpace(ThemeFileBox.Text)
                ? "default.xml"
                : ThemeFileBox.Text.Trim();

            if (string.Equals(selectedTheme, "Custom XML", StringComparison.OrdinalIgnoreCase))
                _ = ThemeService.Load(selectedThemeFile);
            else
                _ = ThemeService.ResolveThemePath(selectedThemeFile);

            settings.Theme = selectedTheme;
            settings.ThemeFileName = selectedThemeFile;
            settings.DefaultViewMode = ReadComboItem(ViewModeComboBox, "Medium");
            settings.DefaultSortMode = ReadComboItem(SortModeComboBox, "Name");
            settings.ShowHiddenFiles = ShowHiddenSwitch.IsOn;
            settings.ShowFileExtensions = ShowExtensionsSwitch.IsOn;
            settings.RememberViewPerFolder = PerFolderViewSwitch.IsOn;
            settings.TerminalCommand = TerminalCommandBox.Text.Trim();
            settings.TerminalArguments = TerminalArgumentsBox.Text.Trim();
            settings.WindowsShellContextMenu = WindowsShellMenuSwitch.IsOn;
            settings.BackgroundIndexing = BackgroundIndexingSwitch.IsOn;

            ShellIntegrationService.Apply(settings.WindowsShellContextMenu);
            IndexWorkerService.Apply(settings.BackgroundIndexing);
            await _settingsService.SaveAsync();
        }
        catch (Exception ex)
        {
            args.Cancel = true;
            IntegrationStatusText.Text = $"Settings could not be updated: {ex.Message}";
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

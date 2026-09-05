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
        var settings = _settingsService.Current;

        var previousTheme = settings.Theme;
        var previousThemeFileName = settings.ThemeFileName;
        var previousViewMode = settings.DefaultViewMode;
        var previousSortMode = settings.DefaultSortMode;
        var previousShowHidden = settings.ShowHiddenFiles;
        var previousShowExtensions = settings.ShowFileExtensions;
        var previousPerFolderView = settings.RememberViewPerFolder;
        var previousTerminalCommand = settings.TerminalCommand;
        var previousTerminalArguments = settings.TerminalArguments;
        var previousShellIntegration = settings.WindowsShellContextMenu;
        var previousBackgroundIndexing = settings.BackgroundIndexing;

        var shellIntegrationAttempted = false;
        var backgroundIndexingAttempted = false;

        try
        {
            IntegrationStatusText.Text = string.Empty;
            var selectedTheme = ReadComboItem(ThemeComboBox, "System");
            var selectedThemeFile = string.IsNullOrWhiteSpace(ThemeFileBox.Text)
                ? "default.xml"
                : ThemeFileBox.Text.Trim();
            var desiredShellIntegration = WindowsShellMenuSwitch.IsOn;
            var desiredBackgroundIndexing = BackgroundIndexingSwitch.IsOn;

            // The XML filename is irrelevant while System/Dark/Light is active. Validating it in
            // those modes previously made an old/bad custom filename block unrelated settings saves.
            if (string.Equals(selectedTheme, "Custom XML", StringComparison.OrdinalIgnoreCase))
                _ = ThemeService.Load(selectedThemeFile);

            // External integration can partially mutate Windows state before throwing. Mark each
            // operation as attempted before calling it so a failure midway still triggers rollback.
            shellIntegrationAttempted = true;
            ShellIntegrationService.Apply(desiredShellIntegration);

            backgroundIndexingAttempted = true;
            IndexWorkerService.Apply(desiredBackgroundIndexing);

            settings.Theme = selectedTheme;
            settings.ThemeFileName = selectedThemeFile;
            settings.DefaultViewMode = ReadComboItem(ViewModeComboBox, "Medium");
            settings.DefaultSortMode = ReadComboItem(SortModeComboBox, "Name");
            settings.ShowHiddenFiles = ShowHiddenSwitch.IsOn;
            settings.ShowFileExtensions = ShowExtensionsSwitch.IsOn;
            settings.RememberViewPerFolder = PerFolderViewSwitch.IsOn;
            settings.TerminalCommand = TerminalCommandBox.Text.Trim();
            settings.TerminalArguments = TerminalArgumentsBox.Text.Trim();
            settings.WindowsShellContextMenu = desiredShellIntegration;
            settings.BackgroundIndexing = desiredBackgroundIndexing;

            await _settingsService.SaveAsync();
        }
        catch (Exception ex)
        {
            args.Cancel = true;

            // SaveAsync can fail after the in-memory object was mutated. Restore every field this
            // dialog owns so a failed Save never leaves the running UI in a phantom configuration.
            settings.Theme = previousTheme;
            settings.ThemeFileName = previousThemeFileName;
            settings.DefaultViewMode = previousViewMode;
            settings.DefaultSortMode = previousSortMode;
            settings.ShowHiddenFiles = previousShowHidden;
            settings.ShowFileExtensions = previousShowExtensions;
            settings.RememberViewPerFolder = previousPerFolderView;
            settings.TerminalCommand = previousTerminalCommand;
            settings.TerminalArguments = previousTerminalArguments;
            settings.WindowsShellContextMenu = previousShellIntegration;
            settings.BackgroundIndexing = previousBackgroundIndexing;

            // Roll back independently: one failed cleanup must not stop the other subsystem from
            // being restored to the user's last persisted preference.
            if (backgroundIndexingAttempted)
            {
                try
                {
                    IndexWorkerService.Apply(previousBackgroundIndexing);
                }
                catch
                {
                    // Keep the original failure visible below.
                }
            }

            if (shellIntegrationAttempted)
            {
                try
                {
                    ShellIntegrationService.Apply(previousShellIntegration);
                }
                catch
                {
                    // Keep the original failure visible below.
                }
            }

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

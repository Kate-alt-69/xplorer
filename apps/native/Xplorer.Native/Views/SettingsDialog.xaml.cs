using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage.Pickers;
using Windows.UI.Popups;
using Xplorer.Native.Models;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class SettingsDialog : ContentDialog
{
    private readonly SettingsService _settingsService;
    private readonly nint _ownerHwnd;
    private bool _suppressEvents = true;

    public SettingsDialog(SettingsService settingsService)
    {
        InitializeComponent();
        _settingsService = settingsService;
        _ownerHwnd = GetForegroundWindow();

        ThemeService.EnsureDefaultThemeFile();
        var settings = _settingsService.Current;
        SelectComboItem(ThemeComboBox, settings.Theme);
        ThemeFileText.Text = settings.ThemeFileName;
        ThemeFolderText.Text = ThemeService.ThemeDirectory;
        SelectComboItem(ViewModeComboBox, settings.DefaultViewMode);
        SelectComboItem(SortModeComboBox, settings.DefaultSortMode);
        ShowHiddenSwitch.IsOn = settings.ShowHiddenFiles;
        ShowExtensionsSwitch.IsOn = settings.ShowFileExtensions;
        PerFolderViewSwitch.IsOn = settings.RememberViewPerFolder;
        TerminalCommandBox.Text = settings.TerminalCommand;
        TerminalArgumentsBox.Text = settings.TerminalArguments;
        WindowsShellMenuSwitch.IsOn = settings.WindowsShellContextMenu;
        BackgroundIndexingSwitch.IsOn = settings.BackgroundIndexing;
        SectionList.SelectedIndex = 0;

        Closed += (_, _) => UiMemoryService.SchedulePostInteractionTrim("settings dialog closed");
        _suppressEvents = false;
    }

    private void SectionList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var section = (SectionList.SelectedItem as ListViewItem)?.Tag?.ToString() ?? "General";
        GeneralPage.Visibility = section == "General" ? Visibility.Visible : Visibility.Collapsed;
        ExplorerPage.Visibility = section == "Explorer" ? Visibility.Visible : Visibility.Collapsed;
        ThemePage.Visibility = section == "Theme" ? Visibility.Visible : Visibility.Collapsed;
        TerminalPage.Visibility = section == "Terminal" ? Visibility.Visible : Visibility.Collapsed;
        SystemPage.Visibility = section == "System" ? Visibility.Visible : Visibility.Collapsed;

        (SectionTitle.Text, SectionDescription.Text) = section switch
        {
            "Explorer" => ("Explorer", "Folder layout, sorting and per-folder behavior."),
            "Theme" => ("Theme", "Appearance, safe XML import and temporary previews."),
            "Terminal" => ("Terminal", "Choose what the Terminal button launches."),
            "System" => ("System", "Windows integration and the background metadata worker."),
            _ => ("General", "Everyday Xplorer behavior."),
        };
    }

    private async void ShowHiddenSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var old = _settingsService.Current.ShowHiddenFiles;
        var value = ShowHiddenSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.ShowHiddenFiles = value,
            settings => settings.ShowHiddenFiles = old,
            () => ShowHiddenSwitch.IsOn = old);
    }

    private async void ShowExtensionsSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var old = _settingsService.Current.ShowFileExtensions;
        var value = ShowExtensionsSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.ShowFileExtensions = value,
            settings => settings.ShowFileExtensions = old,
            () => ShowExtensionsSwitch.IsOn = old);
    }

    private async void ViewModeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents) return;
        var old = _settingsService.Current.DefaultViewMode;
        var value = ReadComboItem(ViewModeComboBox, old);
        await PersistSimpleAsync(
            settings => settings.DefaultViewMode = value,
            settings => settings.DefaultViewMode = old,
            () => SelectComboItem(ViewModeComboBox, old));
    }

    private async void SortModeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents) return;
        var old = _settingsService.Current.DefaultSortMode;
        var value = ReadComboItem(SortModeComboBox, old);
        await PersistSimpleAsync(
            settings => settings.DefaultSortMode = value,
            settings => settings.DefaultSortMode = old,
            () => SelectComboItem(SortModeComboBox, old));
    }

    private async void PerFolderViewSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var old = _settingsService.Current.RememberViewPerFolder;
        var value = PerFolderViewSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.RememberViewPerFolder = value,
            settings => settings.RememberViewPerFolder = old,
            () => PerFolderViewSwitch.IsOn = old);
    }

    private async void ThemeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents) return;
        var settings = _settingsService.Current;
        var old = settings.Theme;
        var value = ReadComboItem(ThemeComboBox, old);

        try
        {
            if (string.Equals(value, "Custom XML", StringComparison.OrdinalIgnoreCase))
                _ = ThemeService.Load(settings.ThemeFileName);

            settings.Theme = value;
            await _settingsService.SaveAsync();
            ShowSaved();
        }
        catch (Exception ex)
        {
            settings.Theme = old;
            WithSuppressedEvents(() => SelectComboItem(ThemeComboBox, old));
            ShowError(ex.Message);
        }
    }

    private async void TerminalBoxes_LostFocus(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var settings = _settingsService.Current;
        var oldCommand = settings.TerminalCommand;
        var oldArguments = settings.TerminalArguments;
        var command = TerminalCommandBox.Text.Trim();
        var arguments = TerminalArgumentsBox.Text.Trim();

        await PersistSimpleAsync(
            value =>
            {
                value.TerminalCommand = command;
                value.TerminalArguments = arguments;
            },
            value =>
            {
                value.TerminalCommand = oldCommand;
                value.TerminalArguments = oldArguments;
            },
            () =>
            {
                TerminalCommandBox.Text = oldCommand;
                TerminalArgumentsBox.Text = oldArguments;
            });
    }

    private async void WindowsShellMenuSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var settings = _settingsService.Current;
        var old = settings.WindowsShellContextMenu;
        var desired = WindowsShellMenuSwitch.IsOn;
        if (old == desired) return;

        try
        {
            ShellIntegrationService.Apply(desired);
            settings.WindowsShellContextMenu = desired;
            await _settingsService.SaveAsync();
            ShowSaved();
        }
        catch (Exception ex)
        {
            try { ShellIntegrationService.Apply(old); } catch { }
            settings.WindowsShellContextMenu = old;
            WithSuppressedEvents(() => WindowsShellMenuSwitch.IsOn = old);
            ShowError(ex.Message);
        }
    }

    private async void BackgroundIndexingSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents) return;
        var settings = _settingsService.Current;
        var old = settings.BackgroundIndexing;
        var desired = BackgroundIndexingSwitch.IsOn;
        if (old == desired) return;

        try
        {
            IndexWorkerService.Apply(desired);
            settings.BackgroundIndexing = desired;
            await _settingsService.SaveAsync();
            ShowSaved();
        }
        catch (Exception ex)
        {
            try { IndexWorkerService.Apply(old); } catch { }
            settings.BackgroundIndexing = old;
            WithSuppressedEvents(() => BackgroundIndexingSwitch.IsOn = old);
            ShowError(ex.Message);
        }
    }

    private async void ImportThemeButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var continueImport = await ConfirmAsync(
                "Import XML theme",
                "WARNING: this can temporarily override Xplorer's current colors and layout. The preview cannot add controls or execute commands. Do you want to continue?",
                "Continue",
                "Cancel");
            if (!continueImport) return;

            var picker = new FileOpenPicker
            {
                SuggestedStartLocation = PickerLocationId.Downloads,
            };
            picker.FileTypeFilter.Add(".xml");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, ResolveOwnerHwnd());
            var file = await picker.PickSingleFileAsync();
            if (file is null) return;

            StatusText.Text = "Scanning and validating theme…";
            var import = await ThemeImportService.StageAsync(file.Path, file.Name);

            if (!import.Scan.Performed)
            {
                var continueWithoutScan = await ConfirmAsync(
                    "Antimalware scan unavailable",
                    $"WARNING: Windows could not confirm a local AMSI provider scan.\n\n{import.Scan.Message}\n\nThe XML will still be restricted to Xplorer's data-only schema. Continue?",
                    "Continue",
                    "Discard");
                if (!continueWithoutScan)
                {
                    ThemeImportService.DiscardPending();
                    return;
                }
            }

            if (import.MissingProperties.Count > 0)
            {
                var shown = import.MissingProperties.Take(8).ToList();
                var suffix = import.MissingProperties.Count > shown.Count
                    ? $"\n…and {import.MissingProperties.Count - shown.Count} more."
                    : string.Empty;
                var continueIncomplete = await ConfirmAsync(
                    "Theme does not define every setting",
                    $"WARNING: this XML theme does not change:\n\n• {string.Join("\n• ", shown)}{suffix}\n\nXplorer will keep safe defaults for those values. Preview anyway?",
                    "Preview",
                    "Discard");
                if (!continueIncomplete)
                {
                    ThemeImportService.DiscardPending();
                    return;
                }
            }

            ThemePreviewCoordinator.Preview(import.Definition);
            StatusText.Text = import.Scan.Performed
                ? $"Previewing {import.State.DisplayName}. Local antimalware scan passed. Restart Xplorer to keep or discard it."
                : $"Previewing {import.State.DisplayName}. Restart Xplorer to keep or discard it.";
        }
        catch (Exception ex)
        {
            ThemeImportService.DiscardPending();
            ThemePreviewCoordinator.Restore();
            ShowError($"Theme import blocked: {ex.Message}");
        }
    }

    private void RevertThemePreviewButton_Click(object sender, RoutedEventArgs e)
    {
        ThemeImportService.DiscardPending();
        ThemePreviewCoordinator.Restore();
        StatusText.Text = "Theme preview reverted.";
    }

    private async Task PersistSimpleAsync(
        Action<XplorerSettings> apply,
        Action<XplorerSettings> rollback,
        Action rollbackUi)
    {
        var settings = _settingsService.Current;
        try
        {
            apply(settings);
            await _settingsService.SaveAsync();
            ShowSaved();
        }
        catch (Exception ex)
        {
            rollback(settings);
            WithSuppressedEvents(rollbackUi);
            ShowError(ex.Message);
        }
    }

    private async Task<bool> ConfirmAsync(string title, string message, string primary, string cancel)
    {
        var dialog = new MessageDialog(message, title);
        dialog.Commands.Add(new UICommand(primary, null, 0));
        dialog.Commands.Add(new UICommand(cancel, null, 1));
        dialog.DefaultCommandIndex = 0;
        dialog.CancelCommandIndex = 1;
        WinRT.Interop.InitializeWithWindow.Initialize(dialog, ResolveOwnerHwnd());
        var result = await dialog.ShowAsync();
        return Equals(result.Id, 0);
    }

    private nint ResolveOwnerHwnd()
    {
        if (_ownerHwnd != 0) return _ownerHwnd;
        var foreground = GetForegroundWindow();
        if (foreground == 0)
            throw new InvalidOperationException("Xplorer could not resolve a window owner for the picker.");
        return foreground;
    }

    private void ShowSaved() => StatusText.Text = "Saved automatically";

    private void ShowError(string message) => StatusText.Text = $"Could not save: {message}";

    private void WithSuppressedEvents(Action action)
    {
        _suppressEvents = true;
        try { action(); }
        finally { _suppressEvents = false; }
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

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();
}

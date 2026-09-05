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
    private bool _suppressEvents;

    private ComboBox? _themeComboBox;
    private ComboBox? _viewModeComboBox;
    private ComboBox? _sortModeComboBox;
    private ToggleSwitch? _showHiddenSwitch;
    private ToggleSwitch? _showExtensionsSwitch;
    private ToggleSwitch? _perFolderViewSwitch;
    private ToggleSwitch? _windowsShellMenuSwitch;
    private ToggleSwitch? _backgroundIndexingSwitch;
    private TextBox? _terminalCommandBox;
    private TextBox? _terminalArgumentsBox;

    public SettingsDialog(SettingsService settingsService)
    {
        InitializeComponent();
        _settingsService = settingsService;
        _ownerHwnd = GetForegroundWindow();
        ThemeService.EnsureDefaultThemeFile();

        Closed += (_, _) => UiMemoryService.SchedulePostInteractionTrim("settings dialog closed");
        SectionList.SelectedIndex = 0;
        RenderSection("General");
    }

    private void SectionList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var section = (SectionList.SelectedItem as ListViewItem)?.Tag?.ToString() ?? "General";
        RenderSection(section);
    }

    private void RenderSection(string section)
    {
        _suppressEvents = true;
        try
        {
            ResetPageControlReferences();
            PageHost.Children.Clear();
            StatusText.Text = string.Empty;

            (SectionTitle.Text, SectionDescription.Text) = section switch
            {
                "Explorer" => ("Explorer", "Folder layout, sorting and per-folder behavior."),
                "Theme" => ("Theme", "Appearance, safe XML import and temporary previews."),
                "Terminal" => ("Terminal", "Choose what the Terminal button launches."),
                "System" => ("System", "Windows integration and the background metadata worker."),
                _ => ("General", "Everyday Xplorer behavior."),
            };

            switch (section)
            {
                case "Explorer": BuildExplorerPage(); break;
                case "Theme": BuildThemePage(); break;
                case "Terminal": BuildTerminalPage(); break;
                case "System": BuildSystemPage(); break;
                default: BuildGeneralPage(); break;
            }
        }
        finally
        {
            _suppressEvents = false;
        }
    }

    private void BuildGeneralPage()
    {
        var settings = _settingsService.Current;

        _showHiddenSwitch = CreateToggle(settings.ShowHiddenFiles);
        _showHiddenSwitch.Toggled += ShowHiddenSwitch_Toggled;
        PageHost.Children.Add(CreateSettingRow(
            "Show hidden files",
            "Include files and folders carrying the Windows Hidden attribute.",
            "Useful for development and troubleshooting. Hidden system data can be noisy, so it is off by default.",
            _showHiddenSwitch));

        _showExtensionsSwitch = CreateToggle(settings.ShowFileExtensions);
        _showExtensionsSwitch.Toggled += ShowExtensionsSwitch_Toggled;
        PageHost.Children.Add(CreateSettingRow(
            "Show file extensions",
            "Keep .txt, .png, .exe and other extensions visible in file names.",
            "Extensions make file types explicit and help avoid misleading names such as photo.jpg.exe.",
            _showExtensionsSwitch));
    }

    private void BuildExplorerPage()
    {
        var settings = _settingsService.Current;

        _viewModeComboBox = CreateCombo(["Medium", "Large", "Details"], settings.DefaultViewMode);
        _viewModeComboBox.SelectionChanged += ViewModeComboBox_SelectionChanged;
        PageHost.Children.Add(CreateSettingRow(
            "Default view",
            "Choose the file layout used globally unless per-folder memory is enabled.",
            "Medium balances density and readability. Large favors thumbnails. Details exposes metadata columns.",
            _viewModeComboBox));

        _sortModeComboBox = CreateCombo(["Name", "Date modified", "Type", "Size"], settings.DefaultSortMode);
        _sortModeComboBox.SelectionChanged += SortModeComboBox_SelectionChanged;
        PageHost.Children.Add(CreateSettingRow(
            "Default sort",
            "Set the global ordering for folders without their own saved preference.",
            "This becomes the fallback ordering for every folder unless per-folder memory is enabled.",
            _sortModeComboBox));

        _perFolderViewSwitch = CreateToggle(settings.RememberViewPerFolder, "Per folder", "Global");
        _perFolderViewSwitch.Toggled += PerFolderViewSwitch_Toggled;
        PageHost.Children.Add(CreateSettingRow(
            "Remember view and sort per folder",
            "Let each folder keep its own view and sort instead of using one global setting.",
            "Useful if Pictures should stay Large while development folders stay Details.",
            _perFolderViewSwitch));
    }

    private void BuildThemePage()
    {
        var settings = _settingsService.Current;

        _themeComboBox = CreateCombo(["System", "Dark", "Light", "Custom XML"], settings.Theme);
        _themeComboBox.SelectionChanged += ThemeComboBox_SelectionChanged;
        PageHost.Children.Add(CreateSettingRow(
            "Theme mode",
            "Use the system appearance, force light/dark, or activate an imported Xplorer XML theme.",
            "Custom XML is data-only: it can change supported colors/layout values but cannot create controls or run code.",
            _themeComboBox));

        var current = new StackPanel { Spacing = 4 };
        current.Children.Add(new TextBlock { Text = "Current XML theme", FontWeight = Windows.UI.Text.FontWeights.SemiBold });
        current.Children.Add(new TextBlock { Text = settings.ThemeFileName, TextWrapping = TextWrapping.Wrap });
        current.Children.Add(new TextBlock
        {
            Text = ThemeService.ThemeDirectory,
            Opacity = 0.62,
            TextWrapping = TextWrapping.Wrap,
        });
        PageHost.Children.Add(current);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var import = new Button { Content = "Import new theme…" };
        import.Click += ImportThemeButton_Click;
        var revert = new Button { Content = "Revert preview" };
        revert.Click += RevertThemePreviewButton_Click;
        actions.Children.Add(import);
        actions.Children.Add(revert);
        actions.Children.Add(CreateInfoButton(
            "Imports are staged first, scanned through Windows AMSI when a provider participates, parsed with Xplorer's strict data-only schema, then previewed without changing the saved theme."));
        PageHost.Children.Add(actions);

        PageHost.Children.Add(new TextBlock
        {
            Text = "Imported themes cannot add buttons, commands or file operations. The preview carries only already-parsed style values. If you leave it active, Xplorer asks again after restart before making it permanent.",
            Opacity = 0.68,
            TextWrapping = TextWrapping.Wrap,
        });
    }

    private void BuildTerminalPage()
    {
        var settings = _settingsService.Current;
        PageHost.Children.Add(new TextBlock
        {
            Text = "Xplorer launches terminal sessions in the current directory. Leave the custom command empty to use your Windows Terminal default profile.",
            Opacity = 0.72,
            TextWrapping = TextWrapping.Wrap,
        });

        _terminalCommandBox = new TextBox
        {
            Header = "Custom command",
            PlaceholderText = "Example: pwsh.exe, powershell.exe, cmd.exe or wsl.exe",
            Text = settings.TerminalCommand,
        };
        _terminalCommandBox.LostFocus += TerminalBoxes_LostFocus;
        PageHost.Children.Add(_terminalCommandBox);

        _terminalArgumentsBox = new TextBox
        {
            Header = "Arguments",
            PlaceholderText = "Optional arguments",
            Text = settings.TerminalArguments,
        };
        _terminalArgumentsBox.LostFocus += TerminalBoxes_LostFocus;
        PageHost.Children.Add(_terminalArgumentsBox);

        var info = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        info.Children.Add(CreateInfoButton(
            "The terminal setting affects only the Terminal button. Xplorer does not spawn PowerShell/CMD/conhost to enumerate folders or feed its index."));
        info.Children.Add(new TextBlock
        {
            Text = "Terminal choice does not affect file browsing or indexing.",
            VerticalAlignment = VerticalAlignment.Center,
            Opacity = 0.68,
        });
        PageHost.Children.Add(info);
    }

    private void BuildSystemPage()
    {
        var settings = _settingsService.Current;

        _windowsShellMenuSwitch = CreateToggle(settings.WindowsShellContextMenu);
        _windowsShellMenuSwitch.Toggled += WindowsShellMenuSwitch_Toggled;
        PageHost.Children.Add(CreateSettingRow(
            "Open in Xplorer shell entry",
            "Add reversible Xplorer-owned context-menu entries without replacing explorer.exe or injecting hooks.",
            "Turning this off removes only registry entries marked as owned by Xplorer.",
            _windowsShellMenuSwitch));

        _backgroundIndexingSwitch = CreateToggle(settings.BackgroundIndexing);
        _backgroundIndexingSwitch.Toggled += BackgroundIndexingSwitch_Toggled;
        PageHost.Children.Add(CreateSettingRow(
            "Background indexing",
            "Run the tiny Rust metadata worker at background priority and keep the current workspace hot.",
            "The worker indexes metadata only, uses NTFS USN deltas when available, and prioritizes the current directory plus bounded descendants.",
            _backgroundIndexingSwitch));
    }

    private static Grid CreateSettingRow(string title, string description, string info, FrameworkElement control)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var text = new StackPanel { Spacing = 3 };
        text.Children.Add(new TextBlock { Text = title, FontWeight = Windows.UI.Text.FontWeights.SemiBold });
        text.Children.Add(new TextBlock { Text = description, Opacity = 0.68, TextWrapping = TextWrapping.Wrap });
        grid.Children.Add(text);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(CreateInfoButton(info));
        actions.Children.Add(control);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);
        return grid;
    }

    private static Button CreateInfoButton(string text)
    {
        var button = new Button
        {
            Content = "i",
            Width = 26,
            Height = 26,
            Padding = new Thickness(0),
        };
        ToolTipService.SetToolTip(button, text);
        return button;
    }

    private static ToggleSwitch CreateToggle(bool value, string on = "On", string off = "Off") => new()
    {
        IsOn = value,
        OnContent = on,
        OffContent = off,
    };

    private static ComboBox CreateCombo(IReadOnlyList<string> choices, string selected)
    {
        var combo = new ComboBox { Width = 190 };
        foreach (var choice in choices)
            combo.Items.Add(new ComboBoxItem { Content = choice });
        SelectComboItem(combo, selected);
        return combo;
    }

    private async void ShowHiddenSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _showHiddenSwitch is null) return;
        var old = _settingsService.Current.ShowHiddenFiles;
        var value = _showHiddenSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.ShowHiddenFiles = value,
            settings => settings.ShowHiddenFiles = old,
            () => { if (_showHiddenSwitch is not null) _showHiddenSwitch.IsOn = old; });
    }

    private async void ShowExtensionsSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _showExtensionsSwitch is null) return;
        var old = _settingsService.Current.ShowFileExtensions;
        var value = _showExtensionsSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.ShowFileExtensions = value,
            settings => settings.ShowFileExtensions = old,
            () => { if (_showExtensionsSwitch is not null) _showExtensionsSwitch.IsOn = old; });
    }

    private async void ViewModeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _viewModeComboBox is null) return;
        var old = _settingsService.Current.DefaultViewMode;
        var value = ReadComboItem(_viewModeComboBox, old);
        await PersistSimpleAsync(
            settings => settings.DefaultViewMode = value,
            settings => settings.DefaultViewMode = old,
            () => { if (_viewModeComboBox is not null) SelectComboItem(_viewModeComboBox, old); });
    }

    private async void SortModeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _sortModeComboBox is null) return;
        var old = _settingsService.Current.DefaultSortMode;
        var value = ReadComboItem(_sortModeComboBox, old);
        await PersistSimpleAsync(
            settings => settings.DefaultSortMode = value,
            settings => settings.DefaultSortMode = old,
            () => { if (_sortModeComboBox is not null) SelectComboItem(_sortModeComboBox, old); });
    }

    private async void PerFolderViewSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _perFolderViewSwitch is null) return;
        var old = _settingsService.Current.RememberViewPerFolder;
        var value = _perFolderViewSwitch.IsOn;
        await PersistSimpleAsync(
            settings => settings.RememberViewPerFolder = value,
            settings => settings.RememberViewPerFolder = old,
            () => { if (_perFolderViewSwitch is not null) _perFolderViewSwitch.IsOn = old; });
    }

    private async void ThemeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _themeComboBox is null) return;
        var settings = _settingsService.Current;
        var old = settings.Theme;
        var value = ReadComboItem(_themeComboBox, old);

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
            WithSuppressedEvents(() => { if (_themeComboBox is not null) SelectComboItem(_themeComboBox, old); });
            ShowError(ex.Message);
        }
    }

    private async void TerminalBoxes_LostFocus(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _terminalCommandBox is null || _terminalArgumentsBox is null) return;
        var settings = _settingsService.Current;
        var oldCommand = settings.TerminalCommand;
        var oldArguments = settings.TerminalArguments;
        var command = _terminalCommandBox.Text.Trim();
        var arguments = _terminalArgumentsBox.Text.Trim();

        await PersistSimpleAsync(
            value => { value.TerminalCommand = command; value.TerminalArguments = arguments; },
            value => { value.TerminalCommand = oldCommand; value.TerminalArguments = oldArguments; },
            () =>
            {
                if (_terminalCommandBox is not null) _terminalCommandBox.Text = oldCommand;
                if (_terminalArgumentsBox is not null) _terminalArgumentsBox.Text = oldArguments;
            });
    }

    private async void WindowsShellMenuSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _windowsShellMenuSwitch is null) return;
        var settings = _settingsService.Current;
        var old = settings.WindowsShellContextMenu;
        var desired = _windowsShellMenuSwitch.IsOn;
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
            WithSuppressedEvents(() => { if (_windowsShellMenuSwitch is not null) _windowsShellMenuSwitch.IsOn = old; });
            ShowError(ex.Message);
        }
    }

    private async void BackgroundIndexingSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents || _backgroundIndexingSwitch is null) return;
        var settings = _settingsService.Current;
        var old = settings.BackgroundIndexing;
        var desired = _backgroundIndexingSwitch.IsOn;
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
            WithSuppressedEvents(() => { if (_backgroundIndexingSwitch is not null) _backgroundIndexingSwitch.IsOn = old; });
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

            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.Downloads };
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
                ? $"Previewing {import.State.DisplayName}. Antimalware scan passed. Restart Xplorer to keep or discard it."
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

    private async Task PersistSimpleAsync(Action<XplorerSettings> apply, Action<XplorerSettings> rollback, Action rollbackUi)
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

    private void ResetPageControlReferences()
    {
        _themeComboBox = null;
        _viewModeComboBox = null;
        _sortModeComboBox = null;
        _showHiddenSwitch = null;
        _showExtensionsSwitch = null;
        _perFolderViewSwitch = null;
        _windowsShellMenuSwitch = null;
        _backgroundIndexingSwitch = null;
        _terminalCommandBox = null;
        _terminalArgumentsBox = null;
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

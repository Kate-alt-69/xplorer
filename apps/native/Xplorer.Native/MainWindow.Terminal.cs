using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Xplorer.Native.Models;
using Xplorer.Native.Services;
using Xplorer.Native.Views;

namespace Xplorer.Native;

public sealed partial class MainWindow
{
    private IDisposable? _terminalHostRegistration;
    private TerminalWorkspaceDialog? _terminalDialog;
    private bool _terminalInfrastructureInitialized;
    private bool _terminalTabChordArmed;

    private void InitializeEmbeddedTerminal()
    {
        if (_terminalInfrastructureInitialized) return;
        _terminalInfrastructureInitialized = true;

        _terminalHostRegistration = TerminalService.AttachInAppHost(OpenEmbeddedTerminal);
        CrashLogService.Log("Embedded terminal host initialized.");

        // handledEventsToo=true matters for Tab: WinUI's focus navigation can consume Tab before a
        // normal bubbling handler sees it. We observe it without cancelling focus movement, then
        // only consume T if the user is still holding Tab.
        Root.AddHandler(
            UIElement.KeyDownEvent,
            new KeyEventHandler(Root_TerminalChordKeyDown),
            handledEventsToo: true);
        Root.AddHandler(
            UIElement.KeyUpEvent,
            new KeyEventHandler(Root_TerminalChordKeyUp),
            handledEventsToo: true);

        Closed += (_, _) =>
        {
            _terminalHostRegistration?.Dispose();
            _terminalHostRegistration = null;
            _terminalDialog?.Dispose();
            _terminalDialog = null;
        };
    }

    private void OpenEmbeddedTerminal(string directory, XplorerSettings settings) =>
        _ = ShowEmbeddedTerminalAsync(directory);

    private async Task ShowEmbeddedTerminalAsync(string directory)
    {
        CrashLogService.Log($"Terminal open requested. Directory='{directory}'.");
        try
        {
            // TerminalWorkspaceDialog is now a real top-level WinUI Window. Do not assign the main
            // window's XamlRoot: separate HWND ownership is what enables native Windows edge/corner
            // resize hit-testing and keeps terminal resizing isolated from Xplorer's main layout.
            _terminalDialog ??= new TerminalWorkspaceDialog(_settingsService);
            await _terminalDialog.ShowForDirectoryAsync(directory);
            CrashLogService.Log("Terminal native window shown/focused.");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Embedded terminal open failed", ex);
            StatusText.Text = $"Terminal error: {ex.Message}";
        }
    }

    private void Root_TerminalChordKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Tab)
        {
            _terminalTabChordArmed = true;
            return;
        }

        if (!_terminalTabChordArmed || e.Key != VirtualKey.T) return;
        e.Handled = true;
        _terminalTabChordArmed = false;
        OpenTerminal();
    }

    private void Root_TerminalChordKeyUp(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Tab)
            _terminalTabChordArmed = false;
    }
}

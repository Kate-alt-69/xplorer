using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private async void TerminalView_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (sender is not RichEditBox { Tag: TerminalTabState state }) return;
        var session = state.Session;
        if (session is null || !session.IsRunning) return;

        if (e.Key == VirtualKey.Tab)
        {
            _tabChordArmed = true;
            _tabChordUsed = false;
            e.Handled = true;
            return;
        }

        if (_tabChordArmed && e.Key == VirtualKey.T)
        {
            _tabChordUsed = true;
            e.Handled = true;
            Hide();
            return;
        }

        var control = IsKeyDown(VirtualKey.Control);
        var shift = IsKeyDown(VirtualKey.Shift);
        var alt = IsKeyDown(VirtualKey.Menu);

        if (shift && e.Key is VirtualKey.Up or VirtualKey.Down or VirtualKey.PageUp or VirtualKey.PageDown)
        {
            e.Handled = true;
            ScrollTerminal(state, e.Key);
            return;
        }

        if (control && shift && e.Key == VirtualKey.C)
        {
            e.Handled = true;
            CopySelection(state.View);
            return;
        }

        if (control && shift && e.Key == VirtualKey.V)
        {
            e.Handled = true;
            await PasteClipboardAsync(session);
            return;
        }

        var keyCode = (int)e.Key;
        if (control && keyCode >= (int)VirtualKey.A && keyCode <= (int)VirtualKey.Z)
        {
            e.Handled = true;
            var controlCharacter = (char)(keyCode - (int)VirtualKey.A + 1);
            await session.SendAsync(controlCharacter.ToString());
            return;
        }

        var terminalSequence = TranslateTerminalKey(e.Key);
        if (terminalSequence is not null)
        {
            e.Handled = true;
            await session.SendAsync(terminalSequence);
            return;
        }

        var text = TranslatePrintableKey(e.Key);
        if (string.IsNullOrEmpty(text)) return;

        e.Handled = true;
        if (alt) text = "\x1b" + text;
        await session.SendAsync(text);
    }

    private async void TerminalView_KeyUp(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Tab || !_tabChordArmed) return;
        e.Handled = true;

        var shouldSendTab = !_tabChordUsed &&
                            sender is RichEditBox { Tag: TerminalTabState state } &&
                            state.Session?.IsRunning == true;
        _tabChordArmed = false;
        _tabChordUsed = false;

        if (shouldSendTab && sender is RichEditBox { Tag: TerminalTabState active } && active.Session is not null)
            await active.Session.SendAsync("\t");
    }

    private static void CopySelection(RichEditBox view)
    {
        var selection = view.Document.Selection;
        if (selection.Length <= 0) return;
        selection.GetText(TextGetOptions.None, out var text);
        if (string.IsNullOrEmpty(text)) return;

        var package = new DataPackage();
        package.SetText(text);
        Clipboard.SetContent(package);
        Clipboard.Flush();
    }

    private static async Task PasteClipboardAsync(ConPtyTerminalSession session)
    {
        try
        {
            var content = Clipboard.GetContent();
            if (!content.Contains(StandardDataFormats.Text)) return;
            var text = await content.GetTextAsync();
            if (!string.IsNullOrEmpty(text)) await session.SendAsync(text);
        }
        catch
        {
            // Clipboard ownership can change between GetContent and GetTextAsync; ignore that race.
        }
    }

    private static string? TranslateTerminalKey(VirtualKey key) => key switch
    {
        VirtualKey.Enter => "\r",
        VirtualKey.Back => "\x7f",
        VirtualKey.Escape => "\x1b",
        VirtualKey.Up => "\x1b[A",
        VirtualKey.Down => "\x1b[B",
        VirtualKey.Right => "\x1b[C",
        VirtualKey.Left => "\x1b[D",
        VirtualKey.Home => "\x1b[H",
        VirtualKey.End => "\x1b[F",
        VirtualKey.Insert => "\x1b[2~",
        VirtualKey.Delete => "\x1b[3~",
        VirtualKey.PageUp => "\x1b[5~",
        VirtualKey.PageDown => "\x1b[6~",
        VirtualKey.F1 => "\x1bOP",
        VirtualKey.F2 => "\x1bOQ",
        VirtualKey.F3 => "\x1bOR",
        VirtualKey.F4 => "\x1bOS",
        VirtualKey.F5 => "\x1b[15~",
        VirtualKey.F6 => "\x1b[17~",
        VirtualKey.F7 => "\x1b[18~",
        VirtualKey.F8 => "\x1b[19~",
        VirtualKey.F9 => "\x1b[20~",
        VirtualKey.F10 => "\x1b[21~",
        VirtualKey.F11 => "\x1b[23~",
        VirtualKey.F12 => "\x1b[24~",
        _ => null,
    };

    private static string? TranslatePrintableKey(VirtualKey key)
    {
        var keyboardState = new byte[256];
        if (!GetKeyboardState(keyboardState)) return null;

        var virtualKey = (uint)key;
        var scanCode = MapVirtualKeyW(virtualKey, 0);
        var buffer = new StringBuilder(8);
        var written = ToUnicode(virtualKey, scanCode, keyboardState, buffer, buffer.Capacity, 0);
        return written > 0 ? buffer.ToString(0, written) : null;
    }

    private static bool IsKeyDown(VirtualKey key) =>
        (GetKeyState((int)key) & 0x8000) != 0;

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int nVirtKey);

    [DllImport("user32.dll")]
    private static extern bool GetKeyboardState([Out] byte[] lpKeyState);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int ToUnicode(
        uint wVirtKey,
        uint wScanCode,
        byte[] lpKeyState,
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff,
        int cchBuff,
        uint wFlags);
}

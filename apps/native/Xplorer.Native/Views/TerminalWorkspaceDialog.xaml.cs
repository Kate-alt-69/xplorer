using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;
using Windows.UI;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog : ContentDialog, IDisposable
{
    private readonly SettingsService _settingsService;
    private readonly List<TerminalTabState> _states = [];
    private string _latestDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private bool _visible;
    private bool _disposed;
    private bool _tabChordArmed;
    private bool _tabChordUsed;

    public TerminalWorkspaceDialog(SettingsService settingsService)
    {
        InitializeComponent();
        _settingsService = settingsService;
    }

    public async Task ShowForDirectoryAsync(string directory)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _latestDirectory = Directory.Exists(directory)
            ? Path.GetFullPath(directory)
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        EnsureFolderAwareSession();
        if (_visible)
        {
            FocusSelectedTerminal();
            return;
        }

        _visible = true;
        try
        {
            var show = ShowAsync();
            DispatcherQueue.TryEnqueue(FocusSelectedTerminal);
            await show;
        }
        finally
        {
            _visible = false;
            _tabChordArmed = false;
            _tabChordUsed = false;
        }
    }

    private void EnsureFolderAwareSession()
    {
        var selected = GetSelectedState();
        if (selected is null)
        {
            CreateTerminalTab(_latestDirectory, select: true);
            return;
        }

        if (string.Equals(selected.WorkingDirectory, _latestDirectory, StringComparison.OrdinalIgnoreCase))
        {
            if (selected.Session?.IsRunning != true)
                RestartTerminalTab(selected, _latestDirectory);
            return;
        }

        if (string.Equals(
                _settingsService.Current.TerminalFolderChangeBehavior,
                "Open new tab",
                StringComparison.OrdinalIgnoreCase))
        {
            CreateTerminalTab(_latestDirectory, select: true);
        }
        else
        {
            RestartTerminalTab(selected, _latestDirectory);
        }
    }

    private TerminalTabState CreateTerminalTab(string directory, bool select)
    {
        var view = CreateTerminalView();
        var tab = new TabViewItem
        {
            Header = "Terminal",
            IsClosable = true,
            Content = view,
        };
        var state = new TerminalTabState(this, tab, view, directory);
        tab.Tag = state;
        view.Tag = state;

        _states.Add(state);
        TerminalTabs.TabItems.Add(tab);
        StartSession(state, directory);

        if (select) TerminalTabs.SelectedItem = tab;
        return state;
    }

    private void RestartTerminalTab(TerminalTabState state, string directory)
    {
        StopSession(state);
        state.Buffer.Clear();
        state.View.Text = string.Empty;
        state.WorkingDirectory = directory;
        StartSession(state, directory);
    }

    private void StartSession(TerminalTabState state, string directory)
    {
        try
        {
            var launch = TerminalService.ResolveLaunch(_settingsService.Current);
            var session = ConPtyTerminalSession.Start(directory, launch);
            state.Session = session;
            state.WorkingDirectory = directory;
            state.Tab.Header = BuildTabHeader(launch.DisplayName, directory);
            session.OutputReceived += state.OutputHandler;
            session.Exited += state.ExitHandler;
            session.StartReading();
            ResizeSession(state);
        }
        catch (Exception ex)
        {
            state.Session = null;
            state.Tab.Header = "Terminal error";
            state.Buffer.Append($"Xplorer could not start the terminal.\r\n{ex.Message}\r\n");
            RefreshTerminalView(state);
        }
    }

    private void StopSession(TerminalTabState state)
    {
        var session = state.Session;
        state.Session = null;
        if (session is null) return;
        session.OutputReceived -= state.OutputHandler;
        session.Exited -= state.ExitHandler;
        session.Dispose();
    }

    private TextBox CreateTerminalView()
    {
        var view = new TextBox
        {
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            Padding = new Thickness(12, 10, 12, 12),
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(Color.FromArgb(0xff, 0x0c, 0x0c, 0x0c)),
            Foreground = new SolidColorBrush(Color.FromArgb(0xff, 0xf2, 0xf2, 0xf2)),
            SelectionHighlightColor = new SolidColorBrush(Color.FromArgb(0xff, 0x26, 0x4f, 0x78)),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        ScrollViewer.SetHorizontalScrollBarVisibility(view, ScrollBarVisibility.Auto);
        ScrollViewer.SetVerticalScrollBarVisibility(view, ScrollBarVisibility.Auto);
        view.KeyDown += TerminalView_KeyDown;
        view.KeyUp += TerminalView_KeyUp;
        view.SizeChanged += TerminalView_SizeChanged;
        return view;
    }

    private async void TerminalView_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (sender is not TextBox { Tag: TerminalTabState state }) return;
        var session = state.Session;
        if (session is null || !session.IsRunning) return;

        if (e.Key == VirtualKey.Tab)
        {
            // Delay plain Tab until key-up so "hold Tab + press T" can be a toggle chord without
            // also sending completion into the shell.
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

        if (control && e.Key is >= VirtualKey.A and <= VirtualKey.Z)
        {
            e.Handled = true;
            var controlCharacter = (char)((int)e.Key - (int)VirtualKey.A + 1);
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
                            sender is TextBox { Tag: TerminalTabState state } &&
                            state.Session?.IsRunning == true;
        _tabChordArmed = false;
        _tabChordUsed = false;

        if (shouldSendTab && sender is TextBox { Tag: TerminalTabState active } && active.Session is not null)
            await active.Session.SendAsync("\t");
    }

    private void TerminalView_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is TextBox { Tag: TerminalTabState state }) ResizeSession(state);
    }

    private void ResizeSession(TerminalTabState state)
    {
        var width = Math.Max(0, state.View.ActualWidth - 24);
        var height = Math.Max(0, state.View.ActualHeight - 22);
        var columns = Math.Max(20, (int)Math.Floor(width / 7.9));
        var rows = Math.Max(4, (int)Math.Floor(height / 17.0));
        state.Session?.Resize(columns, rows);
    }

    private void QueueTerminalRefresh(TerminalTabState state)
    {
        if (state.Disposed || Interlocked.Exchange(ref state.RefreshQueued, 1) != 0) return;
        if (!DispatcherQueue.TryEnqueue(() =>
            {
                Interlocked.Exchange(ref state.RefreshQueued, 0);
                if (!state.Disposed) RefreshTerminalView(state);
            }))
        {
            Interlocked.Exchange(ref state.RefreshQueued, 0);
        }
    }

    private static void RefreshTerminalView(TerminalTabState state)
    {
        var snapshot = state.Buffer.Snapshot();
        state.View.Text = snapshot;
        state.View.SelectionStart = snapshot.Length;
        state.View.SelectionLength = 0;
    }

    private void TerminalClose_Click(object sender, RoutedEventArgs e) => Hide();

    private void TerminalTabs_AddTabButtonClick(TabView sender, object args) =>
        CreateTerminalTab(_latestDirectory, select: true);

    private void TerminalTabs_TabCloseRequested(TabView sender, TabViewTabCloseRequestedEventArgs args)
    {
        if (args.Tab?.Tag is not TerminalTabState state) return;
        RemoveState(state);
        sender.TabItems.Remove(args.Tab);
        if (sender.TabItems.Count == 0 && _visible) Hide();
    }

    private void TerminalTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var state = GetSelectedState();
        if (state is null) return;
        ResizeSession(state);
        DispatcherQueue.TryEnqueue(() => state.View.Focus(FocusState.Programmatic));
    }

    private TerminalTabState? GetSelectedState() =>
        (TerminalTabs.SelectedItem as TabViewItem)?.Tag as TerminalTabState;

    private void FocusSelectedTerminal()
    {
        var state = GetSelectedState();
        if (state is null) return;
        state.View.Focus(FocusState.Programmatic);
        ResizeSession(state);
    }

    private static string BuildTabHeader(string shell, string directory)
    {
        var trimmed = directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var folder = Path.GetFileName(trimmed);
        if (string.IsNullOrWhiteSpace(folder)) folder = directory;
        return $"{shell}  •  {folder}";
    }

    private static void CopySelection(TextBox view)
    {
        if (view.SelectionLength <= 0) return;
        var package = new DataPackage();
        package.SetText(view.SelectedText);
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

    private void RemoveState(TerminalTabState state)
    {
        if (!_states.Remove(state)) return;
        state.Disposed = true;
        StopSession(state);
        state.View.KeyDown -= TerminalView_KeyDown;
        state.View.KeyUp -= TerminalView_KeyUp;
        state.View.SizeChanged -= TerminalView_SizeChanged;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var state in _states.ToArray()) RemoveState(state);
        _states.Clear();
        GC.SuppressFinalize(this);
    }

    private sealed class TerminalTabState
    {
        private readonly TerminalWorkspaceDialog _owner;

        public TabViewItem Tab { get; }
        public TextBox View { get; }
        public TerminalTextBuffer Buffer { get; } = new();
        public ConPtyTerminalSession? Session { get; set; }
        public string WorkingDirectory { get; set; }
        public int RefreshQueued;
        public bool Disposed;

        public EventHandler<string> OutputHandler { get; }
        public EventHandler ExitHandler { get; }

        public TerminalTabState(
            TerminalWorkspaceDialog owner,
            TabViewItem tab,
            TextBox view,
            string workingDirectory)
        {
            _owner = owner;
            Tab = tab;
            View = view;
            WorkingDirectory = workingDirectory;
            OutputHandler = (_, text) =>
            {
                Buffer.Append(text);
                _owner.QueueTerminalRefresh(this);
            };
            ExitHandler = (_, _) =>
            {
                Buffer.Append("\r\n[process exited]\r\n");
                _owner.QueueTerminalRefresh(this);
            };
        }
    }

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

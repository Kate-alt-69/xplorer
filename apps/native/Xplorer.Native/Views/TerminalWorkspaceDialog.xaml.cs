using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Xplorer.Native.Services;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog : Window, IDisposable
{
    private readonly SettingsService _settingsService;
    private readonly List<TerminalTabState> _states = [];
    private string _latestDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private bool _visible;
    private bool _disposed;
    private bool _tabChordArmed;
    private bool _tabChordUsed;

    private static readonly Color DefaultTerminalForeground = Color.FromArgb(0xff, 0xf2, 0xf2, 0xf2);
    private static readonly Color DefaultTerminalBackground = Color.FromArgb(0xff, 0x0c, 0x0c, 0x0c);

    public TerminalWorkspaceDialog(SettingsService settingsService)
    {
        InitializeComponent();
        _settingsService = settingsService;
        InitializeNativeTerminalWindow();
    }

    public Task ShowForDirectoryAsync(string directory)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _latestDirectory = Directory.Exists(directory)
            ? Path.GetFullPath(directory)
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        EnsureFolderAwareSession();
        ShowNativeTerminalWindow();
        DispatcherQueue.TryEnqueue(FocusSelectedTerminal);
        return Task.CompletedTask;
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
        var surface = CreateTerminalSurface();
        var tab = new TabViewItem
        {
            Header = "Terminal",
            IsClosable = true,
            Content = surface.Root,
        };
        var state = new TerminalTabState(
            this,
            tab,
            surface.Input,
            surface.Display,
            surface.DisplayScroller,
            directory);
        tab.Tag = state;
        surface.Root.Tag = state;
        surface.Input.Tag = state;

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
        state.Display.Inlines.Clear();
        state.WorkingDirectory = directory;
        StartSession(state, directory);
    }

    private void StartSession(TerminalTabState state, string directory)
    {
        try
        {
            var launch = TerminalService.ResolveLaunch(_settingsService.Current);
            CrashLogService.Log($"Terminal session starting. Shell='{launch.DisplayName}'; Directory='{directory}'.");
            var session = ConPtyTerminalSession.Start(directory, launch);
            state.Session = session;
            state.WorkingDirectory = directory;
            state.Tab.Header = BuildTabHeader(launch.DisplayName, directory);
            session.OutputReceived += state.OutputHandler;
            session.Exited += state.ExitHandler;
            session.StartReading();
            ResizeSession(state);
            CrashLogService.Log($"Terminal session started. Shell='{launch.DisplayName}'.");
        }
        catch (Exception ex)
        {
            CrashLogService.LogException("Terminal session start failed", ex);
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

    // Win10's RichEdit document-formatting path crashed in native code under streaming ConPTY
    // output. Keep TextBox as the interaction/selection layer, but make its glyphs transparent and
    // paint the already-parsed ANSI style runs in a plain TextBlock underneath it. Both layers use
    // the same font/padding and their ScrollViewers are synchronized, giving us PowerShell/ANSI
    // inline colors without reintroducing RichEditBox or a WebView terminal.
    private TerminalSurface CreateTerminalSurface()
    {
        var display = new TextBlock
        {
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            TextWrapping = TextWrapping.NoWrap,
            Foreground = new SolidColorBrush(DefaultTerminalForeground),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            IsTextSelectionEnabled = false,
        };

        var displayHost = new Border
        {
            Padding = new Thickness(12, 10, 12, 12),
            Background = new SolidColorBrush(DefaultTerminalBackground),
            Child = display,
        };
        var displayScroller = new ScrollViewer
        {
            Content = displayHost,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
            HorizontalScrollMode = ScrollMode.Enabled,
            VerticalScrollMode = ScrollMode.Enabled,
            IsHitTestVisible = false,
        };

        var input = new TextBox
        {
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            IsSpellCheckEnabled = false,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            Padding = new Thickness(12, 10, 12, 12),
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(Color.FromArgb(0x00, 0x00, 0x00, 0x00)),
            // Keep the TextBox layout/selection engine but let the colored TextBlock below it paint
            // the glyphs. SelectionHighlightColor remains visible over the colored output.
            Foreground = new SolidColorBrush(Color.FromArgb(0x00, 0xff, 0xff, 0xff)),
            SelectionHighlightColor = new SolidColorBrush(Color.FromArgb(0xb8, 0x26, 0x4f, 0x78)),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        ScrollViewer.SetHorizontalScrollBarVisibility(input, ScrollBarVisibility.Auto);
        ScrollViewer.SetVerticalScrollBarVisibility(input, ScrollBarVisibility.Auto);

        input.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(TerminalView_KeyDown), handledEventsToo: true);
        input.AddHandler(UIElement.KeyUpEvent, new KeyEventHandler(TerminalView_KeyUp), handledEventsToo: true);
        input.Loaded += TerminalView_Loaded;
        input.SizeChanged += TerminalView_SizeChanged;

        var root = new Grid
        {
            Background = new SolidColorBrush(DefaultTerminalBackground),
        };
        root.Children.Add(displayScroller);
        root.Children.Add(input);
        return new TerminalSurface(root, input, display, displayScroller);
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

    private void RemoveState(TerminalTabState state)
    {
        if (!_states.Remove(state)) return;
        state.Disposed = true;
        StopSession(state);
        if (state.Scroller is not null && state.ScrollSyncAttached)
            state.Scroller.ViewChanged -= state.ScrollHandler;
        state.View.Loaded -= TerminalView_Loaded;
        state.View.SizeChanged -= TerminalView_SizeChanged;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var state in _states.ToArray()) RemoveState(state);
        _states.Clear();
        DisposeNativeTerminalWindow();
        GC.SuppressFinalize(this);
    }

    private readonly record struct TerminalSurface(
        Grid Root,
        TextBox Input,
        TextBlock Display,
        ScrollViewer DisplayScroller);

    private sealed class TerminalTabState
    {
        private readonly TerminalWorkspaceDialog _owner;

        public TabViewItem Tab { get; }
        public TextBox View { get; }
        public TextBlock Display { get; }
        public ScrollViewer DisplayScroller { get; }
        public ScrollViewer? Scroller { get; set; }
        public TerminalTextBuffer Buffer { get; } = new();
        public ConPtyTerminalSession? Session { get; set; }
        public string WorkingDirectory { get; set; }
        public int RefreshQueued;
        public bool Disposed;
        public bool ScrollSyncAttached;

        public EventHandler<string> OutputHandler { get; }
        public EventHandler ExitHandler { get; }
        public EventHandler<ScrollViewerViewChangedEventArgs> ScrollHandler { get; }

        public TerminalTabState(
            TerminalWorkspaceDialog owner,
            TabViewItem tab,
            TextBox view,
            TextBlock display,
            ScrollViewer displayScroller,
            string workingDirectory)
        {
            _owner = owner;
            Tab = tab;
            View = view;
            Display = display;
            DisplayScroller = displayScroller;
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
            ScrollHandler = (_, _) => _owner.SyncTerminalDisplayScroll(this);
        }
    }
}

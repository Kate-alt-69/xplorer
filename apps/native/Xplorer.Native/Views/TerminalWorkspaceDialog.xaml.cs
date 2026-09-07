using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
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
    private bool _resizing;
    private uint _resizePointerId;
    private Windows.Foundation.Point _resizeStart;
    private double _resizeStartWidth;
    private double _resizeStartHeight;

    private static readonly Color DefaultTerminalForeground = Color.FromArgb(0xff, 0xf2, 0xf2, 0xf2);
    private static readonly Color DefaultTerminalBackground = Color.FromArgb(0xff, 0x0c, 0x0c, 0x0c);

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
        var (view, scroller) = CreateTerminalView();
        var tab = new TabViewItem
        {
            Header = "Terminal",
            IsClosable = true,
            Content = scroller,
        };
        var state = new TerminalTabState(this, tab, view, scroller, directory);
        tab.Tag = state;
        view.Tag = state;
        scroller.Tag = state;

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
        state.View.Inlines.Clear();
        state.LastRenderedText = string.Empty;
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

    // TextBlock provides lightweight formatted Runs and selectable text without using RichEdit's
    // mutable document model. That gives ConPTY/PowerShell its ANSI colors back while avoiding the
    // Windows 10 native RichEdit formatting crash that previously terminated the whole file manager.
    private (TextBlock View, ScrollViewer Scroller) CreateTerminalView()
    {
        var view = new TextBlock
        {
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            Foreground = new SolidColorBrush(DefaultTerminalForeground),
            SelectionHighlightColor = new SolidColorBrush(Color.FromArgb(0xff, 0x26, 0x4f, 0x78)),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var scroller = new ScrollViewer
        {
            Content = view,
            Background = new SolidColorBrush(DefaultTerminalBackground),
            Padding = new Thickness(12, 10, 12, 12),
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            ZoomMode = ZoomMode.Disabled,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        view.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(TerminalView_KeyDown), handledEventsToo: true);
        view.AddHandler(UIElement.KeyUpEvent, new KeyEventHandler(TerminalView_KeyUp), handledEventsToo: true);
        view.Loaded += TerminalView_Loaded;
        scroller.SizeChanged += TerminalView_SizeChanged;
        return (view, scroller);
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
        state.View.Loaded -= TerminalView_Loaded;
        state.Scroller.SizeChanged -= TerminalView_SizeChanged;
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
        public TextBlock View { get; }
        public ScrollViewer Scroller { get; }
        public TerminalTextBuffer Buffer { get; } = new();
        public ConPtyTerminalSession? Session { get; set; }
        public string WorkingDirectory { get; set; }
        public string LastRenderedText { get; set; } = string.Empty;
        public int RefreshQueued;
        public bool Disposed;

        public EventHandler<string> OutputHandler { get; }
        public EventHandler ExitHandler { get; }

        public TerminalTabState(
            TerminalWorkspaceDialog owner,
            TabViewItem tab,
            TextBlock view,
            ScrollViewer scroller,
            string workingDirectory)
        {
            _owner = owner;
            Tab = tab;
            View = view;
            Scroller = scroller;
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
}

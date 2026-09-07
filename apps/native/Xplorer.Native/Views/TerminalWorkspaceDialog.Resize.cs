using System.Runtime.InteropServices;
using Microsoft.UI.Windowing;
using Windows.Graphics;

namespace Xplorer.Native.Views;

public sealed partial class TerminalWorkspaceDialog
{
    private const int SwHide = 0;
    private const int SwShow = 5;

    private nint _terminalHwnd;
    private AppWindow? _terminalAppWindow;

    private void InitializeNativeTerminalWindow()
    {
        _terminalHwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_terminalHwnd);
        _terminalAppWindow = AppWindow.GetFromWindowId(windowId);

        if (_terminalAppWindow.Presenter is OverlappedPresenter presenter)
        {
            // Keep the normal Windows non-client frame. WS_THICKFRAME hit-testing is what gives us
            // the standard horizontal/vertical/diagonal resize cursors on every edge and corner.
            presenter.IsResizable = true;
            presenter.IsMaximizable = true;
            presenter.IsMinimizable = true;
        }

        _terminalAppWindow.Resize(new SizeInt32(980, 620));
        _terminalAppWindow.Closing += TerminalAppWindow_Closing;
        Title = "Xplorer Terminal";
    }

    private void ShowNativeTerminalWindow()
    {
        if (_disposed) return;

        if (_terminalHwnd != 0)
        {
            _ = ShowWindow(_terminalHwnd, SwShow);
            _ = SetForegroundWindow(_terminalHwnd);
        }

        Activate();
        _visible = true;
    }

    // Deliberately named Hide so existing terminal keyboard/tab behavior can stay independent from
    // the hosting technology. Unlike ContentDialog.Hide(), this hides the real top-level HWND while
    // keeping all ConPTY sessions and terminal tabs alive in memory.
    private void Hide()
    {
        if (_disposed) return;
        if (_terminalHwnd != 0) _ = ShowWindow(_terminalHwnd, SwHide);
        _visible = false;
        _tabChordArmed = false;
        _tabChordUsed = false;
    }

    private void TerminalAppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_disposed) return;

        // The normal caption X behaves like the in-terminal close button: hide the workspace rather
        // than killing PowerShell/cmd tabs. MainWindow.Dispose is the only path that destroys it.
        args.Cancel = true;
        Hide();
    }

    private void DisposeNativeTerminalWindow()
    {
        if (_terminalAppWindow is not null)
            _terminalAppWindow.Closing -= TerminalAppWindow_Closing;

        _visible = false;
        try
        {
            Close();
        }
        catch
        {
            // Main-window shutdown must never fail because the auxiliary terminal HWND is already
            // being destroyed by Windows.
        }
        finally
        {
            _terminalAppWindow = null;
            _terminalHwnd = 0;
        }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint hWnd);
}

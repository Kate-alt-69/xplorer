using Microsoft.UI.Xaml;

namespace Xplorer.Native;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var mainWindow = new MainWindow();
        mainWindow.InitializeNativeFileOperations();
        _window = mainWindow;
        _window.Activate();
    }
}

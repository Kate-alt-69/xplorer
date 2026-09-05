namespace Xplorer.Native.Services;

/// <summary>
/// In-process bridge between the Settings dialog and MainWindow. A preview carries only a parsed,
/// whitelisted theme definition; XML text, controls, commands and executable behavior never cross
/// this boundary.
/// </summary>
public static class ThemePreviewCoordinator
{
    public static event Action<XplorerThemeDefinition>? PreviewRequested;
    public static event Action? RestoreRequested;

    public static void Preview(XplorerThemeDefinition theme) => PreviewRequested?.Invoke(theme);

    public static void Restore() => RestoreRequested?.Invoke();
}

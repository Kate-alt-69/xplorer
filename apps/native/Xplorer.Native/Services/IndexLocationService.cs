namespace Xplorer.Native.Services;

/// <summary>
/// Resolves the active Xplorer index store. Privileged worker data is accepted only from Xplorer's
/// protected ProgramData subtree; the pointer itself is user-writable and therefore never trusted as
/// an arbitrary filesystem path. Interactive control/hint files always remain in LocalAppData.
/// </summary>
internal static class IndexLocationService
{
    private static int _forceLocalForSession;

    public static string LocalIndexDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Index");

    public static string ControlDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer",
        "Control");

    public static string ActivePointerPath => Path.Combine(LocalIndexDirectory, "active-index.path");

    public static string ActiveIndexDirectory
    {
        get
        {
            if (Volatile.Read(ref _forceLocalForSession) != 0)
                return LocalIndexDirectory;

            var privileged = TryReadProtectedIndexDirectory();
            return privileged ?? LocalIndexDirectory;
        }
    }

    public static bool PrivilegedIndexConfigured => TryReadProtectedIndexDirectory() is not null;

    public static void UseLocalIndexForSession() => Interlocked.Exchange(ref _forceLocalForSession, 1);

    public static void PreferConfiguredIndex() => Interlocked.Exchange(ref _forceLocalForSession, 0);

    private static string? TryReadProtectedIndexDirectory()
    {
        try
        {
            if (!File.Exists(ActivePointerPath)) return null;
            var value = File.ReadAllText(ActivePointerPath).Trim();
            if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value)) return null;

            var candidate = Path.GetFullPath(value)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var programDataRoot = Path.GetFullPath(Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "Xplorer",
                    "Index"))
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            var relative = Path.GetRelativePath(programDataRoot, candidate);
            if (relative == "." ||
                Path.IsPathRooted(relative) ||
                relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    .Any(segment => segment == ".."))
            {
                return null;
            }

            return Directory.Exists(candidate) ? candidate : null;
        }
        catch
        {
            return null;
        }
    }
}

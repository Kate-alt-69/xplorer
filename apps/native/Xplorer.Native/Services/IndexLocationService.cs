using System.Security.Principal;

namespace Xplorer.Native.Services;

/// <summary>
/// Resolves Xplorer's index/control locations without trusting a user-writable pointer to a
/// privileged filesystem path. A protected index has one deterministic ProgramData location per
/// desktop SID and is considered provisioned only when SYSTEM wrote its marker inside that store.
/// </summary>
internal static class IndexLocationService
{
    private const string ProvisionMarkerName = "provisioned.v1";
    private static int _forceLocalForSession;

    public static string UserDataDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Xplorer");

    public static string LocalIndexDirectory => Path.Combine(UserDataDirectory, "Index");

    public static string ControlDirectory => Path.Combine(UserDataDirectory, "Control");

    public static string ProtectedIndexDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "Xplorer",
        "Index",
        CurrentUserSid);

    public static string ProtectedWorkerDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "Xplorer",
        "Worker");

    public static string ProtectedWorkerPath => Path.Combine(ProtectedWorkerDirectory, "xplorer-bgw.exe");

    public static string ProtectedProvisionMarker => Path.Combine(ProtectedIndexDirectory, ProvisionMarkerName);

    public static string ActiveIndexDirectory =>
        Volatile.Read(ref _forceLocalForSession) == 0 && PrivilegedIndexConfigured
            ? ProtectedIndexDirectory
            : LocalIndexDirectory;

    public static bool PrivilegedIndexConfigured
    {
        get
        {
            try
            {
                return Directory.Exists(ProtectedIndexDirectory)
                    && File.Exists(ProtectedProvisionMarker)
                    && File.Exists(ProtectedWorkerPath);
            }
            catch
            {
                return false;
            }
        }
    }

    public static bool UsingProtectedIndex =>
        Volatile.Read(ref _forceLocalForSession) == 0 && PrivilegedIndexConfigured;

    public static void UseLocalIndexForSession() => Interlocked.Exchange(ref _forceLocalForSession, 1);

    public static void PreferConfiguredIndex() => Interlocked.Exchange(ref _forceLocalForSession, 0);

    private static string CurrentUserSid
    {
        get
        {
            try
            {
                return WindowsIdentity.GetCurrent().User?.Value
                    ?? throw new InvalidOperationException("The current Windows user has no SID.");
            }
            catch
            {
                // This value is used only to probe an optional acceleration store. A deliberately
                // impossible SID component simply makes protected indexing unavailable and leaves
                // Xplorer on the ordinary per-user index/direct-disk path.
                return "S-1-0-0";
            }
        }
    }
}

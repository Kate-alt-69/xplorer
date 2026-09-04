using Microsoft.Win32;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns Xplorer's per-user Windows Shell registration. Every registry key created here carries
/// an ownership marker, and cleanup refuses to delete keys without that marker.
/// </summary>
public static class ShellIntegrationService
{
    private const string ClassesRoot = @"Software\Classes";
    private const string VerbKeyName = "Xplorer.Native";
    private const string OwnershipValueName = "XplorerOwner";
    private const string OwnershipValue = "{8F7A8759-1D96-45A1-A7A4-1F516D9DC7B8}";
    private const string HostExecutableName = "xplorer.exe";

    private static readonly ShellVerb[] Verbs =
    [
        new(@"Directory\shell", "%1"),
        new(@"Drive\shell", "%1"),
        new(@"Directory\Background\shell", "%V"),
    ];

    public static void Apply(bool enabled)
    {
        if (enabled) Register();
        else Unregister();
    }

    public static void Register()
    {
        var executable = ResolvePublicExecutable();

        foreach (var verb in Verbs)
        {
            var keyPath = $@"{ClassesRoot}\{verb.ParentPath}\{VerbKeyName}";
            using var key = Registry.CurrentUser.CreateSubKey(keyPath, writable: true)
                ?? throw new InvalidOperationException($"Unable to create HKCU\\{keyPath}.");

            key.SetValue("", "Open in Xplorer", RegistryValueKind.String);
            key.SetValue("MUIVerb", "Open in Xplorer", RegistryValueKind.String);
            key.SetValue("Icon", $"\"{executable}\"", RegistryValueKind.String);
            key.SetValue(OwnershipValueName, OwnershipValue, RegistryValueKind.String);

            using var command = key.CreateSubKey("command", writable: true)
                ?? throw new InvalidOperationException($"Unable to create the command for HKCU\\{keyPath}.");
            command.SetValue("", $"\"{executable}\" \"{verb.TargetToken}\"", RegistryValueKind.String);
            command.SetValue(OwnershipValueName, OwnershipValue, RegistryValueKind.String);
        }
    }

    public static void Unregister()
    {
        foreach (var verb in Verbs)
        {
            var parentPath = $@"{ClassesRoot}\{verb.ParentPath}";
            using var parent = Registry.CurrentUser.OpenSubKey(parentPath, writable: true);
            if (parent is null) continue;

            using var candidate = parent.OpenSubKey(VerbKeyName, writable: false);
            if (candidate is null) continue;

            var marker = candidate.GetValue(OwnershipValueName) as string;
            if (!string.Equals(marker, OwnershipValue, StringComparison.Ordinal)) continue;

            candidate.Close();
            parent.DeleteSubKeyTree(VerbKeyName, throwOnMissingSubKey: false);
        }
    }

    private static string ResolvePublicExecutable()
    {
        var host = Path.Combine(AppContext.BaseDirectory, HostExecutableName);
        if (File.Exists(host)) return host;

        return Environment.ProcessPath is { Length: > 0 } processPath
            ? processPath
            : throw new InvalidOperationException("Unable to determine the Xplorer executable path.");
    }

    private sealed record ShellVerb(string ParentPath, string TargetToken);
}

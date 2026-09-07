namespace Xplorer.Native.Services;

/// <summary>
/// Stable process-boundary contract for Xplorer.Native.exe. Keep command spelling/alias handling in
/// one place so the Rust launcher, shell integration and debug tools can evolve without teaching
/// MainWindow about command-line syntax.
/// </summary>
internal static class LaunchRequestParser
{
    private static readonly HashSet<string> OpenAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        "--open",
        "-open",
        "/open",
        "--folder",
        "-folder",
        "--path",
        "-path",
        "--test-open-folder",
        "-test-open-folder",
        "--test-open-path",
        "-test-open-path",
    };

    private static readonly HashSet<string> DebugAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        "--debug",
        "-debug",
        "--diagnose",
    };

    private static readonly HashSet<string> MaintenanceCommands = new(StringComparer.OrdinalIgnoreCase)
    {
        "--register-shell",
        "--unregister-shell",
        "--cleanup-integration",
    };

    public static LaunchRequest Parse(IEnumerable<string> arguments)
    {
        var tokens = arguments
            .Where(argument => !string.IsNullOrWhiteSpace(argument))
            .Select(argument => argument.Trim())
            .ToArray();

        string? initialFolder = null;
        string? maintenanceCommand = null;
        string? error = null;
        var unknown = new List<string>();
        var debug = false;
        var explicitFolder = false;

        for (var index = 0; index < tokens.Length; index++)
        {
            var token = tokens[index];

            if (DebugAliases.Contains(token))
            {
                debug = true;
                continue;
            }

            if (MaintenanceCommands.Contains(token))
            {
                maintenanceCommand ??= token.ToLowerInvariant();
                continue;
            }

            if (OpenAliases.Contains(token))
            {
                explicitFolder = true;
                if (index + 1 >= tokens.Length)
                {
                    error ??= $"{token} requires a folder path";
                    continue;
                }

                var value = tokens[++index];
                if (TryNormalizeFolder(value, out var folder))
                    initialFolder = folder;
                else
                    error ??= $"Folder does not exist or is not accessible: {value}";
                continue;
            }

            // A bare positional directory remains supported for Windows shell integrations and
            // backwards compatibility. Option-looking text is never guessed to be a path.
            if (!LooksLikeOption(token) && initialFolder is null)
            {
                if (TryNormalizeFolder(token, out var folder))
                {
                    initialFolder = folder;
                    continue;
                }
            }

            unknown.Add(token);
        }

        return new LaunchRequest(
            InitialFolder: initialFolder,
            MaintenanceCommand: maintenanceCommand,
            DebugRequested: debug,
            ExplicitFolderRequested: explicitFolder,
            UnknownArguments: unknown,
            Error: error);
    }

    private static bool TryNormalizeFolder(string value, out string folder)
    {
        folder = string.Empty;
        if (string.IsNullOrWhiteSpace(value)) return false;

        var candidate = value.Trim();
        if (candidate.Length >= 2 && candidate[0] == '"' && candidate[^1] == '"')
            candidate = candidate[1..^1];

        try
        {
            if (!Directory.Exists(candidate)) return false;
            folder = Path.GetFullPath(candidate);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool LooksLikeOption(string value) =>
        value.StartsWith("-", StringComparison.Ordinal) || value.StartsWith("/", StringComparison.Ordinal);
}

internal sealed record LaunchRequest(
    string? InitialFolder,
    string? MaintenanceCommand,
    bool DebugRequested,
    bool ExplicitFolderRequested,
    IReadOnlyList<string> UnknownArguments,
    string? Error);

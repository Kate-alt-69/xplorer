using System.Security.Cryptography;
using System.Text.Json;

namespace Xplorer.Native.Services;

/// <summary>
/// Stages imported themes without changing the persisted active theme. The staged XML is parsed by
/// ThemeService, scanned by AMSI and described by a tiny pending-state file. Only an explicit later
/// confirmation promotes it into the user's active Themes folder.
/// </summary>
public static class ThemeImportService
{
    private const int MaximumStateBytes = 16 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private const string PendingStateFileName = "pending-preview.json";

    public sealed record PendingThemeState(
        string StagedFileName,
        string DisplayName,
        string SourceFileName,
        string Sha256,
        DateTimeOffset CreatedUtc);

    public sealed record ImportResult(
        PendingThemeState State,
        XplorerThemeDefinition Definition,
        IReadOnlyList<string> MissingProperties,
        ThemeSecurityService.ScanResult Scan);

    private static string PendingStatePath => Path.Combine(ThemeService.ThemeDirectory, PendingStateFileName);

    public static bool HasPendingPreview()
    {
        try
        {
            return TryReadState() is not null;
        }
        catch
        {
            return false;
        }
    }

    public static async Task<ImportResult> StageAsync(string sourcePath, string displayName)
    {
        if (!string.Equals(Path.GetExtension(sourcePath), ".xml", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Only .xml Xplorer theme files can be imported.");

        var sourceInfo = new FileInfo(sourcePath);
        if (!sourceInfo.Exists)
            throw new FileNotFoundException("The selected XML theme no longer exists.", sourcePath);
        if (sourceInfo.Length > 64 * 1024)
            throw new InvalidDataException("Xplorer theme files are limited to 64 KiB.");

        var scan = await ThemeSecurityService.ScanFileAsync(sourcePath).ConfigureAwait(false);
        if (!scan.Clean)
            throw new InvalidDataException(scan.Message);

        ThemeService.EnsureDefaultThemeFile();
        DiscardPending();

        var bytes = await File.ReadAllBytesAsync(sourcePath).ConfigureAwait(false);
        var hash = Convert.ToHexString(SHA256.HashData(bytes));
        var stagedName = $".pending-{Guid.NewGuid():N}.xml";
        var stagedPath = ThemeService.ResolveThemePath(stagedName);
        await File.WriteAllBytesAsync(stagedPath, bytes).ConfigureAwait(false);

        try
        {
            var inspection = ThemeService.Analyze(stagedName);
            var state = new PendingThemeState(
                stagedName,
                string.IsNullOrWhiteSpace(displayName) ? Path.GetFileName(sourcePath) : displayName.Trim(),
                Path.GetFileName(sourcePath),
                hash,
                DateTimeOffset.UtcNow);
            WriteState(state);
            return new ImportResult(state, inspection.Definition, inspection.MissingProperties, scan);
        }
        catch
        {
            TryDelete(stagedPath);
            TryDelete(PendingStatePath);
            throw;
        }
    }

    public static async Task<ImportResult?> LoadPendingAsync()
    {
        var state = TryReadState();
        if (state is null) return null;

        ValidateStateFileName(state.StagedFileName);
        var path = ThemeService.ResolveThemePath(state.StagedFileName);
        if (!File.Exists(path))
        {
            TryDelete(PendingStatePath);
            return null;
        }

        var bytes = await File.ReadAllBytesAsync(path).ConfigureAwait(false);
        var hash = Convert.ToHexString(SHA256.HashData(bytes));
        if (!string.Equals(hash, state.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The staged theme changed after it was previewed. Xplorer will not trust it.");

        var scan = await ThemeSecurityService.ScanFileAsync(path).ConfigureAwait(false);
        if (!scan.Clean)
            throw new InvalidDataException(scan.Message);

        var inspection = ThemeService.Analyze(state.StagedFileName);
        return new ImportResult(state, inspection.Definition, inspection.MissingProperties, scan);
    }

    public static async Task<string> CommitPendingAsync(SettingsService settingsService)
    {
        var pending = await LoadPendingAsync().ConfigureAwait(false)
            ?? throw new InvalidOperationException("There is no pending theme preview to keep.");

        var stagedPath = ThemeService.ResolveThemePath(pending.State.StagedFileName);
        var destinationName = FindAvailableDestinationName(pending.State.SourceFileName);
        var destinationPath = ThemeService.ResolveThemePath(destinationName);
        File.Copy(stagedPath, destinationPath, overwrite: false);

        var settings = settingsService.Current;
        var previousTheme = settings.Theme;
        var previousFile = settings.ThemeFileName;
        try
        {
            settings.Theme = "Custom XML";
            settings.ThemeFileName = destinationName;
            await settingsService.SaveAsync().ConfigureAwait(false);
        }
        catch
        {
            settings.Theme = previousTheme;
            settings.ThemeFileName = previousFile;
            TryDelete(destinationPath);
            throw;
        }

        DiscardPending();
        return destinationName;
    }

    public static void DiscardPending()
    {
        PendingThemeState? state = null;
        try
        {
            state = TryReadState();
        }
        catch
        {
            // Malformed state is discarded below.
        }

        if (state is not null)
        {
            try
            {
                ValidateStateFileName(state.StagedFileName);
                TryDelete(ThemeService.ResolveThemePath(state.StagedFileName));
            }
            catch
            {
                // Never follow an invalid path from state during cleanup.
            }
        }

        TryDelete(PendingStatePath);
    }

    private static PendingThemeState? TryReadState()
    {
        if (!File.Exists(PendingStatePath)) return null;
        var info = new FileInfo(PendingStatePath);
        if (info.Length <= 0 || info.Length > MaximumStateBytes)
            throw new InvalidDataException("Pending theme state is invalid.");

        var state = JsonSerializer.Deserialize<PendingThemeState>(File.ReadAllText(PendingStatePath), JsonOptions)
            ?? throw new InvalidDataException("Pending theme state is empty.");
        ValidateStateFileName(state.StagedFileName);
        if (string.IsNullOrWhiteSpace(state.Sha256) || state.Sha256.Length != 64)
            throw new InvalidDataException("Pending theme state has an invalid hash.");
        return state;
    }

    private static void WriteState(PendingThemeState state)
    {
        Directory.CreateDirectory(ThemeService.ThemeDirectory);
        var temp = $"{PendingStatePath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(state, JsonOptions));
            File.Move(temp, PendingStatePath, overwrite: true);
        }
        finally
        {
            TryDelete(temp);
        }
    }

    private static string FindAvailableDestinationName(string sourceName)
    {
        var stem = SanitizeFileStem(Path.GetFileNameWithoutExtension(sourceName));
        if (string.IsNullOrWhiteSpace(stem)) stem = "imported-theme";

        for (var index = 0; index < 1000; index++)
        {
            var candidate = index == 0 ? $"{stem}.xml" : $"{stem}-{index}.xml";
            if (!File.Exists(ThemeService.ResolveThemePath(candidate))) return candidate;
        }

        return $"{stem}-{Guid.NewGuid():N}.xml";
    }

    private static string SanitizeFileStem(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var cleaned = new string(value.Where(character => !invalid.Contains(character) && character != '.').ToArray()).Trim();
        return cleaned.Length > 48 ? cleaned[..48] : cleaned;
    }

    private static void ValidateStateFileName(string fileName)
    {
        if (!fileName.StartsWith(".pending-", StringComparison.Ordinal) ||
            !string.Equals(Path.GetFileName(fileName), fileName, StringComparison.Ordinal) ||
            !string.Equals(Path.GetExtension(fileName), ".xml", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Pending theme state points outside Xplorer's theme staging area.");
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // Best effort cleanup only.
        }
    }
}

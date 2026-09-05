using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;

namespace Xplorer.Native.Models;

/// <summary>
/// XAML-visible file model. The native rewrite deliberately uses Xplorer's own
/// color-coded vector icon language instead of Explorer's yellow shell-folder
/// thumbnails. Real thumbnails are still used for image files.
/// </summary>
public sealed class FileSystemItem : INotifyPropertyChanged
{
    private BitmapImage? _thumbnail;
    private bool _thumbnailRequested;

    public string FullPath { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public bool ShowExtension { get; set; }
    public DateTime LastWriteTimeUtc { get; set; }
    public long? SizeBytes { get; set; }

    public string DisplayName
    {
        get
        {
            if (IsDirectory || ShowExtension)
                return Name;

            var withoutExtension = Path.GetFileNameWithoutExtension(Name);
            return string.IsNullOrWhiteSpace(withoutExtension) ? Name : withoutExtension;
        }
    }

    public string TypeName
    {
        get
        {
            if (IsDirectory) return "File folder";
            var extension = Path.GetExtension(Name);
            return string.IsNullOrWhiteSpace(extension)
                ? "File"
                : $"{extension.TrimStart('.').ToUpperInvariant()} file";
        }
    }

    public string ModifiedText => LastWriteTimeUtc == default
        ? string.Empty
        : LastWriteTimeUtc.ToLocalTime().ToString("g");

    public string SizeText => SizeBytes is long bytes ? FormatSize(bytes) : string.Empty;

    public string FallbackGlyph
    {
        get
        {
            if (IsDirectory) return "\uE8B7";

            return Extension switch
            {
                ".txt" or ".md" or ".log" or ".rtf" => "\uE8A5",
                ".js" or ".ts" or ".jsx" or ".tsx" or ".py" or ".rb" or ".go" or ".rs" or
                ".java" or ".c" or ".h" or ".cpp" or ".hpp" or ".cs" => "\uE943",
                ".html" or ".htm" or ".css" or ".scss" or ".sass" => "\uE909",
                ".json" or ".xml" or ".yaml" or ".yml" or ".toml" => "\uE943",
                ".png" or ".jpg" or ".jpeg" or ".gif" or ".svg" or ".webp" or ".bmp" or
                ".tif" or ".tiff" or ".heic" or ".avif" => "\uE91B",
                ".mp4" or ".avi" or ".mkv" or ".mov" or ".webm" or ".m4v" => "\uE714",
                ".mp3" or ".wav" or ".flac" or ".ogg" or ".aac" or ".m4a" or ".opus" => "\uE8D6",
                ".pdf" => "\uE8A5",
                ".doc" or ".docx" or ".odt" => "\uE8A5",
                ".xls" or ".xlsx" or ".csv" or ".ods" => "\uE80A",
                ".ppt" or ".pptx" or ".odp" => "\uE89B",
                ".zip" or ".rar" or ".7z" or ".tar" or ".gz" or ".bz2" or ".xz" => "\uE7B8",
                ".exe" or ".msi" or ".appx" or ".msix" => "\uE713",
                ".sh" or ".bash" or ".zsh" or ".bat" or ".cmd" or ".ps1" => "\uE756",
                _ => "\uE7C3",
            };
        }
    }

    public SolidColorBrush IconBrush => new(GetIconColor());

    public bool ShouldLoadThumbnail => !IsDirectory && IsImageExtension(Extension);

    public BitmapImage? Thumbnail
    {
        get => _thumbnail;
        set
        {
            if (ReferenceEquals(_thumbnail, value)) return;
            _thumbnail = value;
            OnPropertyChanged();
        }
    }

    public bool TryBeginThumbnailLoad()
    {
        if (!ShouldLoadThumbnail || _thumbnailRequested) return false;
        _thumbnailRequested = true;
        return true;
    }

    private string Extension => Path.GetExtension(Name).ToLowerInvariant();

    private Color GetIconColor()
    {
        if (IsDirectory) return Rgb(0x63, 0x66, 0xF1);

        return Extension switch
        {
            ".js" or ".ts" or ".jsx" or ".tsx" or ".sh" or ".bash" or ".zsh" or ".bat" or
            ".cmd" or ".ps1" => Rgb(0xFB, 0xBF, 0x24),
            ".py" or ".rb" or ".go" or ".rs" or ".java" or ".c" or ".h" or ".cpp" or
            ".hpp" or ".cs" or ".json" or ".xml" or ".yaml" or ".yml" or ".toml" or
            ".xls" or ".xlsx" or ".csv" or ".ods" => Rgb(0x34, 0xD3, 0x99),
            ".html" or ".htm" or ".css" or ".scss" or ".sass" or ".zip" or ".rar" or
            ".7z" or ".tar" or ".gz" or ".bz2" or ".xz" or ".ppt" or ".pptx" or ".odp" => Rgb(0xFB, 0x92, 0x3C),
            ".png" or ".jpg" or ".jpeg" or ".gif" or ".svg" or ".webp" or ".bmp" or
            ".tif" or ".tiff" or ".heic" or ".avif" => Rgb(0xA7, 0x8B, 0xFA),
            ".mp4" or ".avi" or ".mkv" or ".mov" or ".webm" or ".m4v" or ".pdf" => Rgb(0xF8, 0x71, 0x71),
            ".mp3" or ".wav" or ".flac" or ".ogg" or ".aac" or ".m4a" or ".opus" => Rgb(0x22, 0xD3, 0xEE),
            ".doc" or ".docx" or ".odt" => Rgb(0x63, 0x66, 0xF1),
            _ => Rgb(0x99, 0x9C, 0xAA),
        };
    }

    private static bool IsImageExtension(string extension) => extension is
        ".png" or ".jpg" or ".jpeg" or ".gif" or ".svg" or ".webp" or ".bmp" or
        ".tif" or ".tiff" or ".heic" or ".avif";

    private static Color Rgb(byte r, byte g, byte b) => Color.FromArgb(0xff, r, g, b);

    private static string FormatSize(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double value = bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }

        return unit == 0 ? $"{bytes} B" : $"{value:0.#} {units[unit]}";
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

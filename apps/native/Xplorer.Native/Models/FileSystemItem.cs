using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Xplorer.Native.Models;

public sealed class FileSystemItem : INotifyPropertyChanged
{
    private BitmapImage? _thumbnail;
    private bool _thumbnailRequested;

    public required string FullPath { get; init; }
    public required string Name { get; init; }
    public required bool IsDirectory { get; init; }
    public required bool ShowExtension { get; init; }
    public DateTime LastWriteTimeUtc { get; init; }
    public long? SizeBytes { get; init; }

    public string DisplayName
    {
        get
        {
            if (IsDirectory || ShowExtension)
            {
                return Name;
            }

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

    public string FallbackGlyph => IsDirectory ? "\uE8B7" : "\uE7C3";

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
        if (_thumbnailRequested) return false;
        _thumbnailRequested = true;
        return true;
    }

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

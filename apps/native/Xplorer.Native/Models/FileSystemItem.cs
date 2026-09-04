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

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

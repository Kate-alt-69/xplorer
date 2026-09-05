using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;

namespace Xplorer.Native.Services;

public static class ThumbnailService
{
    public static async Task<BitmapImage?> LoadAsync(string path, bool isDirectory, uint size = 96)
    {
        // Xplorer has its own folder/file icon language. Explorer shell thumbnails for folders
        // and ordinary file types were visually replacing those icons with stock yellow folders.
        // Only real visual media gets a thumbnail; everything else keeps the Xplorer vector icon.
        if (isDirectory || !IsImage(path)) return null;

        try
        {
            var file = await StorageFile.GetFileFromPathAsync(path);
            using var thumbnail = await file.GetThumbnailAsync(
                ThumbnailMode.PicturesView,
                size,
                ThumbnailOptions.UseCurrentScale);

            if (thumbnail.Size == 0) return null;

            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(thumbnail);
            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsImage(string path) => Path.GetExtension(path).ToLowerInvariant() is
        ".png" or ".jpg" or ".jpeg" or ".webp" or ".bmp" or ".gif" or ".tif" or ".tiff" or ".heic" or ".avif" or ".svg";
}

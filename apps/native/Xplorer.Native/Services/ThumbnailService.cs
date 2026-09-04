using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;

namespace Xplorer.Native.Services;

public static class ThumbnailService
{
    public static async Task<BitmapImage?> LoadAsync(string path, bool isDirectory, uint size = 96)
    {
        try
        {
            StorageItemThumbnail thumbnail;
            if (isDirectory)
            {
                var folder = await StorageFolder.GetFolderFromPathAsync(path);
                thumbnail = await folder.GetThumbnailAsync(
                    ThumbnailMode.ListView,
                    size,
                    ThumbnailOptions.UseCurrentScale);
            }
            else
            {
                var file = await StorageFile.GetFileFromPathAsync(path);
                var mode = IsImage(path) ? ThumbnailMode.PicturesView : ThumbnailMode.ListView;
                thumbnail = await file.GetThumbnailAsync(
                    mode,
                    size,
                    ThumbnailOptions.UseCurrentScale);
            }

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

    private static bool IsImage(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() is
            ".png" or ".jpg" or ".jpeg" or ".webp" or ".bmp" or ".gif" or ".tif" or ".tiff" or ".heic" or ".avif";
    }
}

using Xplorer.Native.Models;

namespace Xplorer.Native.Services;

public static class DriveService
{
    public static IReadOnlyList<DriveItem> GetDrives()
    {
        var result = new List<DriveItem>();

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady) continue;

                var total = drive.TotalSize;
                var free = drive.AvailableFreeSpace;
                var usedPercent = total <= 0 ? 0 : ((double)(total - free) / total) * 100d;
                var label = string.IsNullOrWhiteSpace(drive.VolumeLabel)
                    ? drive.Name.TrimEnd('\\')
                    : $"{drive.VolumeLabel} ({drive.Name.TrimEnd('\\')})";

                result.Add(new DriveItem
                {
                    RootPath = drive.RootDirectory.FullName,
                    DisplayName = label,
                    FreeSpaceText = $"{FormatBytes(free)} free",
                    UsedPercent = usedPercent,
                    // Deliberately conservative. Fixed disks and partitions must never show Eject.
                    CanEject = drive.DriveType == DriveType.Removable,
                });
            }
            catch (IOException)
            {
                // Drive disappeared while being enumerated.
            }
            catch (UnauthorizedAccessException)
            {
                // Skip inaccessible devices.
            }
        }

        return result;
    }

    private static string FormatBytes(long bytes)
    {
        string[] suffixes = ["B", "KB", "MB", "GB", "TB"];
        double value = bytes;
        var suffix = 0;
        while (value >= 1024 && suffix < suffixes.Length - 1)
        {
            value /= 1024;
            suffix++;
        }

        return $"{value:0.#} {suffixes[suffix]}";
    }
}

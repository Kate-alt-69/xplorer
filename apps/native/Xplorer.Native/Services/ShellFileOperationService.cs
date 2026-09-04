using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// Runs copy/move/delete through the modern Windows Shell IFileOperation API. Windows therefore
/// owns progress, cancellation, elevation, collision prompts, apply-to-all behavior, and Recycle
/// Bin semantics instead of Xplorer attempting to imitate them.
/// </summary>
public static class ShellFileOperationService
{
    private const uint FofAllowUndo = 0x0040;
    private const uint FofNoConfirmMkdir = 0x0200;
    private const uint FofWantNukeWarning = 0x4000;
    private const uint FofxShowElevationPrompt = 0x00040000;
    private const uint FofxRecycleOnDelete = 0x00080000;
    private const uint FofxAddUndoRecord = 0x20000000;

    private static readonly Guid IidShellItem = new("43826D1E-E718-42EE-BC55-A1E261C37BFE");

    public static Task<ShellFileOperationResult> CopyAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources,
        string destination) =>
        RunAsync(ownerHwnd, ShellOperation.Copy, sources, destination);

    public static Task<ShellFileOperationResult> MoveAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources,
        string destination) =>
        RunAsync(ownerHwnd, ShellOperation.Move, sources, destination);

    public static Task<ShellFileOperationResult> DeleteAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources) =>
        RunAsync(ownerHwnd, ShellOperation.Delete, sources, null);

    private static Task<ShellFileOperationResult> RunAsync(
        nint ownerHwnd,
        ShellOperation operation,
        IReadOnlyCollection<string> sources,
        string? destination)
    {
        var sourcePaths = sources
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (sourcePaths.Length == 0)
            return Task.FromResult(new ShellFileOperationResult(0, false));

        var destinationPath = destination is null ? null : Path.GetFullPath(destination);
        var completion = new TaskCompletionSource<ShellFileOperationResult>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var thread = new Thread(() =>
        {
            IFileOperation? fileOperation = null;
            IShellItem? destinationItem = null;
            var sourceItems = new List<IShellItem>(sourcePaths.Length);

            try
            {
                fileOperation = (IFileOperation)new FileOperationComObject();
                ThrowIfFailed(fileOperation.SetOwnerWindow(ownerHwnd));
                ThrowIfFailed(fileOperation.SetOperationFlags(GetFlags(operation)));

                if (destinationPath is not null)
                    destinationItem = CreateShellItem(destinationPath);

                foreach (var path in sourcePaths)
                {
                    var sourceItem = CreateShellItem(path);
                    sourceItems.Add(sourceItem);

                    var hr = operation switch
                    {
                        ShellOperation.Copy => fileOperation.CopyItem(
                            sourceItem,
                            destinationItem ?? throw new InvalidOperationException("Copy destination is missing."),
                            null,
                            null),
                        ShellOperation.Move => fileOperation.MoveItem(
                            sourceItem,
                            destinationItem ?? throw new InvalidOperationException("Move destination is missing."),
                            null,
                            null),
                        ShellOperation.Delete => fileOperation.DeleteItem(sourceItem, null),
                        _ => throw new ArgumentOutOfRangeException(nameof(operation)),
                    };
                    ThrowIfFailed(hr);
                }

                var performHr = fileOperation.PerformOperations();
                if (performHr < 0)
                {
                    completion.TrySetResult(new ShellFileOperationResult(performHr, false));
                    return;
                }

                ThrowIfFailed(fileOperation.GetAnyOperationsAborted(out var aborted));
                completion.TrySetResult(new ShellFileOperationResult(performHr, aborted));
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
            finally
            {
                foreach (var sourceItem in sourceItems)
                    ReleaseComObject(sourceItem);
                if (destinationItem is not null) ReleaseComObject(destinationItem);
                if (fileOperation is not null) ReleaseComObject(fileOperation);
            }
        })
        {
            IsBackground = true,
            Name = "Xplorer IFileOperation",
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }

    private static uint GetFlags(ShellOperation operation)
    {
        var common = FofAllowUndo | FofNoConfirmMkdir | FofxShowElevationPrompt | FofxAddUndoRecord;
        return operation == ShellOperation.Delete
            ? common | FofWantNukeWarning | FofxRecycleOnDelete
            : common;
    }

    private static IShellItem CreateShellItem(string path)
    {
        nint shellItemPtr = 0;
        try
        {
            var iid = IidShellItem;
            ThrowIfFailed(SHCreateItemFromParsingName(path, 0, ref iid, out shellItemPtr));
            return (IShellItem)Marshal.GetObjectForIUnknown(shellItemPtr);
        }
        finally
        {
            if (shellItemPtr != 0) Marshal.Release(shellItemPtr);
        }
    }

    private static void ThrowIfFailed(int hr)
    {
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    }

    private static void ReleaseComObject(object value)
    {
        if (Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }

    private enum ShellOperation
    {
        Copy,
        Move,
        Delete,
    }

    [ComImport]
    [Guid("3AD05575-8857-4850-9277-11B85BDB8E09")]
    private class FileOperationComObject
    {
    }

    [ComImport]
    [Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOperation
    {
        [PreserveSig] int Advise(IFileOperationProgressSink pfops, out uint pdwCookie);
        [PreserveSig] int Unadvise(uint dwCookie);
        [PreserveSig] int SetOperationFlags(uint dwOperationFlags);
        [PreserveSig] int SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string pszMessage);
        [PreserveSig] int SetProgressDialog([MarshalAs(UnmanagedType.IUnknown)] object popd);
        [PreserveSig] int SetProperties([MarshalAs(UnmanagedType.IUnknown)] object pproparray);
        [PreserveSig] int SetOwnerWindow(nint hwndOwner);
        [PreserveSig] int ApplyPropertiesToItem(IShellItem psiItem);
        [PreserveSig] int ApplyPropertiesToItems([MarshalAs(UnmanagedType.IUnknown)] object punkItems);
        [PreserveSig] int RenameItem(
            IShellItem psiItem,
            [MarshalAs(UnmanagedType.LPWStr)] string pszNewName,
            IFileOperationProgressSink? pfopsItem);
        [PreserveSig] int RenameItems(
            [MarshalAs(UnmanagedType.IUnknown)] object punkItems,
            [MarshalAs(UnmanagedType.LPWStr)] string pszNewName);
        [PreserveSig] int MoveItem(
            IShellItem psiItem,
            IShellItem psiDestinationFolder,
            [MarshalAs(UnmanagedType.LPWStr)] string? pszNewName,
            IFileOperationProgressSink? pfopsItem);
        [PreserveSig] int MoveItems(
            [MarshalAs(UnmanagedType.IUnknown)] object punkItems,
            IShellItem psiDestinationFolder);
        [PreserveSig] int CopyItem(
            IShellItem psiItem,
            IShellItem psiDestinationFolder,
            [MarshalAs(UnmanagedType.LPWStr)] string? pszCopyName,
            IFileOperationProgressSink? pfopsItem);
        [PreserveSig] int CopyItems(
            [MarshalAs(UnmanagedType.IUnknown)] object punkItems,
            IShellItem psiDestinationFolder);
        [PreserveSig] int DeleteItem(IShellItem psiItem, IFileOperationProgressSink? pfopsItem);
        [PreserveSig] int DeleteItems([MarshalAs(UnmanagedType.IUnknown)] object punkItems);
        [PreserveSig] int NewItem(
            IShellItem psiDestinationFolder,
            uint dwFileAttributes,
            [MarshalAs(UnmanagedType.LPWStr)] string pszName,
            [MarshalAs(UnmanagedType.LPWStr)] string? pszTemplateName,
            IFileOperationProgressSink? pfopsItem);
        [PreserveSig] int PerformOperations();
        [PreserveSig] int GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool pfAnyOperationsAborted);
    }

    [ComImport]
    [Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOperationProgressSink
    {
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        [PreserveSig] int BindToHandler(nint pbc, ref Guid bhid, ref Guid riid, out nint ppv);
        [PreserveSig] int GetParent(out IShellItem ppsi);
        [PreserveSig] int GetDisplayName(uint sigdnName, out nint ppszName);
        [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(
        string pszPath,
        nint pbc,
        ref Guid riid,
        out nint ppv);
}

public readonly record struct ShellFileOperationResult(int ResultCode, bool Aborted)
{
    public bool Succeeded => ResultCode >= 0 && !Aborted;
}

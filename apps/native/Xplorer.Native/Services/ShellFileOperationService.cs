using System.Runtime.InteropServices;

namespace Xplorer.Native.Services;

/// <summary>
/// First native file-operation backend. It delegates copy/move/delete to the Windows Shell so
/// collision, elevation, recycle-bin and progress UI behave like Windows instead of being
/// reimplemented in the WinUI layer. This can later move to IFileOperation without changing the
/// MainWindow contract.
/// </summary>
public static class ShellFileOperationService
{
    private const uint FoMove = 0x0001;
    private const uint FoCopy = 0x0002;
    private const uint FoDelete = 0x0003;

    private const ushort FofAllowUndo = 0x0040;
    private const ushort FofNoConfirmMkdir = 0x0200;
    private const ushort FofWantNukeWarning = 0x4000;

    public static Task<ShellFileOperationResult> CopyAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources,
        string destination) =>
        RunAsync(ownerHwnd, FoCopy, sources, destination, FofAllowUndo | FofNoConfirmMkdir);

    public static Task<ShellFileOperationResult> MoveAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources,
        string destination) =>
        RunAsync(ownerHwnd, FoMove, sources, destination, FofAllowUndo | FofNoConfirmMkdir);

    public static Task<ShellFileOperationResult> DeleteAsync(
        nint ownerHwnd,
        IReadOnlyCollection<string> sources) =>
        RunAsync(ownerHwnd, FoDelete, sources, null, FofAllowUndo | FofWantNukeWarning);

    private static Task<ShellFileOperationResult> RunAsync(
        nint ownerHwnd,
        uint operation,
        IReadOnlyCollection<string> sources,
        string? destination,
        ushort flags)
    {
        var sourcePaths = sources
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (sourcePaths.Length == 0)
            return Task.FromResult(new ShellFileOperationResult(0, false));

        var sourceList = ToMultiString(sourcePaths);
        var destinationList = destination is null
            ? null
            : ToMultiString([Path.GetFullPath(destination)]);

        var completion = new TaskCompletionSource<ShellFileOperationResult>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var thread = new Thread(() =>
        {
            try
            {
                var fileOperation = new SHFILEOPSTRUCT
                {
                    hwnd = ownerHwnd,
                    wFunc = operation,
                    pFrom = sourceList,
                    pTo = destinationList,
                    fFlags = flags,
                };

                var resultCode = SHFileOperationW(ref fileOperation);
                completion.TrySetResult(new ShellFileOperationResult(
                    resultCode,
                    fileOperation.fAnyOperationsAborted));
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        })
        {
            IsBackground = true,
            Name = "Xplorer Shell File Operation",
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }

    private static string ToMultiString(IEnumerable<string> values) =>
        string.Join('\0', values) + "\0\0";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public nint hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)] public string? pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
        public nint hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHFileOperationW")]
    private static extern int SHFileOperationW(ref SHFILEOPSTRUCT lpFileOp);
}

public readonly record struct ShellFileOperationResult(int ResultCode, bool Aborted)
{
    public bool Succeeded => ResultCode == 0 && !Aborted;
}

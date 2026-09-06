using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Xplorer.Native.Services;

/// <summary>
/// Owns one Windows Pseudo Console (ConPTY) session. The shell remains a real console process; only
/// its presentation is hosted by Xplorer so terminal UI never steals permanent folder-view space.
/// </summary>
internal sealed class ConPtyTerminalSession : IDisposable
{
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const nuint ProcThreadAttributePseudoConsole = 0x00020016;
    private const uint StillActive = 259;

    private readonly CancellationTokenSource _shutdown = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly FileStream _input;
    private readonly FileStream _output;
    private Task _outputPump = Task.CompletedTask;
    private int _pumpStarted;
    private nint _pseudoConsole;
    private nint _processHandle;
    private bool _disposed;

    public event EventHandler<string>? OutputReceived;
    public event EventHandler? Exited;

    public string WorkingDirectory { get; }
    public string DisplayName { get; }
    public bool IsRunning { get; private set; } = true;

    private ConPtyTerminalSession(
        string workingDirectory,
        TerminalLaunchSpec launch,
        nint pseudoConsole,
        nint processHandle,
        SafeFileHandle inputWrite,
        SafeFileHandle outputRead)
    {
        WorkingDirectory = workingDirectory;
        DisplayName = launch.DisplayName;
        _pseudoConsole = pseudoConsole;
        _processHandle = processHandle;
        // CreatePipe returns synchronous handles. Marking them async makes FileStream reject the
        // handle before the shell session can be used. Xplorer services these blocking handles on
        // worker threads instead, which is the correct model for anonymous ConPTY pipes.
        _input = new FileStream(inputWrite, FileAccess.Write, 4096, isAsync: false);
        _output = new FileStream(outputRead, FileAccess.Read, 4096, isAsync: false);
    }

    public static ConPtyTerminalSession Start(string workingDirectory, TerminalLaunchSpec launch)
    {
        var fullDirectory = Path.GetFullPath(workingDirectory);
        if (!Directory.Exists(fullDirectory))
            throw new DirectoryNotFoundException(fullDirectory);

        SafeFileHandle? inputRead = null;
        SafeFileHandle? inputWrite = null;
        SafeFileHandle? outputRead = null;
        SafeFileHandle? outputWrite = null;
        nint pseudoConsole = 0;
        nint attributeList = 0;
        PROCESS_INFORMATION processInfo = default;

        try
        {
            CreateAnonymousPipe(out inputRead, out inputWrite);
            CreateAnonymousPipe(out outputRead, out outputWrite);

            var size = new COORD { X = 120, Y = 32 };
            ThrowIfFailed(CreatePseudoConsole(size, inputRead.DangerousGetHandle(), outputWrite.DangerousGetHandle(), 0, out pseudoConsole));

            // The pseudoconsole duplicated the console-facing ends. Xplorer owns only the ends used
            // to write input and read output from this point onward.
            inputRead.Dispose();
            inputRead = null;
            outputWrite.Dispose();
            outputWrite = null;

            nuint attributeListSize = 0;
            _ = InitializeProcThreadAttributeList(0, 1, 0, ref attributeListSize);
            var firstError = Marshal.GetLastWin32Error();
            if (attributeListSize == 0 && firstError != 122) // ERROR_INSUFFICIENT_BUFFER
                throw new Win32Exception(firstError);

            attributeList = Marshal.AllocHGlobal(checked((nint)attributeListSize));
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    ProcThreadAttributePseudoConsole,
                    pseudoConsole,
                    (nuint)IntPtr.Size,
                    0,
                    0))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var startupInfo = new STARTUPINFOEX
            {
                StartupInfo = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFOEX>(),
                },
                lpAttributeList = attributeList,
            };

            var commandLine = new StringBuilder(BuildCommandLine(launch));
            if (!CreateProcessW(
                    null,
                    commandLine,
                    0,
                    0,
                    false,
                    ExtendedStartupInfoPresent | CreateUnicodeEnvironment,
                    0,
                    fullDirectory,
                    ref startupInfo,
                    out processInfo))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), $"Could not start {launch.DisplayName}.");
            }

            CloseHandle(processInfo.hThread);
            processInfo.hThread = 0;

            var session = new ConPtyTerminalSession(
                fullDirectory,
                launch,
                pseudoConsole,
                processInfo.hProcess,
                inputWrite,
                outputRead);

            // Ownership transferred into FileStream/session. Reading starts only after the UI has
            // subscribed so the shell's first prompt cannot race past OutputReceived.
            inputWrite = null;
            outputRead = null;
            pseudoConsole = 0;
            processInfo.hProcess = 0;
            return session;
        }
        catch
        {
            if (processInfo.hThread != 0) CloseHandle(processInfo.hThread);
            if (processInfo.hProcess != 0) CloseHandle(processInfo.hProcess);
            if (pseudoConsole != 0) ClosePseudoConsole(pseudoConsole);
            inputRead?.Dispose();
            inputWrite?.Dispose();
            outputRead?.Dispose();
            outputWrite?.Dispose();
            throw;
        }
        finally
        {
            if (attributeList != 0)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
        }
    }

    public void StartReading()
    {
        if (_disposed || Interlocked.Exchange(ref _pumpStarted, 1) != 0) return;
        _outputPump = Task.Run(PumpOutput);
    }

    public async Task SendAsync(string text)
    {
        if (_disposed || !IsRunning || string.IsNullOrEmpty(text)) return;
        var bytes = Encoding.UTF8.GetBytes(text);

        try
        {
            await _writeGate.WaitAsync().ConfigureAwait(false);
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            return;
        }

        try
        {
            if (_disposed || !IsRunning) return;
            await Task.Run(() =>
            {
                if (_disposed || !IsRunning) return;
                _input.Write(bytes, 0, bytes.Length);
                _input.Flush();
            }, _shutdown.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (_disposed)
        {
        }
        catch (IOException) when (_disposed || !IsRunning)
        {
        }
        finally
        {
            try { _writeGate.Release(); } catch (ObjectDisposedException) { }
        }
    }

    public void Resize(int columns, int rows)
    {
        if (_disposed || _pseudoConsole == 0) return;
        var size = new COORD
        {
            X = checked((short)Math.Clamp(columns, 20, short.MaxValue)),
            Y = checked((short)Math.Clamp(rows, 4, short.MaxValue)),
        };
        _ = ResizePseudoConsole(_pseudoConsole, size);
    }

    private void PumpOutput()
    {
        var decoder = Encoding.UTF8.GetDecoder();
        var bytes = new byte[8192];
        var chars = new char[8192];

        try
        {
            while (!_shutdown.IsCancellationRequested)
            {
                // The pipe is synchronous; this pump itself already runs on a worker thread.
                // Blocking Read is intentional and Dispose/ClosePseudoConsole tears it down.
                var read = _output.Read(bytes, 0, bytes.Length);
                if (read == 0) break;

                var byteOffset = 0;
                while (byteOffset < read)
                {
                    decoder.Convert(
                        bytes,
                        byteOffset,
                        read - byteOffset,
                        chars,
                        0,
                        chars.Length,
                        flush: false,
                        out var bytesUsed,
                        out var charsUsed,
                        out _);
                    byteOffset += bytesUsed;
                    if (charsUsed > 0)
                        OutputReceived?.Invoke(this, new string(chars, 0, charsUsed));
                }
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (_disposed)
        {
        }
        catch (IOException) when (_disposed)
        {
        }
        catch (Exception ex)
        {
            OutputReceived?.Invoke(this, $"\r\n[Xplorer terminal I/O error: {ex.Message}]\r\n");
        }
        finally
        {
            IsRunning = false;
            Exited?.Invoke(this, EventArgs.Empty);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        IsRunning = false;
        _shutdown.Cancel();

        try { _input.Dispose(); } catch { }

        if (_pseudoConsole != 0)
        {
            ClosePseudoConsole(_pseudoConsole);
            _pseudoConsole = 0;
        }

        if (_processHandle != 0)
        {
            try
            {
                if (GetExitCodeProcess(_processHandle, out var code) && code == StillActive)
                    _ = TerminateProcess(_processHandle, 0);
            }
            catch { }
            CloseHandle(_processHandle);
            _processHandle = 0;
        }

        try { _output.Dispose(); } catch { }

        // A worker may still be unwinding from a blocked read/write after the handles close. Keep
        // these managed primitives alive until the session itself is collected to avoid teardown
        // races with that worker.
        GC.SuppressFinalize(this);
    }

    private static void CreateAnonymousPipe(out SafeFileHandle read, out SafeFileHandle write)
    {
        if (!CreatePipe(out var rawRead, out var rawWrite, 0, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        read = new SafeFileHandle(rawRead, ownsHandle: true);
        write = new SafeFileHandle(rawWrite, ownsHandle: true);
    }

    private static string BuildCommandLine(TerminalLaunchSpec launch)
    {
        var command = Quote(launch.Executable);
        return string.IsNullOrWhiteSpace(launch.Arguments)
            ? command
            : $"{command} {launch.Arguments}";
    }

    private static string Quote(string value) =>
        "\"" + value.Replace("\"", "\\\"") + "\"";

    private static void ThrowIfFailed(int hresult)
    {
        if (hresult < 0) Marshal.ThrowExceptionForHR(hresult);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public nint lpReserved2;
        public nint hStdInput;
        public nint hStdOutput;
        public nint hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public nint lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public nint hProcess;
        public nint hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out nint hReadPipe, out nint hWritePipe, nint lpPipeAttributes, uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(COORD size, nint hInput, nint hOutput, uint dwFlags, out nint phPC);

    [DllImport("kernel32.dll")]
    private static extern int ResizePseudoConsole(nint hPC, COORD size);

    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(nint hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        nint lpAttributeList,
        int dwAttributeCount,
        uint dwFlags,
        ref nuint lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        nint lpAttributeList,
        uint dwFlags,
        nuint attribute,
        nint lpValue,
        nuint cbSize,
        nint lpPreviousValue,
        nint lpReturnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(nint lpAttributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string? lpApplicationName,
        StringBuilder lpCommandLine,
        nint lpProcessAttributes,
        nint lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        nint lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(nint hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(nint hProcess, uint uExitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(nint hObject);
}

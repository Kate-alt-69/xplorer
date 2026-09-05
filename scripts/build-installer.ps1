param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',

    [string]$Version = '1.0.0-alpha.1',

    [switch]$SkipNativeBuild,

    [string]$VCRedistPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Runtime -ne 'win-x64') {
    throw 'The NSIS installer is currently produced for win-x64 only.'
}

# $IsWindows exists in PowerShell 6+, but not in the Windows PowerShell 5.1 that still ships
# with Windows 10. Use the platform API so the documented `PowerShell -File ...` command works
# in both Windows PowerShell and modern pwsh without tripping StrictMode.
$isWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if (-not $isWindowsHost) {
    throw 'The Xplorer Windows installer must be built on Windows.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $repoRoot 'dist\Xplorer-win-x64'
$output = Join-Path $repoRoot 'dist\Xplorer-Setup-x64.exe'
$installerScript = Join-Path $repoRoot 'installer\Xplorer.nsi'
$installerIcon = Join-Path $repoRoot 'installer\Xplorer.ico'

if (-not $SkipNativeBuild) {
    & (Join-Path $PSScriptRoot 'build-native.ps1') `
        -Configuration $Configuration `
        -Runtime $Runtime `
        -Package
    if ($LASTEXITCODE -ne 0) { throw "Native Xplorer build failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path (Join-Path $payload 'xplorer.exe'))) {
    throw "Native payload is missing: $payload. Build the native app first."
}
if (-not (Test-Path (Join-Path $payload 'Xplorer.Native.exe'))) {
    throw "Native UI is missing from payload: $payload."
}
if (-not (Test-Path $installerIcon)) {
    throw "Installer icon is missing: $installerIcon."
}

# Unpackaged WinUI depends on the Microsoft Visual C++ runtime even when the Windows App SDK
# itself is deployed self-contained. Bundle the official x64 redistributable so a clean Windows
# 10 machine does not just terminate Xplorer.Native.exe before managed startup/logging begins.
if ([string]::IsNullOrWhiteSpace($VCRedistPath)) {
    $prereqDir = Join-Path $repoRoot 'dist\prereqs'
    New-Item -ItemType Directory -Force -Path $prereqDir | Out-Null
    $vcRedist = Join-Path $prereqDir 'vc_redist.x64.exe'

    if (-not (Test-Path $vcRedist)) {
        Write-Host '==> Downloading Microsoft Visual C++ x64 Redistributable'
        try {
            [Net.ServicePointManager]::SecurityProtocol = `
                [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        }
        catch {
            # PowerShell 7+ uses the platform HTTP stack; this compatibility tweak mainly helps 5.1.
        }

        $downloadError = $null
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Invoke-WebRequest `
                    -UseBasicParsing `
                    -Uri 'https://aka.ms/vc14/vc_redist.x64.exe' `
                    -OutFile $vcRedist
                $downloadError = $null
                break
            }
            catch {
                $downloadError = $_
                Remove-Item $vcRedist -Force -ErrorAction SilentlyContinue
                if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) }
            }
        }
        if ($downloadError) {
            throw "Could not download the Microsoft Visual C++ x64 Redistributable: $downloadError"
        }
    }
}
else {
    if (-not (Test-Path $VCRedistPath)) {
        throw "VCRedistPath does not exist: $VCRedistPath"
    }
    $vcRedist = (Resolve-Path $VCRedistPath).Path
}

if ((Get-Item $vcRedist).Length -lt 1MB) {
    throw "Visual C++ Redistributable looks incomplete: $vcRedist"
}
$signature = Get-AuthenticodeSignature $vcRedist
$signer = $signature.SignerCertificate.Subject
if (-not $signer -or $signer -notmatch 'Microsoft' -or $signature.Status -in @('NotSigned', 'HashMismatch')) {
    throw "Visual C++ Redistributable signature check failed ($($signature.Status)): $vcRedist"
}
Write-Host "==> VC++ prerequisite: $vcRedist"

$makensis = $null
$command = Get-Command makensis.exe -ErrorAction SilentlyContinue
if ($command) { $makensis = $command.Source }
if (-not $makensis) {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'),
        (Join-Path $env:ProgramFiles 'NSIS\makensis.exe')
    )
    $makensis = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $makensis) {
    throw 'NSIS makensis.exe was not found. Install NSIS 3.x, then rerun this script.'
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
Remove-Item $output -Force -ErrorAction SilentlyContinue

Write-Host "==> Building Xplorer installer $Version"
& $makensis `
    '/WX' `
    "/DAPP_VERSION=$Version" `
    "/DPAYLOAD_DIR=$payload" `
    "/DOUT_FILE=$output" `
    "/DICON_FILE=$installerIcon" `
    "/DVC_REDIST_FILE=$vcRedist" `
    $installerScript
if ($LASTEXITCODE -ne 0) {
    throw "makensis failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path $output)) {
    throw "NSIS completed without creating $output."
}

$sizeMiB = [math]::Round((Get-Item $output).Length / 1MB, 2)
Write-Host "==> Xplorer installer: $output ($sizeMiB MiB)"

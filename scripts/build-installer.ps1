param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',

    [string]$Version = '0.4.0-alpha.1',

    [switch]$SkipNativeBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Runtime -ne 'win-x64') {
    throw 'The NSIS installer is currently produced for win-x64 only.'
}
if (-not $IsWindows) {
    throw 'The Xplorer Windows installer must be built on Windows.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $repoRoot 'dist\Xplorer-win-x64'
$output = Join-Path $repoRoot 'dist\Xplorer-Setup-x64.exe'
$installerScript = Join-Path $repoRoot 'installer\Xplorer.nsi'

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
    "/DAPP_VERSION=$Version" `
    "/DPAYLOAD_DIR=$payload" `
    "/DOUT_FILE=$output" `
    $installerScript
if ($LASTEXITCODE -ne 0) {
    throw "makensis failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path $output)) {
    throw "NSIS completed without creating $output."
}

$sizeMiB = [math]::Round((Get-Item $output).Length / 1MB, 2)
Write-Host "==> Xplorer installer: $output ($sizeMiB MiB)"

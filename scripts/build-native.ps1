param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('win-x64')]
    [string]$Runtime = 'win-x64',

    [switch]$Package
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WorkerManifest = Join-Path $RepoRoot 'apps/worker/Cargo.toml'
$NativeProject = Join-Path $RepoRoot 'apps/native/Xplorer.Native/Xplorer.Native.csproj'
$DistRoot = Join-Path $RepoRoot 'dist'
$PublishDir = Join-Path $DistRoot 'Xplorer-win-x64'
$ArchivePath = Join-Path $DistRoot 'Xplorer-win-x64.zip'
$Platform = 'x64'

foreach ($tool in @('cargo', 'dotnet')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required but was not found in PATH."
    }
}

$workerProfile = if ($Configuration -eq 'Release') { 'release' } else { 'debug' }
$workerArgs = @('build', '--manifest-path', $WorkerManifest)
if ($Configuration -eq 'Release') {
    $workerArgs += '--release'
}

Write-Host "==> Building Rust xplorer.exe ($workerProfile)"
& cargo @workerArgs
if ($LASTEXITCODE -ne 0) { throw "Rust build failed with exit code $LASTEXITCODE." }

$RustHost = Join-Path $RepoRoot "apps/worker/target/$workerProfile/xplorer.exe"
if (-not (Test-Path $RustHost)) {
    throw "Rust host was not produced: $RustHost"
}

if (Test-Path $PublishDir) {
    Remove-Item $PublishDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null

Write-Host '==> Restoring WinUI project'
& dotnet restore $NativeProject "-p:Platform=$Platform" "-p:RuntimeIdentifier=$Runtime"
if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE." }

Write-Host '==> Publishing self-contained WinUI frontend'
$publishArgs = @(
    'publish', $NativeProject,
    '-c', $Configuration,
    '-r', $Runtime,
    '--self-contained', 'true',
    '--no-restore',
    '-o', $PublishDir,
    "-p:Platform=$Platform",
    "-p:RuntimeIdentifier=$Runtime",
    '-p:WindowsAppSDKSelfContained=true'
)
if ($Configuration -eq 'Release') {
    $publishArgs += '-p:DebugType=None'
    $publishArgs += '-p:DebugSymbols=false'
}
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

Copy-Item $RustHost (Join-Path $PublishDir 'xplorer.exe') -Force

$required = @(
    (Join-Path $PublishDir 'xplorer.exe'),
    (Join-Path $PublishDir 'Xplorer.Native.exe')
)
foreach ($path in $required) {
    if (-not (Test-Path $path)) {
        throw "Publish output is incomplete; missing $path"
    }
}

$buildInfo = @"
Xplorer Native
Configuration: $Configuration
Runtime: $Runtime
Public entry point: xplorer.exe
UI process: Xplorer.Native.exe

Normal launch:
  .\xplorer.exe

Background metadata worker:
  .\xplorer.exe --service-worker

Register worker at user logon:
  .\xplorer.exe --register-startup

Unregister worker:
  .\xplorer.exe --unregister-startup
  .\xplorer.exe --stop-service-worker
"@
Set-Content -Path (Join-Path $PublishDir 'BUILD.txt') -Value $buildInfo -Encoding UTF8

if ($Package) {
    if (Test-Path $ArchivePath) {
        Remove-Item $ArchivePath -Force
    }
    Write-Host "==> Creating $ArchivePath"
    Compress-Archive -Path (Join-Path $PublishDir '*') -DestinationPath $ArchivePath -CompressionLevel Optimal
}

Write-Host "==> Xplorer output: $PublishDir"
if ($Package) {
    Write-Host "==> Xplorer zip: $ArchivePath"
}

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

Write-Host "==> Building Rust xplorer.exe + xplorer-bgw.exe ($workerProfile)"
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
& dotnet restore $NativeProject "-p:Platform=$Platform" "-p:RuntimeIdentifier=$Runtime" '-p:EnableMsixTooling=true'
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
    '-p:WindowsAppSDKSelfContained=true',
    '-p:EnableMsixTooling=true',
    '-p:AppxPackage=false',
    '-p:WindowsPackageType=None'
)
if ($Configuration -eq 'Release') {
    $publishArgs += '-p:DebugType=None'
    $publishArgs += '-p:DebugSymbols=false'
}
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

# The same tiny Rust host is published twice intentionally. xplorer.exe is the public launcher and
# diagnostic entry point; xplorer-bgw.exe is the background-worker image so Task Manager makes the
# process role obvious instead of showing two indistinguishable xplorer.exe processes.
Copy-Item $RustHost (Join-Path $PublishDir 'xplorer.exe') -Force
Copy-Item $RustHost (Join-Path $PublishDir 'xplorer-bgw.exe') -Force

$required = @(
    (Join-Path $PublishDir 'xplorer.exe'),
    (Join-Path $PublishDir 'xplorer-bgw.exe'),
    (Join-Path $PublishDir 'Xplorer.Native.exe')
)
foreach ($path in $required) {
    if (-not (Test-Path $path)) {
        throw "Publish output is incomplete; missing $path"
    }
}

# WinUI's custom-control styles (notably TabView) are resolved through MRT/PRI even for an
# unpackaged self-contained app. Windows 11 can mask a missing app PRI because more framework
# resources are already present in the OS; Windows 10 cannot. Never ship another package that is
# missing this file.
$appPriCandidates = @(
    (Join-Path $PublishDir 'resources.pri'),
    (Join-Path $PublishDir 'Xplorer.Native.pri')
)
$appPri = $appPriCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $appPri) {
    $priNames = Get-ChildItem -Path $PublishDir -Filter '*.pri' -File -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Name
    throw "Publish output has no Xplorer application PRI. Found only: $($priNames -join ', '). WinUI TabView will fail on Windows 10."
}

# Windows App SDK/MRT versions differ on whether an unpackaged app probes resources.pri or the
# module-named PRI first. Keep a compatibility alias so either lookup path sees the same merged map.
$resourcesPri = Join-Path $PublishDir 'resources.pri'
if (-not (Test-Path $resourcesPri)) {
    Copy-Item $appPri $resourcesPri -Force
    Write-Host "==> Added resources.pri compatibility alias from $(Split-Path $appPri -Leaf)"
}
Write-Host "==> App PRI: $resourcesPri ($([math]::Round((Get-Item $resourcesPri).Length / 1KB, 1)) KiB)"

$buildInfo = @"
Xplorer Native
Configuration: $Configuration
Runtime: $Runtime
Public entry point: xplorer.exe
UI process: Xplorer.Native.exe
Background worker image: xplorer-bgw.exe
Application PRI: resources.pri

Normal launch:
  .\xplorer.exe

Debug startup/resource probe:
  .\xplorer.exe --debug

Read-only folder/index diagnostic:
  .\xplorer.exe --debug --test-folder "C:\\path\\to\\folder"

Explicit folder-index rebuild diagnostic:
  .\xplorer.exe --debug --test-folder "C:\\path\\to\\folder" --reindex

Background metadata worker:
  .\xplorer-bgw.exe --service-worker

Register worker at user logon:
  .\xplorer-bgw.exe --register-startup

Unregister worker:
  .\xplorer-bgw.exe --unregister-startup
  .\xplorer-bgw.exe --stop-service-worker
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

[CmdletBinding()]
param(
    [ValidateSet('win-x64')]
    [string]$Runtime = 'win-x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$Build,
    [switch]$KeepOpen,

    [ValidateRange(3, 60)]
    [int]$WaitSeconds = 8
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist\Xplorer-$Runtime"
$uiExe = Join-Path $distDir 'Xplorer.Native.exe'
$startupLog = Join-Path $env:LOCALAPPDATA 'Xplorer\Logs\startup.log'
$reportDir = Join-Path $repoRoot 'dist\runtime-diagnostics'
$reportPath = Join-Path $reportDir 'runtime-test-report.txt'

if ($Build) {
    Write-Host '==> Building native Xplorer before runtime diagnostics'
    & (Join-Path $PSScriptRoot 'build-native.ps1') -Configuration $Configuration -Runtime $Runtime
    if ($LASTEXITCODE -ne 0) {
        throw "Native build failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path $uiExe)) {
    throw "Native UI was not found at '$uiExe'. Build it first or rerun with -Build."
}

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
Remove-Item $startupLog -Force -ErrorAction SilentlyContinue
Remove-Item $reportPath -Force -ErrorAction SilentlyContinue

$previousDebug = [Environment]::GetEnvironmentVariable('XPLORER_DEBUG_STARTUP', 'Process')
[Environment]::SetEnvironmentVariable('XPLORER_DEBUG_STARTUP', '1', 'Process')

Write-Host "==> Starting runtime diagnostics on $([Environment]::OSVersion)"
Write-Host "==> UI: $uiExe"
Write-Host "==> Waiting $WaitSeconds seconds for XAML/UI probes"

$process = Start-Process -FilePath $uiExe -PassThru
$failed = $false
$failureMessages = [System.Collections.Generic.List[string]]::new()

try {
    Start-Sleep -Seconds $WaitSeconds
    $process.Refresh()

    if (-not (Test-Path $startupLog)) {
        $failed = $true
        $failureMessages.Add('No startup.log was produced.')
        $logText = ''
        $logLines = @()
    }
    else {
        $logText = Get-Content $startupLog -Raw
        $logLines = @(Get-Content $startupLog)
    }

    if ($process.HasExited) {
        $failed = $true
        $failureMessages.Add("Xplorer.Native.exe exited early with code $($process.ExitCode).")
    }

    $fatalMarkers = @(
        'UI preflight control FAILED:',
        'UI preflight XAML FAILED:',
        'UI preflight action FAILED:',
        'MainWindow construction failed:',
        'Startup recovery window activated.',
        'App.OnLaunched:',
        'WinUI unhandled exception'
    )

    foreach ($marker in $fatalMarkers) {
        if ($logText.Contains($marker, [StringComparison]::Ordinal)) {
            $failed = $true
            $failureMessages.Add("Detected runtime failure marker: $marker")
        }
    }

    $requiredMarkers = @(
        'XamlControlsResources installed programmatically.',
        'UI preflight action OK: application Resources access',
        'UI preflight action OK: default XML theme parse',
        'UI preflight action OK: SettingsDialog compiled XAML',
        'MainWindow constructed.',
        'Theme support initialized.',
        'MainWindow activated.',
        'Startup completed.'
    )

    foreach ($marker in $requiredMarkers) {
        if (-not $logText.Contains($marker, [StringComparison]::Ordinal)) {
            $failed = $true
            $failureMessages.Add("Did not reach required runtime marker: $marker")
        }
    }

    $probeLines = @($logLines | Where-Object {
        $_ -match 'UI preflight (control|XAML|action) (OK|FAILED):' -or
        $_ -match 'XamlControlsResources (installed|installation failed)' -or
        $_ -match 'MainWindow (constructed|construction failed)' -or
        $_ -match 'Theme support initialized' -or
        $_ -match 'Startup completed'
    })

    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add("Xplorer native runtime diagnostic report")
    $report.Add("Generated: $([DateTimeOffset]::Now.ToString('O'))")
    $report.Add("OS: $([Environment]::OSVersion)")
    $report.Add("UI: $uiExe")
    $report.Add("Process alive after ${WaitSeconds}s: $(-not $process.HasExited)")
    $report.Add('')
    $report.Add('Probe summary:')
    foreach ($line in $probeLines) { $report.Add($line) }
    $report.Add('')

    if ($failureMessages.Count -gt 0) {
        $report.Add('Failures:')
        foreach ($message in $failureMessages) { $report.Add("- $message") }
        $report.Add('')
    }

    $report.Add('Full startup log:')
    if ($logLines.Count -eq 0) {
        $report.Add('<missing>')
    }
    else {
        foreach ($line in $logLines) { $report.Add($line) }
    }

    [IO.File]::WriteAllLines($reportPath, $report)

    Write-Host ''
    Write-Host '--- Runtime probe summary ---'
    if ($probeLines.Count -gt 0) {
        $probeLines | ForEach-Object { Write-Host $_ }
    }
    else {
        Write-Host '<no probe lines>'
    }

    if ($failed) {
        Write-Host ''
        Write-Host '--- Detected failures ---'
        $failureMessages | ForEach-Object { Write-Host "- $_" }
        Write-Host "==> Full report: $reportPath"
        throw 'Xplorer native runtime diagnostics FAILED.'
    }

    Write-Host ''
    Write-Host '==> Xplorer native runtime diagnostics PASSED.'
    Write-Host "==> Full report: $reportPath"
}
finally {
    if ($null -eq $previousDebug) {
        [Environment]::SetEnvironmentVariable('XPLORER_DEBUG_STARTUP', $null, 'Process')
    }
    else {
        [Environment]::SetEnvironmentVariable('XPLORER_DEBUG_STARTUP', $previousDebug, 'Process')
    }

    if (-not $KeepOpen -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $process.Dispose()
}

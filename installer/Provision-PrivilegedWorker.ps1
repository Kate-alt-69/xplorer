param(
    [ValidateSet('Install', 'Remove')]
    [string]$Mode = 'Install',
    [string]$SourceWorker = '',
    [string]$UserSid = '',
    [string]$UserLocalAppData = '',
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$TaskPrefix = 'Xplorer Index Worker'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-Argument([string]$Value) {
    return '"' + ($Value -replace '"', '\"') + '"'
}

if (-not $Elevated) {
    if ([string]::IsNullOrWhiteSpace($UserSid)) {
        $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    }
    if ([string]::IsNullOrWhiteSpace($UserLocalAppData)) {
        $UserLocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
    }

    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', (Quote-Argument $PSCommandPath),
        '-Mode', $Mode,
        '-UserSid', (Quote-Argument $UserSid),
        '-UserLocalAppData', (Quote-Argument $UserLocalAppData),
        '-Elevated'
    )
    if (-not [string]::IsNullOrWhiteSpace($SourceWorker)) {
        $arguments += @('-SourceWorker', (Quote-Argument $SourceWorker))
    }

    try {
        $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ($arguments -join ' ') -Wait -PassThru
        exit $child.ExitCode
    }
    catch {
        Write-Error "Privileged worker permission was declined or could not be requested: $($_.Exception.Message)"
        exit 1223
    }
}

if (-not (Test-Administrator)) {
    Write-Error 'Privileged worker provisioning requires an elevated administrator token.'
    exit 5
}
if ([string]::IsNullOrWhiteSpace($UserSid) -or [string]::IsNullOrWhiteSpace($UserLocalAppData)) {
    Write-Error 'Original user SID and LocalAppData path are required.'
    exit 87
}

$taskName = "$TaskPrefix $UserSid"
$programRoot = Join-Path $env:ProgramFiles 'Xplorer\Worker'
$protectedWorker = Join-Path $programRoot 'xplorer-bgw.exe'
$protectedIndex = Join-Path $env:ProgramData ("Xplorer\Index\" + $UserSid)
$localIndex = Join-Path $UserLocalAppData 'Xplorer\Index'
$controlDir = Join-Path $UserLocalAppData 'Xplorer\Control'
$pointerPath = Join-Path $localIndex 'active-index.path'
$taskPointerPath = Join-Path $localIndex 'active-task.name'

if ($Mode -eq 'Remove') {
    try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    Remove-Item -LiteralPath $pointerPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $taskPointerPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $protectedIndex -Recurse -Force -ErrorAction SilentlyContinue

    $remaining = @(Get-ScheduledTask -TaskName "$TaskPrefix *" -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) {
        Remove-Item -LiteralPath $programRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($SourceWorker) -or -not (Test-Path -LiteralPath $SourceWorker -PathType Leaf)) {
    Write-Error "Worker payload was not found: $SourceWorker"
    exit 2
}

# Stop the existing task before replacing its protected executable during an upgrade.
try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
Start-Sleep -Milliseconds 250

New-Item -ItemType Directory -Force -Path $programRoot | Out-Null
New-Item -ItemType Directory -Force -Path $protectedIndex | Out-Null
New-Item -ItemType Directory -Force -Path $localIndex | Out-Null
New-Item -ItemType Directory -Force -Path $controlDir | Out-Null
Copy-Item -LiteralPath $SourceWorker -Destination $protectedWorker -Force

# Protected index: SYSTEM/Admins may write; the original desktop user can read but cannot redirect
# elevated writes through junctions/reparse points in a user-writable cache directory.
$inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')),
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance, $propagation, $allow)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($UserSid)),
    [Security.AccessControl.FileSystemRights]'ReadAndExecute, Synchronize',
    $inheritance, $propagation, $allow)))
Set-Acl -LiteralPath $protectedIndex -AclObject $acl

$workerArguments = @(
    '--service-worker',
    '--data-dir', (Quote-Argument $protectedIndex),
    '--control-dir', (Quote-Argument $controlDir)
) -join ' '
$action = New-ScheduledTaskAction -Execute $protectedWorker -Argument $workerArguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Xplorer metadata/USN background index worker. Installed with explicit administrator consent.' `
    -Force | Out-Null

Set-Content -LiteralPath $pointerPath -Value $protectedIndex -Encoding UTF8 -NoNewline
Set-Content -LiteralPath $taskPointerPath -Value $taskName -Encoding UTF8 -NoNewline
Remove-Item -LiteralPath (Join-Path $controlDir 'indexing.disabled') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
exit 0

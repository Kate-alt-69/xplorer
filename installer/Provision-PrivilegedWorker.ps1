param(
    [ValidateSet('Install', 'Remove')]
    [string]$Mode = 'Install',
    [string]$SourceWorker = '',
    [string]$UserSid = '',
    [string]$UserLocalAppData = '',
    [switch]$Elevated,
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
$TaskPrefix = 'Xplorer Index Worker'
$ProvisionVersion = '1'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-Argument([string]$Value) {
    return '"' + ($Value -replace '"', '\"') + '"'
}

function ConvertTo-EncodedCommand([string]$ScriptText) {
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ScriptText))
}

function Wait-TaskCompletion([string]$Name, [int]$TimeoutSeconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 200
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
        if ($task.State -ne 'Running') {
            $info = Get-ScheduledTaskInfo -TaskName $Name -ErrorAction Stop
            return [uint32]$info.LastTaskResult
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for scheduled task '$Name'."
}

function Register-SystemOneShot([string]$Name, [string]$ScriptText) {
    $encoded = ConvertTo-EncodedCommand $ScriptText
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $Name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
}

if (-not $Elevated) {
    if ([string]::IsNullOrWhiteSpace($UserSid)) {
        $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    }
    if ([string]::IsNullOrWhiteSpace($UserLocalAppData)) {
        $UserLocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
    }

    if (Test-Administrator) {
        $Elevated = $true
    }
    elseif ($NoPrompt) {
        Write-Error 'Administrator permission is required to provision/remove the protected Xplorer worker.'
        exit 740
    }
    else {
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
            $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
                -Verb RunAs -ArgumentList ($arguments -join ' ') -Wait -PassThru
            exit $child.ExitCode
        }
        catch {
            Write-Error "Privileged worker permission was declined or could not be requested: $($_.Exception.Message)"
            exit 1223
        }
    }
}

if (-not (Test-Administrator)) {
    Write-Error 'Privileged worker provisioning requires an elevated administrator token.'
    exit 740
}
if ([string]::IsNullOrWhiteSpace($UserSid) -or [string]::IsNullOrWhiteSpace($UserLocalAppData)) {
    Write-Error 'Original user SID and LocalAppData path are required.'
    exit 87
}

$taskName = "$TaskPrefix $UserSid"
$updateTaskName = "Xplorer Protected Worker Update $UserSid"
$workerBase = Join-Path $env:ProgramFiles 'Xplorer\Worker'
# Keep each desktop user's hash-pinned BGW independent. A second user installing a different Xplorer
# version must never replace the binary referenced by another user's protected scheduled task.
$programRoot = Join-Path $workerBase $UserSid
$protectedWorker = Join-Path $programRoot 'xplorer-bgw.exe'
$protectedIndex = Join-Path $env:ProgramData ("Xplorer\Index\" + $UserSid)
$controlDir = Join-Path $UserLocalAppData 'Xplorer\Control'
$provisionMarker = Join-Path $protectedIndex 'provisioned.v1'
$diagnosticPointer = Join-Path $controlDir 'protected-index.path'

try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
try { Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }

if ($Mode -eq 'Remove') {
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }

    $programRootLiteral = $programRoot.Replace("'", "''")
    $workerBaseLiteral = $workerBase.Replace("'", "''")
    $protectedIndexLiteral = $protectedIndex.Replace("'", "''")
    $cleanup = @"
`$ErrorActionPreference = 'Stop'
Remove-Item -LiteralPath '$protectedIndexLiteral' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '$programRootLiteral' -Recurse -Force -ErrorAction SilentlyContinue
`$remaining = @(Get-ScheduledTask -TaskName '$TaskPrefix *' -ErrorAction SilentlyContinue)
if (`$remaining.Count -eq 0) {
    Remove-Item -LiteralPath '$workerBaseLiteral' -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
"@
    Register-SystemOneShot -Name $updateTaskName -ScriptText $cleanup
    try {
        Start-ScheduledTask -TaskName $updateTaskName
        $result = Wait-TaskCompletion -Name $updateTaskName
        if ($result -ne 0) { throw "Protected-worker cleanup task returned $result." }
    }
    finally {
        Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $diagnosticPointer -Force -ErrorAction SilentlyContinue
    exit 0
}

if ([string]::IsNullOrWhiteSpace($SourceWorker) -or -not (Test-Path -LiteralPath $SourceWorker -PathType Leaf)) {
    Write-Error "Worker payload was not found: $SourceWorker"
    exit 2
}

# Compute the candidate identity before SYSTEM is allowed to copy it. The transient SYSTEM task
# verifies this hash both before and after copying, closing the source-file replacement race.
$sourceHash = (Get-FileHash -LiteralPath $SourceWorker -Algorithm SHA256).Hash.ToUpperInvariant()
$sourceSignature = Get-AuthenticodeSignature -LiteralPath $SourceWorker
$expectedSigner = ''
if ($sourceSignature.Status -eq 'Valid') {
    $expectedSigner = $sourceSignature.SignerCertificate.Thumbprint.ToUpperInvariant()
}
elseif ($sourceSignature.Status -ne 'NotSigned') {
    Write-Error "Worker Authenticode status is $($sourceSignature.Status); refusing privileged installation."
    exit 13
}

$sourceLiteral = (Resolve-Path -LiteralPath $SourceWorker).Path.Replace("'", "''")
$programRootLiteral = $programRoot.Replace("'", "''")
$protectedWorkerLiteral = $protectedWorker.Replace("'", "''")
$protectedIndexLiteral = $protectedIndex.Replace("'", "''")
$markerLiteral = $provisionMarker.Replace("'", "''")
$userSidLiteral = $UserSid.Replace("'", "''")
$expectedHashLiteral = $sourceHash.Replace("'", "''")
$expectedSignerLiteral = $expectedSigner.Replace("'", "''")

$installPayload = @"
`$ErrorActionPreference = 'Stop'
`$source = '$sourceLiteral'
`$programRoot = '$programRootLiteral'
`$destination = '$protectedWorkerLiteral'
`$indexDir = '$protectedIndexLiteral'
`$marker = '$markerLiteral'
`$expectedHash = '$expectedHashLiteral'
`$expectedSigner = '$expectedSignerLiteral'
`$userSid = '$userSidLiteral'

if (-not (Test-Path -LiteralPath `$source -PathType Leaf)) { exit 20 }
if ((Get-FileHash -LiteralPath `$source -Algorithm SHA256).Hash.ToUpperInvariant() -ne `$expectedHash) { exit 21 }
New-Item -ItemType Directory -Force -Path `$programRoot | Out-Null
New-Item -ItemType Directory -Force -Path `$indexDir | Out-Null
`$temporary = `$destination + '.new'
Remove-Item -LiteralPath `$temporary -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath `$source -Destination `$temporary -Force
if ((Get-FileHash -LiteralPath `$temporary -Algorithm SHA256).Hash.ToUpperInvariant() -ne `$expectedHash) {
    Remove-Item -LiteralPath `$temporary -Force -ErrorAction SilentlyContinue
    exit 22
}
if (-not [string]::IsNullOrWhiteSpace(`$expectedSigner)) {
    `$signature = Get-AuthenticodeSignature -LiteralPath `$temporary
    if (`$signature.Status -ne 'Valid' -or `$signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne `$expectedSigner) {
        Remove-Item -LiteralPath `$temporary -Force -ErrorAction SilentlyContinue
        exit 23
    }
}
Move-Item -LiteralPath `$temporary -Destination `$destination -Force
if ((Get-FileHash -LiteralPath `$destination -Algorithm SHA256).Hash.ToUpperInvariant() -ne `$expectedHash) { exit 24 }

`$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
`$propagation = [Security.AccessControl.PropagationFlags]::None
`$allow = [Security.AccessControl.AccessControlType]::Allow
`$system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
`$admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
`$desktopUser = New-Object Security.Principal.SecurityIdentifier(`$userSid)

function Set-ProtectedDirectoryAcl([string]`$Path) {
    `$acl = New-Object Security.AccessControl.DirectorySecurity
    `$acl.SetOwner(`$system)
    `$acl.SetAccessRuleProtection(`$true, `$false)
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$system, [Security.AccessControl.FileSystemRights]::FullControl, `$inherit, `$propagation, `$allow)))
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$admins, [Security.AccessControl.FileSystemRights]::ReadAndExecute, `$inherit, `$propagation, `$allow)))
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$desktopUser, [Security.AccessControl.FileSystemRights]::ReadAndExecute, `$inherit, `$propagation, `$allow)))
    Set-Acl -LiteralPath `$Path -AclObject `$acl
}

function Set-ProtectedFileAcl([string]`$Path) {
    `$acl = New-Object Security.AccessControl.FileSecurity
    `$acl.SetOwner(`$system)
    `$acl.SetAccessRuleProtection(`$true, `$false)
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$system, [Security.AccessControl.FileSystemRights]::FullControl, `$allow)))
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$admins, [Security.AccessControl.FileSystemRights]::ReadAndExecute, `$allow)))
    `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(`$desktopUser, [Security.AccessControl.FileSystemRights]::ReadAndExecute, `$allow)))
    Set-Acl -LiteralPath `$Path -AclObject `$acl
}

Set-ProtectedDirectoryAcl -Path `$programRoot
Set-ProtectedDirectoryAcl -Path `$indexDir
Set-ProtectedFileAcl -Path `$destination
Set-Content -LiteralPath `$marker -Value '$ProvisionVersion' -Encoding ASCII -NoNewline
exit 0
"@

Register-SystemOneShot -Name $updateTaskName -ScriptText $installPayload
try {
    Start-ScheduledTask -TaskName $updateTaskName
    $result = Wait-TaskCompletion -Name $updateTaskName
    if ($result -ne 0) {
        throw "Protected-worker update verification failed with result $result."
    }
}
finally {
    Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction SilentlyContinue
}

# The persistent task itself is the fail-closed launch broker. Windows Task Scheduler protects its
# definition; it verifies hash (and signer on signed builds) before BGW is ever executed.
$workerLiteral = $protectedWorker.Replace("'", "''")
$indexLiteral = $protectedIndex.Replace("'", "''")
$controlLiteral = $controlDir.Replace("'", "''")
$launchGuard = @"
`$ErrorActionPreference = 'Stop'
`$worker = '$workerLiteral'
`$expectedHash = '$expectedHashLiteral'
`$expectedSigner = '$expectedSignerLiteral'
if (-not (Test-Path -LiteralPath `$worker -PathType Leaf)) { exit 30 }
if ((Get-FileHash -LiteralPath `$worker -Algorithm SHA256).Hash.ToUpperInvariant() -ne `$expectedHash) { exit 31 }
if (-not [string]::IsNullOrWhiteSpace(`$expectedSigner)) {
    `$signature = Get-AuthenticodeSignature -LiteralPath `$worker
    if (`$signature.Status -ne 'Valid' -or `$signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne `$expectedSigner) { exit 32 }
}
`$arguments = @('--service-worker', '--data-dir', '$indexLiteral', '--control-dir', '$controlLiteral')
`$process = Start-Process -FilePath `$worker -ArgumentList `$arguments -WindowStyle Hidden -PassThru -Wait
exit `$process.ExitCode
"@
$launchEncoded = ConvertTo-EncodedCommand $launchGuard
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $launchEncoded"
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
    -Description 'Xplorer protected metadata/USN background index worker. The task verifies BGW integrity before every launch.' `
    -Force | Out-Null

New-Item -ItemType Directory -Force -Path $controlDir | Out-Null
Set-Content -LiteralPath $diagnosticPointer -Value $protectedIndex -Encoding UTF8 -NoNewline
Remove-Item -LiteralPath (Join-Path $controlDir 'indexing.disabled') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
Write-Output "Protected Xplorer BGW installed. SHA256=$sourceHash Signed=$([bool]$expectedSigner)"
exit 0

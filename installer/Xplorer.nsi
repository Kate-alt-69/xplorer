Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "1.0.0-alpha.1"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR must point at the published Xplorer directory"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "Xplorer-Setup-x64.exe"
!endif
!ifndef ICON_FILE
  !error "ICON_FILE must point at Xplorer.ico"
!endif
!ifndef VC_REDIST_FILE
  !error "VC_REDIST_FILE must point at vc_redist.x64.exe"
!endif

!define PRODUCT_NAME "Xplorer"
!define COMPANY_NAME "K8 / Xplorer"
!define INSTALL_KEY "Software\Xplorer"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Xplorer"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define SHELL_OWNER "{8F7A8759-1D96-45A1-A7A4-1F516D9DC7B8}"

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Xplorer"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallDir"
BrandingText "Xplorer native file manager"
Icon "${ICON_FILE}"
UninstallIcon "${ICON_FILE}"
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Xplorer"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${COMPANY_NAME}"
VIAddVersionKey /LANG=1033 "FileDescription" "Xplorer native Windows installer"
VIAddVersionKey /LANG=1033 "LegalCopyright" "AGPL-3.0"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\xplorer.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Xplorer"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var ExistingUninstall
Var UpgradeBackup

Function .onInit
  SetShellVarContext current
  StrCpy $UpgradeBackup "$LOCALAPPDATA\Xplorer.upgrade-data"
FunctionEnd

Function StopRunningXplorer
  ; taskkill returning "not found" is harmless during a first install. An already-provisioned
  ; SYSTEM BGW is stopped by the privileged provisioner during its verified replacement step.
  nsExec::ExecToLog 'taskkill /IM xplorer-bgw.exe /T /F'
  nsExec::ExecToLog 'taskkill /IM xplorer.exe /T /F'
  nsExec::ExecToLog 'taskkill /IM Xplorer.Native.exe /T /F'
  Sleep 250
FunctionEnd

Function RestoreNativeUserData
  CreateDirectory "$LOCALAPPDATA\Xplorer"

  ClearErrors
  Rename "$UpgradeBackup\settings.json" "$LOCALAPPDATA\Xplorer\settings.json"
  ClearErrors
  Rename "$UpgradeBackup\Themes" "$LOCALAPPDATA\Xplorer\Themes"
  ClearErrors
  Rename "$UpgradeBackup\Index" "$LOCALAPPDATA\Xplorer\Index"
  RMDir "$UpgradeBackup"
FunctionEnd

Function BackupNativeUserData
  IfFileExists "$UpgradeBackup\*.*" 0 +2
    Call RestoreNativeUserData

  CreateDirectory "$UpgradeBackup"
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\settings.json" "$UpgradeBackup\settings.json"
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\Themes" "$UpgradeBackup\Themes"
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\Index" "$UpgradeBackup\Index"
FunctionEnd

Function RemoveLegacyShellKeys
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Xplorer"
FunctionEnd

Function RegisterNativeShellKeys
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native" "" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native" "MUIVerb" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native" "Icon" '"$INSTDIR\Xplorer.Native.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native" "XplorerOwner" "${SHELL_OWNER}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native\command" "" '"$INSTDIR\xplorer.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Xplorer.Native\command" "XplorerOwner" "${SHELL_OWNER}"

  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native" "" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native" "MUIVerb" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native" "Icon" '"$INSTDIR\Xplorer.Native.exe"'
  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native" "XplorerOwner" "${SHELL_OWNER}"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native\command" "" '"$INSTDIR\xplorer.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Drive\shell\Xplorer.Native\command" "XplorerOwner" "${SHELL_OWNER}"

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native" "" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native" "MUIVerb" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native" "Icon" '"$INSTDIR\Xplorer.Native.exe"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native" "XplorerOwner" "${SHELL_OWNER}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native\command" "" '"$INSTDIR\xplorer.exe" "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native\command" "XplorerOwner" "${SHELL_OWNER}"

  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native" "" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native" "MUIVerb" "Open in Xplorer"
  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native" "Icon" '"$INSTDIR\Xplorer.Native.exe"'
  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native" "XplorerOwner" "${SHELL_OWNER}"
  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native\command" "" '"$INSTDIR\xplorer.exe" "$DESKTOP"'
  WriteRegStr HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native\command" "XplorerOwner" "${SHELL_OWNER}"
FunctionEnd

Function FindExistingUninstaller
  StrCpy $ExistingUninstall ""
  ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "QuietUninstallString"
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "UninstallString"
  ${EndIf}
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKLM "${UNINSTALL_KEY}" "QuietUninstallString"
  ${EndIf}
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKLM "${UNINSTALL_KEY}" "UninstallString"
  ${EndIf}
FunctionEnd

Section "Xplorer" SEC_MAIN
  SetShellVarContext current

  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=vc_redist.x64.exe "${VC_REDIST_FILE}"
  DetailPrint "Ensuring Microsoft Visual C++ x64 runtime..."
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $0
  ${If} $0 == 3010
    SetRebootFlag true
  ${ElseIf} $0 == 1641
    SetRebootFlag true
  ${ElseIf} $0 == 1638
    DetailPrint "A compatible Visual C++ runtime is already installed."
  ${ElseIf} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Microsoft Visual C++ Runtime setup failed (exit code $0). Xplorer was not changed."
    Abort
  ${EndIf}
  Delete "$PLUGINSDIR\vc_redist.x64.exe"

  Call StopRunningXplorer
  Call BackupNativeUserData
  Call FindExistingUninstaller

  ${If} $ExistingUninstall != ""
    DetailPrint "Removing the previously installed Xplorer before upgrade..."
    ExecWait '$ExistingUninstall /S' $0
    ${If} $0 != 0
      Call RestoreNativeUserData
      MessageBox MB_ICONSTOP|MB_OK "The existing Xplorer installation could not be removed (exit code $0). Your Xplorer data was restored and this upgrade was stopped."
      Abort
    ${EndIf}
  ${EndIf}

  Call RestoreNativeUserData
  Call RemoveLegacyShellKeys

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}\*.*"
  File /oname=Provision-PrivilegedWorker.ps1 "${__FILEDIR__}\Provision-PrivilegedWorker.ps1"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Xplorer"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${COMPANY_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Xplorer.Native.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Xplorer"
  CreateShortcut "$SMPROGRAMS\Xplorer\Xplorer.lnk" "$INSTDIR\xplorer.exe" "" "$INSTDIR\Xplorer.Native.exe"
  CreateShortcut "$SMPROGRAMS\Xplorer\Uninstall Xplorer.lnk" "$INSTDIR\Uninstall.exe"
  Call RegisterNativeShellKeys

  CreateDirectory "$LOCALAPPDATA\Xplorer\Index"
  CreateDirectory "$LOCALAPPDATA\Xplorer\Control"
  Delete "$LOCALAPPDATA\Xplorer\Control\indexing.disabled"

  ; Interactive installs offer one explicit UAC prompt to provision the protected SYSTEM worker.
  ; Silent installs never create a surprise prompt and use the ordinary per-user worker instead.
  IfSilent bgw_fallback bgw_privileged

bgw_privileged:
  DetailPrint "Requesting permission for protected background indexing..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\Provision-PrivilegedWorker.ps1" -Mode Install -SourceWorker "$INSTDIR\xplorer-bgw.exe"' $0
  ${If} $0 == 0
    DeleteRegValue HKCU "${RUN_KEY}" "Xplorer Index Worker"
    DetailPrint "Protected background indexing was provisioned successfully."
    Goto bgw_done
  ${Else}
    DetailPrint "Protected indexing was not provisioned (exit $0); using the per-user worker."
  ${EndIf}

bgw_fallback:
  WriteRegStr HKCU "${RUN_KEY}" "Xplorer Index Worker" '"$INSTDIR\xplorer-bgw.exe" --service-worker --data-dir "$LOCALAPPDATA\Xplorer\Index" --control-dir "$LOCALAPPDATA\Xplorer\Control"'
  Exec '"$INSTDIR\xplorer-bgw.exe" --service-worker --data-dir "$LOCALAPPDATA\Xplorer\Index" --control-dir "$LOCALAPPDATA\Xplorer\Control"'

bgw_done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current

  ; Disable first. If a silent/non-elevated cleanup cannot remove a protected task, the remaining
  ; worker observes this marker and stays idle rather than continuing to crawl after uninstall.
  CreateDirectory "$LOCALAPPDATA\Xplorer\Control"
  FileOpen $0 "$LOCALAPPDATA\Xplorer\Control\indexing.disabled" w
  FileWrite $0 "disabled"
  FileClose $0

  IfSilent un_priv_silent un_priv_interactive

un_priv_interactive:
  IfFileExists "$INSTDIR\Provision-PrivilegedWorker.ps1" 0 un_priv_done
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\Provision-PrivilegedWorker.ps1" -Mode Remove' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Xplorer could not remove the protected background worker (exit code $0). It has been disabled and will remain idle."
  ${EndIf}
  Goto un_priv_done

un_priv_silent:
  IfFileExists "$INSTDIR\Provision-PrivilegedWorker.ps1" 0 un_priv_done
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\Provision-PrivilegedWorker.ps1" -Mode Remove -NoPrompt' $0
  ${If} $0 != 0
    DetailPrint "Protected worker cleanup requires an elevated uninstall; worker was disabled instead (exit $0)."
  ${EndIf}

un_priv_done:
  IfFileExists "$INSTDIR\xplorer-bgw.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\xplorer-bgw.exe" --stop-service-worker'
    Goto +2
  IfFileExists "$INSTDIR\xplorer.exe" 0 +2
    nsExec::ExecToLog '"$INSTDIR\xplorer.exe" --stop-service-worker'

  Call un.StopRunningXplorer

  DeleteRegValue HKCU "${RUN_KEY}" "Xplorer Index Worker"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Xplorer.Native"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Xplorer.Native"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Xplorer.Native"
  DeleteRegKey HKCU "Software\Classes\DesktopBackground\Shell\Xplorer.Native"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Xplorer"

  Delete "$SMPROGRAMS\Xplorer\Xplorer.lnk"
  Delete "$SMPROGRAMS\Xplorer\Uninstall Xplorer.lnk"
  RMDir "$SMPROGRAMS\Xplorer"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"

  ClearErrors
  Delete "$INSTDIR\xplorer-bgw.exe"
  ${If} ${Errors}
    Sleep 750
    ClearErrors
    Delete /REBOOTOK "$INSTDIR\xplorer-bgw.exe"
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\xplorer.exe"
  ${If} ${Errors}
    Sleep 750
    ClearErrors
    Delete /REBOOTOK "$INSTDIR\xplorer.exe"
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\Xplorer.Native.exe"
  ${If} ${Errors}
    Sleep 250
    ClearErrors
    Delete /REBOOTOK "$INSTDIR\Xplorer.Native.exe"
  ${EndIf}
  RMDir /r /REBOOTOK "$INSTDIR"

  ; Preserve %LOCALAPPDATA%\Xplorer: settings, XML themes, indexes, context-menu config, control
  ; state and diagnostic logs are user data. A failed privileged cleanup leaves indexing.disabled.
SectionEnd

Function un.StopRunningXplorer
  nsExec::ExecToLog 'taskkill /IM xplorer-bgw.exe /T /F'
  nsExec::ExecToLog 'taskkill /IM xplorer.exe /T /F'
  nsExec::ExecToLog 'taskkill /IM Xplorer.Native.exe /T /F'
  Sleep 500
FunctionEnd

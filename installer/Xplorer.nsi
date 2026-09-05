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

!define PRODUCT_NAME "Xplorer"
!define COMPANY_NAME "K8 / Xplorer"
!define INSTALL_KEY "Software\Xplorer"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Xplorer"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

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
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var ExistingUninstall
Var ExistingUninstallNeedsSilent
Var UpgradeBackup

Function .onInit
  SetShellVarContext current
  StrCpy $UpgradeBackup "$LOCALAPPDATA\Xplorer.upgrade-data"
FunctionEnd

Function StopRunningXplorer
  ; taskkill returning "not found" is harmless during a first install.
  nsExec::ExecToLog 'taskkill /IM xplorer.exe /F'
  nsExec::ExecToLog 'taskkill /IM Xplorer.Native.exe /F'
FunctionEnd

Function RestoreNativeUserData
  CreateDirectory "$LOCALAPPDATA\Xplorer"

  ; Rename is intentionally unconditional: it also restores empty Themes/Index directories.
  ClearErrors
  Rename "$UpgradeBackup\settings.json" "$LOCALAPPDATA\Xplorer\settings.json"
  ClearErrors
  Rename "$UpgradeBackup\Themes" "$LOCALAPPDATA\Xplorer\Themes"
  ClearErrors
  Rename "$UpgradeBackup\Index" "$LOCALAPPDATA\Xplorer\Index"
  RMDir "$UpgradeBackup"
FunctionEnd

Function BackupNativeUserData
  ; Recover a stale backup from an interrupted earlier upgrade before creating a fresh one. Never
  ; blindly delete the backup directory: it may contain the user's only copy of settings/themes.
  IfFileExists "$UpgradeBackup\*.*" 0 +2
    Call RestoreNativeUserData

  CreateDirectory "$UpgradeBackup"

  ; Move only Xplorer's native data, not the old Tauri program payload that happened to share
  ; %LOCALAPPDATA%\Xplorer. This keeps upgrades safe without dragging obsolete binaries forward.
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\settings.json" "$UpgradeBackup\settings.json"
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\Themes" "$UpgradeBackup\Themes"
  ClearErrors
  Rename "$LOCALAPPDATA\Xplorer\Index" "$UpgradeBackup\Index"
FunctionEnd

Function RemoveLegacyShellKeys
  ; Old Tauri installers used the Xplorer key name. New native integration owns Xplorer.Native.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Xplorer"
FunctionEnd

Function FindExistingUninstaller
  StrCpy $ExistingUninstall ""
  StrCpy $ExistingUninstallNeedsSilent "0"

  ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "QuietUninstallString"
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "UninstallString"
    ${If} $ExistingUninstall != ""
      StrCpy $ExistingUninstallNeedsSilent "1"
    ${EndIf}
  ${EndIf}

  ; Older releases may have been installed for all users. Reading HKLM is safe without elevation;
  ; if its uninstaller requires elevation Windows will handle that when the executable launches.
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKLM "${UNINSTALL_KEY}" "QuietUninstallString"
  ${EndIf}
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKLM "${UNINSTALL_KEY}" "UninstallString"
    ${If} $ExistingUninstall != ""
      StrCpy $ExistingUninstallNeedsSilent "1"
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Xplorer" SEC_MAIN
  SetShellVarContext current
  Call StopRunningXplorer
  Call BackupNativeUserData
  Call FindExistingUninstaller

  ${If} $ExistingUninstall != ""
    DetailPrint "Removing the previously installed Xplorer before upgrade..."
    ${If} $ExistingUninstallNeedsSilent == "1"
      ExecWait '$ExistingUninstall /S' $0
    ${Else}
      ExecWait '$ExistingUninstall' $0
    ${EndIf}
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

  ; Enable the reversible per-user shell verb for an installed build. The maintenance command
  ; updates settings.json as well, keeping the Settings toggle consistent with the registry.
  ExecWait '"$INSTDIR\Xplorer.Native.exe" --register-shell' $0
  ${If} $0 != 0
    DetailPrint "Shell integration could not be enabled automatically; Xplorer itself is installed."
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext current

  IfFileExists "$INSTDIR\Xplorer.Native.exe" 0 +2
    nsExec::ExecToLog '"$INSTDIR\Xplorer.Native.exe" --cleanup-integration'
  IfFileExists "$INSTDIR\xplorer.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\xplorer.exe" --stop-service-worker'
    nsExec::ExecToLog '"$INSTDIR\xplorer.exe" --unregister-startup'

  Call un.StopRunningXplorer

  ; Best-effort registry cleanup also works if an executable was manually deleted first.
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
  RMDir /r "$INSTDIR"

  ; Intentionally preserve %LOCALAPPDATA%\Xplorer. It contains settings, XML themes and the
  ; metadata index; uninstalling program files must not destroy user data.
SectionEnd

Function un.StopRunningXplorer
  nsExec::ExecToLog 'taskkill /IM xplorer.exe /F'
  nsExec::ExecToLog 'taskkill /IM Xplorer.Native.exe /F'
FunctionEnd

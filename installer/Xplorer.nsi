Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetShellVarContext current

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.4.0-alpha.1"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR must point at the published Xplorer directory"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "Xplorer-Setup-x64.exe"
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
VIProductVersion "0.4.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Xplorer"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
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
Var UpgradeBackup

Function .onInit
  StrCpy $UpgradeBackup "$LOCALAPPDATA\Xplorer.upgrade-data"
FunctionEnd

Function StopRunningXplorer
  ; taskkill returning "not found" is harmless during a first install.
  nsExec::ExecToLog 'taskkill /IM xplorer.exe /F'
  nsExec::ExecToLog 'taskkill /IM Xplorer.Native.exe /F'
FunctionEnd

Function BackupNativeUserData
  RMDir /r "$UpgradeBackup"
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

Function RemoveLegacyShellKeys
  ; Old Tauri installers used the Xplorer key name. New native integration owns Xplorer.Native.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Xplorer"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Xplorer"
FunctionEnd

Section "Xplorer" SEC_MAIN
  Call StopRunningXplorer
  Call BackupNativeUserData

  ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "QuietUninstallString"
  ${If} $ExistingUninstall == ""
    ReadRegStr $ExistingUninstall HKCU "${UNINSTALL_KEY}" "UninstallString"
  ${EndIf}

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

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Xplorer"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${COMPANY_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\xplorer.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$"$INSTDIR\Uninstall.exe$" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Xplorer"
  CreateShortcut "$SMPROGRAMS\Xplorer\Xplorer.lnk" "$INSTDIR\xplorer.exe"
  CreateShortcut "$SMPROGRAMS\Xplorer\Uninstall Xplorer.lnk" "$INSTDIR\Uninstall.exe"

  ; Match the old installed Xplorer experience by enabling the reversible per-user shell verb.
  ; The maintenance switch also persists the toggle so Settings accurately reflects the registry.
  ExecWait '$"$INSTDIR\Xplorer.Native.exe$" --register-shell' $0
  ${If} $0 != 0
    DetailPrint "Shell integration could not be enabled automatically; Xplorer itself is installed."
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext current

  IfFileExists "$INSTDIR\Xplorer.Native.exe" 0 +2
    nsExec::ExecToLog '$"$INSTDIR\Xplorer.Native.exe$" --cleanup-integration'
  IfFileExists "$INSTDIR\xplorer.exe" 0 +3
    nsExec::ExecToLog '$"$INSTDIR\xplorer.exe$" --stop-service-worker'
    nsExec::ExecToLog '$"$INSTDIR\xplorer.exe$" --unregister-startup'

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

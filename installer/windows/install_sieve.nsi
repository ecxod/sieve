Unicode true
SetCompressor /SOLID lzma

!ifndef APP_SOURCE
  !error "APP_SOURCE is required"
!endif

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif

!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "install_sieve.exe"
!endif

!ifndef ICON_FILE
  !error "ICON_FILE is required"
!endif

!define APP_NAME "Sieve"
!define APP_PUBLISHER "ecxod"
!define APP_EXE "sieve.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
!include "Win\RestartManager.nsh"

${StrStr}

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\${APP_NAME}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user

!define MUI_ABORTWARNING
!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

/**
 * Electron keeps its executable and Chromium resource packs open while it is
 * running. Check the process list first so an ordinary upgrade of an already
 * closed application stays silent. Only a running Sieve process triggers the
 * save warning and Restart Manager shutdown.
 */
Function CloseSieveForUpgrade
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXE}" /FO CSV /NH'
  Pop $0
  Pop $2
  StrCmp $0 "error" done
  ${StrStr} $3 $2 "${APP_EXE}"
  StrCmp $3 "" done prompt

prompt:
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "Sieve must be closed before the update can continue.$\r$\n$\r$\nSave any open editor changes, then click OK. The installer will close Sieve automatically." \
    /SD IDOK IDOK close IDCANCEL cancel

close:
  StrCpy $1 0
  !insertmacro RestartManager_ShutdownFile "$INSTDIR\${APP_EXE}" $0
  !insertmacro RestartManager_ShutdownFile "$INSTDIR\chrome_100_percent.pak" $0
  Sleep 250

verify:
  ClearErrors
  IfFileExists "$INSTDIR\chrome_100_percent.pak" 0 verify_executable
  Rename "$INSTDIR\chrome_100_percent.pak" "$INSTDIR\chrome_100_percent.pak.sieve-update-old"
  IfErrors locked
  Delete "$INSTDIR\chrome_100_percent.pak.sieve-update-old"

verify_executable:
  ClearErrors
  IfFileExists "$INSTDIR\${APP_EXE}" 0 done
  Rename "$INSTDIR\${APP_EXE}" "$INSTDIR\${APP_EXE}.sieve-update-old"
  IfErrors locked
  Delete "$INSTDIR\${APP_EXE}.sieve-update-old"
  Goto done

locked:
  StrCmp $1 0 force_close retry

force_close:
  StrCpy $1 1
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXE}"'
  Pop $2
  Pop $3
  Sleep 500
  Goto verify

retry:
  MessageBox MB_RETRYCANCEL|MB_ICONSTOP \
    "Sieve still has files open. Close it manually and click Retry." \
    /SD IDCANCEL IDRETRY close IDCANCEL cancel
  Abort

done:
  Return

cancel:
  Abort
FunctionEnd

Section "Install"
  SetShellVarContext current
  Call CloseSieveForUpgrade
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}/*"

  WriteUninstaller "$INSTDIR\Uninstall Sieve.exe"

  CreateDirectory "$SMPROGRAMS\Sieve"
  CreateShortcut "$SMPROGRAMS\Sieve\Sieve.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\Sieve\Uninstall Sieve.lnk" "$INSTDIR\Uninstall Sieve.exe"
  CreateShortcut "$DESKTOP\Sieve.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall Sieve.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Sieve.lnk"
  Delete "$SMPROGRAMS\Sieve\Sieve.lnk"
  Delete "$SMPROGRAMS\Sieve\Uninstall Sieve.lnk"
  RMDir "$SMPROGRAMS\Sieve"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd

; Lucien Home installer: per-user, no admin needed
Unicode true
!define PRODUCT "Lucien Home"
!define EXE "Lucien Home.exe"
!define VERSION "2.0.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LucienHome"
Name "${PRODUCT}"
!ifdef FAMILY
  OutFile "out\Lucien Home Setup ${VERSION} (Lucien family).exe"
!else
  OutFile "out\Lucien Home Setup ${VERSION}.exe"
!endif
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${PRODUCT} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Lucien family"
VIAddVersionKey "LegalCopyright" "Lucien family"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "..\app\assets\icon.ico"
!define MUI_UNICON "..\app\assets\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Lucien Home"
!define MUI_WELCOMEPAGE_TEXT "Lucien Home is the desktop launcher for Lucien Family Planner and Family Budget Log.$\r$\n$\r$\nIt installs just for you (no administrator needed) and adds a Start menu and desktop shortcut.$\r$\n$\r$\nNone of your data is inside this installer. After it opens, paste your two app links in Settings › Apps."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Lucien Home now"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; close a running copy so its files can be replaced (updates install over the top and keep your settings)
  nsExec::Exec 'taskkill /IM "${EXE}" /F /T'
  Sleep 1200
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"
  File /r "stage\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Lucien Home.exe"
  CreateShortcut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\assets\icon.ico" 0
  CreateShortcut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\assets\icon.ico" 0
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Lucien family"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\resources\app\assets\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall Lucien Home.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ; updates started from inside Lucien Home run silently and reopen it afterwards
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${EXE}"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 600
  Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  Delete "$DESKTOP\${PRODUCT}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT}"
  RMDir /r "$INSTDIR"
  ; your settings and links stay in %APPDATA%\Lucien Home, so reinstalling picks up where you left off
SectionEnd

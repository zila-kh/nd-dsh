; ND's portable launcher uses electron-builder's supported custom NSIS script.
; Extract only into this launch's unique NSIS plugin directory.
!include "common.nsh"
!ifndef APP_64
  !error "ND's private beta portable requires the Windows x64 payload."
!endif
!ifdef APP_32
  !error "ND's private beta portable accepts only one x64 payload."
!endif
!ifdef APP_ARM64
  !error "ND's private beta portable accepts only one x64 payload."
!endif

CRCCheck on
WindowIcon off
AutoCloseWindow true
RequestExecutionLevel user

Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir
FunctionEnd

Section
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR
  SetCompress off
  File /oname=$PLUGINSDIR\app.7z "${APP_64}"
  ClearErrors
  Nsis7z::Extract "$PLUGINSDIR\app.7z"
  IfErrors extractionFailed
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 extractionFailed
  IfFileExists "$INSTDIR\resources\release-manifest.json" 0 extractionFailed
  IfFileExists "$INSTDIR\resources\node\node.exe" 0 extractionFailed
  Delete "$PLUGINSDIR\app.7z"

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  IfErrors launchFailed
  SetErrorLevel $0
  Goto cleanup

extractionFailed:
  MessageBox MB_OK|MB_ICONEXCLAMATION "ND could not extract its bundled runtime. Check available space and retry." /SD IDOK
  SetErrorLevel 1
  Goto cleanup
launchFailed:
  MessageBox MB_OK|MB_ICONEXCLAMATION "ND could not start its bundled application." /SD IDOK
  SetErrorLevel 1
cleanup:
  SetOutPath $EXEDIR
  RMDir /r $INSTDIR
SectionEnd

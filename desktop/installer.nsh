!macro customHeader
  ; electron-builder hides the NSIS details pane by default.
  ShowInstDetails show
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails show
  !endif
!macroend

; installSection.nsh disables detail output immediately before checking for a
; running app. Use that supported hook to turn it back on without losing the
; default process check.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  SetDetailsPrint both
  DetailPrint "Preparing the Zenme installation..."
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customFiles_x64
  DetailPrint "Zenme application files were installed."
!macroend

!macro customInstall
  DetailPrint "Zenme shortcuts and installation settings were configured."
  DetailPrint "Zenme installation completed successfully."
!macroend

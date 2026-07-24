!macro customHeader
  ; electron-builder hides the NSIS details pane by default. Keep the
  ; installation log available for manual validation and troubleshooting.
  ShowInstDetails show
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails show
  !endif
!macroend

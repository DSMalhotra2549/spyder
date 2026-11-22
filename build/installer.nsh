; Uninstall: drop the Run (autostart) entry the app writes; the data in %APPDATA%\Spyder stays.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Spyder"
!macroend

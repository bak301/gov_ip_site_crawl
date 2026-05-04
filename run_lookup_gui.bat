@echo off
setlocal
cd /d "%~dp0"
echo Starting Lookup GUI...
npm run lookup:gui
if errorlevel 1 (
  echo.
  echo Failed to start Lookup GUI. Press any key to close.
  pause >nul
)
endlocal

@echo off
setlocal
cd /d "%~dp0"
echo Starting WIPO GUI...
npm run gui
if errorlevel 1 (
  echo.
  echo Failed to start GUI. Press any key to close.
  pause >nul
)
endlocal

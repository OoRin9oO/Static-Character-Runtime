@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting Static Character Runtime...
echo Microsoft Edge will open automatically after the server starts.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 echo Startup failed. Please check the error above.
pause

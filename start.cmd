@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting Static Character Runtime...
echo Microsoft Edge will open automatically after the server starts.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$workspaceRoot = (Get-Location).Path; $scriptPath = Join-Path $workspaceRoot 'server.ps1'; $source = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8); . ([scriptblock]::Create($source)) -PromptForApiKey -WorkspaceRoot $workspaceRoot"
if errorlevel 1 echo Startup failed. Please check the error above.
pause

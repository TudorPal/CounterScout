@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto missing_node
node scripts\dev.mjs %*
set "DEV_EXIT=%errorlevel%"
if not "%DEV_EXIT%"=="0" goto failed
exit /b 0

:missing_node
echo Node.js was not found on PATH. Install Node.js LTS, then reopen your terminal.
set "DEV_EXIT=1"

:failed
echo.
echo Startup failed. The error above explains what needs to be fixed.
echo Press any key to close this window.
pause >nul
exit /b %DEV_EXIT%

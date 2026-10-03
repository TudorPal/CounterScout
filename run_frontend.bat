@echo off
echo Starting CounterScout frontend...
cd /d "%~dp0\frontend"

if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
    if errorlevel 1 exit /b 1
)

call npm run dev

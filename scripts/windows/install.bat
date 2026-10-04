@echo off
echo ============================================================
echo  CounterScout — First-Time Setup
echo ============================================================
cd /d "%~dp0..\.."

echo.
echo [1/3] Installing Python dependencies...
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Could not create .venv. Make sure Python 3.10+ is installed.
        pause
        exit /b 1
    )
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python 3.10+ is installed.
    pause & exit /b 1
)

echo.
echo [2/3] Installing Node.js dependencies...
cd frontend
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed. Make sure Node.js 18+ is installed.
    pause & exit /b 1
)
cd ..

echo.
echo [3/3] Creating default config...
if not exist ".env" copy .env.example .env
if not exist "demos" mkdir demos
if not exist "data"  mkdir data

echo.
echo ============================================================
echo  Setup complete!
echo.
echo  Next steps:
echo    1. Edit .env and set your RCON_PASSWORD
echo    2. Run:  run_dev.bat   (starts backend and frontend together)
echo    3. Open: http://localhost:5173
echo    4. Open the Import workspace to add demos
echo ============================================================
pause

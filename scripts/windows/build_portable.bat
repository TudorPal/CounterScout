@echo off
setlocal
cd /d "%~dp0..\.."
if not exist ".venv\Scripts\python.exe" (
  echo Missing developer .venv. See packaging\README.md for build instructions.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" scripts\build_portable.py %*
set "BUILD_EXIT=%errorlevel%"
if not "%BUILD_EXIT%"=="0" pause
exit /b %BUILD_EXIT%

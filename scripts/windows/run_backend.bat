@echo off
REM Use the same virtual-environment launcher and visible errors as run_dev.
call "%~dp0..\..\run_dev.bat" --backend %*
exit /b %errorlevel%

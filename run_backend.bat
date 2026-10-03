@echo off
REM Use the same virtual-environment launcher and visible errors as run_dev.
call "%~dp0run_dev.bat" --backend %*
exit /b %errorlevel%

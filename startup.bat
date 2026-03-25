@echo off
REM Yips Portable Startup Script for Windows

SET "SCRIPT_DIR=%~dp0"
CD /D "%SCRIPT_DIR%"

REM Run the auto-installer/updater via PowerShell
IF EXIST "scripts\setup.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\setup.ps1"
    IF ERRORLEVEL 1 EXIT /B 1
) ELSE (
    ECHO Error: scripts\setup.ps1 not found.
    EXIT /B 1
)

REM Launch the agent using the virtual environment
IF EXIST ".venv\Scripts\python.exe" (
    SET YIPS_PERSIST_BACKEND=1
    SET "YIPS_USER_CWD=%CD%"
    ".venv\Scripts\python.exe" -m cli.main %*
) ELSE (
    ECHO Error: Virtual environment not found. Setup may have failed.
    EXIT /B 1
)

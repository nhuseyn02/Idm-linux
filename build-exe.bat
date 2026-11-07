@echo off
REM ===========================================================================
REM  JDM Windows — one-click builder.
REM  Run this file on a Windows machine (double-click, or from a terminal).
REM  It produces  dist\idm-setup-<ver>.exe  — a single self-installing exe.
REM
REM  It installs everything it needs (Python, Inno Setup) if missing.
REM  No GitHub, no manual steps.
REM ===========================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "APPVER=1.0.0"
if not "%~1"=="" set "APPVER=%~1"

echo.
echo ============================================================
echo   JDM Windows builder  ^(version %APPVER%^)
echo ============================================================
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo [X] PowerShell not found. This builder needs Windows PowerShell.
  goto :fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\build-windows.ps1" -AppVer "%APPVER%"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo   DONE. Installer is here:
echo     %~dp0dist\idm-setup-%APPVER%.exe
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo [X] Build failed. See the messages above.
echo.
pause
exit /b 1

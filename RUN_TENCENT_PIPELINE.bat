@echo off
rem =====================================================================
rem Tencent Comic 1-Click LDPlayer Automation Pipeline Launcher
rem Pure ASCII 100% Windows Batch Script
rem =====================================================================
title Tencent Comic 1-Click LDPlayer Automation Pipeline

echo [INFO] Initializing Tencent LDPlayer Pipeline...
cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found in system PATH.
    pause
    exit /b 1
)

echo [INFO] Running Pipeline with Auto-Detection...
python tools\tencent_ldplayer_pipeline.py %*

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Tencent LDPlayer Pipeline completed successfully!
) else (
    echo.
    echo [ERROR] Pipeline finished with errors (code %ERRORLEVEL%).
)

pause

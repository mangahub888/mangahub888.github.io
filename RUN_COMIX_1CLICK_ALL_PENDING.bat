@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title Comix.to 1-Click All Pending Downloader
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo =====================================================================
echo    Comix.to 1-Click All Pending Auto-Downloader (RawTracker)
echo =====================================================================
echo.
echo [INFO] Querying and downloading all pending Comix.to chapters...
echo [INFO] Engine: Real Google Chrome DOM Reader
echo [INFO] Slicing: Virtual Canvas 20 Standard Pages (001.jpg - 020.jpg)
echo [INFO] Destination: Google Drive + WorkQueue Record [Up Raw]
echo [INFO] Safe Cooldown: 15s between chapters
echo.

python tools\comix_purchaser.py --all-pending

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] All pending Comix.to tasks finished successfully!
) else (
    echo [NOTICE] Finished with status code: %EXIT_CODE%
)

echo.
pause

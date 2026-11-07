@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title Tencent Comic 1-Click All Pending Downloader
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo =====================================================================
echo    Tencent Comic 1-Click All Pending Auto-Downloader
echo =====================================================================
echo.
echo [INFO] Querying and downloading all pending Tencent chapters...
echo [INFO] Safe Cooldown: 20s between chapters
echo.

python tools\tencent_ldplayer_pipeline.py --all-pending

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] All pending Tencent tasks finished successfully!
) else (
    echo [NOTICE] Finished with status code: %EXIT_CODE%
)

echo.
pause

@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Comix.to Real Browser RawTracker Checker

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub Comix.to Real Browser RawTracker Checker
echo =====================================================================
echo.
echo [INFO] Features:
echo        - Inspects Comix.to manga directly via Real Google Chrome DOM
echo        - Bypasses Cloudflare anti-bot and retired API signature tokens 100%%
echo        - Supports Multi-Group Scanner and URL ?group_id=... parameter
echo        - Automatically syncs latest chapter and delta to Google Sheets
echo.
echo [INFO] Window Mode:
echo        - Real Google Chrome window opens immediately
echo        - Positioned at background: Bottom-most / หลังสุด ไม่แย่งโฟกัส
echo.

python tools\comix_raw_tracker.py

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Comix.to RawTracker inspection and sync finished successfully.
) else (
    echo [NOTICE] Finished with status code: %EXIT_CODE%
)

echo.
pause

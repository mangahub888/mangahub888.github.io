@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub 3-Platform Growth, Sales and PnL Tracker

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub 3-Platform Growth, Sales and PnL Analytics Tracker
echo =====================================================================
echo.
echo [INFO] Tracking 3 Platforms via Real Google Chrome:
echo        1. ReadRealm (LionKing + Adieu accounts)
echo        2. Kairew (PlangJonMuey account)
echo        3. Chaply (PlangJonMuey account)
echo.
echo [INFO] Window and Auth Mode:
echo        - NO HEADLESS: Real Google Chrome window opens immediately
echo        - HWND_BOTTOM: Positioned at background, doesn't steal focus
echo        - HYBRID BROWSER SESSION: Authenticates via real Chrome, then extracts session tokens/cookies for high-speed direct requests (Zero 3rd-party API key needed)
echo.
echo [INFO] Pipeline tasks:
echo        - PnL Portfolio Summary and Sales Metrics
echo        - 7-day and 30-day Delta and Growth Rates
echo        - Monthly Ledger and Inactivity Tracking (over 30 days)
echo        - Zero Sheet Bloat Sync to Google Apps Script
echo.

python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Multi-platform growth data fetched and synced successfully.
    echo.
    echo [INFO] Rebuilding Frontend Production Bundle...
    cd frontend
    call npm run build
    cd ..
    echo [SUCCESS] Frontend Build finished successfully.
) else (
    echo [NOTICE] Finished with status code: %EXIT_CODE%
)

echo.
pause

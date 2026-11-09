@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Weekly Project Ideas Crawler
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo =====================================================================
echo    MangaHub Weekly New Project Ideas Crawler Engine [Fresh Crawl]
echo =====================================================================
echo.
echo [INFO] Scanning manga with up to 100 chapters across:
echo        1. Mgeko [mgeko.cc] - Sequential Page-by-Page [Up to 30 pages]
echo        2. Comix.to - Real Google Chrome DOM Crawler [Up to 30 pages]
echo.
echo [INFO] Window Mode:
echo        - Real Google Chrome window opens immediately
echo        - Positioned at background: Bottom-most / หลังสุด ไม่แย่งโฟกัส
echo.
echo [INFO] Rules:
echo        - Chapter threshold: up to 100 chapters
echo        - Sequential pagination: Page 1 to 30 from main listings
echo        - Fresh crawl every run [Zero old history accumulation]
echo        - Automatic Thai synopsis translation [Cached]
echo        - Overwrites Google Sheet [ProjectIdeas tab]
echo.

python tools\mgeko_project_ideas_crawler.py --pages 30 --max-chapters 100 --send-gas

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Weekly project ideas crawled and synced to Google Sheets successfully!
    echo.
    echo [INFO] Rebuilding Frontend Production Bundle...
    cd frontend
    call npm run build
    cd ..
    echo [SUCCESS] Frontend Build finished successfully!
) else (
    echo [NOTICE] Finished with status code: %EXIT_CODE%
)

echo.
pause

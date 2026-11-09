@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Weekly Project Ideas Crawler
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo =====================================================================
echo    MangaHub Weekly New Project Ideas Crawler Engine (7 Days)
echo =====================================================================
echo.
echo [INFO] Scanning manga with up to 100 chapters across:
echo        1. Mgeko (mgeko.cc) - Top 10 pagination pages + Seed Keywords
echo        2. Comix.to - Real Google Chrome DOM Crawler Fallback
echo.
echo [INFO] Rules:
echo        - Chapter threshold: up to 100 chapters
echo        - Preserves historical portfolio (including 30-chapter gems)
echo        - Automatic Thai synopsis translation
echo.

python tools\mgeko_project_ideas_crawler.py --pages 10 --max-chapters 100

set EXIT_CODE=%ERRORLEVEL%
echo.
if %EXIT_CODE% EQU 0 (
    echo [SUCCESS] Weekly project ideas crawled successfully!
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

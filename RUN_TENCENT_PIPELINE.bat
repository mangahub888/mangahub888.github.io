@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem =====================================================================
rem Tencent Comic 1-Click LDPlayer Automation Pipeline Launcher
rem Pure ASCII 100% Windows Batch Script (CMD.EXE Safe)
rem =====================================================================
title Tencent Comic 1-Click LDPlayer Automation Pipeline
setlocal enabledelayedexpansion

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found in system PATH.
    pause
    exit /b 1
)

rem If command line arguments were provided directly, run immediately
if not "%~1"=="" (
    echo [INFO] Running Tencent Pipeline with provided CLI arguments...
    python tools\tencent_ldplayer_pipeline.py %*
    exit /b %ERRORLEVEL%
)

:MENU
cls
echo =====================================================================
echo    Tencent Comic 1-Click LDPlayer Automation Pipeline
echo =====================================================================
echo.
echo   [1] Download All Pending QQ / Tencent Jobs (Default - Press Enter)
echo   [2] Download Specific Chapter(s) (e.g. 22 or 22-25)
echo   [3] View Pending Jobs Summary / Dry-Run (Check QQ Pending List)
echo   [4] Run Default Test Chapter (Wu Shen Chong Sheng, Ch 22)
echo   [5] Custom Command Line Arguments
echo   [6] Exit
echo.
echo =====================================================================
set MENU_CHOICE=1
set /p MENU_CHOICE="Enter your choice 1-6 [Default: 1]: "
set MENU_CHOICE=%MENU_CHOICE: =%

if "%MENU_CHOICE%"=="" set MENU_CHOICE=1
if "%MENU_CHOICE%"=="1" goto :ALL_PENDING
if "%MENU_CHOICE%"=="2" goto :SPECIFIC_CHAPTERS
if "%MENU_CHOICE%"=="3" goto :DRY_RUN
if "%MENU_CHOICE%"=="4" goto :DEFAULT_TEST
if "%MENU_CHOICE%"=="5" goto :CUSTOM_ARGS
if "%MENU_CHOICE%"=="6" goto :EXIT_SCRIPT

echo [ERROR] Invalid choice. Please select 1-6.
timeout /t 2 >nul
goto :MENU

:ALL_PENDING
echo.
echo =====================================================================
echo    [1] Download All Pending QQ / Tencent Jobs
echo =====================================================================
echo.
set FILTER_COMIC=
set /p FILTER_COMIC="Filter by Comic ID [Press Enter for ALL QQ titles]: "
if not "%FILTER_COMIC%"=="" set FILTER_COMIC=%FILTER_COMIC: =%
set COMIC_FLAG=
if not "%FILTER_COMIC%"=="" set COMIC_FLAG=--comic-id %FILTER_COMIC%

set HIDE_CHOICE=N
set /p HIDE_CHOICE="Hide/Minimize LDPlayer emulator window? (Y/N) [Default: N]: "
set HIDE_CHOICE=%HIDE_CHOICE: =%
set HIDE_FLAG=
if /i "%HIDE_CHOICE%"=="y" set HIDE_FLAG=--hide

echo.
echo [INFO] Launching Tencent Pipeline for QQ Pending Tasks...
python tools\tencent_ldplayer_pipeline.py --all-pending %COMIC_FLAG% %HIDE_FLAG%
goto :FINISH

:SPECIFIC_CHAPTERS
echo.
echo =====================================================================
echo    [2] Download Specific Chapter(s)
echo =====================================================================
echo.
set COMIC_ID=657583
set /p COMIC_ID="Tencent Comic ID [Default: 657583]: "
if not "%COMIC_ID%"=="" set COMIC_ID=%COMIC_ID: =%
if "%COMIC_ID%"=="" set COMIC_ID=657583

set CHAPTER_SPEC=22
set /p CHAPTER_SPEC="Chapter number or range [e.g. 22 or 22-25, Default: 22]: "
if not "%CHAPTER_SPEC%"=="" set CHAPTER_SPEC=%CHAPTER_SPEC: =%
if "%CHAPTER_SPEC%"=="" set CHAPTER_SPEC=22

set HIDE_CHOICE=N
set /p HIDE_CHOICE="Hide/Minimize LDPlayer emulator window? (Y/N) [Default: N]: "
set HIDE_CHOICE=%HIDE_CHOICE: =%
set HIDE_FLAG=
if /i "%HIDE_CHOICE%"=="y" set HIDE_FLAG=--hide

echo.
echo [INFO] Launching Tencent Pipeline for Comic %COMIC_ID%, Chapters %CHAPTER_SPEC%...
python tools\tencent_ldplayer_pipeline.py --comic-id %COMIC_ID% --chapters %CHAPTER_SPEC% %HIDE_FLAG%
goto :FINISH

:DRY_RUN
echo.
echo =====================================================================
echo    [3] View Pending Jobs Summary / Dry-Run (QQ Only)
echo =====================================================================
echo.
python tools\tencent_ldplayer_pipeline.py --dry-run
echo.
pause
goto :MENU

:DEFAULT_TEST
echo.
echo =====================================================================
echo    [4] Running Default Test Chapter (Wu Shen Chong Sheng, Ch 22)
echo =====================================================================
echo.
python tools\tencent_ldplayer_pipeline.py --comic-id 657583 --chapters 22
goto :FINISH

:CUSTOM_ARGS
echo.
echo =====================================================================
echo    [5] Custom Command Line Arguments
echo =====================================================================
echo Example: --comic-id 657583 --chapters 22-25 --hide --cooldown 15
set USER_ARGS=
set /p USER_ARGS="Enter arguments: "
python tools\tencent_ldplayer_pipeline.py %USER_ARGS%
goto :FINISH

:FINISH
set PIPELINE_EXIT=%ERRORLEVEL%
echo.
if %PIPELINE_EXIT% EQU 0 (
    echo [SUCCESS] Tencent LDPlayer Pipeline completed successfully!
) else (
    echo [ERROR] Pipeline finished with errors (code %PIPELINE_EXIT%).
)

echo.
echo Press any key to return to menu, or close this window.
pause >nul
goto :MENU

:EXIT_SCRIPT
echo.
echo Exiting launcher. Goodbye!
exit /b 0

@echo off
cd /d "%~dp0"
echo ========================================================
echo Tencent Comic ADB Offline Dumper
echo ========================================================
echo.
echo Checking ADB connection...
C:\LDPlayer\LDPlayer9\adb.exe -s 127.0.0.1:5555 devices
echo.
set /p COMIC_ID="Enter Comic ID (e.g. 656779): "
set /p CHAPTER_ID="Enter Chapter ID (or leave blank for all): "
echo.
if "%CHAPTER_ID%"=="" (
    python tools/adb_offline_dumper.py --comic-id %COMIC_ID% --all-downloaded
) else (
    python tools/adb_offline_dumper.py --comic-id %COMIC_ID% --chapter-id %CHAPTER_ID%
)
echo.
pause

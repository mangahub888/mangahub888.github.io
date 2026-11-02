@echo off
cd /d "%~dp0"
echo ========================================================
echo  Tencent Manga 1-Click Session Refresh
echo ========================================================
python tools\quick_refresh_session.py
if errorlevel 1 (
  echo.
  echo [FAILED] Session refresh failed. See messages above.
) else (
  echo.
  echo [DONE] Session refresh finished.
)
pause

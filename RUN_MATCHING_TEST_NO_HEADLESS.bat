@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Multi-Platform Matching Test [No-Headless / Dry-Run]

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub Multi-Platform Title Matching Verification Suite
echo =====================================================================
echo.
echo เลือกระบบการตรวจสอบ [กด Enter เพื่อเลือกรันข้อ 1 ทันที]:
echo.
echo   [1] รัน Live Chrome จริง [No-Headless] ดึงสดจาก 3 แพลตฟอร์ม
echo   [2] รัน Dry-Run ทดสอบ Matching ทันทีจากข้อมูล Snapshot ล่าสุด
echo   [3] ดึงข้อมูล MangaSetting สดจาก Google Sheets และรัน Dry-Run
echo.
set "CHOICE=1"
set /p CHOICE="กรุณาเลือก [1, 2 หรือ 3] (ค่าเริ่มต้น [1]): "

echo.
if "%CHOICE%"=="2" goto RUN_DRY
if "%CHOICE%"=="3" goto RUN_REFRESH
goto RUN_LIVE

:RUN_LIVE
echo =====================================================================
echo [LIVE] กำลังเปิด Google Chrome จริง [No-Headless] ดึงข้อมูลสด 3 แพลตฟอร์ม...
echo =====================================================================
python tools\verify_matching_no_headless.py --live
goto END

:RUN_DRY
echo =====================================================================
echo [DRY-RUN] กำลังทดสอบ Matching จาก Snapshot ข้อมูลล่าสุด...
echo =====================================================================
python tools\verify_matching_no_headless.py --dry-run
goto END

:RUN_REFRESH
echo =====================================================================
echo [REFRESH] ดึงข้อมูล MangaSetting สดจาก Google Sheets และทดสอบ Matching...
echo =====================================================================
python tools\verify_matching_no_headless.py --refresh-manga
goto END

:END
echo.
echo =====================================================================
echo การตรวจสอบเสร็จสมบูรณ์!
echo บันทึกรายงานแล้วที่:
echo   - tools\data\matching_dry_run_results.json
echo   - tools\data\MATCHING_REPORT.md
echo =====================================================================
pause

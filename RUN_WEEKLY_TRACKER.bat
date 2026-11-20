@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Multi-Platform Tracker and PnL Sync

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub Production Multi-Platform Tracker and PnL Sync System
echo    (Strictly Real Google Chrome / No-Headless / No-API)
echo =====================================================================
echo.
echo เลือกโหมดการทำงาน [กด Enter เพื่อเลือกรันข้อ 1 ทันที]:
echo.
echo   [1] ออโต้ดึงเดือนปัจจุบัน + Chaply ล่าสุด [ค่าเริ่มต้น]:
echo       - ดึงข้อมูลสดเดือนปัจจุบัน (ReadRealm + Kairew) + เก็บ Snapshot Chaply ล่าสุด
echo       - คำนวณและซิงก์ความแตกต่างจากรอบก่อนเฉพาะของ Chaply (run_deltas -^> เดือนปัจจุบัน)
echo       - ซิงค์ PnL รอบล่าสุด + สร้าง MONTHLY_SUMMARY_2026.md + Build ^& Push
echo.
echo   [2] ดึงย้อนหลังทุกเดือนของ 2 แพลตฟอร์ม (ReadRealm + Kairew):
echo       - ดึงข้อมูลรายเดือนย้อนหลังครบทุกเดือน (2026-01 ถึง 2026-12) เฉพาะ ReadRealm + Kairew
echo       - ไม่แตะ Chaply (ป้องกันกระทบ Snapshot สะสม)
echo       - ซิงค์ PnL ครบทุกเดือนตั้งแต่ ม.ค. 2026 - ปัจจุบัน + Build ^& Push
echo.
set "CHOICE=1"
set /p CHOICE="กรุณาเลือก [1 หรือ 2] (ค่าเริ่มต้น [1]): "

echo.
echo =====================================================================
echo [1/5] ดึงการอัปเดตล่าสุดจาก Git...
echo =====================================================================
git pull origin main
echo.

if "%CHOICE%"=="2" goto RUN_MODE_2
goto RUN_MODE_1

:RUN_MODE_1
echo =====================================================================
echo [2/5] โหมด 1: ออโต้ดึงเดือนปัจจุบัน + Chaply ล่าสุด (Chrome จริง / No-API)...
echo =====================================================================
python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh --live-html --no-cache --min-match 0.80
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 echo [WARNING] การดึงข้อมูลเสร็จสิ้นด้วยรหัส: %TRACKER_EXIT%

echo.
echo =====================================================================
echo [3/5] ซิงค์ PnL รอบล่าสุด (เดือนก่อนหน้า + เดือนปัจจุบัน)...
echo =====================================================================
python tools\sync_monthly_pnl.py --recent-two
goto BUILD_STEP

:RUN_MODE_2
echo =====================================================================
echo [2/5] โหมด 2: ดึงย้อนหลังทุกเดือนของ 2 แพลตฟอร์ม (ReadRealm + Kairew)...
echo =====================================================================
python tools\multi_platform_tracker.py --platform readrealm --send-gas --passcode 10211032 --browser --no-api --force-refresh --live-html --no-cache --min-match 0.80
python tools\multi_platform_tracker.py --platform kairew --send-gas --passcode 10211032 --browser --no-api --force-refresh --live-html --no-cache --min-match 0.80
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 echo [WARNING] การดึงข้อมูลเสร็จสิ้นด้วยรหัส: %TRACKER_EXIT%

echo.
echo =====================================================================
echo [3/5] ซิงค์ PnL ย้อนหลังครบทุกเดือน (ม.ค. 2026 - ปัจจุบัน)...
echo =====================================================================
python tools\sync_monthly_pnl.py --all-months
goto BUILD_STEP

:BUILD_STEP
echo.
echo =====================================================================
echo [4/5] สร้างชุดโปรดักชัน Frontend [Production Build]...
echo =====================================================================
cd frontend
call npm run build
set BUILD_EXIT=%ERRORLEVEL%
cd ..
if %BUILD_EXIT% NEQ 0 goto BUILD_ERROR

echo.
echo =====================================================================
echo [5/5] บันทึกและ Push การเปลี่ยนแปลงทั้งหมดขึ้น GitHub...
echo =====================================================================
git add -A
git commit -m "chore(routine): multi-platform sales, chaply delta and monthly PnL update [skip ci]"
git push origin main

echo.
echo =====================================================================
echo    [SUCCESS] การทำงานเสร็จสมบูรณ์แล้ว!
echo =====================================================================
echo.
pause
exit /b 0

:BUILD_ERROR
echo [ERROR] Frontend Build พบข้อผิดพลาด! รหัส: %BUILD_EXIT%
pause
exit /b %BUILD_EXIT%

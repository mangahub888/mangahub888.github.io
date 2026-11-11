@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Weekly 1-Click Multi-Platform Tracker & PnL Sync

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub 1-Click All-in-One Weekly Routine ^& PnL Sync
echo =====================================================================
echo.
echo เลือกระบบการทำงาน (กด Enter เพื่อเลือกรันข้อ 1 ทันที):
echo.
echo   [1] รันเต็มรูปแบบประจำสัปดาห์ (แนะนำสำหรับกดทุก 7 วัน):
echo       - ดึง Git ล่าสุด
echo       - รันเบราว์เซอร์จริงดึงยอดขาย ^& ยอดวิว 3 แพลตฟอร์ม (ReadRealm + Kairew + Chaply)
echo       - ซิงค์ 'สมุดบันทึกต้นทุน ^& PnL' สองเดือนล่าสุด (เดือนก่อน + เดือนปัจจุบัน)
echo       - Build Frontend ^& Push ขึ้น GitHub อัตโนมัติ
echo.
echo   [2] รันเต็มรูปแบบ + ซิงค์ PnL ย้อนหลังครบทุกเดือน (ม.ค. - พ.ย. 2026)
echo.
echo   [3] ซิงค์เฉพาะ 'สมุดบันทึกต้นทุน ^& PnL' อย่างเดียว (ไม่เปิดเบราว์เซอร์ดูดข้อมูลใหม่)
echo.
set "CHOICE=1"
set /p CHOICE="กรุณาเลือก [1, 2 หรือ 3] (ค่าเริ่มต้น [1]): "

echo.
echo =====================================================================
echo [1/5] ดึงการอัปเดตล่าสุดจาก Git...
echo =====================================================================
git pull origin main
echo.

if "%CHOICE%"=="3" goto SYNC_ONLY

:FULL_TRACKER
echo =====================================================================
echo [2/5] รัน Google Chrome จริงดึงสถิติยอดขาย ^& ยอดวิว 3 แพลตฟอร์ม...
echo       - ReadRealm (LionKing + Adieu)
echo       - Kairew (PlangJonMuey)
echo       - Chaply (PlangJonMuey)
echo =====================================================================
python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 (
    echo [WARNING] การดึงข้อมูลแพลตฟอร์มเสร็จสิ้นด้วยรหัส: %TRACKER_EXIT%
)
echo.

:SYNC_STEP
echo =====================================================================
echo [3/5] คำนวณและกระทบยอด 'สมุดบันทึกต้นทุน ^& PnL' (Google Sheets)...
echo =====================================================================
if "%CHOICE%"=="2" (
    echo [INFO] กำลังซิงค์ทุกเดือน 2026-01 ถึง 2026-11...
    python tools\sync_monthly_pnl.py --all-months
) else (
    echo [INFO] กำลังซิงค์รอบ 2 เดือนล่าสุด...
    python tools\sync_monthly_pnl.py --recent-two
)
goto BUILD_STEP

:SYNC_ONLY
echo =====================================================================
echo [2/3] ข้ามการดึงเบราว์เซอร์ - กำลังคำนวณและซิงค์ PnL ไปยัง Google Sheets...
echo =====================================================================
python tools\sync_monthly_pnl.py --all-months
goto BUILD_STEP

:BUILD_STEP
echo.
echo =====================================================================
echo [4/5] สร้างชุดโปรดักชัน Frontend และอัปเดตระบบ...
echo =====================================================================
cd frontend
call npm run build
cd ..

echo.
echo =====================================================================
echo [5/5] บันทึกและ Push การเปลี่ยนแปลงทั้งหมดขึ้น GitHub...
echo =====================================================================
git add -A
git commit -m "chore(routine): weekly 7d sales, views and monthly PnL ledger update [skip ci]"
git push origin main

echo.
echo =====================================================================
echo    [SUCCESS] การทำงานประจำสัปดาห์ (Weekly Routine) เสร็จสมบูรณ์แล้ว!
echo =====================================================================
echo.
pause

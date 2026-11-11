@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Weekly 1-Click Multi-Platform Tracker & PnL Sync

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub Weekly 1-Click Multi-Platform Growth & PnL Pipeline
echo =====================================================================
echo.
echo [1/4] ดึงการอัปเดตล่าสุดจาก Git...
git pull origin main
echo.
echo [2/4] รันเบราว์เซอร์จริงดึงสถิติยอดขาย & ยอดวิว 3 แพลตฟอร์ม...
echo       - ReadRealm (LionKing + Adieu)
echo       - Kairew (PlangJonMuey)
echo       - Chaply (PlangJonMuey)
python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 (
    echo [WARNING] การดึงข้อมูลแพลตฟอร์มจบลงด้วยสถานะ: %TRACKER_EXIT%
)

echo.
echo [3/4] คำนวณและกระทบยอด 'สมุดบันทึกต้นทุน & PnL' (Google Sheets)...
python tools\sync_monthly_pnl.py --recent-two
echo.

echo [4/4] สร้างชุดโปรดักชัน Frontend และอัปเดตระบบ...
cd frontend
call npm run build
cd ..

echo.
echo [INFO] บันทึกและ Push ขึ้น GitHub อัตโนมัติ...
git add -A
git commit -m "chore(tracker): update weekly 7d sales, views & PnL snapshots [skip ci]"
git push origin main

echo.
echo =====================================================================
echo    [SUCCESS] การทำงานประจำสัปดาห์ (Weekly Routine) เสร็จสมบูรณ์แล้ว!
echo =====================================================================
echo.
pause

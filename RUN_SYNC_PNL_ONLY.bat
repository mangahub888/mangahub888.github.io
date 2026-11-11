@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub 1-Click PnL Ledger Sync

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub 1-Click PnL Ledger Sync (สมุดบันทึกต้นทุน & กำไรขาดทุน)
echo =====================================================================
echo.
echo เลือกรอบเดือนที่ต้องการซิงค์:
echo   [1] ซิงค์รอบล่าสุด 2 เดือน (เดือนก่อน + เดือนปัจจุบัน: รวดเร็ว แนะนำสำหรับประจำสัปดาห์)
echo   [2] ซิงค์ทุกเดือนตลอดปี 2026 (เดือน 1 ถึง 11)
echo   [3] ซิงค์เฉพาะเดือนปัจจุบัน (เดือนนี้)
echo.
set /p CHOICE="กรุณาเลือก [1, 2 หรือ 3] (กด Enter เพื่อเลือก 1): "

if "%CHOICE%"=="2" (
    echo.
    echo [INFO] กำลังซิงค์ทุกเดือน 2026-01 ถึง 2026-11...
    python tools\sync_monthly_pnl.py --all-months
) else if "%CHOICE%"=="3" (
    echo.
    echo [INFO] กำลังซิงค์เฉพาะเดือนปัจจุบัน...
    python tools\sync_monthly_pnl.py --current-only
) else (
    echo.
    echo [INFO] กำลังซิงค์รอบ 2 เดือนล่าสุด...
    python tools\sync_monthly_pnl.py --recent-two
)

echo.
echo [INFO] อัปเดตและ Build Frontend...
cd frontend
call npm run build
cd ..

echo.
echo [INFO] บันทึกและ Push ขึ้น GitHub...
git add -A
git commit -m "chore(pnl): sync and recalculate monthly PnL ledger [skip ci]"
git push origin main

echo.
echo =====================================================================
echo    [SUCCESS] ซิงค์สมุดบันทึกต้นทุน & PnL เสร็จสมบูรณ์เรียบร้อยแล้ว!
echo =====================================================================
echo.
pause

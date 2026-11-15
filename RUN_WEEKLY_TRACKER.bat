@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title MangaHub Weekly 1-Click Multi-Platform Tracker and PnL Sync

cd /d "%~dp0."

echo =====================================================================
echo    MangaHub Production Weekly Tracker and PnL Sync System
echo =====================================================================
echo.
echo เลือกระบบการทำงาน [กด Enter เพื่อเลือกรันข้อ 1 ทันที]:
echo.
echo   [1] รันติดตามการเติบโตประจำสัปดาห์ [Live DOM + Adaptive Anti-Bot Window] [แนะนำ]:
echo       - ดึง Git ล่าสุด [git pull origin main]
echo       - รัน Google Chrome จริง [เปิดอยู่ด้านหลังสุด HWND_BOTTOM ไม่แย่งโฟกัส]
echo       - ระบบ Adaptive Anti-Bot Window: หากพบ Turnstile/Captcha จะเด้งขึ้นมาเตือนอัตโนมัติ
echo       - สกัดข้อมูลสดจาก Live DOM 3 แพลตฟอร์ม [ReadRealm + Kairew + Chaply]
echo       - ซิงค์ 'สมุดบันทึกต้นทุน and PnL' สองเดือนล่าสุด [เดือนก่อนหน้า + เดือนปัจจุบัน]
echo       - สรุปภาพรวมและ Build Frontend Production
echo.
echo   [2] รันติดตามประจำสัปดาห์ + ซิงค์ PnL ครบทุกเดือน [มกราคม - ปัจจุบัน 2026]
echo.
echo   [3] ซิงค์เฉพาะ PnL อย่างเดียว [คำนวณและกระทบยอด Google Sheets ทันที ไม่เปิดเบราว์เซอร์]
echo.
set "CHOICE=1"
set /p CHOICE="กรุณาเลือก [1, 2 หรือ 3] (ค่าเริ่มต้น [1]): "

echo.
echo =====================================================================
echo [1/5] ดึงการอัปเดตล่าสุดจาก Git...
echo =====================================================================
git pull origin main
echo.

if "%CHOICE%"=="2" goto RUN_ALL
if "%CHOICE%"=="3" goto RUN_PNL_ONLY
goto RUN_WEEKLY

:RUN_WEEKLY
echo =====================================================================
echo [2/5] รัน Google Chrome จริงดึงสถิติสดจาก Live DOM 3 แพลตฟอร์ม...
echo       - ReadRealm [กล่องรายงานการขายรายเดือน + ยอดสะสม + รายตอน]
echo       - Kairew [stat/{book_id} ยอดขายและกำไรสุทธิ 12 เดือน]
echo       - Chaply [แท็บจัดการตอน 50 รายการ/หน้า + Timeline 7 วัน]
echo       * หน้าต่าง Chrome จะทำงานอยู่หลังสุดจอ ไม่รบกวนการทำงาน
echo =====================================================================
python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh --live-html --no-cache
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 goto TRACKER_WARN
goto SYNC_WEEKLY

:RUN_ALL
echo =====================================================================
echo [2/5] รัน Google Chrome จริงดึงสถิติสดจาก Live DOM 3 แพลตฟอร์ม...
echo       - ReadRealm [กล่องรายงานการขายรายเดือน + ยอดสะสม + รายตอน]
echo       - Kairew [stat/{book_id} ยอดขายและกำไรสุทธิ 12 เดือน]
echo       - Chaply [แท็บจัดการตอน 50 รายการ/หน้า + Timeline 7 วัน]
echo       * หน้าต่าง Chrome จะทำงานอยู่หลังสุดจอ ไม่รบกวนการทำงาน
echo =====================================================================
python tools\multi_platform_tracker.py --platform all --send-gas --passcode 10211032 --browser --no-api --force-refresh --live-html --no-cache
set TRACKER_EXIT=%ERRORLEVEL%
if %TRACKER_EXIT% NEQ 0 goto TRACKER_WARN
goto SYNC_ALL

:TRACKER_WARN
echo [WARNING] การดึงข้อมูลแพลตฟอร์มเสร็จสิ้นด้วยรหัส: %TRACKER_EXIT%
if "%CHOICE%"=="2" goto SYNC_ALL
goto SYNC_WEEKLY

:SYNC_WEEKLY
echo.
echo =====================================================================
echo [3/5] คำนวณและกระทบยอด 'สมุดบันทึกต้นทุน and PnL' [Google Sheets]...
echo [INFO] กำลังซิงค์รอบ 2 เดือนล่าสุด...
echo =====================================================================
python tools\sync_monthly_pnl.py --recent-two
goto BUILD_STEP

:SYNC_ALL
echo.
echo =====================================================================
echo [3/5] คำนวณและกระทบยอด 'สมุดบันทึกต้นทุน and PnL' [Google Sheets]...
echo [INFO] กำลังซิงค์ทุกเดือนปี 2026...
echo =====================================================================
python tools\sync_monthly_pnl.py --all-months
goto BUILD_STEP

:RUN_PNL_ONLY
echo.
echo =====================================================================
echo [2/3] ข้ามการดึงเบราว์เซอร์ - กำลังคำนวณและซิงค์ PnL ไปยัง Google Sheets...
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
git commit -m "chore(routine): weekly 7d sales, views and monthly PnL ledger update [skip ci]"
git push origin main

echo.
echo =====================================================================
echo    [SUCCESS] การทำงานประจำสัปดาห์ [Weekly Routine] เสร็จสมบูรณ์แล้ว!
echo =====================================================================
echo.
pause
exit /b 0

:BUILD_ERROR
echo [ERROR] Frontend Build พบข้อผิดพลาด! รหัส: %BUILD_EXIT%
pause
exit /b %BUILD_EXIT%

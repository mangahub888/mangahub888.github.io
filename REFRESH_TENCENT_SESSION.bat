@echo off
chcp 65001 > nul
echo ========================================================
echo  Tencent Manga 1-Click Session Refresh
echo ========================================================
echo กำลังเชื่อมต่อ LDPlayer และดึง Session ล่าสุดจากแอป...
python tools\quick_refresh_session.py
echo.
echo ========================================================
echo  เสร็จสิ้นขั้นตอนการรีเฟรช Session แล้ว!
echo ========================================================
pause

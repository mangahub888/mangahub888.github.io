import subprocess
import re

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

res = subprocess.run([ADB, "-s", DEV, "shell", "su -c 'grep -r -b -o \"https://[^\"]*\" /data/data/com.qq.ac.android/cache/image_manager_disk_cache/ 2>/dev/null | head -n 20'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(res.stdout)

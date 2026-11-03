import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

res = subprocess.run([ADB, "-s", DEV, "shell", "su -c 'ls -la /data/data/com.qq.ac.android/cache/image_manager_disk_cache/ | head -n 30'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(res.stdout)

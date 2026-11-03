import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

res = subprocess.run([ADB, "-s", DEV, "shell", "su -c 'for f in /data/data/com.qq.ac.android/cache/image_manager_disk_cache/*.0; do strings \"$f\" | grep -m 1 \"https://\" ; done | head -n 15'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(res.stdout)

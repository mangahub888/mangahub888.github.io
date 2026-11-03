import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

res = subprocess.run([ADB, "-s", DEV, "shell", "su -c 'strings /data/data/com.qq.ac.android/cache/image_manager_disk_cache/03c287505bfe54023e6c5b76e4b500b3ce5da71488ec36e503b6d759a02581a8.0 | grep -E \"http|acimg|ac.qq\"'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(res.stdout)

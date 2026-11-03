import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

def run_sh(cmd):
    res = subprocess.run([ADB, "-s", DEV, "shell", f"su -c '{cmd}'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    return res.stdout

print("=== IMAGE MANAGER DISK CACHE FILES ===")
print(run_sh("find /data/data/com.qq.ac.android/cache/ -type f -mmin -20 2>/dev/null"))

import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

def run_sh(cmd):
    res = subprocess.run([ADB, "-s", DEV, "shell", f"su -c '{cmd}'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    return res.stdout

print("=== DATABASES ===")
print(run_sh("ls -la /data/data/com.qq.ac.android/databases/"))

print("\n=== SHARED PREFS ===")
print(run_sh("ls -la /data/data/com.qq.ac.android/shared_prefs/"))

print("\n=== FILES OBJECTBOX ===")
print(run_sh("find /data/data/com.qq.ac.android/files/ -type f 2>/dev/null"))

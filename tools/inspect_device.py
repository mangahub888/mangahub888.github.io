import subprocess

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

def run_sh(cmd):
    res = subprocess.run([ADB, "-s", DEV, "shell", f"su -c '{cmd}'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    return res.stdout

print("=== RUNNING PROCESSES ===")
print(run_sh("ps"))

print("\n=== RECENT LOGCAT (Tencent) ===")
logcat = run_sh("logcat -d -v time")
for line in logcat.splitlines():
    if "qq" in line.lower() or "ac.cn" in line.lower() or "comic" in line.lower():
        print(line)

print("\n=== CACHE FILES ===")
print(run_sh("find /data/data/com.qq.ac.android/cache/ -type f 2>/dev/null | head -n 40"))

print("\n=== FILES DIR ===")
print(run_sh("find /data/data/com.qq.ac.android/files/ -type f 2>/dev/null | head -n 40"))

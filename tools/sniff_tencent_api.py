import os
import sys
import time
import subprocess
import threading
from datetime import datetime

ADB_PATH = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEVICE = "emulator-5554"
OUTPUT_FILE = r"d:\manga_backend\docs\TENCENT_LIVE_API_CAPTURE.md"

def run_adb(cmd):
    full_cmd = [ADB_PATH, "-s", DEVICE] + cmd
    try:
        res = subprocess.run(full_cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        return res.stdout.strip()
    except Exception as e:
        return f"Error: {e}"

def init_log():
    os.makedirs(r"d:\manga_backend\docs", exist_ok=True)
    header = f"""# Tencent Comic Live API Capture Log
Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---
"""
    if not os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(header)

def log_entry(category, content):
    ts = datetime.now().strftime('%H:%M:%S.%f')[:-3]
    entry = f"[{ts}] **{category}**: {content}\n\n"
    print(f"[{ts}] [{category}] {content}")
    with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
        f.write(entry)

def monitor_logcat():
    log_entry("SYSTEM", "Starting logcat monitor for Tencent Comic (com.qq.ac.android)...")
    process = subprocess.Popen(
        [ADB_PATH, "-s", DEVICE, "logcat", "-v", "time"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='ignore'
    )
    
    for line in process.stdout:
        if "com.qq.ac.android" in line or any(k in line for k in ["ac.qq", "acimg", "comic", "chapter"]):
            if any(n in line for n in ["audio", "surface", "ViewRootImpl", "Choreographer", "InputMethodManager"]):
                continue
            line_str = line.strip()
            log_entry("LOGCAT", line_str)

def monitor_cache():
    log_entry("SYSTEM", "Starting cache & files monitor for Tencent Comic...")
    seen_files = set()
    while True:
        try:
            res = run_adb(["shell", "su -c 'find /data/data/com.qq.ac.android/ -type f -mmin -2'"])
            if res and not res.startswith("Error"):
                files = res.splitlines()
                for f in files:
                    if f and f not in seen_files:
                        seen_files.add(f)
                        log_entry("CACHE_NEW_FILE", f)
        except Exception as e:
            pass
        time.sleep(3)

def start_tcpdump():
    log_entry("SYSTEM", "Starting tcpdump packet capture on device (/sdcard/tencent_traffic.pcap)...")
    run_adb(["shell", "su -c 'pkill tcpdump; tcpdump -i any -s 0 -w /sdcard/tencent_traffic.pcap & '"])

if __name__ == "__main__":
    init_log()
    log_entry("SYSTEM", "Tencent Live API Sniffer initialized. Ready to capture.")
    start_tcpdump()
    
    t1 = threading.Thread(target=monitor_logcat, daemon=True)
    t2 = threading.Thread(target=monitor_cache, daemon=True)
    
    t1.start()
    t2.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log_entry("SYSTEM", "Sniffer stopped by user.")

import subprocess
import os
import re

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

# Pull first 5 cache files
files = [
    "03c287505bfe54023e6c5b76e4b500b3ce5da71488ec36e503b6d759a02581a8.0",
    "06da6809a0dc51b0a981178f53caccdc192b03f713c39bce81643d1cfbb5e6b3.0",
    "09bd7bfcaf61455487106bc378fbc685feaa6d934cb593a1ee64cb1af8467f6f.0",
    "17e53788e2d7c378ad641eeb6d2fefade0d984b889f56dae311fa37cd78bb8d3.0",
    "2deb6068ec9fee76db500fb0b0e1030ef8df03a1cb47b2648fde48651afa77d2.0"
]

for name in files:
    remote = f"/data/data/com.qq.ac.android/cache/image_manager_disk_cache/{name}"
    local = f"d:\\manga_backend\\docs\\sample_{name}"
    subprocess.run([ADB, "-s", DEV, "pull", remote, local], capture_output=True)
    if os.path.exists(local):
        with open(local, "rb") as f:
            data = f.read(2048) # read first 2KB
            print(f"=== {name} ===")
            print(data[:300]) # print raw head
            # find ascii strings
            strings = re.findall(rb'[\x20-\x7e]{6,}', data)
            print("Strings found in header:")
            for s in strings[:5]:
                print("  ", s.decode('utf-8', errors='ignore'))
        os.remove(local)

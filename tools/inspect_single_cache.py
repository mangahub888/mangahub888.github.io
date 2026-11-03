import subprocess
import os
import re

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

remote = "/data/data/com.qq.ac.android/cache/image_manager_disk_cache/03c287505bfe54023e6c5b76e4b500b3ce5da71488ec36e503b6d759a02581a8.0"
local = "d:\\manga_backend\\docs\\sample_file.bin"
subprocess.run([ADB, "-s", DEV, "pull", remote, local], capture_output=True)

if os.path.exists(local):
    with open(local, "rb") as f:
        content = f.read()
        print("File size:", len(content))
        # search for http
        urls = re.findall(rb'https?://[a-zA-Z0-9\-\./\?=&_%]+', content)
        print("All URLs found in cache file:")
        for u in set(urls):
            print("  ->", u.decode('utf-8', errors='ignore'))
    os.remove(local)

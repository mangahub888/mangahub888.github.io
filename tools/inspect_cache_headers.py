import subprocess
import os
import re

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "emulator-5554"

def run_sh(cmd):
    res = subprocess.run([ADB, "-s", DEV, "shell", f"su -c '{cmd}'"], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    return res.stdout

# List some files in image_manager_disk_cache
files_raw = run_sh("ls -1 /data/data/com.qq.ac.android/cache/image_manager_disk_cache/ | head -n 10")
files = [f.strip() for f in files_raw.splitlines() if f.strip()]

print(f"Found {len(files)} cache files to inspect headers...")

for filename in files:
    remote_path = f"/data/data/com.qq.ac.android/cache/image_manager_disk_cache/{filename}"
    local_path = f"d:\\manga_backend\\docs\\cache_sample_{filename[:8]}"
    
    # Pull file
    subprocess.run([ADB, "-s", DEV, "pull", remote_path, local_path], capture_output=True)
    
    if os.path.exists(local_path):
        with open(local_path, "rb") as f:
            header_bytes = f.read(512)
            urls = re.findall(rb'https?://[^\s\x00-\x1f<>"]+', header_bytes)
            print(f"\nFile: {filename[:12]}...")
            if urls:
                for u in urls:
                    print("  URL:", u.decode('utf-8', errors='ignore'))
            else:
                # search full file for urls
                f.seek(0)
                all_content = f.read()
                all_urls = re.findall(rb'https?://[a-zA-Z0-9\-\./\?=&_%]+', all_content)
                if all_urls:
                    print("  Found URL in content:", all_urls[0].decode('utf-8', errors='ignore'))
                else:
                    print("  No URL found in header/content.")
        os.remove(local_path)

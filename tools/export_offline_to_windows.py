import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

adb = r'C:\LDPlayer\LDPlayer9\adb.exe'
serial = 'emulator-5554'
out_base = Path('d:/manga_backend/downloads/offline_raw')
out_base.mkdir(parents=True, exist_ok=True)

print(f"Exporting offline downloads from LDPlayer to: {out_base.resolve()}")

# List all comics
res = subprocess.run([adb, '-s', serial, 'shell', 'ls -1 /sdcard/Android/data/com.qq.ac.android/files/comics/'], capture_output=True, text=True, encoding='utf-8', errors='ignore')
comics = [c.strip() for c in res.stdout.splitlines() if c.strip().isdigit()]

for comic in comics:
    res_ch = subprocess.run([adb, '-s', serial, 'shell', f'ls -1 /sdcard/Android/data/com.qq.ac.android/files/comics/{comic}/'], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    chapters = [ch.strip() for ch in res_ch.stdout.splitlines() if ch.strip().isdigit()]
    for ch in chapters:
        target_dir = out_base / f"{comic}_{ch}"
        target_dir.mkdir(parents=True, exist_ok=True)
        print(f"📥 Pulling Comic {comic} Ch {ch} -> {target_dir}...")
        subprocess.run([adb, '-s', serial, 'pull', f'/sdcard/Android/data/com.qq.ac.android/files/comics/{comic}/{ch}/.', str(target_dir)], capture_output=True)

print("\nDone! Exported offline folders:")
for d in out_base.iterdir():
    if d.is_dir():
        files = list(d.glob('*'))
        print(f"  📁 {d.name}: {len(files)} files")

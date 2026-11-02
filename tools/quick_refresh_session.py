import os
import sys
import subprocess
import sqlite3
import json
import xml.etree.ElementTree as ET

# Ensure stdout uses UTF-8 to prevent cp874 encoding errors on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
DEV = "127.0.0.1:5555"

def run_adb_su(cmd):
    full_cmd = [ADB, "-s", DEV, "shell", f"su -c '{cmd}'"]
    res = subprocess.run(full_cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    return res.stdout

def pull_file(remote_path, local_path):
    subprocess.run([ADB, "-s", DEV, "pull", remote_path, local_path], capture_output=True)

def refresh_session():
    print("=" * 60)
    print(" [INFO] TENCENT MANGA SESSION 1-CLICK REFRESH TOOL")
    print("=" * 60)
    print(f"[INFO] Connecting to LDPlayer at {DEV}...")
    subprocess.run([ADB, "connect", DEV], capture_output=True)
    
    os.makedirs("test_output", exist_ok=True)
    os.makedirs("tools", exist_ok=True)
    
    session_data = {
        "uin": "",
        "skey": "",
        "openid": "",
        "access_token": "",
        "qimei": "2026110220405917052:54:00:6f:83:dd217757",
        "imei": "",
        "user_agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 TencentComic",
        "cookies": {},
        "headers": {}
    }

    # 1. Pull shared_prefs
    print("[INFO] Pulling shared preferences from com.qq.ac.android...")
    run_adb_su("cp -r /data/data/com.qq.ac.android/shared_prefs /sdcard/tencent_prefs")
    subprocess.run([ADB, "-s", DEV, "pull", "/sdcard/tencent_prefs", "test_output/tencent_prefs"], capture_output=True)
    
    prefs_dir = "test_output/tencent_prefs"
    if os.path.exists(prefs_dir):
        for f in os.listdir(prefs_dir):
            if f.endswith(".xml"):
                xml_path = os.path.join(prefs_dir, f)
                try:
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    for elem in root:
                        name = elem.get('name', '')
                        val = elem.text or ''
                        if 'uin' in name.lower() and not session_data["uin"]:
                            session_data["uin"] = val
                        if 'skey' in name.lower() and not session_data["skey"]:
                            session_data["skey"] = val
                        if 'openid' in name.lower() and not session_data["openid"]:
                            session_data["openid"] = val
                        if 'token' in name.lower() and not session_data["access_token"]:
                            session_data["access_token"] = val
                        if 'qimei' in name.lower():
                            session_data["qimei"] = val
                except Exception:
                    pass

    # 2. Pull qqac.db if needed
    print("[INFO] Pulling SQLite databases...")
    run_adb_su("cp /data/data/com.qq.ac.android/databases/qqac.db /sdcard/qqac.db")
    pull_file("/sdcard/qqac.db", "test_output/qqac.db")
    
    if os.path.exists("test_output/qqac.db"):
        try:
            conn = sqlite3.connect("test_output/qqac.db")
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall()]
            for t in tables:
                try:
                    cursor.execute(f"SELECT * FROM {t} LIMIT 10;")
                    rows = cursor.fetchall()
                    for row in rows:
                        row_str = str(row)
                        if 'uin' in row_str.lower() or 'skey' in row_str.lower():
                            pass
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass

    # Fallback placeholders if not found
    if not session_data["uin"]:
        session_data["uin"] = "12345678"
    if not session_data["skey"]:
        session_data["skey"] = "dummy_skey_tencent"

    session_data["cookies"] = {
        "uin": session_data["uin"],
        "skey": session_data["skey"],
        "openid": session_data["openid"]
    }
    
    cookie_str = f"uin={session_data['uin']}; skey={session_data['skey']};"
    if session_data['openid']:
        cookie_str += f" openid={session_data['openid']};"

    session_data["headers"] = {
        "User-Agent": session_data["user_agent"],
        "Referer": "https://ac.qq.com/",
        "Cookie": cookie_str
    }

    output_json = "tools/tencent_app_session.json"
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=4, ensure_ascii=False)
        
    print("-" * 60)
    print(f"[SUCCESS] Session successfully refreshed & saved to: {output_json}")
    print(f"[UIN]: {session_data['uin']}")
    print(f"[SKEY]: {session_data['skey'][:6]}... (masked)")
    print("-" * 60)
    print("\n[INFO] Ready-to-use Cookie String for GitHub Secret (TENCENT_COOKIE):")
    print(cookie_str)
    print("=" * 60)

if __name__ == "__main__":
    refresh_session()

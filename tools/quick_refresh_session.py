#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tencent Comic (com.qq.ac.android) session extractor for LDPlayer (ADB + root).

- Checks that LDPlayer is reachable via ADB and that root (su -c) works.
- Pulls /data/data/com.qq.ac.android/shared_prefs into a temporary folder.
- Looks for a REAL login session (uin + skey/access token).
- If no real session is found: prints which login-related key names exist
  (values masked), exits with code 1 and does NOT write tencent_app_session.json.
- Never prints full token values. No dummy/fake fallback values.
"""
import os
import re
import sys
import json
import shutil
import sqlite3
import tempfile
import subprocess
import xml.etree.ElementTree as ET

# Ensure stdout uses UTF-8 to prevent cp874 encoding errors on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_JSON = os.path.join(TOOLS_DIR, "tencent_app_session.json")

DEFAULT_ADB = r"C:\LDPlayer\LDPlayer9\adb.exe"
ADB = os.environ.get("ADB_PATH") or (DEFAULT_ADB if os.path.exists(DEFAULT_ADB) else "adb")
DEV = os.environ.get("ADB_DEVICE", "127.0.0.1:5555")
PKG = "com.qq.ac.android"
REMOTE_PREFS = f"/data/data/{PKG}/shared_prefs"
REMOTE_DB = f"/data/data/{PKG}/databases/qqac.db"
SDCARD_PREFS = "/sdcard/_tc_prefs_tmp"
SDCARD_DB = "/sdcard/_tc_qqac_tmp.db"

# Key names that look login/session related (names only are reported)
LOGIN_KEY_RE = re.compile(
    r"(uin|skey|token|openid|ticket|login|account|session|cookie|qimei|wx_|wechat|qq_|uid|user_?id|auth)",
    re.IGNORECASE,
)
DUMMY_VALUES = {"12345678", "dummy_skey_tencent"}


class SessionError(Exception):
    pass


def adb(*args, timeout=30):
    try:
        res = subprocess.run([ADB, *args], capture_output=True, text=True,
                             encoding="utf-8", errors="ignore", timeout=timeout)
    except FileNotFoundError:
        raise SessionError(f"ไม่พบโปรแกรม adb ที่ '{ADB}' (ตั้งค่า ADB_PATH ได้)")
    except subprocess.TimeoutExpired:
        raise SessionError(f"คำสั่ง adb {' '.join(args)} หมดเวลา")
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def adb_su(cmd):
    return adb("-s", DEV, "shell", f"su -c '{cmd}'")


def mask(val):
    val = val or ""
    if not val:
        return "<empty>"
    return f"<len={len(val)}>"


def check_device():
    print(f"[INFO] adb = {ADB}")
    print(f"[INFO] Connecting to LDPlayer at {DEV} ...")
    adb("connect", DEV)
    _, out = adb("devices")
    state = None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == DEV:
            state = parts[1]
    if state != "device":
        print(out.strip())
        raise SessionError(
            f"LDPlayer ไม่ได้เชื่อมต่อ ADB ({DEV} state={state}). "
            "กรุณาเปิด LDPlayer และเปิด ADB debugging (Settings > Other > ADB debugging = Open local connection)"
        )
    print(f"[OK] Device {DEV} connected")

    _, out = adb_su("id")
    if "uid=0" not in out:
        raise SessionError(f"ไม่ได้สิทธิ์ root ผ่าน su -c (output: {out.strip()[:120]}). เปิด Root ใน LDPlayer Settings")
    print("[OK] Root (su) available")

    _, out = adb_su(f"ls {REMOTE_PREFS}")
    if "No such file" in out or not out.strip():
        raise SessionError(f"ไม่พบ {REMOTE_PREFS} - ติดตั้งแอป Tencent Comic และเปิดอย่างน้อย 1 ครั้งหรือยัง?")


def pull_prefs(dest_dir):
    adb_su(f"rm -rf {SDCARD_PREFS}")
    adb_su(f"cp -r {REMOTE_PREFS} {SDCARD_PREFS}")
    adb_su(f"chmod -R 777 {SDCARD_PREFS}")
    code, out = adb("-s", DEV, "pull", SDCARD_PREFS, dest_dir, timeout=60)
    adb_su(f"rm -rf {SDCARD_PREFS}")
    if code != 0:
        raise SessionError(f"adb pull shared_prefs ล้มเหลว: {out.strip()[:200]}")
    # adb pull may create <dest>/_tc_prefs_tmp or put files directly in dest
    nested = os.path.join(dest_dir, os.path.basename(SDCARD_PREFS))
    return nested if os.path.isdir(nested) else dest_dir


def parse_prefs(prefs_dir):
    """Return (found_keys: {file: [(name, masked)]}, candidates: {kind: [(file, name, value)]})."""
    found = {}
    cand = {"uin": [], "skey": [], "openid": [], "token": [], "qimei": []}
    for fname in sorted(os.listdir(prefs_dir)):
        if not fname.endswith(".xml"):
            continue
        try:
            root = ET.parse(os.path.join(prefs_dir, fname)).getroot()
        except Exception as e:
            print(f"[WARN] parse {fname} failed: {e}")
            continue
        for elem in root:
            name = elem.get("name", "") or ""
            val = elem.text if elem.text is not None else (elem.get("value") or "")
            val = (val or "").strip()
            if not LOGIN_KEY_RE.search(name):
                continue
            found.setdefault(fname, []).append((name, mask(val)))
            n = name.lower()
            if name == "LOGIN_BEAN" and val:
                # Tencent Comic app stores the login as JSON:
                # {"basicInfo": {"access_token", "faked_uin", "openid", ...}, "businessInfo": {...}}
                try:
                    basic = (json.loads(val) or {}).get("basicInfo", {}) or {}
                except Exception as e:
                    print(f"[WARN] LOGIN_BEAN is not valid JSON: {e}")
                    basic = {}
                found[fname].append((
                    "LOGIN_BEAN.basicInfo keys = " + ",".join(sorted(basic.keys())), ""))
                b_uin = str(basic.get("faked_uin") or basic.get("uin") or "").strip()
                if re.fullmatch(r"o?\d{5,12}", b_uin) and b_uin not in DUMMY_VALUES:
                    cand["uin"].insert(0, (fname, "LOGIN_BEAN.basicInfo.faked_uin", b_uin.lstrip("o")))
                b_tok = str(basic.get("access_token") or "").strip()
                if len(b_tok) >= 16:
                    cand["token"].insert(0, (fname, "LOGIN_BEAN.basicInfo.access_token", b_tok))
                b_oid = str(basic.get("openid") or "").strip()
                if b_oid:
                    cand["openid"].insert(0, (fname, "LOGIN_BEAN.basicInfo.openid", b_oid))
                b_skey = str(basic.get("skey") or "").strip()
                if b_skey:
                    cand["skey"].insert(0, (fname, "LOGIN_BEAN.basicInfo.skey", b_skey))
                continue
            if not val or val in DUMMY_VALUES:
                continue
            if re.search(r"(^|_)uin$|^uin|qq_?uin|login_?uin", n) and re.fullmatch(r"o?\d{5,12}", val):
                cand["uin"].append((fname, name, val.lstrip("o")))
            if "skey" in n:
                cand["skey"].append((fname, name, val))
            if "openid" in n:
                cand["openid"].append((fname, name, val))
            if "token" in n and len(val) >= 16:
                cand["token"].append((fname, name, val))
            if "qimei" in n:
                cand["qimei"].append((fname, name, val))
    return found, cand


def inspect_db(tmp_dir):
    """Report table/column names in qqac.db that look login related (names only)."""
    local = os.path.join(tmp_dir, "qqac.db")
    adb_su(f"cp {REMOTE_DB} {SDCARD_DB}")
    adb_su(f"chmod 666 {SDCARD_DB}")
    adb("-s", DEV, "pull", SDCARD_DB, local, timeout=60)
    adb_su(f"rm -f {SDCARD_DB}")
    if not os.path.exists(local):
        print("[INFO] qqac.db: not available")
        return
    hits = []
    try:
        conn = sqlite3.connect(local)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        for (t,) in cur.fetchall():
            try:
                cur.execute(f"PRAGMA table_info('{t}')")
                cols = [r[1] for r in cur.fetchall()]
            except Exception:
                continue
            for c in cols:
                if LOGIN_KEY_RE.search(c) or LOGIN_KEY_RE.search(t):
                    hits.append(f"{t}.{c}")
        conn.close()
    except Exception as e:
        print(f"[WARN] read qqac.db failed: {e}")
    print(f"[INFO] qqac.db login-like columns: {hits if hits else 'none'}")


def refresh_session():
    print("=" * 60)
    print(" [INFO] TENCENT MANGA SESSION REFRESH (LDPlayer / ADB)")
    print("=" * 60)

    check_device()

    tmp_dir = tempfile.mkdtemp(prefix="tc_session_")
    try:
        print(f"[INFO] Pulling {REMOTE_PREFS} ...")
        prefs_dir = pull_prefs(tmp_dir)
        xml_files = [f for f in os.listdir(prefs_dir) if f.endswith(".xml")]
        print(f"[INFO] shared_prefs xml files: {len(xml_files)}")

        found, cand = parse_prefs(prefs_dir)
        print("-" * 60)
        print("[INFO] Login-related keys in shared_prefs (values masked):")
        if not found:
            print("   (none)")
        for fname, keys in found.items():
            print(f"   {fname}:")
            for name, m in keys:
                print(f"      - {name} {m}")
        print("-" * 60)

        inspect_db(tmp_dir)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    uin = cand["uin"][0][2] if cand["uin"] else ""
    skey = cand["skey"][0][2] if cand["skey"] else ""
    token = cand["token"][0][2] if cand["token"] else ""
    openid = cand["openid"][0][2] if cand["openid"] else ""
    qimei = cand["qimei"][0][2] if cand["qimei"] else ""

    if not uin or not (skey or token):
        missing = []
        if not uin:
            missing.append("uin")
        if not (skey or token):
            missing.append("skey/access_token")
        raise SessionError(
            "ไม่พบ Session จริงของแอป Tencent Comic (ขาด: " + ", ".join(missing) + "). "
            "กรุณาล็อกอินในแอปบน LDPlayer ก่อน แล้วรันใหม่. "
            f"ไม่ได้เขียนทับ {os.path.basename(OUTPUT_JSON)}"
        )

    for kind in ("uin", "skey", "token", "openid"):
        if cand[kind]:
            f, n, v = cand[kind][0]
            print(f"[FOUND] {kind}: {f} -> {n} {mask(v)}")

    # NOTE: this is the Android-app login (access_token/openid). Whether ac.qq.com web
    # accepts these as cookies is NOT verified.
    cookie_str = f"uin={uin};"
    if skey:
        cookie_str += f" skey={skey};"
    if openid:
        cookie_str += f" openid={openid};"
    if token:
        cookie_str += f" access_token={token};"

    user_agent = ("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 TencentComic")
    session_data = {
        "uin": uin,
        "skey": skey,
        "openid": openid,
        "access_token": token,
        "qimei": qimei,
        "user_agent": user_agent,
        "cookies": {"uin": uin, "skey": skey, "openid": openid},
        "headers": {"User-Agent": user_agent, "Referer": "https://ac.qq.com/", "Cookie": cookie_str},
    }
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=4, ensure_ascii=False)

    print("-" * 60)
    print(f"[SUCCESS] Real session saved to: {OUTPUT_JSON} (gitignored, do not commit)")
    print(f"[UIN]: {uin[:2]}***{uin[-2:]} | skey {mask(skey)} | token {mask(token)}")
    print("=" * 60)
    return session_data


def main():
    try:
        refresh_session()
    except SessionError as e:
        print("-" * 60)
        print(f"[ERROR] {e}")
        print("=" * 60)
        sys.exit(1)


if __name__ == "__main__":
    main()

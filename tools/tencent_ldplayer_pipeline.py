#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tencent Comic (ac.qq.com) 1-Click LDPlayer Automation Pipeline
==============================================================
Fully automated end-to-end pipeline:
  1. Controls / hides LDPlayer (supports 127.0.0.1:5555 / emulator-5554 / ldconsole.exe).
  2. Ensures Frida server is running and attaches to com.qq.ac.android.
  3. Dynamic TOC / Chapter List extraction from ac.qq.com HTML (maps chapter number -> cid).
  4. Multi-Chapter & Batch Automation (--chapters 22-25, --chapters 22,23,24, --all-pending).
  5. In-Process Intent navigation across chapters without restarting app or Frida session.
  6. Automated VIP Point Purchaser (auto-detects and taps '确认购买' to unlock paid chapters).
  7. Continuous Reader Scroll to Bottom (captures 100% of all raw slices via HTTP/2 & Cipher Decrypt).
  8. Parallel Image Downloader (10 Workers) with Referer: https://ac.qq.com/.
  9. Stitches slices on Continuous Virtual Canvas and divides into exactly 20 standard pages (001.jpg - 020.jpg).
 10. Uploads to Google Drive folder "แปลจนเมื่อย / {manga_name} / {chapter}" via GAS.
 11. Registers / updates GAS WorkQueue according to strict rules:
       - worklink: [อัป Raw] https://drive.google.com/drive/folders/...
       - uploadstatus: เสร็จแล้ว
       - uploadername: Apt
 12. Safe Cool-down between chapters (default 20s with live countdown).
"""

import argparse
import base64
import ctypes
import gzip
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from PIL import Image

# Force UTF-8 on Windows terminal
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ID = "com.qq.ac.android"
REMOTE_BIN = "/data/local/tmp/fsd"
DEFAULT_FRIDA_PORT = 27042
GAS_URL = os.environ.get(
    "GAS_URL",
    "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
)
GAS_PASSCODE = os.environ.get("PASSCODE", "10211032")

ADB_CANDIDATES = [
    r"C:\LDPlayer\LDPlayer9\adb.exe",
    r"C:\LDPlayer\LDPlayer5\adb.exe",
    r"C:\LDPlayer\LDPlayer4\adb.exe",
    "adb",
]


LATEST_LOG_FILE = REPO_ROOT / "test_output" / "tencent_1click_latest.log"


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] [TencentPipeline] {msg}"
    print(line, flush=True)
    try:
        LATEST_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LATEST_LOG_FILE, "a", encoding="utf-8", errors="ignore") as f:
            f.write(line + "\n")
    except Exception:
        pass


def find_tool(candidates: list, fallback: str) -> str:
    for cand in candidates:
        if cand == "adb":
            try:
                subprocess.run([cand, "version"], capture_output=True, timeout=5, check=False)
                return cand
            except Exception:
                continue
        if Path(cand).exists():
            return cand
    return fallback


def adb_command(adb_path: str, serial: str, *args, check: bool = False, timeout: int = 30) -> str:
    cmd = [adb_path] + (["-s", serial] if serial else []) + list(args)
    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=timeout
        )
        if check and res.returncode != 0:
            raise RuntimeError(f"adb {' '.join(args)} failed: {res.stderr.strip() or res.stdout.strip()}")
        return res.stdout.strip()
    except Exception as e:
        if check:
            raise
        return ""


LDCONSOLE_CANDIDATES = [
    r"C:\LDPlayer\LDPlayer9\ldconsole.exe",
    r"C:\LDPlayer\LDPlayer5\ldconsole.exe",
    r"C:\LDPlayer\LDPlayer4\ldconsole.exe",
]


def pick_adb_device(adb_path: str, auto_launch: bool = True, hide: bool = False) -> str:
    out = subprocess.run(
        [adb_path, "devices"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=10
    ).stdout
    serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
    if serials:
        return serials[0]
    subprocess.run([adb_path, "connect", "127.0.0.1:5555"], capture_output=True, text=True, timeout=10)
    out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=10).stdout
    serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
    if serials:
        return serials[0]

    # Auto-launch LDPlayer if not running
    if auto_launch:
        ldconsole = find_tool(LDCONSOLE_CANDIDATES, "")
        if ldconsole and Path(ldconsole).exists():
            log(f"🔄 No active ADB device found. Auto-launching LDPlayer via {ldconsole}...")
            try:
                subprocess.run([ldconsole, "launch", "--index", "0"], capture_output=True, timeout=15)
            except Exception as e:
                log(f"   ⚠️ ldconsole launch notice: {e}")
            for wait_i in range(24):
                time.sleep(3.0)
                if hide:
                    hide_ldplayer_window()
                subprocess.run([adb_path, "connect", "127.0.0.1:5555"], capture_output=True, text=True, timeout=8)
                out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=8).stdout
                serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
                if serials:
                    boot = adb_command(adb_path, serials[0], "shell", "getprop sys.boot_completed")
                    if boot.strip() == "1":
                        log(f"   ✅ LDPlayer booted and connected: {serials[0]}")
                        time.sleep(2.0)
                        return serials[0]
    return ""


def hide_ldplayer_window():
    """Hides or minimizes LDPlayer emulator window on Windows."""
    try:
        user32 = ctypes.windll.user32
        def enum_cb(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value.lower()
                    if "ldplayer" in title or "dnplayer" in title:
                        user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
            return True
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(CB(enum_cb), 0)
        log("LDPlayer window minimized/hidden.")
    except Exception as e:
        log(f"Window control notice: {e}")


def ensure_frida_server(adb_path: str, serial: str, port: int):
    ps = adb_command(adb_path, serial, "shell", "ps -A 2>/dev/null | grep fsd")
    if "fsd" in ps:
        adb_command(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
        return

    out = adb_command(adb_path, serial, "shell", f"ls {REMOTE_BIN} 2>/dev/null")
    if not out:
        cand_server = REPO_ROOT / "tools" / "frida-server16"
        if not cand_server.exists():
            log(f"ERROR: Local frida-server not found at {cand_server}")
            sys.exit(1)
        log(f"Pushing frida-server -> {REMOTE_BIN}")
        adb_command(adb_path, serial, "push", str(cand_server), REMOTE_BIN, check=True, timeout=300)

    adb_command(adb_path, serial, "shell", f"chmod 755 {REMOTE_BIN}")
    adb_command(adb_path, serial, "shell", "pkill -f fsd 2>/dev/null; true")
    time.sleep(0.5)

    start_cmd = f"nohup {REMOTE_BIN} -l 127.0.0.1:{port} >/dev/null 2>&1 &"
    adb_command(adb_path, serial, "shell", f'su -c "{start_cmd}" 2>&1')
    time.sleep(1.5)

    adb_command(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
    log(f"Frida server active & port forwarded: 127.0.0.1:{port}")


def clean_image_url(url: str) -> str:
    clean = url.replace(r"\/", "/")
    clean = re.sub(r"\?tp=avif.*$", "", clean)
    clean = re.sub(r"\?tp=.*$", "", clean)
    return clean


def extract_image_urls(obj) -> list:
    urls = []
    def _walk(item):
        if isinstance(item, dict):
            if "picture" in item and isinstance(item["picture"], list):
                for pic in item["picture"]:
                    if isinstance(pic, dict) and "url" in pic:
                        u = clean_image_url(pic["url"])
                        if u and u not in urls: urls.append(u)
                    elif isinstance(pic, str):
                        u = clean_image_url(pic)
                        if u and u not in urls: urls.append(u)
            for v in item.values():
                _walk(v)
        elif isinstance(item, list):
            for elem in item:
                _walk(elem)
        elif isinstance(item, str):
            clean = clean_image_url(item)
            if "manhua.acimg.cn" in clean and clean.startswith("http"):
                if clean not in urls: urls.append(clean)
    _walk(obj)
    return urls


def extract_slice_seq(url: str) -> int:
    """Extract numeric sequence ID from Tencent manga slice URL (e.g. _136483372.jpg)."""
    m = re.search(r"_(\d+)\.(?:jpg|jpeg|png|webp)", url, re.IGNORECASE)
    if m:
        return int(m.group(1))
    m2 = re.search(r"(\d+)\.(?:jpg|jpeg|png|webp)", url, re.IGNORECASE)
    if m2:
        return int(m2.group(1))
    return 0


def sort_slice_urls(urls: list) -> list:
    """
    Sorts Tencent slice URLs by the numeric sequence ID at the end of the filename
    before .jpg to guarantee correct top-to-bottom reading order.
    """
    if not urls:
        return []
    unique_urls = list(dict.fromkeys(urls))
    has_seq = any(re.search(r"_(\d+)\.(?:jpg|jpeg|png|webp)", u, re.IGNORECASE) for u in unique_urls)
    if has_seq:
        sorted_urls = sorted(unique_urls, key=extract_slice_seq)
        first_seq = extract_slice_seq(sorted_urls[0])
        last_seq = extract_slice_seq(sorted_urls[-1])
        log(f"🔢 sort_slice_urls: Sorted {len(sorted_urls)} slices by Sequence ID ({first_seq} -> {last_seq})")
        return sorted_urls
    return unique_urls


def extract_urls_from_image_info_list(file_path_or_bytes) -> list:
    """
    Extracts clean JPEG CDN URLs from Tencent _image_info_list in exact canonical localIndex order.
    Guarantees 100% correct top-to-bottom reading sequence without sequence ID inversions.
    """
    if isinstance(file_path_or_bytes, (str, Path)):
        with open(file_path_or_bytes, "rb") as f:
            raw = f.read()
    else:
        raw = bytes(file_path_or_bytes)

    try:
        decoded = base64.b64decode(raw)
        data = json.loads(decoded[16:].decode("utf-8"))
    except Exception:
        idx = raw.find(b"{")
        if idx != -1:
            data = json.loads(raw[idx:].decode("utf-8", errors="ignore"))
        else:
            raise ValueError("Unable to parse _image_info_list payload")

    items = []
    if isinstance(data, dict):
        items = data.get("data", []) or data.get("picture", []) or data.get("pictures", [])
    elif isinstance(data, list):
        items = data

    def _get_idx(x):
        try:
            return int(x.get("localIndex", 0))
        except Exception:
            return 0

    items.sort(key=_get_idx)

    ordered_urls = []
    for it in items:
        if isinstance(it, dict):
            u = it.get("current_img_url") or it.get("url") or it.get("img_url") or it.get("pic_url")
            if u:
                u = re.sub(r"\?.*$", "", u)
                if not u.endswith("/1200") and not u.endswith((".jpg", ".jpeg")):
                    u = u + "/1200"
                ordered_urls.append(u)

    return ordered_urls


def check_offline_image_info_list(adb_path: str, serial: str, comic_id: str, chapter_id: str) -> list:
    """
    Checks if LDPlayer has _image_info_list in /sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/
    If found, pulls it and returns the canonical ordered URLs.
    """
    remote_path = f"/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/_image_info_list"
    local_temp = REPO_ROOT / "scratch" / "tencent_dl" / f"{comic_id}_{chapter_id}_image_info_list"
    local_temp.parent.mkdir(parents=True, exist_ok=True)

    check = adb_command(adb_path, serial, "shell", f"ls {remote_path} 2>/dev/null")
    if check and "_image_info_list" in check:
        log(f"📥 Found offline _image_info_list on LDPlayer: {remote_path}")
        adb_command(adb_path, serial, "pull", remote_path, str(local_temp))
        if local_temp.exists() and local_temp.stat().st_size > 0:
            urls = extract_urls_from_image_info_list(local_temp)
            log(f"✨ Extracted {len(urls)} canonical slices from offline _image_info_list for Ch {chapter_id}!")
            return urls
    return []


def check_offline_chapter_dir(adb_path: str, serial: str, comic_id: str, chapter_id: str) -> dict:
    """
    Inspects the on-device offline chapter folder WITHOUT writing to Windows.
    Returns dict: {'exists': bool, 'has_info': bool, 'info_age': float|None, 'files': int}
    Used as a secondary progress signal while the Tencent engine writes _image_info_list.
    """
    chapter_dir = f"/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}"
    out = adb_command(
        adb_path, serial, "shell",
        "cd /sdcard/Android/data/com.qq.ac.android/files/comics/{cid}/{ch} 2>/dev/null && "
        "echo FILES=$(ls | wc -l) && "
        "echo HASINFO=$(ls _image_info_list 2>/dev/null | wc -l) && "
        "echo AGE=$(date +%s -r _image_info_list 2>/dev/null || echo 0) && "
        "echo NOW=$(date +%s)".format(cid=comic_id, ch=chapter_id)
    )
    res = {"exists": False, "has_info": False, "info_age": None, "files": 0}
    if not out or "FILES=" not in out:
        return res
    res["exists"] = True
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("FILES="):
            try:
                res["files"] = int(line.split("=", 1)[1])
            except ValueError:
                pass
        elif line.startswith("HASINFO="):
            res["has_info"] = line.split("=", 1)[1].strip() == "1"
        elif line.startswith("AGE=") and line.startswith("NOW="):
            continue
    try:
        m_age = re.search(r"AGE=(\d+)", out)
        m_now = re.search(r"NOW=(\d+)", out)
        if res["has_info"] and m_age and m_now:
            res["info_age"] = max(0, int(m_now.group(1)) - int(m_age.group(1)))
    except Exception:
        pass
    return res


DOWNLOAD_POLL_INTERVAL = 2.0          # seconds between polls
DEFAULT_DOWNLOAD_POLL_WINDOW = 90.0   # soft window (when --timeout is smaller)
DOWNLOAD_HARD_TIMEOUT = 240.0         # hard ceiling for a single attempt


def check_download_manager_chapter_status(adb_path: str, serial: str, target_seq: str, alt_seq: str = "") -> str:
    """
    Dumps the current DownloadManagerActivity (离线下载 manager) UI and classifies the target chapter row:
      'completed' -> row visible and marked finished ('已完成' / '下载完成' / '100%' / '已下载'),
                     or row visible on DownloadManagerActivity with NO active progress/pause text
      'progress'  -> row visible and still downloading (percentage / pause / waiting text)
      'missing'   -> manager screen not shown, or target chapter not visible
    """
    xml = adb_command(
        adb_path, serial, "shell",
        "uiautomator dump /data/local/tmp/dm_status.xml >/dev/null 2>&1 && cat /data/local/tmp/dm_status.xml"
    )
    if not xml:
        return "missing"
    on_dm = any(k in xml for k in ["tv_actionbar_edit", "添加更多集数", "secendbar_container", "progress_bar"])
    if not on_dm:
        return "missing"

    # Build strict target sequence set from target_seq ONLY when target_seq is present,
    # because DownloadManagerActivity rows ALWAYS display the 1-based sequence number (seq_no),
    # and matching alt_seq (chapter_num) when a prologue exists can match the wrong neighbor row!
    seqs = set()
    primary_s = str(target_seq).strip()
    if primary_s:
        seqs.add(primary_s)
        if primary_s.isdigit():
            seqs.add(str(int(primary_s)))
    elif alt_seq:
        alt_s = str(alt_seq).strip()
        if alt_s:
            seqs.add(alt_s)
            if alt_s.isdigit():
                seqs.add(str(int(alt_s)))

    completed_words = ["已完成", "下载完成", "已下载", "100%"]
    progress_words = ["下载中", "等待中", "暂停", "%"]

    # Try structured XML row inspection first so we don't bleed across sibling rows
    try:
        tree = ET.fromstring(xml)
        for row_node in tree.iter("node"):
            # Inspect ListView / RecyclerView item containers that hold a 'seq' child within 2 levels
            direct_seq = None
            for child in row_node:
                if child.attrib.get("resource-id") == "com.qq.ac.android:id/seq":
                    direct_seq = child.attrib.get("text", "").strip()
                    break
                for sub in child:
                    if sub.attrib.get("resource-id") == "com.qq.ac.android:id/seq":
                        direct_seq = sub.attrib.get("text", "").strip()
                        break
            if direct_seq and (direct_seq in seqs or (direct_seq.isdigit() and str(int(direct_seq)) in seqs)):
                row_xml = ET.tostring(row_node, encoding="unicode")
                if any(w in row_xml for w in completed_words):
                    return "completed"
                if any(w in row_xml for w in progress_words):
                    return "progress"
                return "completed"
    except Exception:
        pass

    # Fallback: regex chunk around 'seq' node
    for pattern in (
        r'resource-id="com\.qq\.ac\.android:id/seq"[^>]*text="([^"]*)"',
        r'text="([^"]*)"[^>]*resource-id="com\.qq\.ac\.android:id/seq"',
    ):
        for m in re.finditer(pattern, xml):
            val = m.group(1).strip()
            if val in seqs or (val.isdigit() and str(int(val)) in seqs):
                row_start = max(0, m.start() - 500)
                row_end = min(len(xml), m.end() + 500)
                chunk = xml[row_start:row_end]
                if any(w in chunk for w in completed_words):
                    return "completed"
                if any(w in chunk for w in progress_words):
                    return "progress"
                return "completed"
    return "missing"


def pull_offline_raw_to_windows(adb_path: str, serial: str, comic_id: str, chapter_id: str):
    """Pulls all raw downloaded slices and _image_info_list from LDPlayer directly into Windows folder."""
    try:
        dest_dir = REPO_ROOT / "downloads" / "offline_raw" / f"{comic_id}_{chapter_id}"
        dest_dir.mkdir(parents=True, exist_ok=True)
        device_dir = f"/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}"
        adb_command(adb_path, serial, "pull", f"{device_dir}/.", str(dest_dir))
        log(f"   💾 Exported raw offline slices to Windows -> {dest_dir}")
    except Exception as e:
        log(f"   ⚠️ Export raw slices notice: {e}")


def find_chapter_seq_coords(xml_text: str, target_seq: str, alt_seq: str = ""):
    """
    Finds center (x, y) coordinates of target chapter sequence number in DownloadChapterSelectActivity.
    NOTE: DownloadChapterSelectActivity grid cells ALWAYS display the 1-based sequential order (`seq_no` = 1..N).
    When `target_seq` is provided, we match ONLY `target_seq` so we NEVER accidentally click `alt_seq`
    (which equals `target_seq - 1` on comics with a prologue) while `target_seq` is scrolled off-screen!
    Returns (found_coord, min_seq, max_seq, is_reversed).
    """
    matches = re.findall(r'text="([^"]+)"[^>]*resource-id="com.qq.ac.android:id/seq"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_text)
    if not matches:
        raw_m = re.findall(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*resource-id="com.qq.ac.android:id/seq"[^>]*text="([^"]+)"', xml_text)
        matches = [(seq, x1, y1, x2, y2) for (x1, y1, x2, y2, seq) in raw_m]

    seq_nums = []
    found_coord = None
    alt_coord = None
    t_clean = str(target_seq).strip()
    a_clean = str(alt_seq).strip()

    for seq, x1, y1, x2, y2 in matches:
        clean_seq = seq.strip()
        if clean_seq.isdigit():
            seq_nums.append(int(clean_seq))
        cx = (int(x1) + int(x2)) // 2
        cy = (int(y1) + int(y2)) // 2
        if t_clean and (clean_seq == t_clean or (clean_seq.isdigit() and t_clean.isdigit() and int(clean_seq) == int(t_clean))):
            found_coord = (cx, cy)
        elif not t_clean and a_clean and (clean_seq == a_clean or (clean_seq.isdigit() and a_clean.isdigit() and int(clean_seq) == int(a_clean))):
            alt_coord = (cx, cy)

    min_seq = min(seq_nums) if seq_nums else 0
    max_seq = max(seq_nums) if seq_nums else 0
    is_reversed = "正序" in xml_text or (len(seq_nums) >= 2 and seq_nums[0] > seq_nums[-1])
    return (found_coord if t_clean else alt_coord), min_seq, max_seq, is_reversed


def find_node_center_by_id_or_text(xml_text: str, resource_ids=(), texts=(), default_coord=None, default=None):
    """
    Safely extracts the center (cx, cy) of the first XML node matching any resource-id suffix
    in `resource_ids` or exact text in `texts`, regardless of uiautomator attribute ordering.
    """
    fallback = default_coord if default_coord is not None else default
    if not xml_text:
        return fallback
    try:
        tree = ET.fromstring(xml_text)
        for n in tree.iter("node"):
            rid = n.attrib.get("resource-id", "")
            txt = n.attrib.get("text", "").strip()
            matched_id = any(rid.endswith(r) or rid == r for r in resource_ids) if resource_ids else False
            matched_txt = (txt in texts) if texts else False
            if matched_id or matched_txt:
                nums = re.findall(r"\d+", n.attrib.get("bounds", ""))
                if len(nums) == 4:
                    return ((int(nums[0]) + int(nums[2])) // 2, (int(nums[1]) + int(nums[3])) // 2)
    except Exception:
        pass
    for r in resource_ids:
        for pat in (
            rf'resource-id="[^"]*{re.escape(r)}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
            rf'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*resource-id="[^"]*{re.escape(r)}"',
        ):
            m = re.search(pat, xml_text)
            if m:
                return ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    for t in texts:
        for pat in (
            rf'text="{re.escape(t)}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
            rf'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*text="{re.escape(t)}"',
        ):
            m = re.search(pat, xml_text)
            if m:
                return ((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
    return fallback


def get_download_selected_count(xml_text: str) -> int:
    """
    Parses the number of currently selected chapters from DownloadChapterSelectActivity UI.
    Matches text like '已选择0话', '已选择1话', '已选择89话'.
    Returns count as int, or -1 if not found.
    """
    if not xml_text:
        return -1
    m = re.search(r'已选择(\d+)话', xml_text)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return -1
    return -1


def ensure_clear_selection(adb_path: str, serial: str, max_retries: int = 7) -> bool:
    """
    Ensures that no chapters are selected in DownloadChapterSelectActivity (count == 0).
    Handles Teen Mode modal ('青少年守护模式'), loading placeholders ('placeholder_loading'),
    Tencent Comic's automatic 'Smart Selection' (智能选择: 放弃智能选择) and toggles.
    """
    for attempt in range(max_retries):
        xml = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
        )
        if not xml:
            time.sleep(0.5)
            continue

        # Handle Teen Mode modal ('青少年守护模式' -> '我知道了' / sure_btn)
        if "青少年守护模式" in xml or "我知道了" in xml or "sure_btn" in xml:
            pt = find_node_center_by_id_or_text(xml, resource_ids=("sure_btn", "close_btn"), texts=("我知道了",), default_coord=(557, 957))
            log(f"   🛡️ Teen Mode modal detected in ensure_clear_selection; dismissing at {pt}...")
            adb_command(adb_path, serial, "shell", f"input tap {pt[0]} {pt[1]}")
            time.sleep(1.0)
            continue

        # Handle captcha / verify page if it popped up
        if "VerifyCodePage" in xml or "安全验证" in xml or "请控制拼图块" in xml:
            log("   ⚠️ VerifyCodePage detected on screen, pressing back...")
            adb_command(adb_path, serial, "shell", "input keyevent 4")
            time.sleep(1.0)
            continue

        # Wait if chapter list is still loading
        if "placeholder_loading" in xml and 'resource-id="com.qq.ac.android:id/seq"' not in xml:
            log("   ⏳ Chapter list still loading (placeholder_loading); waiting 1.2s...")
            time.sleep(1.2)
            continue

        count = get_download_selected_count(xml)
        if count == 0:
            log("   ✨ Selection is verified completely clear (已选择0话).")
            return True

        # Case 1: Smart selection active -> tap '放弃智能选择' (auto_deselect)
        if "auto_deselect" in xml or "放弃智能选择" in xml:
            log(f"   🧹 Smart selection active (已选择{count}话). Tapping '放弃智能选择' (auto_deselect)...")
            pt = find_node_center_by_id_or_text(xml, resource_ids=("auto_deselect",), texts=("放弃智能选择",), default_coord=(822, 135))
            adb_command(adb_path, serial, "shell", f"input tap {pt[0]} {pt[1]}")
            time.sleep(1.0)
            continue

        # Case 2: Chapters selected -> tap '取消全选' or toggle '全选' via dynamic container_select bounds
        if "取消全选" in xml:
            pt = find_node_center_by_id_or_text(xml, resource_ids=("container_select", "select_btn"), texts=("取消全选",), default_coord=(224, 1520))
            log(f"   🧹 Tapping '取消全选' (container_select at {pt}) to deselect all (currently {count} selected)...")
            adb_command(adb_path, serial, "shell", f"input tap {pt[0]} {pt[1]}")
            time.sleep(1.0)
            continue
        elif "全选" in xml and count > 0:
            pt = find_node_center_by_id_or_text(xml, resource_ids=("container_select", "select_btn"), texts=("全选",), default_coord=(224, 1520))
            log(f"   🧹 Chapters selected ({count}话) without auto_deselect. Tapping '全选' at {pt} to toggle...")
            adb_command(adb_path, serial, "shell", f"input tap {pt[0]} {pt[1]}")
            time.sleep(1.0)
            continue

        time.sleep(0.5)

    # Final check
    xml_final = adb_command(
        adb_path, serial, "shell",
        "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
    )
    final_count = get_download_selected_count(xml_final)
    return final_count == 0


def auto_clear_download_history_for_comic(adb_path: str, serial: str, manga_name: str) -> bool:
    """
    1-Click Auto-Recovery: Opens MyDownloadActivity ('我的' -> '离线下载'), finds manga_name,
    taps '编辑', checks the comic's delete checkbox, taps '删除', confirms dialog,
    and taps '完成' to exit edit mode.
    Resets stuck/already-downloaded chapter states (removes green download icon ⬇️)
    allowing 1-click re-selection and download without manual user intervention.
    """
    if not manga_name:
        return False
    log(f"   🧹 [Auto-Recovery] Clearing download history for '{manga_name}' in MyDownloadActivity...")
    try:
        # Launch MyDownloadActivity
        adb_command(adb_path, serial, "shell", "su 0 am start -n com.qq.ac.android/.view.activity.MyDownloadActivity")
        time.sleep(1.5)

        xml = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/mydl.xml >/dev/null 2>&1 && cat /data/local/tmp/mydl.xml"
        )
        if not xml or manga_name not in xml:
            log(f"   ℹ️ '{manga_name}' not found in MyDownloadActivity. (Already clean)")
            return True

        # 1. Tap "编辑" (btn_edit at [832, 53][876, 84])
        m_edit = re.search(r'resource-id="[^"]*btn_edit"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
        if m_edit:
            cx = (int(m_edit.group(1)) + int(m_edit.group(3))) // 2
            cy = (int(m_edit.group(2)) + int(m_edit.group(4))) // 2
            adb_command(adb_path, serial, "shell", f"input tap {cx} {cy}")
        else:
            adb_command(adb_path, serial, "shell", "input tap 854 68")
        time.sleep(1.0)

        # 2. In Edit mode, find checkbox closest to manga_name Y-coords
        xml_edit = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/mydl_edit.xml >/dev/null 2>&1 && cat /data/local/tmp/mydl_edit.xml"
        )
        if not xml_edit:
            return False

        # Locate Y coordinate of manga_name
        target_y = None
        try:
            tree_edit = ET.fromstring(xml_edit)
            for n in tree_edit.iter('node'):
                if manga_name in n.attrib.get('text', ''):
                    m = re.findall(r'\d+', n.attrib.get('bounds', ''))
                    if len(m) == 4:
                        target_y = (int(m[1]) + int(m[3])) // 2
                        break
        except Exception:
            pass

        if target_y is None:
            m_text = re.search(rf'text="[^"]*{re.escape(manga_name)}[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_edit)
            if m_text:
                target_y = (int(m_text.group(2)) + int(m_text.group(4))) // 2

        # Find delete_select_icon closest to target_y
        best_cb = None
        min_dist = 9999
        if target_y is not None:
            try:
                tree_edit = ET.fromstring(xml_edit)
                for n in tree_edit.iter('node'):
                    if n.attrib.get('resource-id') == 'com.qq.ac.android:id/delete_select_icon':
                        m = re.findall(r'\d+', n.attrib.get('bounds', ''))
                        if len(m) == 4:
                            cy = (int(m[1]) + int(m[3])) // 2
                            dist = abs(cy - target_y)
                            if dist < min_dist and dist < 120:
                                min_dist = dist
                                best_cb = ((int(m[0]) + int(m[2])) // 2, cy)
            except Exception:
                pass

        if best_cb:
            adb_command(adb_path, serial, "shell", f"input tap {best_cb[0]} {best_cb[1]}")
        elif target_y is not None:
            adb_command(adb_path, serial, "shell", f"input tap 57 {target_y}")
        else:
            log(f"   ⚠️ Could not pinpoint Y-coords for '{manga_name}', exiting edit mode...")
            adb_command(adb_path, serial, "shell", "input tap 854 68")
            return False
        time.sleep(0.8)

        # 3. Tap "删除" (delete_text or delete_button)
        m_del = re.search(r'resource-id="[^"]*delete_text"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_edit)
        if m_del:
            cx = (int(m_del.group(1)) + int(m_del.group(3))) // 2
            cy = (int(m_del.group(2)) + int(m_del.group(4))) // 2
            adb_command(adb_path, serial, "shell", f"input tap {cx} {cy}")
        else:
            adb_command(adb_path, serial, "shell", "input tap 695 1555")
        time.sleep(1.0)

        # 4. Confirm delete dialog ("确定", "是的", "删除", positive_btn)
        xml_dlg = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/mydl_dlg.xml >/dev/null 2>&1 && cat /data/local/tmp/mydl_dlg.xml"
        )
        if xml_dlg and any(k in xml_dlg for k in ["确定", "是的", "删除", "positive_btn"]):
            m_pos = re.search(r'resource-id="[^"]*positive_btn"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_dlg)
            if m_pos:
                cx = (int(m_pos.group(1)) + int(m_pos.group(3))) // 2
                cy = (int(m_pos.group(2)) + int(m_pos.group(4))) // 2
                adb_command(adb_path, serial, "shell", f"input tap {cx} {cy}")
            else:
                adb_command(adb_path, serial, "shell", "input tap 660 880")
            time.sleep(1.2)

        # 5. Exit Edit mode ("完成") if still open
        xml_post = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/mydl_post.xml >/dev/null 2>&1 && cat /data/local/tmp/mydl_post.xml"
        )
        if xml_post and "完成" in xml_post:
            adb_command(adb_path, serial, "shell", "input tap 854 68")
            time.sleep(0.8)

        # Also dismiss MyDownloadActivity to return clean
        adb_command(adb_path, serial, "shell", "input keyevent 4")
        time.sleep(0.5)

        log(f"   ✅ [Auto-Recovery] Cleaned '{manga_name}' from Download Manager successfully.")
        return True
    except Exception as e:
        log(f"   ⚠️ [Auto-Recovery] Notice during clean: {e}")
        return False


def find_any_selectable_chapter_coords(xml_text: str, exclude_seq: str = "") -> tuple:
    """
    Finds coordinates of chapters in DownloadChapterSelectActivity that can be selected
    to trigger entry into DownloadManagerActivity.
    Separates into:
      - free_clean: chapters without 'state_icon' (not downloaded ⬇️) and without 'tips' ('用券')
      - paid_clean: chapters without 'state_icon' (not downloaded ⬇️)
      - fallback: any other visible chapter on screen
    Returns (free_clean, paid_clean, fallback) where each item is (cx, cy, seq_str).
    """
    free_clean = []
    paid_clean = []
    fallback = []
    ex_clean = str(exclude_seq).strip()

    if not xml_text:
        return free_clean, paid_clean, fallback

    try:
        tree = ET.fromstring(xml_text)
        for item_node in tree.iter("node"):
            rid = item_node.attrib.get("resource-id", "")
            if rid in (
                "com.qq.ac.android:id/item_first",
                "com.qq.ac.android:id/item_second",
                "com.qq.ac.android:id/item_third",
            ):
                seq_node = None
                has_state_icon = False
                has_tips = False
                for child in item_node.iter("node"):
                    crid = child.attrib.get("resource-id", "")
                    if crid == "com.qq.ac.android:id/seq":
                        seq_node = child
                    elif crid == "com.qq.ac.android:id/state_icon":
                        has_state_icon = True
                    elif crid == "com.qq.ac.android:id/tips":
                        has_tips = True

                if seq_node is not None:
                    seq_str = seq_node.attrib.get("text", "").strip()
                    nums = re.findall(r"\d+", seq_node.attrib.get("bounds", ""))
                    if len(nums) == 4:
                        cx = (int(nums[0]) + int(nums[2])) // 2
                        cy = (int(nums[1]) + int(nums[3])) // 2
                        entry = (cx, cy, seq_str)
                        if not has_state_icon and not has_tips and seq_str != ex_clean:
                            free_clean.append(entry)
                        elif not has_state_icon and seq_str != ex_clean:
                            paid_clean.append(entry)
                        else:
                            fallback.append(entry)
    except Exception:
        matches = re.findall(
            r'text="([^"]+)"[^>]*resource-id="com.qq.ac.android:id/seq"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
            xml_text,
        )
        for seq_str, x1, y1, x2, y2 in matches:
            s_clean = seq_str.strip()
            cx = (int(x1) + int(x2)) // 2
            cy = (int(y1) + int(y2)) // 2
            if s_clean != ex_clean:
                paid_clean.append((cx, cy, s_clean))
            else:
                fallback.append((cx, cy, s_clean))

    return free_clean, paid_clean, fallback


def search_and_tap_target_chapter(
    adb_path: str,
    serial: str,
    target_seq: str,
    alt_seq: str = "",
    max_attempts: int = 18
) -> bool:
    """
    Searches for target_seq / alt_seq in DownloadChapterSelectActivity (handling sequence
    order toggle and scrolling) and taps it when found.
    """
    prev_range = None
    stagnant_scrolls = 0
    for attempt in range(max_attempts):
        xml = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
        )
        if xml and ("placeholder_loading" in xml or "正在加载" in xml):
            time.sleep(1.2)
            xml = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
            )

        coords, min_seq, max_seq, is_reversed = find_chapter_seq_coords(xml, target_seq, alt_seq)

        if coords:
            log(f"   🎯 Found Chapter target={target_seq}/alt={alt_seq} at screen {coords}. Selecting...")
            adb_command(adb_path, serial, "shell", f"input tap {coords[0]} {coords[1]}")
            time.sleep(0.8)
            return True

        # Check if toggling sequence order helps on first attempt
        if attempt == 0 and target_seq.isdigit():
            t_val = int(target_seq)
            seq_x, seq_y = find_node_center_by_id_or_text(
                xml, resource_ids=["btn_sequence"], texts=["正序", "倒序"], default=(855, 130)
            )
            if not is_reversed and t_val > 15:
                log(f"   🔄 Toggling to descending order (倒序) for target Ch {target_seq}...")
                adb_command(adb_path, serial, "shell", f"input tap {seq_x} {seq_y}")
                time.sleep(1.0)
                continue
            elif is_reversed and t_val <= min_seq:
                log(f"   🔄 Toggling to ascending order (正序) for target Ch {target_seq}...")
                adb_command(adb_path, serial, "shell", f"input tap {seq_x} {seq_y}")
                time.sleep(1.0)
                continue

        # Detect stagnant scroll range (e.g. hit top or bottom of listview)
        cur_range = (min_seq, max_seq, is_reversed)
        if cur_range == prev_range and min_seq != 999999:
            stagnant_scrolls += 1
        else:
            stagnant_scrolls = 0
        prev_range = cur_range

        if stagnant_scrolls >= 2:
            seq_x, seq_y = find_node_center_by_id_or_text(
                xml, resource_ids=["btn_sequence"], texts=["正序", "倒序"], default=(855, 130)
            )
            log(f"   🔄 Scroll range stagnant at [{min_seq}..{max_seq}]; toggling sequence order at ({seq_x}, {seq_y})...")
            adb_command(adb_path, serial, "shell", f"input tap {seq_x} {seq_y}")
            stagnant_scrolls = 0
            time.sleep(1.0)
            continue

        # If still not found, scroll the listview
        if target_seq.isdigit():
            t_val = int(target_seq)
            if (is_reversed and t_val < min_seq) or (not is_reversed and t_val > max_seq):
                log(f"   📜 Scrolling listview downward to find Ch {target_seq} (visible: {min_seq}..{max_seq})...")
                adb_command(adb_path, serial, "shell", "input swipe 450 1150 450 300 280")
            else:
                log(f"   📜 Scrolling listview upward to find Ch {target_seq} (visible: {min_seq}..{max_seq})...")
                adb_command(adb_path, serial, "shell", "input swipe 450 300 450 1150 280")
            time.sleep(1.0)

    return False


def recover_download_via_pencil_delete_all(
    adb_path: str,
    serial: str,
    comic_id: str,
    script=None,
    exclude_seq: str = "",
    manga_name: str = ""
) -> bool:
    """
    1-Click Download Failure Recovery Workflow (per User Specification):
      1. If on DownloadChapterSelectActivity (or not yet on DownloadManagerActivity with items),
         select ANY available chapter (at least 1 chapter) and tap Download ('下载所选')
         to navigate directly into the comic's DownloadManagerActivity queue screen.
      2. Tap the Pencil / Edit icon ('รูปดินสอ' / tv_actionbar_edit) at top-right [853,54][883,84].
      3. Tap Select All ('เลือกทั้งหมด' / '全选' / select_container) at bottom-left [0,1502][449,1600].
      4. Tap Delete ('ลบออก' / '删除' / delete_container) at bottom-right [450,1502][900,1600]
         and confirm the delete dialog ('是的' / positive_btn).
      5. Tap '添加更多集数' (secendbar_container) to return to DownloadChapterSelectActivity
         so the target 1 chapter can be cleanly selected and downloaded again.
    """
    log("   🛠️ [1-Click Recovery] Starting Dummy-Select -> Pencil -> Select All -> Delete All recovery flow...")
    try:
        xml = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
        )

        # Check if we are already on DownloadManagerActivity with at least 1 chapter row
        on_dm_screen = bool(xml and ("tv_actionbar_edit" in xml or "添加更多集数" in xml or "secendbar_container" in xml))
        dm_has_items = bool(on_dm_screen and ("progress_bar" in xml or 'resource-id="com.qq.ac.android:id/seq"' in xml))

        # Direct launch: open DownloadManagerActivity directly via intent with CLEAR_TOP | CLEAR_TASK (-f 0x14008000)
        if not on_dm_screen:
            log(f"   🔄 [1-Click Recovery] Launching DownloadManagerActivity directly for Comic {comic_id}...")
            adb_command(
                adb_path, serial, "shell",
                f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadManagerActivity --es STR_MSG_COMIC_ID {comic_id}"
            )
            time.sleep(1.8)
            xml = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
            )
            if "VerifyCodePage" in xml or "安全验证" in xml or "请控制拼图块" in xml:
                log("   ⚠️ [1-Click Recovery] VerifyCodePage detected; pressing back to dismiss...")
                adb_command(adb_path, serial, "shell", "input keyevent 4")
                time.sleep(1.0)
                xml = adb_command(
                    adb_path, serial, "shell",
                    "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                )
            on_dm_screen = bool(xml and ("tv_actionbar_edit" in xml or "添加更多集数" in xml or "secendbar_container" in xml))
            dm_has_items = bool(on_dm_screen and ("progress_bar" in xml or 'resource-id="com.qq.ac.android:id/seq"' in xml))

        # If DownloadManagerActivity is already open for this comic and has 0 items, there is nothing stuck in DM queue!
        # Simply tap '添加更多集数' (secendbar_container) or re-open DownloadChapterSelectActivity without dummy download.
        if on_dm_screen and not dm_has_items:
            log(f"   ✅ [1-Click Recovery] DownloadManagerActivity for Comic {comic_id} is already empty (0 items). Returning to chapter selection...")
            if "secendbar_container" in xml or "添加更多集数" in xml:
                add_x, add_y = find_node_center_by_id_or_text(
                    xml, resource_ids=["secendbar_container"], texts=["添加更多集数"], default=(450, 136)
                )
                adb_command(adb_path, serial, "shell", f"input tap {add_x} {add_y}")
                time.sleep(1.5)
            else:
                try:
                    if script is not None:
                        script.exports_sync.opendlselect(str(comic_id))
                    else:
                        raise RuntimeError("No script")
                except Exception:
                    adb_command(
                        adb_path, serial, "shell",
                        f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadChapterSelectActivity --es STR_MSG_COMIC_ID {comic_id} --ei STR_MSG_FROM 1"
                    )
                time.sleep(1.8)
            return True

        on_select_screen = bool(xml and ("选择下载章节" in xml or "container_download" in xml or "download_btn" in xml))

        if not dm_has_items:
            # Ensure we are on DownloadChapterSelectActivity
            if not on_select_screen:
                log(f"   🔄 [1-Click Recovery] Opening DownloadChapterSelectActivity for Comic {comic_id}...")
                try:
                    if script is not None:
                        script.exports_sync.opendlselect(str(comic_id))
                    else:
                        raise RuntimeError("No script")
                except Exception:
                    adb_command(
                        adb_path, serial, "shell",
                        f"su 0 am start -n com.qq.ac.android/.view.activity.DownloadChapterSelectActivity --es STR_MSG_COMIC_ID {comic_id} --ei STR_MSG_FROM 1"
                    )
                time.sleep(2.0)
                xml = adb_command(
                    adb_path, serial, "shell",
                    "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                )

            # Clear mass selection if > 1 chapters are currently selected
            sel_count = get_download_selected_count(xml)
            if sel_count > 1:
                ensure_clear_selection(adb_path, serial)
                xml = adb_command(
                    adb_path, serial, "shell",
                    "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                )
                sel_count = get_download_selected_count(xml)

            # Select at least 1 available chapter to enter DownloadManagerActivity
            if sel_count < 1:
                free_clean, paid_clean, fallback = find_any_selectable_chapter_coords(xml, exclude_seq=exclude_seq)

                # If no free clean chapter is visible right now, flip to ascending order or scroll up to Ch 1
                if not free_clean:
                    if "正序" in xml:
                        log("   🔄 [1-Click Recovery] Toggling to ascending order (正序) to find free chapter...")
                        m_seq_btn = re.search(r'resource-id="[^"]*btn_sequence"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
                        sx = (int(m_seq_btn.group(1)) + int(m_seq_btn.group(3))) // 2 if m_seq_btn else 855
                        sy = (int(m_seq_btn.group(2)) + int(m_seq_btn.group(4))) // 2 if m_seq_btn else 130
                        adb_command(adb_path, serial, "shell", f"input tap {sx} {sy}")
                        time.sleep(1.0)
                    else:
                        log("   📜 [1-Click Recovery] Scrolling up to top chapters to select any 1 chapter...")
                        adb_command(adb_path, serial, "shell", "input swipe 450 350 450 1200 200")
                        time.sleep(1.0)

                    xml = adb_command(
                        adb_path, serial, "shell",
                        "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                    )
                    free_clean, paid_clean, fallback = find_any_selectable_chapter_coords(xml, exclude_seq=exclude_seq)

                candidates = free_clean + paid_clean + fallback
                for cx, cy, seq_str in candidates[:6]:
                    log(f"   🎯 [1-Click Recovery] Selecting dummy chapter #{seq_str} at ({cx}, {cy}) (need >= 1 chapter)...")
                    adb_command(adb_path, serial, "shell", f"input tap {cx} {cy}")
                    time.sleep(0.7)
                    xml_check = adb_command(
                        adb_path, serial, "shell",
                        "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                    )
                    sel_count = get_download_selected_count(xml_check)
                    if sel_count >= 1:
                        log(f"   ✅ [1-Click Recovery] Dummy selection active (已选择{sel_count}话).")
                        break

                # Fallback: tap '全选' if individual chapter taps still left count at 0
                if sel_count < 1:
                    log("   ☑️ [1-Click Recovery] Individual tap count still 0, tapping '全选' (224, 1550) to select available chapters...")
                    adb_command(adb_path, serial, "shell", "input tap 224 1550")
                    time.sleep(0.8)
                    xml_check = adb_command(
                        adb_path, serial, "shell",
                        "uiautomator dump /data/local/tmp/rec_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_ui.xml"
                    )
                    sel_count = get_download_selected_count(xml_check)

            if sel_count >= 1:
                log("   🚀 [1-Click Recovery] Tapping download button ('下载所选' at 675, 1550) to enter DownloadManagerActivity...")
                adb_command(adb_path, serial, "shell", "input tap 675 1550")
                time.sleep(1.0)

                # Confirm download dialog ('是的' / positive_btn) if shown
                xml_dlg = adb_command(
                    adb_path, serial, "shell",
                    "uiautomator dump /data/local/tmp/rec_dlg.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_dlg.xml"
                )
                if xml_dlg and any(k in xml_dlg for k in ["positive_btn", "确定下载", "是的", "预估共"]):
                    log("   ✅ [1-Click Recovery] Confirming download dialog ('是的')...")
                    m_pos = re.search(r'resource-id="[^"]*positive_btn"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml_dlg)
                    if m_pos:
                        px = (int(m_pos.group(1)) + int(m_pos.group(3))) // 2
                        py = (int(m_pos.group(2)) + int(m_pos.group(4))) // 2
                        adb_command(adb_path, serial, "shell", f"input tap {px} {py}")
                    else:
                        adb_command(adb_path, serial, "shell", "input tap 557 923")
                    time.sleep(1.2)

                handle_screen_dialogs(adb_path, serial, auto_buy=True)
            else:
                log("   ⚠️ [1-Click Recovery] Could not select any chapter in DownloadChapterSelectActivity; trying MyDownloadActivity fallback...")
                if manga_name:
                    auto_clear_download_history_for_comic(adb_path, serial, manga_name)
                return False

        # Step 2: Now in DownloadManagerActivity (Image 1) -> Tap Pencil icon ('รูปดินสอ')
        xml_dm = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/rec_dm.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_dm.xml"
        )
        if not xml_dm or not any(k in xml_dm for k in ["tv_actionbar_edit", "添加更多集数", "secendbar_container", "edit_container"]):
            time.sleep(1.0)
            xml_dm = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/rec_dm.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_dm.xml"
            )

        # If not yet in Edit mode (Image 2), tap the Pencil icon at top-right (tv_actionbar_edit: [853,54][883,84] -> 868, 69)
        if "delete_container" not in xml_dm and "edit_container" not in xml_dm:
            edit_x, edit_y = find_node_center_by_id_or_text(
                xml_dm, resource_ids=["tv_actionbar_edit"], default=(868, 69)
            )
            log(f"   ✏️ [1-Click Recovery] Tapping Pencil / Edit icon ('รูปดินสอ') at ({edit_x}, {edit_y})...")
            adb_command(adb_path, serial, "shell", f"input tap {edit_x} {edit_y}")
            time.sleep(0.9)
            xml_dm = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/rec_dm_edit.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_dm_edit.xml"
            )

        # Step 3: Tap Select All ('กด เลือกทั้งหมด' / '全选') at bottom-left (select_container: [0,1502][449,1600] -> 224, 1551)
        if "取消全选" not in xml_dm:
            sel_x, sel_y = find_node_center_by_id_or_text(
                xml_dm, resource_ids=["select_container", "select_text"], texts=["全选"], default=(224, 1551)
            )
            log(f"   ☑️ [1-Click Recovery] Tapping Select All ('เลือกทั้งหมด' / '全选') at ({sel_x}, {sel_y})...")
            adb_command(adb_path, serial, "shell", f"input tap {sel_x} {sel_y}")
            time.sleep(0.8)

        # Step 4: Tap Delete ('กดลบออก' / '删除') at bottom-right (delete_container: [450,1502][900,1600] -> 675, 1551)
        del_x, del_y = find_node_center_by_id_or_text(
            xml_dm, resource_ids=["delete_container", "delete_text"], texts=["删除"], default=(675, 1551)
        )
        log(f"   🗑️ [1-Click Recovery] Tapping Delete ('ลบออก' / '删除') at ({del_x}, {del_y})...")
        adb_command(adb_path, serial, "shell", f"input tap {del_x} {del_y}")
        time.sleep(0.9)

        # Step 5: Confirm Delete Dialog ('确认删除选中的漫画章节？' -> '是的' / positive_btn: [450,840][665,921] -> 557, 880)
        xml_del_dlg = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/rec_del_dlg.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_del_dlg.xml"
        )
        if xml_del_dlg and any(k in xml_del_dlg for k in ["positive_btn", "是的", "确认删除", "确定"]):
            pos_x, pos_y = find_node_center_by_id_or_text(
                xml_del_dlg, resource_ids=["positive_btn"], texts=["是的", "确定"], default=(557, 880)
            )
            log(f"   ✅ [1-Click Recovery] Confirming delete dialog ('是的') at ({pos_x}, {pos_y})...")
            adb_command(adb_path, serial, "shell", f"input tap {pos_x} {pos_y}")
            time.sleep(1.2)

        # Step 6: Navigate back to DownloadChapterSelectActivity via '添加更多集数' (secendbar_container: [0,102][900,170] -> 450, 136)
        xml_after_del = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/rec_after_del.xml >/dev/null 2>&1 && cat /data/local/tmp/rec_after_del.xml"
        )
        if xml_after_del and ("secendbar_container" in xml_after_del or "添加更多集数" in xml_after_del):
            add_x, add_y = find_node_center_by_id_or_text(
                xml_after_del, resource_ids=["secendbar_container"], texts=["添加更多集数"], default=(450, 136)
            )
            log(f"   🔙 [1-Click Recovery] Tapping '添加更多集数' at ({add_x}, {add_y}) to return to chapter selection...")
            adb_command(adb_path, serial, "shell", f"input tap {add_x} {add_y}")
            time.sleep(1.5)
        else:
            log(f"   🔙 [1-Click Recovery] Re-launching DownloadChapterSelectActivity for Comic {comic_id}...")
            try:
                if script is not None:
                    script.exports_sync.opendlselect(str(comic_id))
                else:
                    raise RuntimeError("No script")
            except Exception:
                adb_command(
                    adb_path, serial, "shell",
                    f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadChapterSelectActivity --es STR_MSG_COMIC_ID {comic_id} --ei STR_MSG_FROM 1"
                )
            time.sleep(1.8)

        log("   🎉 [1-Click Recovery] All chapters deleted in DownloadManagerActivity and returned to chapter selection!")
        return True
    except Exception as e:
        log(f"   ⚠️ [1-Click Recovery] Error during recovery flow: {e}")
        return False


def trigger_native_offline_download(
    script,
    adb_path: str,
    serial: str,
    comic_id: str,
    chapter_id: str,
    chapter_name: str,
    seq_no: str = "",
    auto_buy: bool = True,
    timeout: float = 35.0,
    manga_name: str = "",
    expected_total_chapters: int = 0
) -> list:
    """
    Triggers Tencent Comic native offline download for the target chapter.
    Relies STRICTLY on Tencent native offline caching (Zero Reader Swipes).
    Returns canonical ordered URLs from _image_info_list.
    """
    # 0. Ground truth check first
    urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
    if urls and len(urls) >= 5:
        return urls

    target_seq = str(seq_no).strip()
    num_m = re.search(r"(\d+)", chapter_name)
    alt_seq = num_m.group(1) if num_m else ""
    if not target_seq:
        target_seq = alt_seq

    log(f"📥 [OfflineDL] Triggering Native Offline Download: Comic {comic_id} | Ch {chapter_id} ({chapter_name} / Target Seq {target_seq}, Alt {alt_seq})...")

    # Dismiss any previously open dialogs/activities
    adb_command(adb_path, serial, "shell", "input keyevent 4")
    time.sleep(0.4)

    # Launch DownloadChapterSelectActivity (Frida opendlselect finishes any stale DownloadChapterSelectActivity first!)
    try:
        if script is not None:
            script.exports_sync.opendlselect(str(comic_id))
        else:
            raise RuntimeError("No active Frida script")
    except Exception as e:
        log(f"   ⚠️ opendlselect RPC fallback ({e})...")
        adb_command(
            adb_path, serial, "shell",
            f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadChapterSelectActivity --es STR_MSG_COMIC_ID {comic_id} --ei STR_MSG_FROM 1"
        )

    time.sleep(2.2)

    # Dismiss any captcha/dialog if popped up, and verify we are on DownloadChapterSelectActivity for the RIGHT comic!
    xml_init = adb_command(adb_path, serial, "shell", "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml")
    if "VerifyCodePage" in xml_init or "安全验证" in xml_init or "请控制拼图块" in xml_init:
        log("   ⚠️ VerifyCodePage detected on screen, pressing back...")
        adb_command(adb_path, serial, "shell", "input keyevent 4")
        time.sleep(1.2)
        xml_init = adb_command(adb_path, serial, "shell", "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml")

    # Verify if DownloadChapterSelectActivity is open AND showing the expected chapter count (guards against stale singleTop activity!)
    wrong_comic_screen = False
    if expected_total_chapters > 0 and xml_init:
        m_tot = re.search(r'text="共(\d+)话"', xml_init)
        if m_tot and int(m_tot.group(1)) != expected_total_chapters:
            log(f"   ⚠️ Stale DownloadChapterSelectActivity detected (screen shows 共{m_tot.group(1)}话, expected {expected_total_chapters} for Comic {comic_id})!")
            wrong_comic_screen = True

    if not xml_init or ("选择下载章节" not in xml_init and "container_download" not in xml_init) or wrong_comic_screen:
        log(f"   🔄 Force-reloading DownloadChapterSelectActivity for Comic {comic_id} via DownloadManagerActivity -> 添加更多集数...")
        adb_command(
            adb_path, serial, "shell",
            f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadManagerActivity --es STR_MSG_COMIC_ID {comic_id}"
        )
        time.sleep(1.8)
        xml_dm_nav = adb_command(adb_path, serial, "shell", "uiautomator dump /data/local/tmp/dl_dm_nav.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_dm_nav.xml")
        if xml_dm_nav and ("secendbar_container" in xml_dm_nav or "添加更多集数" in xml_dm_nav):
            add_x, add_y = find_node_center_by_id_or_text(
                xml_dm_nav, resource_ids=["secendbar_container"], texts=["添加更多集数"], default=(450, 136)
            )
            adb_command(adb_path, serial, "shell", f"input tap {add_x} {add_y}")
            time.sleep(2.0)
        else:
            adb_command(
                adb_path, serial, "shell",
                f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadChapterSelectActivity --es STR_MSG_COMIC_ID {comic_id} --ei STR_MSG_FROM 1"
            )
            time.sleep(2.2)

    # 1. Ensure selection is completely cleared (0 chapters selected)
    if not ensure_clear_selection(adb_path, serial):
        log("   ⚠️ Warning: Could not fully confirm 0 selection count, attempting to proceed with care...")

    # 2. Search and select target chapter in DownloadChapterSelectActivity
    target_found = search_and_tap_target_chapter(adb_path, serial, target_seq, alt_seq, max_attempts=18)

    if not target_found:
        log(f"   ⚠️ Could not locate Chapter {target_seq} (alt: {alt_seq}) in DownloadChapterSelectActivity UI.")
        return []

    # 3. STRICT PRE-DOWNLOAD SAFETY GUARD
    # Enforce that EXACTLY 1 chapter is selected ('已选择1话')!
    xml_guard = adb_command(
        adb_path, serial, "shell",
        "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
    )
    guard_count = get_download_selected_count(xml_guard)
    log(f"   🛡️ Pre-Download Safety Guard: Currently selected = {guard_count} chapter(s)...")

    if guard_count != 1:
        log(f"   🚨 [SAFETY GUARD BLOCKED] Selection count is {guard_count} (expected exactly 1)!")

        # 1-Click Auto-Recovery per User Workflow:
        # Clear DownloadManagerActivity -> Return & re-select target 1 chapter
        log(f"   🔄 [1-Click Auto-Recovery] Running DownloadManager Pencil -> Select All -> Delete recovery for Comic {comic_id}...")
        recover_download_via_pencil_delete_all(
            adb_path=adb_path,
            serial=serial,
            comic_id=comic_id,
            script=script,
            exclude_seq=target_seq,
            manga_name=manga_name
        )

        # Clear smart selection afresh on DownloadChapterSelectActivity
        ensure_clear_selection(adb_path, serial)

        # Re-search and select the target 1 chapter (with full scroll/sequence support)
        retry_found = search_and_tap_target_chapter(adb_path, serial, target_seq, alt_seq, max_attempts=18)
        if retry_found:
            xml_guard_retry = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/dl_ui.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_ui.xml"
            )
            guard_count = get_download_selected_count(xml_guard_retry)
            log(f"   🛡️ [1-Click Auto-Recovery] Guard re-check: Currently selected = {guard_count} chapter(s)...")

        if guard_count != 1:
            log(f"   🚨 [SAFETY GUARD BLOCKED] Selection count remains {guard_count} (expected exactly 1)! Aborting download click to prevent over-download!")
            ensure_clear_selection(adb_path, serial)
            return []

    log("   ✅ [SAFETY GUARD PASSED] Verified exactly 1 chapter selected ('已选择1话'). Proceeding to tap download...")

    # 4. Tap "下载所选" / "购买下载" (dynamic bounds lookup with fallback to [675, 1520])
    dl_x, dl_y = find_node_center_by_id_or_text(
        xml_guard, resource_ids=["container_download", "download_btn"], texts=["下载所选", "购买下载"], default=(675, 1520)
    )
    log(f"   🚀 Tapping download button ('下载所选' / '购买下载') at ({dl_x}, {dl_y})...")
    adb_command(adb_path, serial, "shell", f"input tap {dl_x} {dl_y}")
    time.sleep(1.2)

    # Multi-pass dialog resolution loop: handles Confirmation ('确定下载' / '是的'), VIP/Ticket purchase ('确认购买' / 'one_btn'),
    # Teen Mode ('青少年守护模式'), Progress Sync ('进度同步提醒'), and VerifyCodePage in ANY order!
    for dlg_pass in range(3):
        xml_dlg = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/dl_dlg.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_dlg.xml"
        )
        if not xml_dlg:
            break

        progressed = False

        # (A) Check if paywall dialog is shown when auto_buy is disabled
        if not auto_buy and any(k in xml_dlg for k in ["one_btn", "read_pay_layout", "确认购买"]):
            log("   ⛔ Paywall / Ticket purchase dialog ('确认购买') detected while --no-auto-buy is active! Aborting chapter download immediately.")
            adb_command(adb_path, serial, "shell", "input keyevent 4")
            return []

        # (B) Check for download confirmation dialog ("是的" / positive_btn)
        if any(k in xml_dlg for k in ["positive_btn", "确定下载", "是的", "预估共"]):
            px, py = find_node_center_by_id_or_text(
                xml_dlg, resource_ids=["positive_btn"], texts=["是的", "确定"], default=(557, 923)
            )
            log(f"   ✅ Confirmation dialog detected (pass {dlg_pass+1})! Confirming download ('是的') at ({px}, {py})...")
            adb_command(adb_path, serial, "shell", f"input tap {px} {py}")
            time.sleep(1.4)
            progressed = True

        # (C) Check for VIP/Ticket purchase ('确认购买'), Teen Mode, or Progress Sync dialogs
        if handle_screen_dialogs(adb_path, serial, auto_buy=auto_buy):
            progressed = True

        # (D) Check if VerifyCodePage / web_container popped up
        xml_post = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/dl_post.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_post.xml"
        )
        if xml_post and any(k in xml_post for k in ["VerifyCodePage", "安全验证", "请控制拼图块"]):
            log("   ⚠️ Security verification (VerifyCodePage) intercepted download! Dismissing and re-tapping download...")
            adb_command(adb_path, serial, "shell", "input keyevent 4")
            time.sleep(1.8)
            xml_re = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/dl_re.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_re.xml"
            )
            if xml_re and get_download_selected_count(xml_re) == 1:
                rx, ry = find_node_center_by_id_or_text(
                    xml_re, resource_ids=["container_download", "download_btn"], texts=["下载所选", "购买下载"], default=(675, 1520)
                )
                log(f"   🚀 Re-tapping download button at ({rx}, {ry}) after dismissing VerifyCodePage...")
                adb_command(adb_path, serial, "shell", f"input tap {rx} {ry}")
                time.sleep(1.4)
                progressed = True

        if not progressed:
            break

    # Poll for _image_info_list (primary success signal).
    # NOTE: Tencent writes _image_info_list incrementally with a cache-style suffix (e.g. 0_0_1);
    # right after the download tap the file may briefly hold a stale/partial entry, so we require
    # the file to have settled (unchanged for a few polls) before accepting it, and we also
    # consult DownloadManagerActivity + the on-device folder as secondary "engine alive" signals
    # so a real download is never declared FAILED just because the poll window was too short.
    # `timeout` is the *soft* window (reported in the log); the hard ceiling is DOWNLOAD_HARD_TIMEOUT.
    poll_window = max(float(timeout or 0.0), DEFAULT_DOWNLOAD_POLL_WINDOW)
    hard_deadline = time.time() + DOWNLOAD_HARD_TIMEOUT
    soft_deadline = time.time() + poll_window
    log(f"   ⏳ Waiting for Tencent Engine to finish offline download (soft window {poll_window:.0f}s, max {DOWNLOAD_HARD_TIMEOUT:.0f}s)...")
    start_poll = time.time()
    last_sig = None
    last_sig_change = time.time()
    last_folder_sig = None
    stable_polls = 0
    soft_warned = False
    while time.time() < hard_deadline:
        time.sleep(DOWNLOAD_POLL_INTERVAL)

        # 1) Ground truth: canonical _image_info_list present & stable
        urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
        sig = (len(urls), tuple(urls[:2]), tuple(urls[-2:])) if urls else None
        if sig != last_sig:
            last_sig = sig
            last_sig_change = time.time()
            stable_polls = 0
        else:
            stable_polls += 1
        if urls and len(urls) >= 5 and stable_polls >= 2:
            elapsed = time.time() - start_poll
            log(f"   🎉 Native Offline Download completed in {elapsed:.1f}s! ({len(urls)} canonical slices)")
            adb_command(adb_path, serial, "shell", "input keyevent 4")
            return urls

        # 2) Secondary signals: folder queued on device / DownloadManager row state
        folder = check_offline_chapter_dir(adb_path, serial, comic_id, chapter_id)
        folder_sig = (folder["files"], folder["has_info"])
        if folder_sig != last_folder_sig:
            last_folder_sig = folder_sig
            last_sig_change = time.time()

        dm_status = "missing"
        if time.time() - start_poll >= 4.0:
            dm_status = check_download_manager_chapter_status(adb_path, serial, target_seq, alt_seq)

        if not soft_warned and time.time() > soft_deadline:
            soft_warned = True
            log(f"   ⏳ Soft timeout reached ({poll_window:.0f}s) — still polling up to {DOWNLOAD_HARD_TIMEOUT:.0f}s "
                f"(dm={dm_status}, files={folder['files']}, info={folder['has_info']})...")

        # 3) Engine reported 'completed' in DownloadManager -> give the filesystem a short settle grace period
        if dm_status == "completed":
            log("   ✅ DownloadManagerActivity shows target chapter completed ('已完成'). Pulling slices...")
            grace_end = time.time() + 6.0
            while time.time() < grace_end:
                time.sleep(1.5)
                urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
                if urls and len(urls) >= 5:
                    elapsed = time.time() - start_poll
                    log(f"   🎉 Native Offline Download completed in {elapsed:.1f}s! ({len(urls)} canonical slices)")
                    adb_command(adb_path, serial, "shell", "input keyevent 4")
                    return urls
            # Completed in UI but no usable list yet -> report "no urls" WITHOUT touching anything;
            # execute_pipeline_for_chapter's caller treats a DM-confirmed completion as non-fatal.
            log("   ✅ DownloadManagerActivity confirms completion but _image_info_list not yet readable; "
                "treating download as completed-in-UI (no destructive recovery).")
            return list(urls) if urls else []

        # 3.5) Fast-fail check: if after 16s the download has NOT started (dm_status=='missing', folder['exists']==False),
        #      inspect the current screen to see if we are still stuck on DownloadChapterSelectActivity (e.g. V会员 / unpurchasable lock)
        if (time.time() - start_poll) >= 16.0 and dm_status == "missing" and not folder["exists"] and not urls:
            xml_stuck = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/dl_stuck.xml >/dev/null 2>&1 && cat /data/local/tmp/dl_stuck.xml"
            )
            if xml_stuck and ("选择下载章节" in xml_stuck or "container_download" in xml_stuck) and "tv_actionbar_edit" not in xml_stuck:
                if "V会员" in xml_stuck and get_download_selected_count(xml_stuck) >= 1:
                    log(f"   ⛔ Chapter {target_seq} is locked behind 'V会员' (VIP Member Exclusive) or did not enter DownloadManagerActivity after 16s! Aborting wait early.")
                    ensure_clear_selection(adb_path, serial)
                    return []
                elif get_download_selected_count(xml_stuck) == 1:
                    # Try re-tapping download once in case the first tap was absorbed by a toast/dialog
                    rx, ry = find_node_center_by_id_or_text(
                        xml_stuck, resource_ids=["container_download", "download_btn"], texts=["下载所选", "购买下载"], default=(675, 1520)
                    )
                    log(f"   🔄 Still on DownloadChapterSelectActivity after 16s; re-tapping download button at ({rx}, {ry})...")
                    adb_command(adb_path, serial, "shell", f"input tap {rx} {ry}")
                    time.sleep(1.2)
                    handle_screen_dialogs(adb_path, serial, auto_buy=auto_buy)

        # 4) Folder exists with data and has not changed for a while, while manager shows progress/none
        #    -> engine likely finished writing; accept a stable list even if slightly short.
        if folder["exists"] and folder["files"] > 0 and (time.time() - last_sig_change) > 8.0 and urls:
            elapsed = time.time() - start_poll
            log(f"   🎉 Offline folder settled after {elapsed:.1f}s ({folder['files']} files, {len(urls)} slices).")
            adb_command(adb_path, serial, "shell", "input keyevent 4")
            return urls

    log(f"   ⚠️ Timed out waiting for native offline download (max {DOWNLOAD_HARD_TIMEOUT:.0f}s).")
    return []




def download_slice_bytes(url: str, retries: int = 5) -> bytes:
    clean_u = clean_image_url(url)
    req = urllib.request.Request(
        clean_u,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://ac.qq.com/"
        }
    )
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                if len(data) > 0:
                    return data
        except Exception as e:
            if attempt == retries:
                log(f"   ⚠️ Failed to download slice after {retries} attempts: {clean_u} ({e})")
            time.sleep(0.8 * attempt)
    return None


def call_gas(action: str, payload: dict = None, retries: int = 3) -> dict:
    body = {
        "passcode": GAS_PASSCODE,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                return {"status": "error", "message": str(e)}
            time.sleep(2 * attempt)


def query_pending_gas_queue() -> list:
    """
    Fetch pending Tencent tasks from GAS WorkQueue and RawTracker.
    Accurately maps:
      1. WorkQueue unfinished tasks (uploadstatus != 'เสร็จแล้ว' or missing [อัป Raw] link).
      2. RawTracker Pending Chapters API (GET_RAW_TRACKER_PENDING_CHAPTERS).
      3. RawTracker List (GET_RAW_TRACKER_LIST) for any Tencent titles with latestChapter > currentChapter.
    Automatically calculates chapter ranges to scrape (e.g. currentChapter + 1 to latestChapter)
    and deduplicates items across all sources.
    """
    pending = []
    seen_keys = set()

    # Pre-fetch manga list for mapping mangaId -> originalurl & title
    manga_map = {}
    try:
        m_res = call_gas("GET_MANGA_LIST", {})
        mangas = m_res.get("data", []) if isinstance(m_res, dict) else (m_res if isinstance(m_res, list) else [])
        for m in mangas:
            if m.get("mangaid") is not None:
                manga_map[str(m["mangaid"])] = m
    except Exception as e:
        log(f"Notice: Manga list lookup notice: {e}")

    # 1. Query WorkQueue (Pending items waiting in queue)
    try:
        res = call_gas("GET_WORK_QUEUE", {
            "forceRefresh": True,
            "month": "all",
            "year": "all",
            "includeIncomplete": True
        })
        items = res.get("data", []) if isinstance(res.get("data"), list) else []
        for item in items:
            m_id = str(item.get("mangaid", "")).strip()
            m_info = manga_map.get(m_id, {})
            raw_url = str(m_info.get("originalurl", "") or item.get("rawurl", "") or item.get("originalurl", "")).strip()
            conn = str(item.get("connector", "") or m_info.get("connector", "")).strip().lower()
            raw_url_lower = raw_url.lower()

            # Exclude non-Tencent platforms explicitly
            if any(other in raw_url_lower for other in ["kuaikanmanhua.com", "kuaikan", "thunderscans", "colamanga", "baozimh"]):
                continue
            if conn in ["kuaikan", "thunderscans", "colamanga", "baozimh"]:
                continue

            # Check if this item belongs strictly to Tencent / QQ
            if "ac.qq.com" in raw_url_lower or "qq.com" in raw_url_lower or conn in ["tencent", "qq"]:
                status = str(item.get("uploadstatus", "")).strip()
                link = str(item.get("worklink", "")).strip()
                has_raw_done = (status == "เสร็จแล้ว" and "[อัป Raw]" in link)
                if not has_raw_done:
                    cid_m = re.search(r"id/(\d+)", raw_url)
                    comic_id = cid_m.group(1) if cid_m else str(item.get("comicid", ""))
                    m_name = m_info.get("manganame") or item.get("manganame", "")
                    ch_str = str(item.get("chapter", "")).strip()
                    key = (comic_id or m_name, ch_str)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        item["source"] = "WorkQueue"
                        item["rawurl"] = raw_url
                        item["comicid"] = comic_id
                        item["manganame"] = m_name
                        pending.append(item)
    except Exception as e:
        log(f"Notice: Query WorkQueue error: {e}")

    # 2. Query RawTracker Pending Chapters API
    try:
        raw_res = call_gas("GET_RAW_TRACKER_PENDING_CHAPTERS", {})
        if raw_res.get("status") == "success" and raw_res.get("data"):
            tasks = raw_res["data"].get("tasks", [])
            for t in tasks:
                src = str(t.get("sourceUrl", "")).lower()
                conn = str(t.get("connector", "")).lower()

                # Exclude non-Tencent platforms explicitly
                if any(other in src for other in ["kuaikanmanhua.com", "kuaikan", "thunderscans", "colamanga", "baozimh"]):
                    continue
                if conn in ["kuaikan", "thunderscans", "colamanga", "baozimh"]:
                    continue

                if conn in ["tencent", "qq"] or "ac.qq.com" in src or "qq.com" in src:
                    cid_m = re.search(r"id/(\d+)", src)
                    comic_id = str(t.get("comicId", "") or (cid_m.group(1) if cid_m else ""))
                    m_name = t.get("mangaName", "")
                    ch_str = str(t.get("chapterNum", "")).strip()
                    key = (comic_id or m_name, ch_str)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        pending.append({
                            "source": "RawTracker_Pending",
                            "mangaid": str(t.get("mangaId", "")),
                            "manganame": m_name,
                            "chapter": ch_str,
                            "rawurl": t.get("sourceUrl", ""),
                            "comicid": comic_id,
                            "cid": str(t.get("cid", "") or t.get("topicId", ""))
                        })
    except Exception as e:
        log(f"Notice: Query RawTracker Pending error: {e}")

    # 3. Query RawTracker List directly (Automatic detection of all Tencent titles with new chapters)
    try:
        rt_res = call_gas("GET_RAW_TRACKER_LIST", {})
        trackers = rt_res.get("data", []) if isinstance(rt_res, dict) and "data" in rt_res else (rt_res if isinstance(rt_res, list) else [])
        for trk in trackers:
            url = str(trk.get("url", "")).strip().lower()
            conn = str(trk.get("connector", "")).strip().lower()

            # Exclude non-Tencent platforms explicitly
            if any(other in url for other in ["kuaikanmanhua.com", "kuaikan", "thunderscans", "colamanga", "baozimh"]):
                continue
            if conn in ["kuaikan", "thunderscans", "colamanga", "baozimh"]:
                continue

            if "ac.qq.com" not in url and "qq.com" not in url and conn not in ["tencent", "qq"]:
                continue

            cid_m = re.search(r"id/(\d+)", url)
            comic_id = cid_m.group(1) if cid_m else ""
            m_name = trk.get("manganame", "")
            m_id = str(trk.get("mangaid", "")).strip()

            # Auto-resolve m_id if missing
            if not m_id:
                for mid, minfo in manga_map.items():
                    if comic_id and f"id/{comic_id}".lower() in str(minfo.get("originalurl", "")).lower():
                        m_id = mid
                        break
                    if m_name and m_name.strip().lower() == str(minfo.get("manganame", "")).strip().lower():
                        m_id = mid
                        break

            curr_chap = float(trk.get("currentChapter") or 0)
            raw_count = float(trk.get("lastrawcount") or 0)
            status = str(trk.get("status", ""))

            has_new = (raw_count > curr_chap) or ("มีตอนใหม่" in status)
            if not has_new:
                continue

            start_ch = int(curr_chap) + 1
            end_ch = int(raw_count) if raw_count > curr_chap else start_ch

            for ch_num in range(start_ch, end_ch + 1):
                ch_str = str(ch_num)
                key = (comic_id or m_name, ch_str)
                if key not in seen_keys:
                    seen_keys.add(key)
                    pending.append({
                        "source": "RawTracker",
                        "trackerid": str(trk.get("trackerid", "")),
                        "mangaid": m_id,
                        "manganame": m_name,
                        "chapter": ch_str,
                        "rawurl": url,
                        "comicid": comic_id,
                        "cid": ""
                    })
    except Exception as e:
        log(f"Notice: Query RawTracker List error: {e}")

    return pending


# --------------------------------------------------------------------------
# TOC / CHAPTER LIST EXTRACTION & CHAPTER NUMBER MAPPING
# --------------------------------------------------------------------------
def fetch_tencent_chapter_list(comic_id: str) -> tuple:
    """
    Scrapes the Table of Contents (TOC) from https://ac.qq.com/Comic/comicInfo/id/{comic_id}
    Returns: (comic_title, [ { cid, title, chapter_num, seq_no }, ... ])
    """
    url = f"https://ac.qq.com/Comic/comicInfo/id/{comic_id}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://ac.qq.com/"
        }
    )
    html = ""
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        log(f"⚠️ Warning: Unable to fetch comic TOC from web: {e}")
        return f"Tencent_{comic_id}", []

    # 1. Comic Title
    m_title = re.search(r"<title>《([^》]+)》", html)
    if m_title:
        comic_title = m_title.group(1).strip()
    else:
        m2 = re.search(r"<title>(.*?)</title>", html)
        comic_title = m2.group(1).split("_")[0].strip() if m2 else f"Tencent_{comic_id}"

    # 2. Extract chapters block
    pos = html.find("chapter-page-all")
    if pos != -1:
        end_ol = html.find("</ol>", pos)
        block = html[pos:end_ol] if end_ol != -1 else html[pos:]
    else:
        ch_start = html.find('id="chapter"')
        block = html[ch_start:] if ch_start != -1 else html

    pattern = re.compile(
        rf"/ComicView/index/id/{comic_id}/cid/(\d+)[^>]*>(.*?)</a>",
        re.DOTALL
    )

    chapters = []
    seen_cids = set()
    notice_regex = re.compile(
        r"^(?:预告|序章?|公告|停更|休刊|通知|抽奖|活动|感言|调查|上线|定档|请假)$|^(?:\d{1,2}月\d{1,2}日.*上线)",
        re.IGNORECASE
    )
    story_seq = 0

    for m in pattern.finditer(block):
        cid = m.group(1)
        raw_text = m.group(2)
        clean_text = re.sub(r"<[^>]+>", "", raw_text).strip()
        clean_text = " ".join(clean_text.split())

        if not clean_text or clean_text in ["开始阅读", "日月同错"]:
            continue
        if cid in seen_cids:
            continue

        seen_cids.add(cid)

        # 1. Check if notice / preview / prologue (avoid matching regular words like '秩序', '程序', '前序')
        is_notice = (
            bool(notice_regex.search(clean_text))
            or ("预告" in clean_text)
            or bool(re.search(r"(?:^|[^秩程前])序(?:章|言|幕|$)", clean_text))
        )

        # 2. Extract numeric chapter number (e.g. 第22话 -> 22, 001觉醒 -> 1, 003 爆体的危机 -> 3)
        # Note: in Python 3 regex, Chinese characters are \w, so use (?!\d) instead of \b!
        num_m = re.search(r"第\s*(\d+(?:\.\d+)?)\s*[话話集回]", clean_text)
        if not num_m:
            num_m = re.search(r"^(?:第)?\s*(\d+(?:\.\d+)?)(?!\d)", clean_text)
            if num_m:
                val = float(num_m.group(1))
                if 1900 <= val <= 2100:  # ignore year
                    num_m = None

        ch_num = None
        if is_notice and ("序" in clean_text or "预告" in clean_text or len(chapters) == 0):
            ch_num = "0"
        elif num_m:
            raw_num = str(num_m.group(1)).strip()
            ch_num = str(int(raw_num)) if raw_num.isdigit() else raw_num
            try:
                story_seq = int(float(ch_num))
            except Exception:
                story_seq += 1
        elif is_notice:
            ch_num = "0"
        else:
            story_seq += 1
            ch_num = str(story_seq)

        seq_no = str(len(chapters) + 1)
        chapters.append({
            "cid": cid,
            "title": clean_text,
            "chapter_num": ch_num,
            "seq_no": seq_no
        })

    return comic_title, chapters


def find_chapter_by_spec(chapters: list, spec: str) -> dict:
    """Matches user-provided chapter spec against chapter list."""
    spec_clean = str(spec).strip()
    # 1. Match by exact chapter_num (including numeric comparison for zero-padded strings like '035' == '35')
    for ch in chapters:
        cnum = str(ch.get("chapter_num") or "").strip()
        if cnum:
            if cnum == spec_clean:
                return ch
            if cnum.isdigit() and spec_clean.isdigit() and int(cnum) == int(spec_clean):
                return ch

    # 2. Match by seq_no (sequential 1-based order)
    try:
        spec_idx = int(spec_clean)
        for ch in chapters:
            if ch.get("seq_no") == str(spec_idx):
                return ch
    except ValueError:
        pass

    # 3. Match substring in title (e.g. "22" in "第22话")
    for ch in chapters:
        if spec_clean in ch.get("title", ""):
            return ch

    # 4. Match by CID directly
    for ch in chapters:
        if ch.get("cid") == spec_clean:
            return ch

    return None


def parse_chapter_spec(spec: str) -> list:
    """
    Parses chapter specification:
      - Range: '22-25' -> ['22', '23', '24', '25']
      - Comma list: '22,23,24' -> ['22', '23', '24']
      - Single: '22' -> ['22']
      - Mixed: '1-3,5,8-10' -> ['1', '2', '3', '5', '8', '9', '10']
    """
    if not spec:
        return []
    result = []
    parts = [p.strip() for p in spec.split(",") if p.strip()]
    for p in parts:
        if "-" in p:
            sub = p.split("-", 1)
            try:
                start_m = re.search(r"\d+", sub[0])
                end_m = re.search(r"\d+", sub[1])
                if start_m and end_m:
                    start = int(start_m.group(0))
                    end = int(end_m.group(0))
                    step = 1 if end >= start else -1
                    for n in range(start, end + step, step):
                        s = str(n)
                        if s not in result:
                            result.append(s)
                else:
                    if p not in result: result.append(p)
            except Exception:
                if p not in result: result.append(p)
        else:
            m = re.search(r"(\d+(?:\.\d+)?)", p)
            val = m.group(1) if m else p
            if val not in result:
                result.append(val)
    return result


def run_cooldown(seconds: int):
    """Safe cool-down timer between chapters with live countdown."""
    if seconds <= 0:
        return
    log(f"⏳ Cooling down for {seconds}s before next chapter...")
    for remaining in range(seconds, 0, -5):
        log(f"   ⏱️ Cool-down: {remaining}s remaining...")
        time.sleep(min(5, remaining))
    log("   ⚡ Ready for next chapter!")


# --------------------------------------------------------------------------
# COMPLETE FRIDA INSTRUMENTATION SCRIPT (CIPHER + HTTP/2 + IN-PROCESS INTENT)
# --------------------------------------------------------------------------
FRIDA_JS_INSTRUMENTATION = """
'use strict';

var MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
var DEDUPE_HISTORY_SIZE = 256;
var seenHashes = [];
var lastEndpoints = [];

function emit(kind, obj, buf) {
  var msg = { kind: kind, ts: Date.now() };
  if (obj) {
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        msg[k] = obj[k];
      }
    }
  }
  try {
    if (buf) {
      send(msg, buf);
    } else {
      send(msg);
    }
  } catch (e) {}
}

function toJSByteArray(jbytes) {
  if (!jbytes) return null;
  try {
    return Java.array('byte', jbytes);
  } catch (e) {
    if (jbytes.length !== undefined) return jbytes;
    return null;
  }
}

function hexSnippet(arr, max) {
  if (!arr) return '';
  var n = Math.min(arr.length, max || 32);
  var out = '';
  for (var i = 0; i < n; i++) {
    var b = (arr[i] + 256) % 256;
    out += ('0' + b.toString(16)).slice(-2);
  }
  return out;
}

function isGzip(arr) {
  if (!arr || arr.length < 2) return false;
  return ((arr[0] & 0xff) === 0x1f) && ((arr[1] & 0xff) === 0x8b);
}

function toArrayBuffer(arr) {
  var buf = new ArrayBuffer(arr.length);
  var u8 = new Uint8Array(buf);
  for (var i = 0; i < arr.length; i++) {
    u8[i] = arr[i] & 0xff;
  }
  return buf;
}

function simpleHash(arr) {
  var h = 0x811c9dc5;
  var step = Math.max(1, Math.floor(arr.length / 64));
  for (var i = 0; i < arr.length; i += step) {
    h ^= (arr[i] & 0xff);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + '_' + arr.length;
}

function recordEndpoint(authority, path) {
  if (!path) return;
  lastEndpoints.push({
    ts: Date.now(),
    authority: authority || '',
    path: path
  });
  while (lastEndpoints.length > 30) {
    lastEndpoints.shift();
  }
}

function getRecentEndpoint() {
  var now = Date.now();
  for (var i = lastEndpoints.length - 1; i >= 0; i--) {
    var ep = lastEndpoints[i];
    if (now - ep.ts < 20000) {
      return ep;
    }
  }
  return null;
}

rpc.exports = {
    opendlselect: function(comicId) {
        Java.perform(function() {
            var Intent = Java.use('android.content.Intent');
            var ComponentName = Java.use('android.content.ComponentName');
            var ActivityThread = Java.use('android.app.ActivityThread');
            var currentThread = ActivityThread.currentActivityThread();
            var app = ActivityThread.currentApplication();
            var ctx = app.getApplicationContext();

            // Finish any existing DownloadChapterSelectActivity or DownloadManagerActivity instances first
            // because Tencent's DownloadChapterSelectActivity only reads STR_MSG_COMIC_ID in onCreate(), not onNewIntent()!
            try {
                var mActivities = currentThread.mActivities.value;
                var vals = mActivities.values().toArray();
                for (var i = 0; i < vals.length; i++) {
                    var rec = vals[i];
                    if (rec !== null) {
                        var actField = rec.getClass().getDeclaredField('activity');
                        actField.setAccessible(true);
                        var act = actField.get(rec);
                        if (act !== null) {
                            var clsName = act.getClass().getName();
                            if (clsName.indexOf('DownloadChapterSelectActivity') !== -1 ||
                                clsName.indexOf('DownloadManagerActivity') !== -1) {
                                act.finish();
                            }
                        }
                    }
                }
            } catch (e) {}

            var intent = Intent.$new();
            intent.setComponent(ComponentName.$new('com.qq.ac.android', 'com.qq.ac.android.view.activity.DownloadChapterSelectActivity'));
            intent.putExtra('STR_MSG_COMIC_ID', String(comicId));
            intent.putExtra('STR_MSG_FROM', 1);
            // FLAG_ACTIVITY_NEW_TASK (0x10000000) | FLAG_ACTIVITY_CLEAR_TASK (0x00008000) | FLAG_ACTIVITY_CLEAR_TOP (0x04000000)
            intent.setFlags(0x10000000 | 0x00008000 | 0x04000000);

            ctx.startActivity(intent);
            emit('dl_select_nav', { status: 'dispatched', comicId: comicId });
        });
    }
};

Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');
  var lastKeyHex = '';
  var lastIvHex = '';

  function inspectKeyIv(arg) {
    if (!arg) return;
    try {
      var enc = arg.getEncoded();
      if (enc !== null) {
        lastKeyHex = hexSnippet(toJSByteArray(enc), 32);
        return;
      }
    } catch (e) {}
    try {
      var iv = arg.getIV();
      if (iv !== null) {
        lastIvHex = hexSnippet(toJSByteArray(iv), 32);
      }
    } catch (e) {}
  }

  Cipher.init.overloads.forEach(function (ov) {
    ov.implementation = function () {
      try {
        for (var i = 0; i < arguments.length; i++) {
          inspectKeyIv(arguments[i]);
        }
      } catch (e) {}
      return ov.call(this, ...arguments);
    };
  });

  function processBuffer(direction, rawJBytes, cipherObj) {
    if (!rawJBytes) return;
    var arr = toJSByteArray(rawJBytes);
    if (!arr || arr.length < 2) return;
    if (!isGzip(arr)) return;
    if (arr.length > MAX_PAYLOAD_BYTES) return;

    var h = simpleHash(arr);
    if (seenHashes.indexOf(h) >= 0) return;
    seenHashes.push(h);
    while (seenHashes.length > DEDUPE_HISTORY_SIZE) {
      seenHashes.shift();
    }

    var ep = getRecentEndpoint();
    var buf = toArrayBuffer(arr);
    var algo = '';
    try { algo = String(cipherObj.getAlgorithm()); } catch (e) {}

    emit('plain_gzip', {
      dir: direction,
      len: arr.length,
      algo: algo,
      key: lastKeyHex,
      iv: lastIvHex,
      head: hexSnippet(arr, 32),
      endpoint: ep ? ep.path : null,
      authority: ep ? ep.authority : null
    }, buf);
  }

  Cipher.doFinal.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  Cipher.update.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  // OkHttp2 HTTP/2 scan
  var scannedClasses = {};
  var scanPasses = 0;

  function scanHttp2() {
    scanPasses++;
    Java.enumerateLoadedClassesSync().forEach(function (cn) {
      if (cn.indexOf('okhttp3.internal.http2.') !== 0) return;
      if (scannedClasses[cn]) return;
      scannedClasses[cn] = true;

      var C;
      try { C = Java.use(cn); } catch (e) { return; }
      var methods;
      try { methods = C.class.getDeclaredMethods(); } catch (e) { return; }

      for (var i = 0; i < methods.length; i++) {
        var mName = methods[i].getName();
        if (/toString|hashCode|equals/.test(mName)) continue;
        var holder = C[mName];
        if (!holder || !holder.overloads) continue;

        holder.overloads.forEach(function (ov) {
          var types = ov.argumentTypes.map(function (t) { return t.className; });
          if (types.indexOf('java.util.List') < 0) return;

          ov.implementation = function () {
            for (var a = 0; a < arguments.length; a++) {
              if (types[a] === 'java.util.List' && arguments[a] !== null) {
                try {
                  var list = arguments[a];
                  var sz = list.size();
                  var path = null;
                  var auth = null;
                  var method = 'GET';
                  for (var k = 0; k < sz; k++) {
                    var s = String(list.get(k));
                    if (s.indexOf(':path: ') === 0) path = s.slice(7);
                    else if (s.indexOf(':authority: ') === 0) auth = s.slice(12);
                    else if (s.indexOf(':method: ') === 0) method = s.slice(9);
                  }
                  if (path) {
                    if (auth === 'manhua.acimg.cn' || path.indexOf('/manhua_detail/') === 0) {
                      var imgUrl = 'https://manhua.acimg.cn' + path;
                      emit('image_url', { url: imgUrl, path: path });
                    } else {
                      recordEndpoint(auth, path);
                      emit('h2_path', { method: method, path: path, authority: auth });
                    }
                  }
                } catch (e) {}
              }
            }
            return ov.call(this, ...arguments);
          };
        });
      }
    });
    if (scanPasses >= 30) {
      clearInterval(scanTimer);
    }
  }

  scanHttp2();
  var scanTimer = setInterval(scanHttp2, 2000);

  emit('info', { msg: 'Cipher GZIP decrypt & OkHttp2 hooks active' });
});
"""


class ChapterCaptureSession:
    def __init__(self, target_comic_id: str, target_chapter_id: str):
        self.target_comic_id = str(target_comic_id)
        self.target_chapter_id = str(target_chapter_id)
        self.captured_urls = []
        self.lock = threading.Lock()
        self.last_image_ts = time.time()
        self.captured_event = threading.Event()

    def on_message(self, message: dict, data: bytes):
        payload = message.get("payload", {})
        kind = payload.get("kind") or payload.get("type")

        if kind == "in_process_nav":
            log(f"🚀 In-Process Intent Dispatched -> Comic {payload.get('comicId')} Ch {payload.get('chapterId')}")

        elif kind == "plain_gzip":
            raw_gzip = None
            if data is not None and len(data) > 0:
                raw_gzip = bytes(data)
            elif "head" in payload and len(payload["head"]) > 0:
                raw_gzip = bytes.fromhex(payload["head"])

            if not raw_gzip or not raw_gzip.startswith(b"\x1f\x8b"):
                return

            try:
                decomp = gzip.decompress(raw_gzip)
                text = decomp.decode("utf-8")
                parsed_json = json.loads(text)
                extracted = extract_image_urls(parsed_json)
                if extracted and len(extracted) > 0:
                    with self.lock:
                        for u in extracted:
                            if u not in self.captured_urls:
                                self.captured_urls.append(u)
                        self.last_image_ts = time.time()
                        log(f"💎 Captured {len(self.captured_urls)} CDN images via Cipher Decrypt JSON!")
                        self.captured_event.set()
            except Exception:
                pass

        elif kind == "image_url":
            raw_url = payload.get("url")
            if raw_url:
                clean = clean_image_url(raw_url)
                if "/manhua_detail/" in clean:
                    with self.lock:
                        if clean not in self.captured_urls:
                            self.captured_urls.append(clean)
                            self.last_image_ts = time.time()
                            log(f"🖼️ [Slice #{len(self.captured_urls)}] {clean}")
                            if len(self.captured_urls) >= 5:
                                self.captured_event.set()

        elif kind == "h2_path":
            path = payload.get("path", "")
            if "Chapter" in path:
                log(f"📡 API Route: {path}")

    def get_sorted_urls(self) -> list:
        with self.lock:
            return sort_slice_urls(self.captured_urls)


class PipelineSessionManager:
    """Manages active ChapterCaptureSession for continuous Frida instrumentation."""
    def __init__(self):
        self.current_session = None
        self.lock = threading.Lock()

    def set_session(self, session: ChapterCaptureSession):
        with self.lock:
            self.current_session = session

    def on_message(self, message: dict, data: bytes):
        with self.lock:
            if self.current_session:
                self.current_session.on_message(message, data)


def process_and_upload_chapter(
    urls: list,
    manga_name: str,
    chapter_title: str,
    manga_id: str = "",
    folder_url: str = "",
    skip_sort: bool = False
) -> bool:
    """
    Continuous Virtual Canvas Vertical Slicing into standard 20 pages (001.jpg - 020.jpg)
    and uploading to Google Drive via GAS according to strict WorkQueue rules.
    """
    if not skip_sort:
        urls = sort_slice_urls(urls)
    total_images = len(urls)
    log(f"✂️ Slicing & Uploading: '{manga_name}' | '{chapter_title}' ({total_images} raw pieces)...")

    # 1. Download pieces concurrently (8 Workers)
    downloaded_pieces = [None] * total_images
    def _dl(item):
        idx, u = item
        return idx, download_slice_bytes(u)

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(_dl, (i, urls[i])) for i in range(total_images)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_pieces[i_idx] = i_bytes

    # Ensure 100% slices downloaded with sequential fallback for any missing pieces
    for i in range(total_images):
        if downloaded_pieces[i] is None:
            log(f"   🔄 Retrying missing slice #{i+1} sequentially...")
            downloaded_pieces[i] = download_slice_bytes(urls[i], retries=5)

    success_count = sum(1 for b in downloaded_pieces if b is not None)
    log(f"   Downloaded {success_count}/{total_images} pieces successfully.")
    if success_count < total_images:
        log(f"⚠️ Warning: {total_images - success_count} slice(s) could not be retrieved.")
    if success_count == 0:
        log("❌ No slices downloaded. Aborting stitch.")
        return False

    # 2. Determine standard width & build continuous canvas
    sample_idx = 14 if total_images >= 15 else total_images // 2
    sample_bytes = downloaded_pieces[sample_idx] or downloaded_pieces[0]
    sample_img = Image.open(io.BytesIO(sample_bytes))
    standard_width = sample_img.width if sample_img.width >= 800 else 1200
    sample_img.close()
    log(f"   Standard width calibrated to: {standard_width}px")

    processed_slices = []
    total_canvas_height = 0
    for b in downloaded_pieces:
        if not b: continue
        try:
            p_im = Image.open(io.BytesIO(b)).convert("RGB")
            if p_im.width != standard_width:
                scale = standard_width / p_im.width
                scaled_h = round(p_im.height * scale)
                p_im = p_im.resize((standard_width, scaled_h), Image.Resampling.LANCZOS)
            processed_slices.append(p_im)
            total_canvas_height += p_im.height
        except Exception as e:
            log(f"   ⚠️ Slice decode warning: {e}")

    if not processed_slices:
        log("❌ No valid slice images. Aborting.")
        return False

    log(f"   🎨 Assembling Continuous Virtual Canvas: {standard_width} x {total_canvas_height} px")
    full_canvas = Image.new("RGB", (standard_width, total_canvas_height), color=(255, 255, 255))
    curr_y = 0
    for p_im in processed_slices:
        full_canvas.paste(p_im, (0, curr_y))
        curr_y += p_im.height
        p_im.close()

    # 3. Virtual Canvas Vertical Slicing into exactly 20 standard equal pages
    target_pages = 20
    pages_payloads = [None] * target_pages
    slice_height = total_canvas_height / target_pages

    for part_idx in range(target_pages):
        part_num = part_idx + 1
        y_start = int(part_idx * slice_height)
        y_end = int((part_idx + 1) * slice_height) if part_idx < target_pages - 1 else total_canvas_height

        cropped = full_canvas.crop((0, y_start, standard_width, y_end))
        img_buf = io.BytesIO()
        cropped.save(img_buf, format="JPEG", quality=95, optimize=True)
        cropped.close()
        img_bytes = img_buf.getvalue()

        # Persist local 20 standard pages to Windows disk
        clean_manga = re.sub(r'[\\/*?:"<>|]', "", manga_name).strip()
        clean_ch = re.sub(r'[\\/*?:"<>|]', "", str(chapter_title)).strip()
        local_chapter_dir = REPO_ROOT / "downloads" / f"{clean_manga}_{clean_ch}"
        local_chapter_dir.mkdir(parents=True, exist_ok=True)
        (local_chapter_dir / f"{part_num:03d}.jpg").write_bytes(img_bytes)

        b64_str = base64.b64encode(img_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_str}"

        pages_payloads[part_idx] = {
            "mangaName": manga_name,
            "chapter": chapter_title,
            "partIndex": part_num,
            "totalParts": target_pages,
            "fileName": f"{part_num:03d}.jpg",
            "mimeType": "image/jpeg",
            "base64Data": data_url,
            "isLastPart": False,
            "clearFolder": False,
            "mangaId": manga_id,
            "skipQueue": True,
            "isTest": False,
            "uploadername": "Apt",
            "uploadstatus": "เสร็จแล้ว"
        }
    full_canvas.close()
    log(f"   💾 Saved local 20 pages -> {local_chapter_dir}")

    # 4. Upload to Google Drive via GAS
    log(f"   Uploading {target_pages} standard pages (001.jpg - 020.jpg) to Google Drive...")
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = False
    p1["skipQueue"] = True
    if folder_url:
        p1["folderUrl"] = folder_url
    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        log(f"❌ Failed uploading part 1: {res_p1.get('message')}")
        return False

    folder_url = res_p1.get("data", {}).get("folderUrl") or folder_url
    log(f"   📁 Drive Folder: {folder_url}")

    # Middle parts (2 to 19) in parallel (4 workers)
    if target_pages > 2:
        def _upload_worker(pm):
            pm["folderUrl"] = folder_url
            for attempt in range(1, 4):
                res_m = call_gas("UPLOAD_CHAPTER_STITCHED_PART", pm)
                if res_m.get("status") == "success":
                    return pm["partIndex"], True, ""
                time.sleep(1 * attempt)
            return pm["partIndex"], False, "Failed after retries"

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(_upload_worker, pages_payloads[idx]) for idx in range(1, target_pages - 1)]
            for fut in as_completed(futures):
                p_idx, ok, err_msg = fut.result()
                if not ok:
                    log(f"⚠️ Part {p_idx} warning: {err_msg}")

    # Last part (20)
    p_last = pages_payloads[-1]
    p_last["folderUrl"] = folder_url
    p_last["isLastPart"] = True
    p_last["skipQueue"] = False
    p_last["uploadername"] = "Apt"
    p_last["uploadstatus"] = "เสร็จแล้ว"
    p_last["worklink"] = f"[อัป Raw] {folder_url}"
    p_last["note"] = f"Tencent 1-Click LDPlayer Concat 20 หน้า ลง แปลจนเมื่อย"

    res_last = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p_last)
    if res_last.get("status") != "success":
        log(f"⚠️ Last part notice: {res_last.get('message')}")

    log("✅ Upload & WorkQueue Registration Complete!")
    log(f"   🔗 Work Link: [อัป Raw] {folder_url}")
    log(f"   👤 Uploader: Apt | Status: เสร็จแล้ว")

    # Synchronize RawTracker and Mangas in GAS
    if manga_id:
        try:
            res_comp = call_gas("COMPLETE_RAW_TRACKER_CHAPTER", {
                "mangaId": manga_id,
                "chapterNum": chapter_title
            })
            if res_comp.get("success") or res_comp.get("status") == "success":
                log(f"   📊 RawTracker & Mangas synchronized: Ch {chapter_title} marked as complete.")
        except Exception as e:
            log(f"   ⚠️ RawTracker sync notice: {e}")

    # Automatically clean up local folders on computer per user mandate
    try:
        if local_chapter_dir.exists():
            shutil.rmtree(local_chapter_dir, ignore_errors=True)
            log(f"   🧹 [Auto-Cleanup] Cleared local computer folder -> {local_chapter_dir}")
    except Exception as e:
        log(f"   ⚠️ Local chapter folder cleanup notice: {e}")

    return True


def handle_screen_dialogs(adb_path: str, serial: str, auto_buy: bool = True) -> bool:
    """
    Checks and handles known Tencent Comic UI dialogs:
    0. '青少年守护模式' (Teen Mode modal) -> clicks '我知道了' (sure_btn)
    1. '进度同步提醒' (Progress Sync Alert) -> clicks '不，留在这里' (negative_btn)
    2. 'VIP / Ticket Point Purchase' -> clicks '确认购买' (one_btn)
    """
    handled = False
    try:
        ui_check = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/ui_temp.xml >/dev/null 2>&1 && cat /data/local/tmp/ui_temp.xml"
        )
        if not ui_check:
            return False

        # Case 0: Teen Mode Dialog ('青少年守护模式' / '我知道了')
        if "青少年" in ui_check or "我知道了" in ui_check or "sure_btn" in ui_check:
            tx, ty = find_node_center_by_id_or_text(
                ui_check, resource_ids=["sure_btn"], texts=["我知道了"], default=(450, 980)
            )
            log(f"🔔 Detected '青少年守护模式' (Teen Mode Alert)! Tapping '我知道了' at ({tx}, {ty})...")
            adb_command(adb_path, serial, "shell", f"input tap {tx} {ty}")
            handled = True
            time.sleep(1.2)
            ui_check = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/ui_temp.xml >/dev/null 2>&1 && cat /data/local/tmp/ui_temp.xml"
            )

        # Case 1: Progress Sync Alert (must NOT trigger on download confirmation dialog '确定下载')
        if ("进度同步提醒" in ui_check or "留在这里" in ui_check) and "确定下载" not in ui_check and "预估共" not in ui_check:
            log("🔔 Detected '进度同步提醒' (Progress Sync Alert)!")
            bx, by = find_node_center_by_id_or_text(
                ui_check, resource_ids=["negative_btn"], texts=["不，留在这里"], default=(341, 923)
            )
            log(f"👉 Auto-clicking '不，留在这里' (negative_btn) at ({bx}, {by})...")
            adb_command(adb_path, serial, "shell", f"input tap {bx} {by}")
            handled = True
            time.sleep(1.5)
            # Re-dump to check if VIP dialog appears right after dismissing sync alert
            ui_check = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/ui_temp.xml >/dev/null 2>&1 && cat /data/local/tmp/ui_temp.xml"
            )

        # Case 2: VIP / Ticket Payment Dialog
        if auto_buy and ("one_btn" in ui_check or "read_pay_layout" in ui_check or "点券" in ui_check or "确认购买" in ui_check):
            log("💳 Detected VIP / Ticket Payment Dialog on screen!")
            bx, by = find_node_center_by_id_or_text(
                ui_check, resource_ids=["one_btn"], texts=["确认购买"], default=(450, 1523)
            )
            log(f"👉 Auto-clicking '确认购买' (one_btn) at ({bx}, {by})...")
            adb_command(adb_path, serial, "shell", f"input tap {bx} {by}")
            handled = True
            time.sleep(2.2)

    except Exception as e:
        log(f"Dialog check notice: {e}")
    return handled


def execute_pipeline_for_chapter(
    adb_path: str,
    serial: str,
    script,
    session_manager: PipelineSessionManager,
    comic_id: str,
    chapter_id: str,
    chapter_name: str,
    manga_name: str,
    seq_no: str = "",
    manga_id: str = "",
    timeout: float = 35.0,
    auto_buy: bool = True,
    folder_url: str = "",
    expected_total_chapters: int = 0
) -> bool:
    """
    Executes single chapter processing via STRICT Native Offline Download (离线下载) only.
    Zero Reader Swipes. Extracts canonical slices from _image_info_list in exact localIndex order.
    """
    # 0. Check for canonical offline _image_info_list on LDPlayer first (100% correct order ground truth)
    offline_urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
    if not (offline_urls and len(offline_urls) >= 5):
        # 1. Trigger Native Offline Download (100% complete slices directly from Tencent Download Engine)
        log(f"📥 Attempting Native Offline Download for {manga_name} {chapter_name} (Seq {seq_no})...")
        offline_urls = trigger_native_offline_download(
            script=script,
            adb_path=adb_path,
            serial=serial,
            comic_id=comic_id,
            chapter_id=chapter_id,
            chapter_name=chapter_name,
            seq_no=seq_no,
            auto_buy=auto_buy,
            timeout=timeout,
            manga_name=manga_name,
            expected_total_chapters=expected_total_chapters
        )

    if not (offline_urls and len(offline_urls) >= 5):
        # Guard against hasty destructive recovery: if the download manager already reports the
        # target chapter as completed, re-check the filesystem a couple of times instead of
        # Pencil -> Select All -> Delete (which would wipe a perfectly good download).
        target_seq_c = str(seq_no).strip() or chapter_name
        alt_seq_c = re.sub(r"\D", "", chapter_name)
        dm_state = check_download_manager_chapter_status(adb_path, serial, target_seq_c, alt_seq_c)
        if dm_state == "completed":
            log(f"   ✅ DownloadManagerActivity reports Ch {chapter_name} completed; waiting for files before any cleanup...")
            for _ in range(5):
                time.sleep(3.0)
                offline_urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
                if offline_urls and len(offline_urls) >= 5:
                    break
            if offline_urls and len(offline_urls) >= 5:
                log(f"   🎉 Recovered {len(offline_urls)} slices without re-downloading.")
            else:
                log(f"   ⚠️ Ch {chapter_name} downloaded (dm_state=completed) but _image_info_list not readable yet; "
                    f"skipping destructive recovery (will be picked up on next run).")
                return False
        else:
            # Recovery & Retry #1: Select >= 1 chapter -> DownloadManagerActivity -> Pencil -> Select All -> Delete -> Re-download target 1 chapter
            log(f"⚠️ First attempt offline download failed for {manga_name} {chapter_name} (dm_state={dm_state}). Executing Pencil -> Select All -> Delete recovery before retry...")
            recover_download_via_pencil_delete_all(
                adb_path=adb_path,
                serial=serial,
                comic_id=comic_id,
                script=script,
                exclude_seq=seq_no,
                manga_name=manga_name
            )
            time.sleep(0.8)
            offline_urls = trigger_native_offline_download(
                script=script,
                adb_path=adb_path,
                serial=serial,
                comic_id=comic_id,
                chapter_id=chapter_id,
                chapter_name=chapter_name,
                seq_no=seq_no,
                auto_buy=auto_buy,
                timeout=timeout,
                manga_name=manga_name,
                expected_total_chapters=expected_total_chapters
            )

        if not (offline_urls and len(offline_urls) >= 5):
            # Re-check dm_state before Retry #2 so we NEVER run destructive Pencil -> Delete on a completed download
            dm_state_retry = check_download_manager_chapter_status(adb_path, serial, target_seq_c, alt_seq_c)
            if dm_state == "completed" or dm_state_retry == "completed":
                log(f"   ✅ DownloadManagerActivity reports Ch {chapter_name} completed before 2nd retry; waiting for files...")
                for _ in range(5):
                    time.sleep(3.0)
                    offline_urls = check_offline_image_info_list(adb_path, serial, comic_id, chapter_id)
                    if offline_urls and len(offline_urls) >= 5:
                        break
                if offline_urls and len(offline_urls) >= 5:
                    log(f"   🎉 Recovered {len(offline_urls)} slices without 2nd destructive retry.")
                else:
                    log(f"   ⚠️ Ch {chapter_name} completed in DownloadManagerActivity (dm_state={dm_state_retry}) but _image_info_list not readable yet; "
                        f"aborting Pencil -> Delete to preserve completed download for next run.")
                    return False
            else:
                log(f"⚠️ Second attempt offline download needed for {manga_name} {chapter_name} (dm_state={dm_state_retry}). Executing Pencil -> Select All -> Delete recovery...")
                recover_download_via_pencil_delete_all(
                    adb_path=adb_path,
                    serial=serial,
                    comic_id=comic_id,
                    script=script,
                    exclude_seq=seq_no,
                    manga_name=manga_name
                )
                time.sleep(0.8)
                offline_urls = trigger_native_offline_download(
                    script=script,
                    adb_path=adb_path,
                    serial=serial,
                    comic_id=comic_id,
                    chapter_id=chapter_id,
                    chapter_name=chapter_name,
                    seq_no=seq_no,
                    auto_buy=auto_buy,
                    timeout=timeout,
                    manga_name=manga_name,
                    expected_total_chapters=expected_total_chapters
                )

    if not (offline_urls and len(offline_urls) >= 5):
        log(f"❌ Native Offline Download failed for {manga_name} {chapter_name}. (Swipe reader fallback is permanently disabled per user mandate)")
        return False

    log(f"🏆 Found canonical offline _image_info_list ({len(offline_urls)} slices) in exact localIndex order!")
    save_dir = REPO_ROOT / "scratch" / "plaintext_dumps"
    save_dir.mkdir(parents=True, exist_ok=True)
    txt_path = save_dir / f"chapter_{comic_id}_{chapter_id}_urls.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for u in offline_urls:
            f.write(u + "\n")
    log(f"   💾 Saved canonical URL list -> {txt_path}")

    # Stitch, Slice into standard 20 pages, Upload to Drive, Register in GAS WorkQueue, Auto-Clean local files
    ok = process_and_upload_chapter(
        urls=offline_urls,
        manga_name=manga_name,
        chapter_title=chapter_name,
        manga_id=manga_id,
        folder_url=folder_url,
        skip_sort=True
    )

    if ok:
        try:
            raw_pc_dir = REPO_ROOT / "downloads" / "offline_raw" / f"{comic_id}_{chapter_id}"
            if raw_pc_dir.exists():
                shutil.rmtree(raw_pc_dir, ignore_errors=True)
                log(f"   🧹 [Auto-Cleanup] Cleared local raw slices folder -> {raw_pc_dir}")
        except Exception as e:
            log(f"   ⚠️ Raw slices cleanup notice: {e}")

    return ok


def clear_device_offline_cache(adb_path: str, serial: str, comic_id: str, chapter_id: str) -> None:
    """
    Deletes the Tencent app's on-device offline cache for ONE chapter
    (/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}) AND clears the
    DownloadManagerActivity entry so the ⬇️ badge in DownloadChapterSelectActivity is also removed.
    This ensures the next run does not shortcut on a stale _image_info_list and does not hit
    a stuck ⬇️ badge on the chapter grid.
    App-private storage on Android 11+ is TCC-blocked for adb, so a permission error is only a NOTICE.
    """
    remote_dir = f"/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}"
    log(f"   🧹 [Device-Cache Cleanup] Removing on-device offline cache -> {remote_dir} ...")
    adb_command(adb_path, serial, "shell", f"rm -rf {remote_dir}")
    left = adb_command(adb_path, serial, "shell", f"ls {remote_dir} 2>/dev/null")
    if left.strip():
        log(f"   ⚠️ Device-cache deletion blocked by Android app-private storage (TCC); files remain: {left.strip()[:200]}")
    else:
        log("   🧹 [Device-Cache Cleanup] On-device offline cache cleared for this chapter.")

    # Also clear the comic's DownloadManagerActivity queue directly so the ⬇️ badge is removed cleanly
    try:
        adb_command(
            adb_path, serial, "shell",
            f"su 0 am start -f 0x14008000 -n com.qq.ac.android/.view.activity.DownloadManagerActivity --es STR_MSG_COMIC_ID {comic_id}"
        )
        time.sleep(1.5)
        xml_dm = adb_command(
            adb_path, serial, "shell",
            "uiautomator dump /data/local/tmp/clean_dm.xml >/dev/null 2>&1 && cat /data/local/tmp/clean_dm.xml"
        )
        if xml_dm and ("tv_actionbar_edit" in xml_dm) and ('resource-id="com.qq.ac.android:id/seq"' in xml_dm):
            log(f"   🧹 [Device-Cache Cleanup] Clearing DownloadManagerActivity entries for Comic {comic_id} to reset ⬇️ badge...")
            edit_x, edit_y = find_node_center_by_id_or_text(xml_dm, resource_ids=["tv_actionbar_edit"], default=(868, 69))
            adb_command(adb_path, serial, "shell", f"input tap {edit_x} {edit_y}")
            time.sleep(0.8)
            adb_command(adb_path, serial, "shell", "input tap 224 1551")
            time.sleep(0.7)
            adb_command(adb_path, serial, "shell", "input tap 675 1551")
            time.sleep(0.8)
            xml_dlg = adb_command(
                adb_path, serial, "shell",
                "uiautomator dump /data/local/tmp/clean_dm_dlg.xml >/dev/null 2>&1 && cat /data/local/tmp/clean_dm_dlg.xml"
            )
            if xml_dlg and any(k in xml_dlg for k in ["positive_btn", "是的", "确认删除", "确定"]):
                px, py = find_node_center_by_id_or_text(
                    xml_dlg, resource_ids=["positive_btn"], texts=["是的", "确定"], default=(557, 880)
                )
                adb_command(adb_path, serial, "shell", f"input tap {px} {py}")
                time.sleep(1.0)
            adb_command(adb_path, serial, "shell", "input keyevent 4")
    except Exception as e:
        log(f"   ⚠️ [Device-Cache Cleanup] DownloadManager badge reset notice: {e}")


def main():
    parser = argparse.ArgumentParser(description="Tencent Comic LDPlayer 1-Click Automation Pipeline")
    parser.add_argument("--comic-id", default="", help="Tencent Comic ID (e.g. 657583, 656779)")
    parser.add_argument("--chapter-id", default="", help="Tencent Chapter ID (e.g. 139650, 139696)")
    parser.add_argument("--chapter", default="", help="Single chapter number (e.g. 22)")
    parser.add_argument("--chapters", default="", help="Chapters spec: e.g. '22-25', '22,23,24', '22'")
    parser.add_argument("--manga-name", default="", help="Manga title")
    parser.add_argument("--manga-id", default="", help="Manga ID in GAS WorkQueue")
    parser.add_argument("--all-pending", action="store_true", help="Fetch pending items from GAS WorkQueue & RawTracker (Default mode)")
    parser.add_argument("--all-unreleased", action="store_true", help="Alias for --all-pending")
    parser.add_argument("--dry-run", action="store_true", help="Query and list pending tasks without starting emulator or downloading")
    parser.add_argument("--cooldown", type=int, default=20, help="Cool-down seconds between chapters (default: 20)")
    parser.add_argument("--hide", action="store_true", help="Minimize/hide LDPlayer emulator window")
    parser.add_argument("--adb", default=None, help="Explicit path to adb.exe")
    parser.add_argument("--port", type=int, default=DEFAULT_FRIDA_PORT, help="Frida server port")
    parser.add_argument("--timeout", type=float, default=35.0, help="Capture timeout per chapter in seconds")
    parser.add_argument("--no-auto-buy", action="store_true", help="Disable automatic VIP Point purchase")
    parser.add_argument("--urls-file", default="", help="Path to text file containing image slice URLs to process directly without LDPlayer")
    parser.add_argument("--info-file", default="", help="Path to Tencent _image_info_list file to process in canonical localIndex order")
    parser.add_argument("--folder-url", default="", help="Existing Google Drive folder URL to overwrite/sync into")
    args = parser.parse_args()

    # DEFAULT TO --all-pending: If no specific chapter, urls-file, info-file, or dry-run requested,
    # default to downloading all pending QQ / Tencent jobs!
    if not args.chapter and not args.chapters and not args.urls_file and not args.info_file and not args.dry_run and not args.all_pending and not args.all_unreleased:
        log("💡 No specific chapter specified. Defaulting to --all-pending mode (Download all pending QQ / Tencent jobs).")
        args.all_pending = True

    # DRY RUN / QUERY ONLY MODE
    if args.dry_run:
        log("🔍 [DRY RUN] Fetching pending Tencent tasks from GAS WorkQueue & RawTracker...")
        pending_items = query_pending_gas_queue()
        if args.comic_id:
            pending_items = [p for p in pending_items if str(p.get("comicid", "")).strip() == str(args.comic_id).strip()]
        if args.manga_id:
            pending_items = [p for p in pending_items if str(p.get("mangaid", "")).strip() == str(args.manga_id).strip()]
        if args.manga_name:
            pending_items = [p for p in pending_items if args.manga_name.lower() in str(p.get("manganame", "")).lower()]

        print("\n" + "=" * 70)
        print(f"📊 [DRY RUN RESULT] Total Pending Chapter Tasks: {len(pending_items)}")
        print("=" * 70)
        grouped = {}
        for item in pending_items:
            m_title = item.get("manganame", "Unknown")
            grouped.setdefault(m_title, []).append(item)

        print(f"Total Unique Titles: {len(grouped)}\n")
        for idx, (m_title, task_list) in enumerate(grouped.items(), 1):
            c_id = task_list[0].get("comicid", "")
            src = task_list[0].get("source", "")
            chapters = [t.get("chapter") for t in task_list]
            print(f"{idx}. {m_title} (Comic ID: {c_id}) [{src}]")
            print(f"   -> {len(chapters)} ตอน: Ch {', '.join(chapters)}")
        print("=" * 70)
        sys.exit(0)

    # MODE 0A: Direct _image_info_list file processing (Canonical localIndex order ground truth)
    if args.info_file:
        info_path = Path(args.info_file)
        if not info_path.exists():
            log(f"ERROR: _image_info_list file not found: {args.info_file}")
            sys.exit(1)
        ordered_urls = extract_urls_from_image_info_list(info_path)
        if not ordered_urls:
            log("ERROR: No URLs found in _image_info_list.")
            sys.exit(1)
        log(f"📂 Extracted {len(ordered_urls)} canonical slice URLs from {args.info_file}")

        m_name = args.manga_name or "命轮之主！当异变降临人间"
        ch_name = args.chapter or "278"
        m_id = args.manga_id or "14"
        f_url = args.folder_url or ""

        save_dir = REPO_ROOT / "scratch" / "plaintext_dumps"
        save_dir.mkdir(parents=True, exist_ok=True)
        txt_path = save_dir / f"chapter_{args.comic_id or 'offline'}_{args.chapter_id or ch_name}_urls.txt"
        with open(txt_path, "w", encoding="utf-8") as f:
            for u in ordered_urls:
                f.write(u + "\n")
        log(f"   💾 Saved canonical URL list -> {txt_path}")

        success = process_and_upload_chapter(
            urls=ordered_urls,
            manga_name=m_name,
            chapter_title=ch_name,
            manga_id=m_id,
            folder_url=f_url,
            skip_sort=True
        )
        sys.exit(0 if success else 1)

    # MODE 0: Direct URLs file processing (Offline / Reprocessing mode - zero emulator dependency)
    if args.urls_file:
        urls_file_path = Path(args.urls_file)
        if not urls_file_path.exists():
            log(f"ERROR: URLs file not found: {args.urls_file}")
            sys.exit(1)
        raw_urls = [line.strip() for line in urls_file_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not raw_urls:
            log("ERROR: URLs file is empty.")
            sys.exit(1)
        log(f"📂 Loaded {len(raw_urls)} URLs from {args.urls_file}")

        # Always sort slice URLs by sequence ID
        sorted_urls = sort_slice_urls(raw_urls)
        with open(urls_file_path, "w", encoding="utf-8") as f:
            for u in sorted_urls:
                f.write(u + "\n")
        log(f"💾 Updated {urls_file_path} with strictly sorted URLs.")

        m_name = args.manga_name or "命轮之主！当异变降临人间"
        ch_title = args.chapter or "278"
        m_id = args.manga_id or "14"
        f_url = args.folder_url or ""

        log(f"🚀 Reprocessing chapter '{ch_title}' for '{m_name}' (Manga ID: {m_id})...")
        ok = process_and_upload_chapter(
            urls=sorted_urls,
            manga_name=m_name,
            chapter_title=ch_title,
            manga_id=m_id,
            folder_url=f_url
        )
        if ok:
            log(f"🎉 Chapter {ch_title} re-processed and uploaded successfully!")
            sys.exit(0)
        else:
            log(f"❌ Failed processing chapter {ch_title} from URLs file.")
            sys.exit(1)

    log("=================================================================")
    log("🚀 Tencent Comic 1-Click LDPlayer Batch Pipeline Initializing...")
    log("=================================================================")

    if args.hide:
        hide_ldplayer_window()

    adb_path = args.adb or find_tool(ADB_CANDIDATES, "adb")
    log(f"Using ADB: {adb_path}")
    serial = pick_adb_device(adb_path, auto_launch=True, hide=args.hide)
    if not serial:
        log("ERROR: No ADB device found. Ensure LDPlayer is running.")
        sys.exit(1)
    log(f"Connected to device: {serial}")

    ensure_frida_server(adb_path, serial, args.port)

    pid_str = adb_command(adb_path, serial, "shell", f"pidof {APP_ID}").strip()
    if not pid_str:
        log(f"App {APP_ID} not running. Launching SplashActivity...")
        adb_command(adb_path, serial, "shell", f"am start -n {APP_ID}/.splash.SplashActivity")
        time.sleep(4.0)
        pid_str = adb_command(adb_path, serial, "shell", f"pidof {APP_ID}").strip()

    if not pid_str:
        log("ERROR: Unable to start or find com.qq.ac.android process.")
        sys.exit(1)

    pid = int(pid_str.split()[0])
    log(f"Target process active: {APP_ID} (PID={pid})")

    import frida
    device_manager = frida.get_device_manager()
    frida_device = device_manager.add_remote_device(f"127.0.0.1:{args.port}")
    session = frida_device.attach(pid)
    log(f"Frida {frida.__version__} attached to PID {pid}.")

    session_manager = PipelineSessionManager()
    script = session.create_script(FRIDA_JS_INSTRUMENTATION)
    script.on("message", session_manager.on_message)
    script.load()
    time.sleep(1.0)
    log("Instrumentation script loaded.")

    success_chapters = 0
    failed_chapters = 0

    try:
        # MODE 1: All Pending / All Unreleased from WorkQueue & RawTracker
        if args.all_pending or args.all_unreleased:
            log("🔍 Fetching pending Tencent tasks from GAS WorkQueue & RawTracker...")
            pending_items = query_pending_gas_queue()
            if args.comic_id:
                pending_items = [p for p in pending_items if str(p.get("comicid", "")).strip() == str(args.comic_id).strip()]
            if args.manga_id:
                pending_items = [p for p in pending_items if str(p.get("mangaid", "")).strip() == str(args.manga_id).strip()]
            if args.manga_name:
                pending_items = [p for p in pending_items if args.manga_name.lower() in str(p.get("manganame", "")).lower()]
            log(f"Found {len(pending_items)} pending task(s).")

            if not pending_items:
                log("✨ No pending Tencent tasks found. WorkQueue is up to date!")
            else:
                comic_tocs = {}
                for idx, item in enumerate(pending_items):
                    m_name = item.get("manganame", "")
                    ch_num = str(item.get("chapter", ""))
                    raw_url = item.get("rawurl", "") or item.get("originalurl", "")
                    m_cid = re.search(r"id/(\d+)", raw_url)
                    cid_from_url = m_cid.group(1) if m_cid else str(item.get("comicid", "")).strip()
                    item_cid = str(item.get("cid", "")).strip()

                    if not cid_from_url:
                        continue

                    log(f"\n▶️ [{idx+1}/{len(pending_items)}] Processing pending: {m_name} Ch {ch_num} (Comic {cid_from_url})...")

                    # Initialize matched safely for every pending item
                    matched = None

                    # Retrieve or fetch comic TOC (cached per comic_id for performance)
                    if cid_from_url not in comic_tocs:
                        comic_tocs[cid_from_url] = fetch_tencent_chapter_list(cid_from_url)
                    comic_title, ch_list = comic_tocs[cid_from_url]
                    if not m_name and comic_title:
                        m_name = comic_title

                    # Resolve matched chapter by CID first (ground truth from RawTracker_Pending), then by chapter_num
                    if ch_list:
                        if item_cid:
                            matched = find_chapter_by_spec(ch_list, item_cid)
                        if not matched:
                            matched = find_chapter_by_spec(ch_list, ch_num)

                    if matched:
                        if not item_cid:
                            item_cid = matched["cid"]
                            log(f"   ✓ Mapped chapter {ch_num} -> CID {item_cid} ('{matched['title']}') [Seq: {matched.get('seq_no', '')}]")
                        else:
                            log(f"   ✓ Confirmed chapter {ch_num} (CID {item_cid}, Seq {matched.get('seq_no', '')}) -> '{matched['title']}'")

                    if not item_cid:
                        log(f"   ⚠️ Could not find CID for {m_name} Ch {ch_num}. Skipping.")
                        failed_chapters += 1
                        continue

                    seq_val = matched.get("seq_no", "") if matched else ""
                    item_manga_id = str(item.get("mangaid", "")).strip()
                    ok = execute_pipeline_for_chapter(
                        adb_path=adb_path,
                        serial=serial,
                        script=script,
                        session_manager=session_manager,
                        comic_id=cid_from_url,
                        chapter_id=item_cid,
                        chapter_name=ch_num,
                        manga_name=m_name,
                        seq_no=seq_val,
                        manga_id=item_manga_id,
                        timeout=args.timeout,
                        auto_buy=not args.no_auto_buy,
                        expected_total_chapters=len(ch_list) if ch_list else 0
                    )

                    if ok:
                        success_chapters += 1
                    else:
                        failed_chapters += 1

                    # Clear THIS chapter's on-device cache immediately after it finishes
                    clear_device_offline_cache(adb_path, serial, cid_from_url, item_cid)

                    if idx < len(pending_items) - 1:
                        run_cooldown(args.cooldown)

        # MODE 2: Specific Chapter(s) via --chapters or --chapter
        else:
            comic_id = args.comic_id or "657583"
            raw_spec = args.chapters or args.chapter or "22"
            ch_specs = parse_chapter_spec(raw_spec)

            log(f"📖 Fetching TOC for Comic ID: {comic_id}...")
            comic_title, ch_list = fetch_tencent_chapter_list(comic_id)
            manga_name = args.manga_name or comic_title
            log(f"   Manga: '{manga_name}' | Total TOC Chapters: {len(ch_list)}")
            log(f"   Target Chapters: {ch_specs}")

            # Auto-resolve Manga ID from GAS if not provided
            target_manga_id = args.manga_id
            if not target_manga_id:
                try:
                    m_res = call_gas("GET_MANGA_LIST", {})
                    for m in m_res.get("data", []):
                        ourl = str(m.get("originalurl", "")).lower()
                        if f"id/{comic_id}".lower() in ourl or comic_id == str(m.get("comicid", "")):
                            target_manga_id = str(m.get("mangaid", ""))
                            log(f"   💡 Auto-resolved Manga ID: {target_manga_id} ('{m.get('manganame')}')")
                            break
                except Exception:
                    pass

            # Match and plan tasks
            tasks_to_run = []
            for spec in ch_specs:
                matched = find_chapter_by_spec(ch_list, spec)
                if matched:
                    tasks_to_run.append({
                        "cid": matched["cid"],
                        "chapter_name": matched.get("chapter_num") or spec,
                        "seq_no": matched.get("seq_no", ""),
                        "title": matched["title"]
                    })
                elif args.chapter_id and len(ch_specs) == 1:
                    # Direct manual CID override
                    tasks_to_run.append({
                        "cid": args.chapter_id,
                        "chapter_name": spec,
                        "seq_no": spec,
                        "title": f"Chapter {spec}"
                    })
                else:
                    log(f"⚠️ Chapter '{spec}' not found in TOC for Comic {comic_id}. Skipping.")

            log(f"📋 Queued {len(tasks_to_run)} chapter(s) for execution.")

            for idx, task in enumerate(tasks_to_run):
                log(f"\n▶️ [{idx+1}/{len(tasks_to_run)}] Processing: {manga_name} {task['chapter_name']} (CID {task['cid']})...")

                ok = execute_pipeline_for_chapter(
                    adb_path=adb_path,
                    serial=serial,
                    script=script,
                    session_manager=session_manager,
                    comic_id=comic_id,
                    chapter_id=task["cid"],
                    chapter_name=task["chapter_name"],
                    manga_name=manga_name,
                    seq_no=task.get("seq_no", ""),
                    manga_id=target_manga_id,
                    timeout=args.timeout,
                    auto_buy=not args.no_auto_buy,
                    expected_total_chapters=len(ch_list) if ch_list else 0
                )

                if ok:
                    success_chapters += 1
                else:
                    failed_chapters += 1

                # Clear THIS chapter's on-device cache + DownloadManager ⬇️ badge immediately after it finishes
                clear_device_offline_cache(adb_path, serial, comic_id, task["cid"])

                if idx < len(tasks_to_run) - 1:
                    run_cooldown(args.cooldown)

    finally:
        try:
            if 'script' in locals() and script:
                script.unload()
            if 'session' in locals() and session:
                session.detach()
        except Exception:
            pass

    log("\n=================================================================")
    log(f"🏁 Tencent Pipeline Batch Execution Finished: {success_chapters} Succeeded, {failed_chapters} Failed.")
    log("=================================================================")
    if failed_chapters > 0 and success_chapters == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

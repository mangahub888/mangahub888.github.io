DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kairew 6-Hour Growth Tracker Engine
-----------------------------------
Tracks Total Sales and Views for all comics across Kairew writer account:
- Account: แปลจนเมื่อย (0886172880 / poom112345ad)

Features:
- Fetches all 79 comics, sales, view counts, chapters, and last update dates.
- Records periodic snapshots based on OUR recording date.
- Computes:
  - 7-day delta & % growth rate (Sales & Views)
  - 30-day delta & % growth rate (Sales & Views)
- Classifies inactivity (> 30 days without new chapters).
- Saves historical timeline to Git JSON (tools/data/kairew_history.json).
- Saves latest snapshot to tools/data/kairew_growth_latest.json.
- Synchronizes with Google Sheet tab `KairewGrowth` (overwriting current snapshot, zero bloat).
"""

import os
import sys
import time
import json
import re
import html
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import requests
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_FILE = os.path.join(DATA_DIR, "kairew_history.json")
LATEST_GROWTH_FILE = os.path.join(DATA_DIR, "kairew_growth_latest.json")
PROFILE_DIR = os.path.join(BASE_DIR, ".chrome_kairew")
AUTH_FILE = os.path.join(DATA_DIR, "kairew_auth.json")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PROFILE_DIR, exist_ok=True)

ACCOUNT_INFO = {
    "id": "kairew_adieu",
    "name": "แปลจนเมื่อย (Kairew)",
    "username": "0886172880",
    "email": "hiyamuraesumi@gmail.com",
    "writer_id": 269
}

try:
    from browser_utils import get_browser_executable_path, set_browser_window_bottom_most
except ImportError:
    try:
        from tools.browser_utils import get_browser_executable_path, set_browser_window_bottom_most
    except ImportError:
        def get_browser_executable_path() -> Optional[str]:
            candidates = [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            ]
            for p in candidates:
                if os.path.exists(p):
                    return p
            return None

        def set_browser_window_bottom_most(title_filter: str = ""):
            pass

def fetch_kairew_data_via_requests() -> Optional[Dict[str, Any]]:
    """Try fetching directly via HTTP requests using stored session cookies (Zero-overhead, 1.5s)."""
    if not os.path.exists(AUTH_FILE):
        return None
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            auth = json.load(f)
        cookies = {c["name"]: c["value"] for c in auth.get("cookies", [])}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        }
        r = requests.get("https://kairew.com/writer/manage-book", cookies=cookies, headers=headers, timeout=20)
        if r.status_code == 200 and "data-page=" in r.text:
            m = re.search(r'data-page="([^"]+)"', r.text)
            if m:
                page_data = json.loads(html.unescape(m.group(1)))
                if page_data.get("props", {}).get("cartoon_list"):
                    print("✓ ดึงข้อมูลสำเร็จโดยตรงผ่าน HTTP Session Cookies (รวดเร็ว < 2 วินาที)")
                    return page_data
    except Exception as e:
        print(f"⚠️ Direct HTTP fetch notice: {e}")
    return None

def fetch_kairew_data_via_browser(headless: bool = False) -> Dict[str, Any]:
    """Launch persistent context to extract manage-book props from Kairew in visible non-headless mode."""
    exec_path = get_browser_executable_path()
    mode_str = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"
    print(f"🌐 [Kairew] กำลังเปิด {mode_str} เพื่อดึงข้อมูล...", flush=True)

    with sync_playwright() as p:
        launch_kwargs = {
            "headless": headless,
            "channel": "chrome",
            "no_viewport": True,
            "ignore_default_args": ["--enable-automation"],
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars"
            ]
        }
        if exec_path:
            launch_kwargs["executable_path"] = exec_path

        try:
            context = p.chromium.launch_persistent_context(user_data_dir=PROFILE_DIR, **launch_kwargs)
        except Exception as e_launch:
            print(f"⚠️ [Kairew] ไม่สามารถเปิดด้วย channel='chrome' ({e_launch}) กำลังลองใช้ Chromium ปกติ...")
            launch_kwargs.pop("channel", None)
            context = p.chromium.launch_persistent_context(user_data_dir=PROFILE_DIR, **launch_kwargs)

        if not headless:
            set_browser_window_bottom_most("kairew")

        page = context.pages[0] if context.pages else context.new_page()

        print("Navigating to https://kairew.com/writer/manage-book ...", flush=True)
        page.goto("https://kairew.com/writer/manage-book", wait_until="domcontentloaded")
        if not headless:
            set_browser_window_bottom_most("kairew")
        time.sleep(4)

        # Check if redirected to login
        if "/login" in page.url or "attention required" in page.title().lower():
            print("Session not authenticated or challenge present. Navigating via login flow...", flush=True)
            page.goto("https://kairew.com/login", wait_until="domcontentloaded")
            time.sleep(3)

            user_inp = page.locator("input[placeholder*='เบอร์'], input[placeholder*='อีเมล']").first
            pass_inp = page.locator("input[type='password']").first
            if user_inp.count() and pass_inp.count():
                user_inp.click()
                user_inp.fill("0886172880")
                pass_inp.click()
                pass_inp.fill("poom112345ad")

            btn = page.locator("button[type='submit'], button.btn-login").first
            for _ in range(25):
                time.sleep(1)
                if "/login" not in page.url:
                    break
                if btn.count() and not btn.is_disabled():
                    btn.click()
                    time.sleep(3)
                    break

            page.goto("https://kairew.com/writer/manage-book", wait_until="domcontentloaded")
            time.sleep(4)

        props_data = page.evaluate("""() => {
            const app = document.getElementById('app');
            if (!app) return null;
            try {
                return JSON.parse(app.dataset.page);
            } catch(e) { return null; }
        }""")

        context.storage_state(path=AUTH_FILE)
        context.close()
        return props_data or {}


THAI_MONTHS_LIST = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

def fetch_all_kairew_monthly_stats(cartoon_list: List[Dict[str, Any]], year: int = None) -> Dict[str, Dict[str, float]]:
    """Fetch exact monthly sales for each Kairew comic via manage-book/stat/{id}?filter_type=year endpoint."""
    if not year:
        year = datetime.now().year
    print(f"\n📊 กำลังดึงสถิติยอดขายรายเดือน (รอบจริง) ของ Kairew ประจำปี {year} สำหรับการ์ตูนทั้ง {len(cartoon_list)} เรื่อง...", flush=True)
    
    if not os.path.exists(AUTH_FILE):
        return {}
    try:
        with open(AUTH_FILE, 'r', encoding='utf-8') as f:
            auth = json.load(f)
        cookies = {c['name']: c['value'] for c in auth.get('cookies', [])}
    except Exception:
        return {}

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    }
    monthly_map = {}

    def fetch_one(c):
        cid = str(c.get('id'))
        url = f'https://kairew.com/writer/manage-book/stat/{cid}?filter_type=year&year={year}'
        try:
            r = requests.get(url, cookies=cookies, headers=headers, timeout=15)
            if r.status_code == 200 and 'data-page=' in r.text:
                m = re.search(r'data-page="([^"]+)"', r.text)
                if m:
                    p = json.loads(html.unescape(m.group(1))).get('props', {})
                    graph = p.get('graph', {})
                    data_arr = graph.get('data', [])
                    res_dict = {}
                    for i, m_name in enumerate(THAI_MONTHS_LIST):
                        val = round(float(data_arr[i] or 0.0), 2) if i < len(data_arr) else 0.0
                        res_dict[m_name] = val
                    return cid, res_dict
        except Exception:
            pass
        return cid, {}

    with ThreadPoolExecutor(max_workers=5) as executor:
        for cid, res_dict in executor.map(fetch_one, cartoon_list):
            if res_dict:
                monthly_map[cid] = res_dict

    print(f"✓ ดึงสถิติยอดขายรายเดือน Kairew สำเร็จ: {len(monthly_map)} เรื่อง", flush=True)
    return monthly_map

def calculate_growth_rate(current_val: float, past_val: float):
    delta = current_val - past_val
    if past_val > 0:
        pct = round((delta / past_val) * 100.0, 2)
    elif past_val == 0 and current_val == 0:
        pct = 0.0
    else:
        pct = 100.0 if delta > 0 else 0.0
    return delta, pct

def send_data_to_gas(report_output: Dict[str, Any], gas_url: str, passcode: str = "10211032") -> bool:
    """Send latest growth snapshot to GAS Web App backend."""
    if not gas_url:
        return False
    print(f"\n📡 กำลังส่งข้อมูลสถิติ Kairew ไปยัง Google Apps Script Backend...", flush=True)
    try:
        payload = {
            "action": "SAVE_KAIREW_GROWTH_DATA",
            "passcode": passcode,
            "payload": report_output
        }
        data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            gas_url,
            data=data_bytes,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "MangaHub-Kairew-Tracker"
            }
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            print(f"✓ ส่งข้อมูลไปยัง GAS สำเร็จ: {res_json.get('status')}", flush=True)
            return True
    except Exception as e:
        print(f"❌ ส่งข้อมูลไปยัง GAS ไม่สำเร็จ: {e}", flush=True)
        return False

def run_kairew_pipeline(send_to_gas: bool = False, gas_url: str = "", passcode: str = "10211032", use_browser: bool = True, headless: bool = False):
    now = datetime.now(timezone.utc)
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")
    snapshot_time_key = now.strftime("%Y-%m-%d_%H%M")

    print("\n" + "=" * 70)
    print(f"🚀 Kairew 6-Hour Growth Pipeline: กำลังบันทึกข้อมูลสถิติรอบ {recorded_at}")
    print("=" * 70)

    # 1. Fetch current data
    page_data = {}
    print("🔄 กำลังตรวจสอบการดึงข้อมูลจาก Kairew...")
    # Try browser or direct fast HTTP requests
    page_data = fetch_kairew_data_via_browser(headless=headless) if use_browser else fetch_kairew_data_via_requests() or {}

    # If direct fetch didn't return data, check cached props file (< 30 mins)
    if not page_data or not page_data.get("props"):
        cached_props_file = os.path.join(DATA_DIR, "kairew_manage_book_props.json")
        if os.path.exists(cached_props_file) and (time.time() - os.path.getmtime(cached_props_file) < 1800):
            try:
                with open(cached_props_file, "r", encoding="utf-8") as f:
                    page_data = json.load(f)
                print("✓ ใช้ข้อมูลสถิติล่าสุดจากแคช (tools/data/kairew_manage_book_props.json)")
            except Exception:
                page_data = {}

    # Fallback to Playwright browser automation if needed
    if not page_data or not page_data.get("props"):
        print("🔄 เริ่มต้นเบราว์เซอร์เพื่อดึงข้อมูลสดจาก Kairew...")
        page_data = fetch_kairew_data_via_browser(headless=headless)

    props = page_data.get("props", {})
    cartoon_list = props.get("cartoon_list", [])
    writer_info = props.get("writer", {})

    if not cartoon_list:
        print("❌ ไม่พบข้อมูลการ์ตูนจาก Kairew! กรุณาตรวจสอบการเข้าสู่ระบบ")
        return

    # Total overview
    lifetime_sales = sum(float(c.get("sales") or 0.0) for c in cartoon_list)
    total_views_overall = sum(int(c.get("view_count") or 0) for c in cartoon_list)
    total_eps_overall = sum(int(c.get("episode_count") or 0) for c in cartoon_list)

    print(f"💰 ข้อมูลบัญชี: ยอดขายสะสม {lifetime_sales:,.2f} บาท | ยอดวิวรวม {total_views_overall:,} วิว | จำนวนผลงาน {len(cartoon_list)} เรื่อง")

    # 2. Fetch exact monthly sales per comic
    monthly_sales_map = fetch_all_kairew_monthly_stats(cartoon_list, year=now.year)
    for c in cartoon_list:
        cid = str(c.get('id'))
        if cid in monthly_sales_map:
            c['monthly_sales'] = monthly_sales_map[cid]
    try:
        with open(os.path.join(DATA_DIR, 'kairew_manage_book_props.json'), 'w', encoding='utf-8') as f:
            json.dump({'props': props}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    # 3. Build current snapshot dict
    current_snap_dict = {}

    for c in cartoon_list:
        cid = str(c.get("id"))
        title = c.get("name", "")
        sales = float(c.get("sales") or 0.0)
        views = int(c.get("view_count") or 0)
        eps = int(c.get("episode_count") or 0)
        last_ep_str = c.get("episode_last_at") or ""

        # Inactivity calculation
        if last_ep_str:
            try:
                # Format: "2026-11-03 13:21:15" or ISO
                clean_str = last_ep_str.strip().replace("T", " ").replace("Z", "").split(".")[0]
                last_ep_dt = datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                days_inactive = max(0, (now - last_ep_dt).days)
            except Exception as e:
                days_inactive = 999
        else:
            days_inactive = 999

        is_inactive_30d = (days_inactive > 30)

        current_snap_dict[cid] = {
            "subject": title,
            "account": ACCOUNT_INFO["name"],
            "account_id": ACCOUNT_INFO["id"],
            "total_views": views,
            "total_sales": sales,
            "chapters_count": eps,
            "last_chapter_updated_at": last_ep_str,
            "days_inactive": days_inactive,
            "is_inactive_30d": is_inactive_30d,
            "monthly_sales": monthly_sales_map.get(cid, {})
        }

    # 3. Load past history
    history = {}
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = {}

    daily_snaps = history.get("daily_snapshots", {})
    six_hour_snaps = history.get("timeline_6h", [])

    daily_snaps[snapshot_date_key] = current_snap_dict
    six_hour_snaps.append({
        "timestamp": recorded_at,
        "key": snapshot_time_key,
        "total_comics": len(cartoon_list),
        "total_sales_portfolio": lifetime_sales,
        "total_views_portfolio": total_views_overall,
        "snapshot": current_snap_dict
    })

    if len(six_hour_snaps) > 1200:
        six_hour_snaps = six_hour_snaps[-1200:]

    history["daily_snapshots"] = daily_snaps
    history["timeline_6h"] = six_hour_snaps
    history["last_updated"] = recorded_at

    # 4. Compute 7d & 30d growth
    past_7d_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    past_30d_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    snap_7d = daily_snaps.get(past_7d_date)
    snap_30d = daily_snaps.get(past_30d_date)

    if not snap_7d:
        for offset in range(6, 12):
            alt_date = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
            if alt_date in daily_snaps:
                snap_7d = daily_snaps[alt_date]
                break

    if not snap_30d:
        for offset in range(25, 38):
            alt_date = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
            if alt_date in daily_snaps:
                snap_30d = daily_snaps[alt_date]
                break

    # Load previous 7-chapter sales cache for Kairew
    prev_kw_7ch = {}
    if os.path.exists(LATEST_GROWTH_FILE):
        try:
            with open(LATEST_GROWTH_FILE, "r", encoding="utf-8") as pf:
                prev_kw_data = json.load(pf)
            for pc in prev_kw_data.get("comics", []):
                prev_kw_7ch[str(pc.get("comic_id"))] = pc
        except Exception:
            pass

    # 5. Build enriched comic rows
    enriched_comics = []
    inactive_count_30d = 0
    active_count_30d = 0

    for cid, cur in current_snap_dict.items():
        cur_views = cur["total_views"]
        cur_sales = cur["total_sales"]

        if cur["is_inactive_30d"]:
            inactive_count_30d += 1
        else:
            active_count_30d += 1

        # 7d growth
        if snap_7d and cid in snap_7d:
            old = snap_7d[cid]
            views_delta_7d, views_pct_7d = calculate_growth_rate(cur_views, old.get("total_views", 0))
            sales_delta_7d, sales_pct_7d = calculate_growth_rate(cur_sales, old.get("total_sales", 0.0))
        else:
            views_delta_7d, views_pct_7d = 0, 0.0
            sales_delta_7d, sales_pct_7d = 0.0, 0.0

        # 30d growth
        if snap_30d and cid in snap_30d:
            old = snap_30d[cid]
            views_delta_30d, views_pct_30d = calculate_growth_rate(cur_views, old.get("total_views", 0))
            sales_delta_30d, sales_pct_30d = calculate_growth_rate(cur_sales, old.get("total_sales", 0.0))
        else:
            views_delta_30d, views_pct_30d = 0, 0.0
            sales_delta_30d, sales_pct_30d = 0.0, 0.0

        row = {
            "comic_id": cid,
            "subject": cur["subject"],
            "platform": "kairew",
            "account": cur["account"],
            "account_id": cur["account_id"],
            "chapters_count": cur["chapters_count"],
            "total_views": cur_views,
            "total_sales": cur_sales,
            "recorded_at": recorded_at,
            "last_chapter_updated_at": cur["last_chapter_updated_at"],
            "days_inactive": cur["days_inactive"],
            "is_inactive_30d": cur["is_inactive_30d"],
            "growth_7d": {
                "views_delta": views_delta_7d,
                "views_growth_pct": views_pct_7d,
                "sales_delta": sales_delta_7d,
                "sales_growth_pct": sales_pct_7d
            },
            "growth_30d": {
                "views_delta": views_delta_30d,
                "views_growth_pct": views_pct_30d,
                "sales_delta": sales_delta_30d,
                "sales_growth_pct": sales_pct_30d
            },
            "sales_7_chapters": round(float(prev_kw_7ch.get(str(cid), {}).get("sales_7_chapters") or 0.0), 2),
            "views_7_chapters": int(prev_kw_7ch.get(str(cid), {}).get("views_7_chapters") or 0),
            "monthly_sales": cur.get("monthly_sales", {})
        }
        enriched_comics.append(row)

    # Sort by sales descending
    enriched_comics.sort(key=lambda x: x["total_sales"], reverse=True)

    report_output = {
        "platform": "kairew",
        "pipeline_recorded_at": recorded_at,
        "date_reference": snapshot_date_key,
        "total_comics": len(enriched_comics),
        "total_sales_portfolio": lifetime_sales,
        "total_views_portfolio": total_views_overall,
        "top_sales_comic": enriched_comics[0]["subject"] if enriched_comics else "",
        "total_inactive_30d": inactive_count_30d,
        "total_active_30d": active_count_30d,
        "has_7d_baseline": (snap_7d is not None),
        "has_30d_baseline": (snap_30d is not None),
        "comics": enriched_comics
    }

    # Save to disk
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกไทม์ไลน์ประวัติ Git ลงใน {HISTORY_FILE}")

    with open(LATEST_GROWTH_FILE, "w", encoding="utf-8") as f:
        json.dump(report_output, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกภาพรวมสถิติล่าสุดลงใน {LATEST_GROWTH_FILE}")

    # Copy to frontend public and src data directory if present
    for rel_path in [["frontend", "src", "data"], ["frontend", "public", "data"]]:
        f_dir = os.path.join(BASE_DIR, "..", *rel_path)
        if os.path.exists(f_dir):
            dest = os.path.join(f_dir, "kairew_growth_latest.json")
            try:
                with open(dest, "w", encoding="utf-8") as f:
                    json.dump(report_output, f, ensure_ascii=False, indent=2)
                print(f"✓ อัปเดตข้อมูลไปยัง Frontend ({'/'.join(rel_path)}): {dest}")
            except Exception as e:
                print(f"⚠️ Frontend sync error: {e}")

    # Sync to Google Apps Script
    if send_to_gas and gas_url:
        send_data_to_gas(report_output, gas_url=gas_url, passcode=passcode)

    print("\n" + "=" * 70)
    print("🎉 Kairew Growth Tracking สำเร็จสมบูรณ์!")
    print(f"   จำนวนผลงานทั้งหมด: {len(enriched_comics)} เรื่อง")
    print(f"   ยอดวิวรวมสะสม: {total_views_overall:,} วิว")
    print(f"   ยอดขายสะสม: {lifetime_sales:,.2f} บาท")
    print(f"   เรื่องที่มีตอนใหม่ใน 30 วัน: {active_count_30d} เรื่อง")
    print(f"   เรื่องที่ไม่มีตอนใหม่ > 30 วัน: {inactive_count_30d} เรื่อง")
    print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kairew Growth Tracker")
    parser.add_argument("--browser", action="store_true", default=True, help="Launch real visible Google Chrome browser (default: True)")
    parser.add_argument("--headless", action="store_true", default=False, help="Run browser in headless mode (default: False)")
    parser.add_argument("--send-gas", action="store_true", help="Send data to GAS Web App")
    parser.add_argument("--gas-url", type=str, default=os.environ.get("GAS_URL") or os.environ.get("GAS_WEBAPP_URL") or DEFAULT_GAS_URL, help="GAS Web App URL")
    parser.add_argument("--passcode", type=str, default="10211032", help="Backend passcode")
    args = parser.parse_args()

    use_browser = False if args.headless else args.browser
    run_kairew_pipeline(send_to_gas=args.send_gas, gas_url=args.gas_url, passcode=args.passcode, use_browser=use_browser, headless=args.headless)

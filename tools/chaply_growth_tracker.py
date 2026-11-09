DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chaply 6-Hour Growth Tracker Engine
-----------------------------------
Tracks Total Sales and Views for all comics across Chaply creator account:
- Account: แปลจนเมื่อย (Adieu7452 / kuroko11.p.g@gmail.com)

Features:
- Fetches all comics, view counts, chapters, and last update dates.
- Records periodic snapshots based on OUR recording date.
- Computes:
  - 7-day delta & % growth rate (Sales & Views)
  - 30-day delta & % growth rate (Sales & Views)
- Classifies inactivity (> 30 days without new chapters).
- Saves historical timeline to Git JSON (tools/data/chaply_history.json).
- Saves latest snapshot to tools/data/chaply_growth_latest.json.
- Synchronizes with Google Sheet tab `ChaplyGrowth` (overwriting current snapshot, zero bloat).
"""

import os
import sys
import time
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
import requests

try:
    from browser_utils import get_browser_executable_path, set_browser_window_bottom_most
except ImportError:
    try:
        from tools.browser_utils import get_browser_executable_path, set_browser_window_bottom_most
    except ImportError:
        def get_browser_executable_path() -> Optional[str]:
            return None
        def set_browser_window_bottom_most(title_filter: str = ""):
            pass

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_FILE = os.path.join(DATA_DIR, "chaply_history.json")
LATEST_GROWTH_FILE = os.path.join(DATA_DIR, "chaply_growth_latest.json")
ALL_COMICS_FILE = os.path.join(DATA_DIR, "chaply_all_comics.json")
BEARER_FILE = os.path.join(DATA_DIR, "chaply_bearer.json")
AUTH_FILE = os.path.join(DATA_DIR, "chaply_auth.json")

os.makedirs(DATA_DIR, exist_ok=True)

ACCOUNT_INFO = {
    "id": "chaply_adieu",
    "name": "แปลจนเมื่อย (Chaply)",
    "username": "Adieu7452",
    "email": "kuroko11.p.g@gmail.com",
    "user_id": "cmu3k53qr1pfm6kdfefjli70o"
}

def get_auth_token() -> str:
    """Read saved bearer token from chaply_bearer.json or chaply_auth.json."""
    if os.path.exists(BEARER_FILE):
        try:
            with open(BEARER_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                token = data.get("token") or data.get("bearer", "").replace("Bearer ", "")
                if token:
                    return token
        except Exception as e:
            print(f"⚠️ Error reading {BEARER_FILE}: {e}")

    if os.path.exists(AUTH_FILE):
        try:
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Look for token in storage or cookies
                token = data.get("accessToken")
                if token:
                    return token
        except Exception as e:
            print(f"⚠️ Error reading {AUTH_FILE}: {e}")
    return ""

def fetch_chaply_stats(token: str) -> Dict[str, Any]:
    """Fetch wallet & overall writer stats from Chaply API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Origin": "https://www.chaply.net",
        "Referer": "https://www.chaply.net/"
    }
    stats = {}
    try:
        r = requests.get("https://api.chaply.net/api/writer/dashboard/stats", headers=headers, timeout=20)
        if r.status_code == 200:
            stats = r.json().get("data", {})
    except Exception as e:
        print(f"⚠️ Error fetching dashboard stats: {e}")

    wallet = {}
    try:
        r_w = requests.get("https://api.chaply.net/api/writer/wallet", headers=headers, timeout=20)
        if r_w.status_code == 200:
            wallet = r_w.json().get("data", {})
    except Exception as e:
        print(f"⚠️ Error fetching wallet: {e}")

    return {
        "stats": stats,
        "wallet": wallet
    }

def fetch_all_chaply_comics(token: str, user_id: str) -> List[Dict[str, Any]]:
    """Fetch all comics for this creator via POST /api/search."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Origin": "https://www.chaply.net",
        "Referer": "https://www.chaply.net/"
    }

    all_items = []
    page = 1
    page_size = 100

    while True:
        payload = {
            "page": page,
            "pageSize": page_size,
            "type": "COMICS",
            "userId": user_id
        }
        try:
            r = requests.post("https://api.chaply.net/api/search", headers=headers, json=payload, timeout=30)
            if r.status_code != 200:
                print(f"❌ Search API returned {r.status_code}: {r.text[:200]}")
                break
            res = r.json()
            if not res.get("success"):
                break
            data = res.get("data", {})
            items = data.get("items", [])
            all_items.extend(items)
            pagination = data.get("pagination", {})
            if not pagination.get("hasNextPage", False) or len(items) == 0:
                break
            page += 1
        except Exception as e:
            print(f"❌ Error querying comics page {page}: {e}")
            break

    return all_items

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
    print(f"\n📡 กำลังส่งข้อมูลสถิติ Chaply ไปยัง Google Apps Script Backend...", flush=True)
    try:
        payload = {
            "action": "SAVE_CHAPLY_GROWTH_DATA",
            "passcode": passcode,
            "payload": report_output
        }
        data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            gas_url,
            data=data_bytes,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "MangaHub-Chaply-Tracker"
            }
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            print(f"✓ ส่งข้อมูลไปยัง GAS สำเร็จ: {res_json.get('status')}", flush=True)
            return True
    except Exception as e:
        print(f"❌ ส่งข้อมูลไปยัง GAS ไม่สำเร็จ: {e}", flush=True)
        return False

def launch_chaply_browser_session(headless: bool = False) -> str:
    """Launch visible real Google Chrome to display creator dashboard and capture fresh token."""
    from playwright.sync_api import sync_playwright
    profile_dir = os.path.join(BASE_DIR, ".chrome_chaply")
    captured = {}
    mode_str = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"
    print(f"🌐 [Chaply] กำลังเปิด {mode_str} เพื่อเข้าสู่หน้า Chaply Creator Dashboard...", flush=True)
    try:
        with sync_playwright() as p:
            launch_kwargs = {
                "headless": headless,
                "channel": "chrome",
                "no_viewport": True,
                "ignore_default_args": ["--enable-automation"],
                "args": ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
            }
            exec_path = get_browser_executable_path()
            if exec_path:
                launch_kwargs["executable_path"] = exec_path

            try:
                context = p.chromium.launch_persistent_context(user_data_dir=profile_dir, **launch_kwargs)
            except Exception as e_launch:
                print(f"⚠️ [Chaply] ไม่สามารถเปิดด้วย channel='chrome' ({e_launch}) กำลังลองใช้ Chromium ปกติ...")
                launch_kwargs.pop("channel", None)
                context = p.chromium.launch_persistent_context(user_data_dir=profile_dir, **launch_kwargs)

            if not headless:
                set_browser_window_bottom_most("chaply")

            page = context.pages[0] if context.pages else context.new_page()
            
            def on_req(req):
                auth = req.headers.get("authorization")
                if auth and "Bearer" in auth:
                    token = auth.split(" ")[1]
                    captured["token"] = token
            page.on("request", on_req)
            
            print("🌐 [Chaply] นำทางเข้าสู่ https://www.chaply.net/writer/dashboard ...", flush=True)
            page.goto("https://www.chaply.net/writer/dashboard", wait_until="domcontentloaded")
            if not headless:
                set_browser_window_bottom_most("chaply")
            time.sleep(3)
            context.storage_state(path=AUTH_FILE)
            context.close()
            
            if captured.get("token"):
                with open(BEARER_FILE, "w", encoding="utf-8") as bf:
                    json.dump({"token": captured["token"]}, bf, indent=2)
                return captured["token"]
    except Exception as e:
        print(f"⚠️ Chaply browser session notice: {e}")
    return get_auth_token()



def run_chaply_pipeline(send_to_gas: bool = False, gas_url: str = "", passcode: str = "10211032", use_browser: bool = True, headless: bool = False):
    now = datetime.now(timezone.utc)
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")
    snapshot_time_key = now.strftime("%Y-%m-%d_%H%M")

    print("\n" + "=" * 70)
    print(f"🚀 Chaply 6-Hour Growth Pipeline: กำลังบันทึกข้อมูลสถิติรอบ {recorded_at}")
    print("=" * 70)

    token = launch_chaply_browser_session(headless=headless) if use_browser else get_auth_token()
    if not token:
        print("❌ ไม่พบ Chaply Auth Token! กรุณารัน tools/login_chaply_persistent.py ก่อน")
        return

    # 1. Fetch overview stats & wallet
    meta = fetch_chaply_stats(token)
    wallet = meta.get("wallet", {})
    stats = meta.get("stats", {})
    lifetime_sales = float(wallet.get("lifetimeEarn") or stats.get("revenue", {}).get("lifetimeEarn") or 0.0)
    total_views_overall = int(stats.get("engagement", {}).get("totalViews") or 0)
    print(f"💰 ข้อมูลบัญชี: ยอดขายสะสม {lifetime_sales:,.2f} บาท | ยอดวิวรวม {total_views_overall:,} วิว")

    # 2. Fetch all comics
    raw_comics = fetch_all_chaply_comics(token, ACCOUNT_INFO["user_id"])
    print(f"🎯 ดึงข้อมูลการ์ตูนสำเร็จทั้งหมด: {len(raw_comics)} เรื่อง")
    try:
        with open(ALL_COMICS_FILE, "w", encoding="utf-8") as f:
            json.dump(raw_comics, f, ensure_ascii=False, indent=2)
        print(f"✓ บันทึกรายการการ์ตูนดิบทั้งหมดลงใน {ALL_COMICS_FILE}")
    except Exception as e:
        print(f"⚠️ ไม่สามารถบันทึก {ALL_COMICS_FILE}: {e}")

    # 3. Build current snapshot dict
    current_snap_dict = {}
    now_ts = now.timestamp()

    for c in raw_comics:
        cid = c.get("id")
        title = c.get("title", "")
        slug = c.get("slug", "")
        views = int(c.get("totalView") or 0)
        eps = int(c.get("totalEpisode") or 0)

        # Inactivity calculation based on lastEpisodeAt
        last_ep_ts = c.get("lastEpisodeAt") or c.get("updatedAt") or 0
        if last_ep_ts > 1000000000000:  # ms
            last_ep_ts = last_ep_ts / 1000.0

        if last_ep_ts > 0:
            last_ep_dt = datetime.fromtimestamp(last_ep_ts)
            last_ep_str = last_ep_dt.strftime("%Y-%m-%d %H:%M:%S")
            days_inactive = max(0, int((now_ts - last_ep_ts) / 86400))
        else:
            last_ep_str = ""
            days_inactive = 999

        is_inactive_30d = (days_inactive > 30)

        # Fetch chapter sales and 7-chapter revenue via writer API (with full pagination)
        tot_sales = 0.0
        s7 = 0.0
        v7 = 0
        try:
            all_ep_items = []
            page_idx = 0
            total_items_from_api = None
            ep_headers = {"Authorization": f"Bearer {token}", "Origin": "https://www.chaply.net"}

            while True:
                ep_url = f"https://api.chaply.net/api/writer/content-episodes/group/{cid}?pageIndex={page_idx}&pageSize=500&includeSales=true"
                r_ep = requests.get(ep_url, headers=ep_headers, timeout=20)
                if r_ep.status_code != 200:
                    break
                ep_res = r_ep.json().get("data", {})
                page_items = ep_res.get("items", [])
                all_ep_items.extend(page_items)

                pag = ep_res.get("pagination", {})
                if total_items_from_api is None and "totalItems" in pag:
                    try:
                        total_items_from_api = int(pag["totalItems"])
                    except (ValueError, TypeError):
                        pass

                if not pag.get("hasNextPage") or not page_items:
                    break
                page_idx += 1
                if page_idx > 20:  # safety break (supports up to 10,000 chapters)
                    break

            # Resolve actual total chapters without capping
            if total_items_from_api is not None and total_items_from_api > 0:
                eps = max(eps, total_items_from_api)

            if len(all_ep_items) > 0:
                eps = max(eps, len(all_ep_items))
                max_idx = max((int(i.get("index") or 0) for i in all_ep_items), default=0)
                if max_idx > eps:
                    eps = max_idx

                tot_sales = round(sum(float(i.get("total_revenue") or 0) for i in all_ep_items), 2)
                ep_sorted = sorted(all_ep_items, key=lambda x: int(x.get("index") or 0))
                last_7 = ep_sorted[-7:] if len(ep_sorted) >= 7 else ep_sorted
                s7 = round(sum(float(i.get("total_revenue") or 0) for i in last_7), 2)
                v7 = sum(int(i.get("total_views") or i.get("totalView") or 0) for i in last_7)
        except Exception as e:
            pass

        current_snap_dict[cid] = {
            "subject": title,
            "slug": slug,
            "account": ACCOUNT_INFO["name"],
            "account_id": ACCOUNT_INFO["id"],
            "total_views": views,
            "total_sales": tot_sales,
            "sales_7_chapters": s7,
            "views_7_chapters": v7,
            "chapters_count": eps,
            "last_chapter_updated_at": last_ep_str,
            "days_inactive": days_inactive,
            "is_inactive_30d": is_inactive_30d
        }

    # 4. Load past history
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
        "total_comics": len(raw_comics),
        "total_sales_portfolio": lifetime_sales,
        "total_views_portfolio": total_views_overall,
        "snapshot": current_snap_dict
    })

    if len(six_hour_snaps) > 1200:
        six_hour_snaps = six_hour_snaps[-1200:]

    history["daily_snapshots"] = daily_snaps
    history["timeline_6h"] = six_hour_snaps
    history["last_updated"] = recorded_at

    # 5. Compute 7d & 30d growth
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

    # 6. Build enriched comic rows
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
            "slug": cur.get("slug", ""),
            "platform": "chaply",
            "account": cur["account"],
            "account_id": cur["account_id"],
            "chapters_count": cur["chapters_count"],
            "total_views": cur_views,
            "total_sales": cur_sales,
            "sales_7_chapters": cur.get("sales_7_chapters", 0.0),
            "views_7_chapters": cur.get("views_7_chapters", 0),
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
            }
        }
        enriched_comics.append(row)

    # Sort by views descending
    enriched_comics.sort(key=lambda x: x["total_views"], reverse=True)

    report_output = {
        "platform": "chaply",
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
            dest = os.path.join(f_dir, "chaply_growth_latest.json")
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
    print("🎉 Chaply Growth Tracking สำเร็จสมบูรณ์!")
    print(f"   จำนวนผลงานทั้งหมด: {len(enriched_comics)} เรื่อง")
    print(f"   ยอดวิวรวมสะสม: {total_views_overall:,} วิว")
    print(f"   ยอดขายสะสม: {lifetime_sales:,.2f} บาท")
    print(f"   เรื่องที่มีตอนใหม่ใน 30 วัน: {active_count_30d} เรื่อง")
    print(f"   เรื่องที่ไม่มีตอนใหม่ > 30 วัน: {inactive_count_30d} เรื่อง")
    print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chaply Growth Tracker")
    parser.add_argument("--browser", action="store_true", default=True, help="Launch real visible Google Chrome browser (default: True)")
    parser.add_argument("--headless", action="store_true", default=False, help="Run browser in headless mode (default: False)")
    parser.add_argument("--send-gas", action="store_true", help="Send data to GAS Web App")
    parser.add_argument("--gas-url", type=str, default=os.environ.get("GAS_URL") or os.environ.get("GAS_WEBAPP_URL") or DEFAULT_GAS_URL, help="GAS Web App URL")
    parser.add_argument("--passcode", type=str, default="10211032", help="Backend passcode")
    args = parser.parse_args()

    use_browser = False if args.headless else args.browser
    run_chaply_pipeline(send_to_gas=args.send_gas, gas_url=args.gas_url, passcode=args.passcode, use_browser=use_browser, headless=args.headless)

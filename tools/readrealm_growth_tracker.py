#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ReadRealm 6-Hour Growth Tracker Engine
------------------------------------
Tracks Total Sales and Views for all comics across both writer accounts:
1. แปลจนเมื่อย (lionking20130@gmail.com)
2. แปลแล้วแปลอีก (adieu2547)

Records periodic snapshots based on OUR recording date (not website date)
and computes:
- 7-day delta & % growth rate (Sales & Views)
- 30-day delta & % growth rate (Sales & Views)
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
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_FILE = os.path.join(DATA_DIR, "readrealm_history.json")
LATEST_GROWTH_FILE = os.path.join(DATA_DIR, "readrealm_growth_latest.json")

os.makedirs(DATA_DIR, exist_ok=True)

# Account configurations
ACCOUNTS = [
    {
        "id": "lionking",
        "name": "แปลจนเมื่อย",
        "username": os.environ.get("READREALM_USER_1", "lionking20130@gmail.com"),
        "password": os.environ.get("READREALM_PASS_1", "aDOPifen01@"),
        "profile_dir": os.path.join(BASE_DIR, ".chrome_readrealm_lionking"),
        "bearer_file": os.path.join(BASE_DIR, "readrealm_bearer_lionking.json"),
    },
    {
        "id": "adieu",
        "name": "แปลแล้วแปลอีก",
        "username": os.environ.get("READREALM_USER_2", "adieu2547"),
        "password": os.environ.get("READREALM_PASS_2", "alone2548"),
        "profile_dir": os.path.join(BASE_DIR, ".chrome_readrealm"),
        "bearer_file": os.path.join(BASE_DIR, "readrealm_bearer.json"),
    }
]

def get_browser_executable_path() -> Optional[str]:
    if sys.platform == "win32":
        candidates = [
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
    return None

def refresh_account_token(acc: Dict[str, Any], headless: bool = True) -> str:
    """Launch Playwright session to obtain fresh Bearer token."""
    exec_path = get_browser_executable_path()
    bearer_file = acc["bearer_file"]
    profile_dir = acc["profile_dir"]

    print(f"🔄 [{acc['name']}] กำลังเชื่อมต่อเบราว์เซอร์เพื่อดึง Token ใหม่...", flush=True)
    with sync_playwright() as p:
        launch_kwargs = {
            "headless": headless,
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

        context = p.chromium.launch_persistent_context(user_data_dir=profile_dir, **launch_kwargs)
        page = context.pages[0] if context.pages else context.new_page()

        tokens = []
        def on_req(req):
            if "api-writer" in req.url and "authorization" in req.headers:
                tokens.append(req.headers["authorization"])
        page.on("request", on_req)

        page.goto("https://readrealm.co/writer/comic", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)

        # If redirected to login, perform auto login
        if "/login" in page.url:
            print(f"🔑 [{acc['name']}] ทำการล็อกอิน...", flush=True)
            page.locator("input[name='username_or_email']").fill(acc["username"])
            page.locator("input[name='password']").fill(acc["password"])
            page.wait_for_timeout(1000)

            btn = page.locator("button[type='submit']").first
            for _ in range(25):
                page.wait_for_timeout(1000)
                try:
                    if not btn.is_disabled():
                        btn.click()
                        page.wait_for_timeout(5000)
                        break
                except Exception:
                    break

            page.goto("https://readrealm.co/writer/comic", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)

        token = tokens[0] if tokens else ""
        if not token:
            try:
                session_data = page.evaluate("""async () => {
                    const r = await fetch('/api/auth/session');
                    return await r.json();
                }""")
                if session_data and session_data.get("accessToken"):
                    token = f"Bearer {session_data['accessToken']}"
            except Exception as e:
                print(f"⚠️ Session eval error: {e}")

        if token:
            with open(bearer_file, "w", encoding="utf-8") as f:
                json.dump({"bearer": token, "updated_at": datetime.now().isoformat()}, f, indent=2)
            print(f"✓ [{acc['name']}] ได้รับ Bearer Token สำเร็จ ({len(token)} chars)")

        context.close()
        return token

def get_valid_token(acc: Dict[str, Any], force_refresh: bool = False) -> str:
    """Retrieve existing cached token or refresh if needed."""
    bearer_file = acc["bearer_file"]
    if not force_refresh and os.path.exists(bearer_file):
        try:
            with open(bearer_file, "r", encoding="utf-8") as f:
                d = json.load(f)
                token = d.get("bearer") or d.get("full") or ""
                if token and token.startswith("Bearer "):
                    return token
                token_only = d.get("token") or ""
                if token_only:
                    return f"Bearer {token_only}"
        except Exception:
            pass
    return refresh_account_token(acc)

def call_api(endpoint_url: str, token: str, acc: Dict[str, Any], retries: int = 2) -> Dict[str, Any]:
    """Execute authenticated GET request to ReadRealm Writer API."""
    headers = {
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://readrealm.co",
        "Referer": "https://readrealm.co/writer/comic"
    }
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(endpoint_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print(f"⚠️ [{acc['name']}] Token หมดอายุ -> รีเฟรช Token ใหม่...")
                new_token = refresh_account_token(acc)
                acc["_cached_token"] = new_token
                headers["Authorization"] = new_token
            elif attempt == retries:
                print(f"❌ API Error {e.code} on {endpoint_url}")
                return {}
        except Exception as e:
            if attempt == retries:
                print(f"❌ Network error on {endpoint_url}: {e}")
                return {}
        time.sleep(0.3)
    return {}

def fetch_all_comics_for_account(acc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch complete comics list and latest stats for an account."""
    token = get_valid_token(acc)
    comics_list = []
    page = 1
    per_page = 50
    now_utc = datetime.now(timezone.utc)

    print(f"\n=======================================================")
    print(f"📚 [{acc['name']}] กำลังดึงรายชื่อการ์ตูนและสถิติล่าสุด...")
    print(f"=======================================================")

    while True:
        url = f"https://api-writer.readrealm.co/writer/comics/getComicsList?comic_subject=&comic_status=&comic_category=&comic_rating=&comic_publish=&per_page={per_page}&page={page}"
        data = call_api(url, acc.get("_cached_token") or token, acc)
        total = data.get("total", 0)
        items = data.get("data", [])
        if not items:
            break

        for item in items:
            cid = item.get("comic_ID")
            subject = (item.get("comic_subject") or "").strip()
            views = int(item.get("comic_views") or 0)
            sales = float(item.get("comic_total_sales") or 0.0)
            ch_count = int(item.get("comic_chapter_publish_count") or item.get("comic_total_chapter") or 0)
            last_ch_updated = item.get("comic_chapter_updated_at")

            days_inactive = 9999
            if last_ch_updated:
                try:
                    dt = datetime.fromisoformat(last_ch_updated.replace("Z", "+00:00"))
                    days_inactive = max(0, (now_utc - dt).days)
                except Exception:
                    pass

            comics_list.append({
                "comic_id": cid,
                "subject": subject,
                "account": acc["name"],
                "account_id": acc["id"],
                "total_views": views,
                "total_sales": sales,
                "chapters_count": ch_count,
                "last_chapter_updated_at": last_ch_updated,
                "days_inactive": days_inactive,
                "is_inactive_30d": days_inactive > 30
            })

        print(f"  [{acc['name']}] โหลดหน้า {page}: สะสม {len(comics_list)} / {total} เรื่อง")
        if len(comics_list) >= total:
            break
        page += 1

    print(f"✓ [{acc['name']}] ดึงข้อมูลสำเร็จ: ทั้งหมด {len(comics_list)} เรื่อง")
    return comics_list

def load_history() -> Dict[str, Any]:
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"snapshots": {}, "metadata": {"created_at": datetime.now().isoformat()}}

def save_history(history: Dict[str, Any]):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"💾 บันทึกประวัติสถิติลงไฟล์: {HISTORY_FILE}")

def find_snapshot_for_date_offset(snapshots: Dict[str, Any], target_days_ago: int) -> Optional[Dict[str, Any]]:
    """Find the snapshot closest to target_days_ago (e.g. 7 days or 30 days ago)."""
    now = datetime.now()
    target_dt = now - timedelta(days=target_days_ago)

    best_key = None
    min_diff = None

    for snap_key, snap_val in snapshots.items():
        try:
            # key can be YYYY-MM-DD or ISO timestamp
            if "T" in snap_key:
                s_dt = datetime.fromisoformat(snap_key)
            else:
                s_dt = datetime.strptime(snap_key[:10], "%Y-%m-%d")

            diff = abs((s_dt - target_dt).total_seconds())

            # Only accept snapshots within a reasonable window (+- 3 days for 7d, +- 7 days for 30d)
            max_allowed = (3 * 86400) if target_days_ago == 7 else (7 * 86400)
            if diff <= max_allowed:
                if min_diff is None or diff < min_diff:
                    min_diff = diff
                    best_key = snap_key
        except Exception:
            continue

    if best_key:
        return snapshots[best_key]
    return None

def compute_growth(current_val: float, past_val: float) -> tuple[float, float]:
    """Returns (delta, percentage_growth)."""
    delta = current_val - past_val
    if past_val > 0:
        pct = (delta / past_val) * 100.0
    else:
        pct = 100.0 if delta > 0 else 0.0
    return delta, pct

def send_data_to_gas(report_output: Dict[str, Any], gas_url: str, passcode: str = "10211032") -> bool:
    """Send latest growth snapshot and metrics to GAS Web App backend."""
    if not gas_url:
        return False
    print(f"\n📡 กำลังส่งข้อมูลสถิติไปยัง Google Apps Script Backend ({gas_url[:50]}...)...", flush=True)
    try:
        payload = {
            "action": "SAVE_READREALM_GROWTH_DATA",
            "passcode": passcode,
            "payload": report_output
        }
        data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            gas_url,
            data=data_bytes,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "MangaHub-ReadRealm-Tracker"
            }
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            print(f"✓ ส่งข้อมูลไปยัง GAS สำเร็จ: {res_json.get('status')}", flush=True)
            return True
    except Exception as e:
        print(f"❌ ส่งข้อมูลไปยัง GAS ไม่สำเร็จ: {e}", flush=True)
        return False

def run_growth_pipeline(send_to_gas: bool = False, gas_url: str = "", passcode: str = "10211032"):
    now = datetime.now()
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")
    snapshot_time_key = now.strftime("%Y-%m-%d_%H%M")

    print("\n" + "=" * 70)
    print(f"🚀 ReadRealm 6-Hour Growth Pipeline: กำลังบันทึกข้อมูลสถิติรอบ {recorded_at}")
    print("=" * 70)

    # 1. Fetch current data across both accounts
    all_current_comics = []
    for acc in ACCOUNTS:
        try:
            acc_comics = fetch_all_comics_for_account(acc)
            all_current_comics.extend(acc_comics)
        except Exception as e:
            print(f"❌ Error fetching {acc['name']}: {e}")

    # Fallback to cached stats if live fetch returned 0
    if not all_current_comics:
        print("⚠️ Live fetch returned 0 comics. Checking cached stats files...")
        cached_lk = os.path.join(DATA_DIR, "readrealm_stats_lionking.json")
        cached_ad = os.path.join(DATA_DIR, "readrealm_stats.json")
        for path, acc in [(cached_lk, ACCOUNTS[0]), (cached_ad, ACCOUNTS[1])]:
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for c in data.get("comics", []):
                        ch_list = c.get("chapters", [])
                        last_ep_str = ch_list[-1].get("created_at") if ch_list else None
                        days_inact = 0
                        if last_ep_str:
                            try:
                                ep_dt = datetime.fromisoformat(last_ep_str.replace("Z", "+00:00"))
                                days_inact = max(0, (now.replace(tzinfo=timezone.utc) - ep_dt).days)
                            except Exception:
                                days_inact = 0
                        all_current_comics.append({
                            "comic_id": str(c.get("comic_id")),
                            "subject": c.get("subject", ""),
                            "account": acc["name"],
                            "account_id": acc["id"],
                            "total_views": int(c.get("total_views") or 0),
                            "total_sales": float(c.get("total_sales") or 0.0),
                            "chapters_count": int(c.get("chapters_count") or len(ch_list)),
                            "last_chapter_updated_at": last_ep_str or "",
                            "days_inactive": days_inact,
                            "is_inactive_30d": days_inact > 30
                        })
                except Exception as e:
                    print(f"Error loading cache {path}: {e}")

    print(f"\n🎯 รวมการ์ตูนที่ดึงได้ทั้งหมด: {len(all_current_comics)} เรื่อง (2 บัญชี)")

    # 2. Build current snapshot dict
    current_snap_dict = {}
    for c in all_current_comics:
        current_snap_dict[c["comic_id"]] = {
            "subject": c["subject"],
            "account": c["account"],
            "account_id": c["account_id"],
            "total_views": c["total_views"],
            "total_sales": c["total_sales"],
            "chapters_count": c["chapters_count"]
        }

    # 3. Load past history
    history = load_history()
    snapshots = history.get("snapshots", {})

    # Save today's snapshot (store by date key so we retain daily history)
    snapshots[snapshot_date_key] = {
        "recorded_at": recorded_at,
        "total_comics": len(all_current_comics),
        "total_sales": sum(c["total_sales"] for c in all_current_comics),
        "total_views": sum(c["total_views"] for c in all_current_comics),
        "comics": current_snap_dict
    }
    history["snapshots"] = snapshots
    history["last_updated"] = recorded_at

    # Maintain timeline of 6-hour snapshots in Git JSON (Old/Historical Data into Git JSON)
    timeline = history.get("timeline", [])
    t_entry = {
        "recorded_at": recorded_at,
        "date": snapshot_date_key,
        "total_sales": round(sum(c["total_sales"] for c in all_current_comics), 2),
        "total_views": sum(c["total_views"] for c in all_current_comics),
        "total_comics": len(all_current_comics)
    }
    if not timeline:
        timeline.append(t_entry)
    else:
        try:
            last_dt = datetime.fromisoformat(timeline[-1]["recorded_at"])
            cur_dt = datetime.fromisoformat(recorded_at)
            # Update last entry if within 45 minutes, else append new
            if abs((cur_dt - last_dt).total_seconds()) < 2700:
                timeline[-1] = t_entry
            else:
                timeline.append(t_entry)
        except Exception:
            timeline.append(t_entry)
    history["timeline"] = timeline

    save_history(history)

    # 4. Find past reference snapshots: 7 days ago & 30 days ago
    snap_7d = find_snapshot_for_date_offset(snapshots, 7)
    snap_30d = find_snapshot_for_date_offset(snapshots, 30)

    past_7d_comics = (snap_7d.get("comics") if snap_7d else {}) or {}
    past_30d_comics = (snap_30d.get("comics") if snap_30d else {}) or {}

    print(f"\n📊 ฐานข้อมูลเปรียบเทียบประวัติ:")
    print(f"   • จุดอ้างอิง 7 วันก่อน: {'✓ พบข้อมูล (' + snap_7d['recorded_at'][:10] + ')' if snap_7d else '⚠️ ยังไม่มีประวัติ (เพิ่งเริ่มต้นเก็บ)'}")
    print(f"   • จุดอ้างอิง 30 วันก่อน: {'✓ พบข้อมูล (' + snap_30d['recorded_at'][:10] + ')' if snap_30d else '⚠️ ยังไม่มีประวัติ (เพิ่งเริ่มต้นเก็บ)'}")

    # Load previous 7-chapter sales cache so we only re-fetch changed comics
    prev_7ch_map = {}
    if os.path.exists(LATEST_GROWTH_FILE):
        try:
            with open(LATEST_GROWTH_FILE, "r", encoding="utf-8") as pf:
                prev_data = json.load(pf)
            for pc in prev_data.get("comics", []):
                prev_7ch_map[str(pc.get("comic_id"))] = pc
        except Exception:
            pass

    # 5. Calculate 7-day and 30-day delta and growth rate for each comic
    growth_results = []
    for c in all_current_comics:
        cid = c["comic_id"]
        cur_v = c["total_views"]
        cur_s = c["total_sales"]

        # 7-day comparison
        past_7d = past_7d_comics.get(cid)
        if past_7d:
            v_7d = past_7d.get("total_views", cur_v)
            s_7d = past_7d.get("total_sales", cur_s)
            d_v_7d, pct_v_7d = compute_growth(cur_v, v_7d)
            d_s_7d, pct_s_7d = compute_growth(cur_s, s_7d)
        else:
            d_v_7d, pct_v_7d = 0, 0.0
            d_s_7d, pct_s_7d = 0.0, 0.0

        # 30-day comparison
        past_30d = past_30d_comics.get(cid)
        if past_30d:
            v_30d = past_30d.get("total_views", cur_v)
            s_30d = past_30d.get("total_sales", cur_s)
            d_v_30d, pct_v_30d = compute_growth(cur_v, v_30d)
            d_s_30d, pct_s_30d = compute_growth(cur_s, s_30d)
        else:
            d_v_30d, pct_v_30d = 0, 0.0
            d_s_30d, pct_s_30d = 0.0, 0.0

        growth_results.append({
            "comic_id": cid,
            "subject": c["subject"],
            "account": c["account"],
            "account_id": c["account_id"],
            "chapters_count": c["chapters_count"],
            "total_views": cur_v,
            "total_sales": cur_s,
            "recorded_at": recorded_at,
            "last_chapter_updated_at": c.get("last_chapter_updated_at"),
            "days_inactive": c.get("days_inactive", 0),
            "is_inactive_30d": c.get("is_inactive_30d", False),
            "growth_7d": {
                "views_delta": d_v_7d,
                "views_growth_pct": round(pct_v_7d, 2),
                "sales_delta": round(d_s_7d, 2),
                "sales_growth_pct": round(pct_s_7d, 2)
            },
            "growth_30d": {
                "views_delta": d_v_30d,
                "views_growth_pct": round(pct_v_30d, 2),
                "sales_delta": round(d_s_30d, 2),
                "sales_growth_pct": round(pct_s_30d, 2)
            },
            "sales_7_chapters": round(float(prev_7ch_map.get(str(cid), {}).get("sales_7_chapters") or 0.0), 2),
            "views_7_chapters": int(prev_7ch_map.get(str(cid), {}).get("views_7_chapters") or 0)
        })

    # Sort by total sales descending
    growth_results.sort(key=lambda x: x["total_sales"], reverse=True)

    # Calculate portfolio aggregates & highlights (Strategy 3: Portfolio Summary Timeline)
    lk_comics = [c for c in growth_results if c.get("account_id") == "lionking" or c.get("account") == "แปลจนเมื่อย"]
    ad_comics = [c for c in growth_results if c.get("account_id") == "adieu" or c.get("account") == "แปลแล้วแปลอีก"]

    lk_sales = round(sum(c["total_sales"] for c in lk_comics), 2)
    lk_views = sum(c["total_views"] for c in lk_comics)
    ad_sales = round(sum(c["total_sales"] for c in ad_comics), 2)
    ad_views = sum(c["total_views"] for c in ad_comics)

    top_sales_comic = growth_results[0]["subject"] if growth_results else ""

    # Sort for top growth highlights
    with_7d = [c for c in growth_results if c.get("growth_7d", {}).get("sales_growth_pct", 0) > 0]
    with_7d.sort(key=lambda x: x["growth_7d"]["sales_growth_pct"], reverse=True)
    top_growth_7d = with_7d[0]["subject"] if with_7d else ""

    with_30d = [c for c in growth_results if c.get("growth_30d", {}).get("sales_growth_pct", 0) > 0]
    with_30d.sort(key=lambda x: x["growth_30d"]["sales_growth_pct"], reverse=True)
    top_growth_30d = with_30d[0]["subject"] if with_30d else ""

    # 6. Save latest growth report file
    report_output = {
        "pipeline_recorded_at": recorded_at,
        "date_reference": snapshot_date_key,
        "total_comics": len(growth_results),
        "total_sales_portfolio": round(sum(x["total_sales"] for x in growth_results), 2),
        "total_views_portfolio": sum(x["total_views"] for x in growth_results),
        "lionking_sales": lk_sales,
        "lionking_views": lk_views,
        "lionking_count": len(lk_comics),
        "adieu_sales": ad_sales,
        "adieu_views": ad_views,
        "adieu_count": len(ad_comics),
        "top_sales_comic": top_sales_comic,
        "top_growth_comic_7d": top_growth_7d,
        "top_growth_comic_30d": top_growth_30d,
        "total_inactive_30d": sum(1 for c in growth_results if c.get("days_inactive", 0) > 30),
        "total_active_30d": sum(1 for c in growth_results if c.get("days_inactive", 0) <= 30),
        "has_7d_baseline": bool(snap_7d),
        "has_30d_baseline": bool(snap_30d),
        "comics": growth_results
    }
    with open(LATEST_GROWTH_FILE, "w", encoding="utf-8") as f:
        json.dump(report_output, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกผลวิเคราะห์การเติบโตล่าสุด: {LATEST_GROWTH_FILE}")

    # Also save to frontend public and src data directories
    for sub in [("frontend", "public", "data"), ("frontend", "src", "data")]:
        front_dir = os.path.join(BASE_DIR, "..", *sub)
        try:
            os.makedirs(front_dir, exist_ok=True)
            out_path = os.path.join(front_dir, "readrealm_growth_latest.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(report_output, f, ensure_ascii=False, indent=2)
            print(f"✓ คัดลอกไปยัง Frontend: {out_path}")
        except Exception as e:
            print(f"⚠️ ไม่สามารถบันทึกไปยัง {front_dir}: {e}")

    # 7. Print Console Leaderboard
    print("\n" + "=" * 95)
    print(f"📈 ตารางรายงานสถิติยอดขาย ยอดวิว และอัตราการเติบโต (Top 15)")
    print(f"   วันที่บันทึก (ตามที่จดเอง): {snapshot_date_key} ({recorded_at[:16]})")
    print("=" * 95)
    print(f"{'อันดับ':<6} | {'ชื่อเรื่อง':<35} | {'บัญชี':<12} | {'ยอดขายรวม':>12} | {'ยอดวิวรวม':>12} | {'โต 7 วัน':>8} | {'โต 30 วัน':>9}")
    print("-" * 95)
    for i, item in enumerate(growth_results[:15], 1):
        s_name = (item["subject"][:32] + "...") if len(item["subject"]) > 32 else item["subject"]
        acc = item["account"]
        sales_str = f"฿{item['total_sales']:,.2f}"
        views_str = f"{item['total_views']:,}"
        g7 = f"{item['growth_7d']['sales_growth_pct']:+.1f}%" if snap_7d else "-"
        g30 = f"{item['growth_30d']['sales_growth_pct']:+.1f}%" if snap_30d else "-"
        print(f"#{i:<5} | {s_name:<35} | {acc:<12} | {sales_str:>12} | {views_str:>12} | {g7:>8} | {g30:>9}")

    print("=" * 95)

    # 8. Sync to Google Apps Script if requested
    if send_to_gas or gas_url or os.environ.get("GAS_URL"):
        target_url = gas_url or os.environ.get("GAS_URL", "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec")
        target_pass = passcode or os.environ.get("PASSCODE", "10211032")
        if target_url:
            send_data_to_gas(report_output, target_url, target_pass)

    return report_output

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ReadRealm 6-Hour Growth Pipeline Tracker")
    parser.add_argument("--sync-gas", action="store_true", help="Send data to GAS Web App")
    parser.add_argument("--gas-url", type=str, default="", help="GAS Web App exec URL")
    parser.add_argument("--passcode", type=str, default="10211032", help="GAS Passcode")
    args = parser.parse_args()

    run_growth_pipeline(
        send_to_gas=args.sync_gas or bool(os.environ.get("GAS_URL")),
        gas_url=args.gas_url or os.environ.get("GAS_URL", ""),
        passcode=args.passcode or os.environ.get("PASSCODE", "10211032")
    )

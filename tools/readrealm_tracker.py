#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ReadRealm Sales & Viewership Tracker (Playwright + API Engine)
-----------------------------------------------------------
ระบบติดตามยอดขายและยอดอ่าน ReadRealm (Writer Portal)
- ดึงข้อมูลการ์ตูนทุกเรื่องของนักเขียน (รองรับมากกว่า 80+ เรื่อง)
- ดึงยอดขายรวม (Total Sales), ยอดวิวรวม (Total Views)
- ดึงรายงานการขายรายปีและรายเดือน (Monthly / Yearly Sales)
- ดึงยอดวิวและยอดขายรายตอน (Chapter-level views & sales)
- วิเคราะห์จัดอันดับ เรื่องเด่น (Top Performers) vs เรื่องด้อย (Underperformers)
- โหมดวิเคราะห์เจาะลึกรายเรื่อง เช่น 3E8jmDbO02AeYZwR5qpa (ปฐมบทแห่งระบบสำนัก)
"""

import os
import sys
import time
import json
import argparse
import urllib.request
import urllib.parse
import http.cookiejar
from datetime import datetime
from typing import Dict, Any, List, Optional
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CHROME_PATH = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
os.makedirs(DATA_DIR, exist_ok=True)

PROFILE_DIR = os.path.join(BASE_DIR, ".chrome_readrealm")
DATA_FILE = os.path.join(DATA_DIR, "readrealm_stats.json")
BEARER_FILE = os.path.join(BASE_DIR, "readrealm_bearer.json")

CURRENT_ACCOUNT = "adieu"
ACCOUNT_CONFIGS = {
    "lionking": {
        "name": "แปลจนเมื่อย",
        "username": os.environ.get("READREALM_USER_1") or os.environ.get("READREALM_EMAIL_1") or "lionking20130@gmail.com",
        "password": os.environ.get("READREALM_PASS_1") or os.environ.get("READREALM_PASSWORD_1") or "aDOPifen01@",
    },
    "adieu": {
        "name": "แปลแล้วแปลอีก",
        "username": os.environ.get("READREALM_USER_2") or os.environ.get("READREALM_EMAIL_2") or "adieu2547",
        "password": os.environ.get("READREALM_PASS_2") or os.environ.get("READREALM_PASSWORD_2") or "alone2548",
    }
}

def configure_account(account: str = "adieu"):
    global PROFILE_DIR, DATA_FILE, BEARER_FILE, CURRENT_ACCOUNT
    CURRENT_ACCOUNT = account
    if account == "lionking":
        PROFILE_DIR = os.path.join(BASE_DIR, ".chrome_readrealm_lionking")
        DATA_FILE = os.path.join(DATA_DIR, "readrealm_stats_lionking.json")
        BEARER_FILE = os.path.join(BASE_DIR, "readrealm_bearer_lionking.json")
    else:
        PROFILE_DIR = os.path.join(BASE_DIR, ".chrome_readrealm")
        DATA_FILE = os.path.join(DATA_DIR, "readrealm_stats.json")
        BEARER_FILE = os.path.join(BASE_DIR, "readrealm_bearer.json")

THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
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

def authenticate_via_direct_http(acc_key: str = "adieu") -> str:
    """Fast & resilient direct HTTP session login via NextAuth endpoints."""
    cfg = ACCOUNT_CONFIGS.get(acc_key, ACCOUNT_CONFIGS["adieu"])
    user = cfg.get("username", "")
    pwd = cfg.get("password", "")
    if not user or not pwd:
        return ""

    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    try:
        csrf_req = urllib.request.Request("https://readrealm.co/api/auth/csrf", headers={"User-Agent": ua})
        with opener.open(csrf_req, timeout=15) as resp:
            csrf_data = json.loads(resp.read().decode("utf-8"))
            csrf_token = csrf_data.get("csrfToken")
        if not csrf_token:
            return ""

        payload = urllib.parse.urlencode({
            "csrfToken": csrf_token,
            "username_or_email": user,
            "password": pwd,
            "callbackUrl": "https://readrealm.co",
            "json": "true"
        }).encode("utf-8")

        cb_req = urllib.request.Request(
            "https://readrealm.co/api/auth/callback/credentials",
            data=payload,
            headers={
                "User-Agent": ua,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Auth-Return-Redirect": "1"
            }
        )
        with opener.open(cb_req, timeout=15) as resp:
            _ = resp.read()

        sess_req = urllib.request.Request("https://readrealm.co/api/auth/session", headers={"User-Agent": ua})
        with opener.open(sess_req, timeout=15) as resp:
            session_data = json.loads(resp.read().decode("utf-8"))

        raw_token = (
            session_data.get("accessToken")
            or session_data.get("token")
            or (session_data.get("user") or {}).get("accessToken")
            or (session_data.get("user") or {}).get("token")
        )
        if raw_token:
            return f"Bearer {raw_token}" if not str(raw_token).startswith("Bearer ") else str(raw_token)
    except Exception as e:
        print(f"⚠️ Direct HTTP login attempt notice: {e}", flush=True)

    return ""

def refresh_bearer_token(headless: bool = True) -> str:
    """Obtain fresh Bearer JWT token from NextAuth using Direct HTTP (Primary) or Playwright (Fallback)."""
    global CURRENT_ACCOUNT
    acc_name = ACCOUNT_CONFIGS.get(CURRENT_ACCOUNT, {}).get("name", CURRENT_ACCOUNT)
    print(f"🔄 [{acc_name}] กำลังขอรับ Token ใหม่ผ่าน Direct NextAuth API...", flush=True)

    token = authenticate_via_direct_http(CURRENT_ACCOUNT)
    if token:
        try:
            with open(BEARER_FILE, "w", encoding="utf-8") as f:
                json.dump({"bearer": token, "updated_at": datetime.now().isoformat()}, f, indent=2)
            print(f"✓ [{acc_name}] ได้รับ Bearer Token ผ่าน Direct API สำเร็จ ({len(token)} chars)")
            return token
        except Exception as e:
            print(f"⚠️ Error writing bearer file: {e}")
            return token

    exec_path = get_browser_executable_path()
    print(f"🔄 [{acc_name}] สลับไปใช้ Playwright Browser เพื่อดึง Bearer Token...", flush=True)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            executable_path=exec_path,
            headless=headless,
            viewport={"width": 1280, "height": 800},
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars"
            ]
        )
        page = context.pages[0] if context.pages else context.new_page()

        tokens = []
        def on_req(req):
            if "api-writer" in req.url and "authorization" in req.headers:
                tokens.append(req.headers["authorization"])
        page.on("request", on_req)

        page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
        page.wait_for_timeout(3500)

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
            with open(BEARER_FILE, "w", encoding="utf-8") as f:
                json.dump({"bearer": token, "updated_at": datetime.now().isoformat()}, f, indent=2)
            print(f"✓ [{acc_name}] ได้รับ Bearer Token สำเร็จ ({len(token)} chars)")

        context.close()
        return token

def get_valid_token(force_refresh: bool = False) -> str:
    """Retrieve existing cached token or refresh if missing."""
    if not force_refresh and os.path.exists(BEARER_FILE):
        try:
            with open(BEARER_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                token = d.get("bearer", "")
                if token and token.startswith("Bearer "):
                    return token
        except:
            pass
    return refresh_bearer_token()

def call_api(endpoint_url: str, token: str, retries: int = 2) -> Dict[str, Any]:
    """Execute authenticated GET request to ReadRealm Writer API."""
    headers = {
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://readrealm.co",
        "Referer": "https://readrealm.co/writer/comics"
    }
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(endpoint_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("⚠️ Token หมดอายุ -> กำลังรีเฟรช Token ใหม่...")
                new_token = refresh_bearer_token()
                headers["Authorization"] = new_token
            elif attempt == retries:
                print(f"❌ API Error {e.code} on {endpoint_url}")
                return {}
        except Exception as e:
            if attempt == retries:
                print(f"❌ Network Error on {endpoint_url}: {e}")
                return {}
            time.sleep(1)
    return {}

def sync_readrealm_data(target_comic_only: Optional[str] = None) -> Dict[str, Any]:
    """
    Sync all comics, yearly/monthly sales, and chapter stats from ReadRealm.
    """
    token = get_valid_token()
    print("=================================================================")
    print("🚀 ReadRealm Sales & Viewership Tracker: เริ่มต้นการดึงข้อมูล")
    print("=================================================================")

    # 1. Fetch Account Information
    account_url = "https://api-writer.readrealm.co/writer/accountInfo/"
    account_info = call_api(account_url, token)
    writer_name = account_info.get("profile_name", "Writer")
    balance_sales = float(account_info.get("balance_sales") or 0.0)
    print(f"👤 บัญชีนักเขียน: {writer_name} | ยอดเงินคงเหลือในกระเป๋า: ฿{balance_sales:,.2f}")

    # 2. Fetch All Comics List (Page by page, 50 per page)
    all_raw_comics = []
    page = 1
    per_page = 50
    total_comics_count = 0

    print("\n📚 กำลังดึงรายชื่อการ์ตูนทั้งหมดในระบบ...")
    while True:
        url = f"https://api-writer.readrealm.co/writer/comics/getComicsList?comic_subject=&comic_status=&comic_category=&comic_rating=&comic_publish=&per_page={per_page}&page={page}"
        data = call_api(url, token)
        total_comics_count = data.get("total", 0)
        items = data.get("data", [])
        if not items:
            break
        all_raw_comics.extend(items)
        if len(all_raw_comics) >= total_comics_count:
            break
        page += 1

    print(f"✓ พบการ์ตูนทั้งหมด {len(all_raw_comics)} เรื่อง (ยอดในระบบ: {total_comics_count} เรื่อง)")

    # If target_comic_only is specified, filter to just that comic
    if target_comic_only:
        all_raw_comics = [c for c in all_raw_comics if c.get("comic_ID") == target_comic_only]
        if not all_raw_comics:
            # Query comic directly if not in list
            all_raw_comics = [{"comic_ID": target_comic_only, "comic_subject": "Target Comic"}]

    current_thai_year = datetime.now().year + 543  # เช่น 2569
    processed_comics = []

    # 3. For each comic, fetch monthly sales and chapter list
    for idx, c in enumerate(all_raw_comics, 1):
        cid = c.get("comic_ID")
        subject = c.get("comic_subject", "ไม่ระบุชื่อ")
        views = int(c.get("comic_views") or 0)
        sales = float(c.get("comic_total_sales") or 0.0)
        publish_count = int(c.get("comic_chapter_publish_count") or 0)

        print(f"\n[{idx:02d}/{len(all_raw_comics):02d}] 📖 {subject}")
        print(f"     ID: {cid} | ยอดวิวรวม: {views:,} | ยอดขายรวม: ฿{sales:,.2f} | ตอน: {publish_count}")

        # A. Fetch Detailed Comic Information
        info_url = f"https://api-writer.readrealm.co/writer/comics/getComicInformation/{cid}"
        info_data = call_api(info_url, token)
        if info_data:
            views = int(info_data.get("comic_views") or views)
            sales = float(info_data.get("comic_total_sales") or sales)

        # B. Fetch Yearly Sales (รายงานการขายรายปี -> รายเดือน 12 เดือน)
        year_url = f"https://api-writer.readrealm.co/writer/comics/analytics/getYearSaleReport?year={current_thai_year}&comic_ID={cid}"
        year_data = call_api(year_url, token)
        monthly_sales_list = year_data.get("data", [0]*12)
        year_sum_sales = float(year_data.get("sum_data") or 0.0)

        # Format monthly sales breakdown
        monthly_sales_dict = {}
        for m_idx, m_val in enumerate(monthly_sales_list):
            if m_idx < 12:
                m_name = THAI_MONTHS[m_idx]
                monthly_sales_dict[m_name] = float(m_val or 0.0)

        # C. Fetch Chapters List (ยอดวิวรายตอน และยอดขายรายตอน)
        chap_url = f"https://api-writer.readrealm.co/writer/comics/chapters/getChaptersList?comic_ID={cid}&page=1&per_page=200&sort_column=asc"
        chap_data = call_api(chap_url, token)
        raw_chapters = chap_data.get("data", [])

        chapters_processed = []
        for ch in raw_chapters:
            ch_title = str(ch.get("comic_chapter_title") or "").strip()
            ch_price = float(ch.get("comic_chapter_price") or 0.0)
            ch_views = int(ch.get("comic_chapter_views") or 0)
            ch_sales = float(ch.get("comic_chapter_total_sales") or 0.0)
            ch_pub = ch.get("comic_chapter_publish_datetime", "")
            chapters_processed.append({
                "chapter_id": ch.get("comic_chapter_ID"),
                "title": ch_title,
                "price": ch_price,
                "is_paid": ch_price > 0,
                "views": ch_views,
                "sales": ch_sales,
                "published_at": ch_pub[:10] if ch_pub else ""
            })

        paid_chapters = [ch for ch in chapters_processed if ch["is_paid"]]
        free_chapters = [ch for ch in chapters_processed if not ch["is_paid"]]
        avg_views_per_chapter = (views / max(len(chapters_processed), 1))
        avg_sales_per_chapter = (sales / max(len(paid_chapters), 1)) if paid_chapters else 0.0

        # Chapter 1 views vs Latest chapter views (Retention / Drop-off)
        ch1_views = chapters_processed[0]["views"] if chapters_processed else 0
        latest_views = chapters_processed[-1]["views"] if chapters_processed else 0
        retention_rate = round((latest_views / max(ch1_views, 1)) * 100, 1)

        print(f"     ✓ ดึงสถิติรายตอน: {len(chapters_processed)} ตอน (ติดเหรียญ {len(paid_chapters)} ตอน) | ยอดปี {current_thai_year}: ฿{year_sum_sales:,.2f}")

        processed_comics.append({
            "comic_id": cid,
            "subject": subject,
            "category": c.get("comic_category", ""),
            "status": c.get("comic_status", ""),
            "total_views": views,
            "total_sales": sales,
            "year_sales": year_sum_sales,
            "monthly_sales": monthly_sales_dict,
            "chapters_count": max(publish_count, int(chap_data.get("total") or 0), len(chapters_processed)),
            "paid_chapters_count": len(paid_chapters),
            "free_chapters_count": len(free_chapters),
            "avg_views_per_chapter": round(avg_views_per_chapter, 1),
            "avg_sales_per_chapter": round(avg_sales_per_chapter, 2),
            "retention_rate": retention_rate,
            "chapters": chapters_processed,
            "cover_url": c.get("comic_cover", ""),
            "synopsis": info_data.get("comic_synopsis", "")
        })

    # Summary
    result = {
        "synced_at": datetime.now().isoformat(),
        "writer": {
            "name": writer_name,
            "wallet_sales": balance_sales
        },
        "total_comics": len(processed_comics),
        "total_views_all": sum(c["total_views"] for c in processed_comics),
        "total_sales_all": sum(c["total_sales"] for c in processed_comics),
        "total_year_sales": sum(c["year_sales"] for c in processed_comics),
        "comics": processed_comics
    }

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("\n=================================================================")
    print(f"🎉 บันทึกข้อมูลสถิติ ReadRealm สำเร็จ: {DATA_FILE}")
    print(f"📊 รวมทั้งสิ้น {len(processed_comics)} เรื่อง | ยอดวิวรวม: {result['total_views_all']:,} | ยอดขายรวม: ฿{result['total_sales_all']:,.2f}")
    print("=================================================================")
    return result

def print_ranking_report():
    """Generate and display the Top vs Underperforming ranking report."""
    if not os.path.exists(DATA_FILE):
        print("⚠️ ยังไม่พบไฟล์ข้อมูล กรุณารัน --sync ก่อน")
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    comics = data.get("comics", [])
    if not comics:
        print("⚠️ ไม่มีข้อมูลการ์ตูนในไฟล์")
        return

    # Sort by Total Sales (Revenue)
    ranked_by_sales = sorted(comics, key=lambda x: x["total_sales"], reverse=True)
    # Sort by Total Views
    ranked_by_views = sorted(comics, key=lambda x: x["total_views"], reverse=True)

    print("\n================================================================================")
    print("🏆 อันดับมังงะ ReadRealm: เรื่องเด่น vs เรื่องด้อย (Sales & Views Ranking)")
    print(f"📅 ข้อมูลล่าสุดเมื่อ: {data.get('synced_at')} | ทั้งหมด {len(comics)} เรื่อง")
    print(f"💰 ยอดขายสะสมรวมทุกเรื่อง: ฿{data.get('total_sales_all', 0):,.2f} | 👁️ ยอดวิวสะสม: {data.get('total_views_all', 0):,} ครั้ง")
    print("================================================================================\n")

    print("🌟 1. ตารางจัดอันดับ 'เรื่องเด่น' เรียงตามยอดขายรวม (Top Performers by Revenue):")
    print(f"{'อันดับ':<6} | {'ชื่อเรื่อง':<44} | {'ยอดขายรวม':>12} | {'ยอดวิวรวม':>10} | {'ตอน':>6} | {'เฉลี่ย/ตอน':>10}")
    print("-" * 98)

    for idx, c in enumerate(ranked_by_sales[:25], 1):
        medal = "🥇" if idx == 1 else "🥈" if idx == 2 else "🥉" if idx == 3 else f"#{idx:02d}"
        name = c['subject'][:40] + ".." if len(c['subject']) > 40 else c['subject']
        sales = f"฿{c['total_sales']:,.2f}"
        views = f"{c['total_views']:,}"
        ch_cnt = c['chapters_count']
        avg_s = f"฿{c['avg_sales_per_chapter']:,.1f}"
        print(f"{medal:<6} | {name:<44} | {sales:>12} | {views:>10} | {ch_cnt:>6} | {avg_s:>10}")

    print("\n" + "=" * 98 + "\n")

    # Categories breakdown
    tier_super = [c for c in ranked_by_sales if c["total_sales"] >= 20000]
    tier_high = [c for c in ranked_by_sales if 10000 <= c["total_sales"] < 20000]
    tier_mid = [c for c in ranked_by_sales if 1000 <= c["total_sales"] < 10000]
    tier_low = [c for c in ranked_by_sales if 0 < c["total_sales"] < 1000]
    tier_zero = [c for c in ranked_by_sales if c["total_sales"] == 0]

    print("📊 2. สรุปการแบ่งกลุ่มเรื่องเด่น - เรื่องด้อย:")
    print(f"  💎 ระดับยอดเยี่ยม (Super Top > ฿20,000): {len(tier_super)} เรื่อง")
    for c in tier_super:
        print(f"     • {c['subject']} -> ฿{c['total_sales']:,.2f} ({c['total_views']:,} วิว)")

    print(f"\n  🔥 ระดับผลงานเด่น (High Tier ฿10,000 - ฿20,000): {len(tier_high)} เรื่อง")
    for c in tier_high:
        print(f"     • {c['subject']} -> ฿{c['total_sales']:,.2f} ({c['total_views']:,} วิว)")

    print(f"\n  📈 ระดับปานกลาง (Mid Tier ฿1,000 - ฿10,000): {len(tier_mid)} เรื่อง")
    for c in tier_mid:
        print(f"     • {c['subject']} -> ฿{c['total_sales']:,.2f} ({c['total_views']:,} วิว)")

    print(f"\n  ⚠️ ระดับเรื่องด้อย / รายได้น้อย (Low Tier < ฿1,000): {len(tier_low)} เรื่อง")
    for c in tier_low[:5]:
        print(f"     • {c['subject']} -> ฿{c['total_sales']:,.2f} ({c['total_views']:,} วิว)")

    print(f"\n  ❌ ระดับเรื่องด้อย / รายได้ 0 บาท (Zero Sales): {len(tier_zero)} เรื่อง")
    for c in tier_zero:
        note = "ตอนฟรียังไม่ติดเหรียญ" if c["paid_chapters_count"] == 0 else "ติดเหรียญแล้วแต่ยังไม่มียอดซื้อ"
        print(f"     🔻 {c['subject']} -> วิว: {c['total_views']:,} ({note})")

def print_comic_deep_dive(comic_id: str):
    """Deep-dive analysis of a single comic including monthly sales and chapter curve."""
    if not os.path.exists(DATA_FILE):
        print("⚠️ กรุณารัน --sync ก่อน")
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    comic = next((c for c in data.get("comics", []) if c["comic_id"] == comic_id), None)
    if not comic:
        print(f"❌ ไม่พบ Comic ID: {comic_id}")
        return

    print("\n================================================================================")
    print(f"🔍 รายงานเจาะลึกมังงะ: {comic['subject']}")
    print(f"🔖 Comic ID: {comic['comic_id']}")
    print(f"💰 ยอดขายรวม: ฿{comic['total_sales']:,.2f} | 👁️ ยอดวิวรวม: {comic['total_views']:,}")
    print(f"📑 จำนวนตอน: {comic['chapters_count']} ตอน (ตอนติดเหรียญ: {comic['paid_chapters_count']}, ตอนฟรี: {comic['free_chapters_count']})")
    print(f"📈 ยอดขายเฉลี่ยต่อตอนติดเหรียญ: ฿{comic['avg_sales_per_chapter']:,.2f} | วิวเฉลี่ยต่อตอน: {comic['avg_views_per_chapter']:,.1f}")
    print(f"📉 อัตราคงอยู่ของคนอ่าน (ตอนแรก -> ตอนล่าสุด): {comic.get('retention_rate', 0)}%")
    print("================================================================================\n")

    # Monthly Sales Table
    print("📅 1. รายงานการขายรายปี (จำแนกตามรายเดือน):")
    print(f"{'เดือน':<16} | {'ยอดขาย (บาท)':>15}")
    print("-" * 35)
    monthly = comic.get("monthly_sales", {})
    for m_name, m_sales in monthly.items():
        if m_sales > 0:
            print(f"{m_name:<16} | ฿{m_sales:>13,.2f}")
        else:
            print(f"{m_name:<16} | {'-':>15}")
    print("-" * 35)
    print(f"{'รวมปีปัจจุบัน':<16} | ฿{comic.get('year_sales', 0):>13,.2f}\n")

    # Chapters Breakdown Table
    print("📑 2. รายชื่อตอน: สถิติยอดวิวรายตอน & ยอดขายรายตอน:")
    print(f"{'ตอน':<12} | {'ประเภท':<8} | {'ราคา':>6} | {'ยอดขายรายตอน':>15} | {'ยอดวิวรายตอน':>14} | {'วันที่ลง':<12}")
    print("-" * 76)

    chapters = comic.get("chapters", [])
    for ch in chapters:
        title = ch.get("title", "")
        price = ch.get("price", 0)
        price_str = f"{int(price)} เหรียญ" if price > 0 else "ฟรี"
        type_str = "🔒 ติดเหรียญ" if price > 0 else "📖 อ่านฟรี"
        sales = ch.get("sales", 0)
        sales_str = f"฿{sales:,.2f}" if sales > 0 else "-"
        views = ch.get("views", 0)
        dt = ch.get("published_at", "")
        print(f"ตอนที่ {title:<6} | {type_str:<8} | {price_str:>6} | {sales_str:>15} | {views:>14,} | {dt:<12}")

def main():
    parser = argparse.ArgumentParser(description="ReadRealm Sales & Viewership Tracker")
    parser.add_argument("--account", type=str, default="adieu", choices=["adieu", "lionking"], help="Account to track (adieu or lionking)")
    parser.add_argument("--sync", action="store_true", help="Sync all data from ReadRealm API")
    parser.add_argument("--ranking", action="store_true", help="Print ranking of top vs underperforming comics")
    parser.add_argument("--comic", type=str, default=None, help="Deep dive analysis for specific comic ID")

    args = parser.parse_args()
    configure_account(args.account)

    if args.sync or not os.path.exists(DATA_FILE):
        sync_readrealm_data()

    print_ranking_report()

    if args.comic:
        print_comic_deep_dive(args.comic)
    elif args.account == "adieu" and not args.ranking:
        print_comic_deep_dive("3E8jmDbO02AeYZwR5qpa")

if __name__ == "__main__":
    main()

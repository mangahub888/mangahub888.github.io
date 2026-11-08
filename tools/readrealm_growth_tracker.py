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
import http.cookiejar
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
        "username": os.environ.get("READREALM_USER_1") or os.environ.get("READREALM_EMAIL_1") or "lionking20130@gmail.com",
        "password": os.environ.get("READREALM_PASS_1") or os.environ.get("READREALM_PASSWORD_1") or "aDOPifen01@",
        "profile_dir": os.path.join(BASE_DIR, ".chrome_readrealm_lionking"),
        "bearer_file": os.path.join(BASE_DIR, "readrealm_bearer_lionking.json"),
    },
    {
        "id": "adieu",
        "name": "แปลแล้วแปลอีก",
        "username": os.environ.get("READREALM_USER_2") or os.environ.get("READREALM_EMAIL_2") or "adieu2547",
        "password": os.environ.get("READREALM_PASS_2") or os.environ.get("READREALM_PASSWORD_2") or "alone2548",
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

def authenticate_via_direct_http(acc: Dict[str, Any]) -> str:
    """Fast & resilient direct HTTP session login via NextAuth endpoints (immune to Cloudflare Turnstile)."""
    user = acc.get("username", "")
    pwd = acc.get("password", "")
    if not user or not pwd:
        print(f"⚠️ [{acc['name']}] ไม่พบข้อมูล Username หรือ Password สำหรับล็อกอิน", flush=True)
        return ""

    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    try:
        # Step 1: Request CSRF Token
        csrf_req = urllib.request.Request("https://readrealm.co/api/auth/csrf", headers={"User-Agent": ua})
        with opener.open(csrf_req, timeout=15) as resp:
            csrf_data = json.loads(resp.read().decode("utf-8"))
            csrf_token = csrf_data.get("csrfToken")
        if not csrf_token:
            return ""

        # Step 2: Submit credentials to NextAuth callback
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

        # Step 3: Fetch fresh session token
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
            token = f"Bearer {raw_token}" if not str(raw_token).startswith("Bearer ") else str(raw_token)
            return token
    except Exception as e:
        print(f"⚠️ [{acc['name']}] Direct HTTP login attempt notice: {e}", flush=True)

    return ""

def refresh_account_token(acc: Dict[str, Any], headless: bool = True) -> str:
    """Obtain fresh Bearer token using Direct NextAuth HTTP strategy (Primary) or Playwright browser (Fallback)."""
    bearer_file = acc["bearer_file"]
    profile_dir = acc["profile_dir"]

    # Strategy 1 (Primary): Direct HTTP Authentication (Fast, zero Turnstile blocking, works on headless CI)
    print(f"🔄 [{acc['name']}] กำลังขอรับ Token ใหม่ผ่าน Direct NextAuth API...", flush=True)
    token = authenticate_via_direct_http(acc)
    if token:
        try:
            with open(bearer_file, "w", encoding="utf-8") as f:
                json.dump({"bearer": token, "updated_at": datetime.now().isoformat()}, f, indent=2)
            print(f"✓ [{acc['name']}] ได้รับ Bearer Token ผ่าน Direct API สำเร็จ ({len(token)} chars)", flush=True)
            return token
        except Exception as e:
            print(f"⚠️ Error writing bearer file: {e}", flush=True)
            return token

    # Strategy 2 (Fallback): Headless / Persistent Browser Session via Playwright
    print(f"🔄 [{acc['name']}] สลับไปใช้ Playwright Browser เพื่อดึง Token...", flush=True)
    exec_path = get_browser_executable_path()
    try:
        with sync_playwright() as p:
            launch_kwargs = {
                "headless": headless,
                "viewport": {"width": 1280, "height": 800},
                "ignore_default_args": ["--enable-automation"],
                "args": [
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-infobars",
                    "--disable-dev-shm-usage"
                ]
            }
            if exec_path:
                launch_kwargs["executable_path"] = exec_path

            context = p.chromium.launch_persistent_context(
                user_data_dir=profile_dir,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                **launch_kwargs
            )
            # Inject stealth helper
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
            """)

            page = context.pages[0] if context.pages else context.new_page()

            tokens = []
            def on_req(req):
                try:
                    if "authorization" in req.headers:
                        auth_h = req.headers["authorization"]
                        if auth_h and auth_h.startswith("Bearer ") and len(auth_h) > 20:
                            tokens.append(auth_h)
                except Exception:
                    pass
            page.on("request", on_req)

            page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
            page.wait_for_timeout(3500)

            # If redirected to login, perform auto login
            if "/login" in page.url:
                print(f"🔑 [{acc['name']}] ตรวจพบหน้าเข้าสู่ระบบ -> ทำการล็อกอิน...", flush=True)
                tokens.clear()

                user_input = page.locator("input[name='username_or_email']").first
                pass_input = page.locator("input[name='password']").first
                if user_input.count() and pass_input.count():
                    user_input.fill(acc["username"])
                    pass_input.fill(acc["password"])
                    try:
                        pass_input.dispatch_event("input")
                        pass_input.dispatch_event("change")
                    except Exception:
                        pass
                page.wait_for_timeout(1000)

                btn = page.locator("button[type='submit']").first
                for sec in range(25):
                    page.wait_for_timeout(1000)
                    if "/login" not in page.url:
                        print(f"✓ [{acc['name']}] นำทางออกจากหน้าล็อกอินแล้ว")
                        break

                    # พยายามคลิก Cloudflare Turnstile checkbox หากมี iframe อยู่
                    try:
                        cf_frame = page.frame_locator("#cf-turnstile iframe, iframe[src*='challenges.cloudflare.com']").first
                        cb = cf_frame.locator("input[type='checkbox'], .cb-i, #challenge-stage, .ctp-checkbox-label").first
                        if cb.count() and cb.is_visible():
                            cb.click(timeout=1500)
                    except Exception:
                        pass

                    try:
                        if btn.count() and not btn.is_disabled():
                            print(f"🔘 [{acc['name']}] ปุ่มพร้อมใช้งาน -> ส่งข้อมูลเข้าสู่ระบบ...")
                            btn.click()
                            page.wait_for_timeout(4000)
                            break
                    except Exception:
                        pass

                tokens.clear()
                page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
                page.wait_for_timeout(4000)

            token = tokens[-1] if tokens else ""

            # Check NextAuth Session endpoint
            if not token:
                try:
                    session_data = page.evaluate("""async () => {
                        try {
                            const r = await fetch('/api/auth/session');
                            return await r.json();
                        } catch(e) { return null; }
                    }""")
                    if session_data:
                        raw_t = session_data.get("accessToken") or session_data.get("token") or (session_data.get("user") or {}).get("accessToken") or (session_data.get("user") or {}).get("token")
                        if raw_t:
                            token = f"Bearer {raw_t}" if not str(raw_t).startswith("Bearer ") else str(raw_t)
                except Exception as e:
                    print(f"⚠️ Session eval error: {e}")

            # Check localStorage / sessionStorage
            if not token:
                try:
                    stored_token = page.evaluate("""() => {
                        try {
                            for (let i = 0; i < localStorage.length; i++) {
                                const k = localStorage.key(i);
                                const v = localStorage.getItem(k);
                                if (v && (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth'))) {
                                    if (v.startsWith('Bearer ') && v.length > 30) return v;
                                    try {
                                        const p = JSON.parse(v);
                                        if (p.accessToken) return p.accessToken;
                                        if (p.token) return p.token;
                                    } catch(e) {}
                                }
                            }
                        } catch(e) {}
                        return null;
                    }""")
                    if stored_token:
                        token = f"Bearer {stored_token}" if not str(stored_token).startswith("Bearer ") else str(stored_token)
                except Exception:
                    pass

            if token:
                try:
                    with open(bearer_file, "w", encoding="utf-8") as f:
                        json.dump({"bearer": token, "updated_at": datetime.now().isoformat()}, f, indent=2)
                    print(f"✓ [{acc['name']}] ได้รับ Bearer Token สำเร็จ ({len(token)} chars)")
                except Exception as e:
                    print(f"⚠️ Error writing bearer file: {e}")
            else:
                print(f"⚠️ [{acc['name']}] ไม่สามารถดึง Bearer Token ได้จากการเชื่อมต่อเบราว์เซอร์")
                # Save screenshot for debugging
                debug_ss = os.path.join(DATA_DIR, f"debug_login_{acc['id']}.png")
                try:
                    page.screenshot(path=debug_ss)
                    print(f"📸 บันทึกภาพหน้าจอดักจับปัญหา: {debug_ss}")
                except Exception:
                    pass

            context.close()
            return token
    except Exception as e:
        print(f"❌ [{acc['name']}] Playwright refresh error: {e}")
        return ""

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
    """Execute authenticated GET request to ReadRealm Writer API with single-refresh guard."""
    refreshed = False

    # หาก token ว่างเปล่า ให้ลองรีเฟรชครั้งแรก 1 ครั้ง
    if not token or not token.strip():
        print(f"⚠️ [{acc['name']}] Token ว่างเปล่า -> กำลังขอรับ Token ใหม่...")
        token = refresh_account_token(acc)
        acc["_cached_token"] = token
        refreshed = True
        if not token:
            print(f"❌ [{acc['name']}] ไม่สามารถดึง Token ได้ ข้ามการเรียก API")
            return {}

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
                if refreshed:
                    print(f"❌ [{acc['name']}] Token ยังคงไม่ถูกต้อง (401) หลังรีเฟรช -> ยกเลิกการเรียกซ้ำเพื่อป้องกันลูปไม่รู้จบ")
                    return {}
                print(f"⚠️ [{acc['name']}] Token หมดอายุ (401) -> รีเฟรช Token ใหม่ 1 ครั้ง...")
                new_token = refresh_account_token(acc)
                refreshed = True
                if not new_token:
                    print(f"❌ [{acc['name']}] ไม่สามารถดึง Token ใหม่ได้")
                    return {}
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

def restore_account_comics_from_cache(acc_id: str, acc_name: str) -> List[Dict[str, Any]]:
    """Recover comics for a specific account from latest growth snapshot or raw cache."""
    now_utc = datetime.now(timezone.utc)
    recovered = []

    # 1. First priority: LATEST_GROWTH_FILE
    if os.path.exists(LATEST_GROWTH_FILE):
        try:
            with open(LATEST_GROWTH_FILE, "r", encoding="utf-8") as lf:
                latest_snap = json.load(lf)
            for c in latest_snap.get("comics", []):
                if c.get("account_id") == acc_id or c.get("account") == acc_name:
                    recovered.append({
                        "comic_id": str(c.get("comic_id")),
                        "subject": c.get("subject", ""),
                        "account": acc_name,
                        "account_id": acc_id,
                        "total_views": int(c.get("total_views") or 0),
                        "total_sales": float(c.get("total_sales") or 0.0),
                        "chapters_count": int(c.get("chapters_count") or 0),
                        "last_chapter_updated_at": c.get("last_chapter_updated_at") or "",
                        "days_inactive": int(c.get("days_inactive") if c.get("days_inactive") is not None else 0),
                        "is_inactive_30d": bool(c.get("is_inactive_30d", False)),
                        "sales_7_chapters": float(c.get("sales_7_chapters") or 0.0),
                        "views_7_chapters": int(c.get("views_7_chapters") or 0),
                    })
            if recovered:
                print(f"✓ [{acc_name}] กู้คืนข้อมูลจาก snapshot ล่าสุดสำเร็จ: {len(recovered)} เรื่อง")
                return recovered
        except Exception as e:
            print(f"⚠️ Error reading {LATEST_GROWTH_FILE} for {acc_name}: {e}")

    # 2. Secondary priority: readrealm_stats_<account>.json
    cache_path = os.path.join(DATA_DIR, "readrealm_stats_lionking.json" if acc_id == "lionking" else "readrealm_stats.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for c in data.get("comics", []):
                ch_list = c.get("chapters", [])
                last_ep_str = ch_list[-1].get("created_at") if ch_list else None
                days_inact = 999
                if last_ep_str:
                    try:
                        ep_dt = datetime.fromisoformat(last_ep_str.replace("Z", "+00:00"))
                        days_inact = max(0, (now_utc - ep_dt).days)
                    except Exception:
                        days_inact = 999
                recovered.append({
                    "comic_id": str(c.get("comic_id")),
                    "subject": c.get("subject", ""),
                    "account": acc_name,
                    "account_id": acc_id,
                    "total_views": int(c.get("total_views") or 0),
                    "total_sales": float(c.get("total_sales") or 0.0),
                    "chapters_count": int(c.get("chapters_count") or len(ch_list)),
                    "last_chapter_updated_at": last_ep_str or "",
                    "days_inactive": days_inact,
                    "is_inactive_30d": days_inact > 30,
                    "sales_7_chapters": 0.0,
                    "views_7_chapters": 0
                })
            if recovered:
                print(f"✓ [{acc_name}] กู้คืนข้อมูลจาก {os.path.basename(cache_path)} สำเร็จ: {len(recovered)} เรื่อง")
                return recovered
        except Exception as e:
            print(f"⚠️ Error reading raw cache {cache_path}: {e}")

    return recovered

def get_known_cached_chapter_counts() -> Dict[str, int]:
    """
    Build a mapping of comic_id -> highest known chapter count from:
    1. Latest growth snapshot (readrealm_growth_latest.json)
    2. ReadRealm history snapshots (readrealm_history.json)
    3. Detailed writer stats cache (readrealm_stats_lionking.json & readrealm_stats.json)
    Protects against ReadRealm Writer API counter bug (-1 chapter count regression).
    """
    counts: Dict[str, int] = {}

    # 1. Latest growth snapshot
    if os.path.exists(LATEST_GROWTH_FILE):
        try:
            with open(LATEST_GROWTH_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for c in data.get("comics", []):
                cid = str(c.get("comic_id") or "")
                ch = int(c.get("chapters_count") or 0)
                if cid and ch > counts.get(cid, 0):
                    counts[cid] = ch
        except Exception:
            pass

    # 2. History snapshots
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for snap in data.get("snapshots", {}).values():
                cms = snap.get("comics", {})
                for cid, cinfo in cms.items():
                    ch = int(cinfo.get("chapters_count") or 0)
                    if cid and ch > counts.get(cid, 0):
                        counts[cid] = ch
        except Exception:
            pass

    # 3. Detailed stats caches
    for stats_fname in ["readrealm_stats_lionking.json", "readrealm_stats.json"]:
        st_path = os.path.join(DATA_DIR, stats_fname)
        if os.path.exists(st_path):
            try:
                with open(st_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for c in data.get("comics", []):
                    cid = str(c.get("comic_id") or "")
                    ch_cnt = int(c.get("chapters_count") or 0)
                    ch_len = len(c.get("chapters") or [])
                    max_ch = max(ch_cnt, ch_len)
                    if cid and max_ch > counts.get(cid, 0):
                        counts[cid] = max_ch
            except Exception:
                pass

    return counts

def fetch_public_readrealm_chapters(cid: str) -> int:
    """
    Smart Public Chapter Resolver:
    Fetches the accurate published chapter count directly from the public ReadRealm reader API:
    https://api.readrealm.co/reader/book/getListChaptersSectionPage?book_type=comic&book_id={cid}&start_index=1&sort=asc
    No writer login/bearer token required.
    """
    if not cid:
        return 0
    total = 0
    start = 1
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Origin": "https://readrealm.co",
        "Referer": f"https://readrealm.co/comic/{cid}"
    }
    try:
        while True:
            url = f"https://api.readrealm.co/reader/book/getListChaptersSectionPage?book_type=comic&book_id={cid}&start_index={start}&sort=asc"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                items = data.get("data", [])
                if not items:
                    break
                total += len(items)
                if len(items) < 50:
                    break
                start += len(items)
        return total
    except Exception:
        return total

def fetch_exact_month_sale(cid: str, year_ce: int, month: int, token: str) -> Optional[float]:
    """
    Fetch exact monthly sale from writer Sale Report endpoint (getMonthSaleReport) 1:1 with writer portal.
    Endpoint: https://api-writer.readrealm.co/writer/comics/analytics/getMonthSaleReport?month={iso}&comic_ID={cid}
    """
    try:
        iso_ts = f"{year_ce}-{month:02d}-01T00:00:00.000Z"
        url = f"https://api-writer.readrealm.co/writer/comics/analytics/getMonthSaleReport?month={urllib.parse.quote(iso_ts)}&comic_ID={cid}"
        res = call_api(url, token)
        if res and "sum_data" in res and res["sum_data"] is not None:
            return float(res["sum_data"])
    except Exception:
        pass
    return None

def fetch_writer_total_sales(cid: str, token: str) -> Optional[float]:
    """
    Fetch all_sale_sum from getDefaultSaleReport matching total sales header shown on writer portal 1:1.
    Endpoint: https://api-writer.readrealm.co/writer/comics/analytics/getDefaultSaleReport?comic_ID={cid}
    """
    try:
        url = f"https://api-writer.readrealm.co/writer/comics/analytics/getDefaultSaleReport?comic_ID={cid}"
        res = call_api(url, token)
        if res and "all_sale_sum" in res and res["all_sale_sum"] is not None:
            return float(res["all_sale_sum"])
    except Exception:
        pass
    return None

def fetch_all_comics_for_account(acc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch complete comics list and latest stats for an account."""
    token = acc.get("_cached_token") or get_valid_token(acc)
    comics_list = []
    page = 1
    per_page = 50
    now_utc = datetime.now(timezone.utc)
    cached_chapter_map = get_known_cached_chapter_counts()

    print(f"\n=======================================================")
    print(f"📚 [{acc['name']}] กำลังดึงรายชื่อการ์ตูนและสถิติล่าสุด...")
    print(f"=======================================================")

    while True:
        url = f"https://api-writer.readrealm.co/writer/comics/getComicsList?comic_subject=&comic_status=&comic_category=&comic_rating=&comic_publish=&per_page={per_page}&page={page}"
        active_token = acc.get("_cached_token") or token
        data = call_api(url, active_token, acc)
        if not data or not isinstance(data, dict):
            if page == 1:
                print(f"⚠️ [{acc['name']}] ไม่ได้รับข้อมูลตอบกลับจาก API ในหน้าแรก")
            break

        total = data.get("total", 0)
        items = data.get("data", [])
        if not items:
            if page == 1:
                print(f"⚠️ [{acc['name']}] ไม่พบรายการการ์ตูนในหน้าแรก (total: {total})")
            break

        for item in items:
            cid = item.get("comic_ID")
            subject = (item.get("comic_subject") or "").strip()
            views = int(item.get("comic_views") or 0)
            sales = float(item.get("comic_total_sales") or 0.0)
            api_ch_count = int(item.get("comic_chapter_publish_count") or item.get("comic_total_chapter") or 0)
            cached_ch_count = cached_chapter_map.get(cid, 0)
            # Phase 2: Engine Chapter Protection - prevent API -1 bug from regressing verified chapter counts
            ch_count = max(api_ch_count, cached_ch_count)
            if cached_ch_count > api_ch_count:
                print(f"    🛡️ [{acc['name']}] Chapter Protection: {subject} (API={api_ch_count} -> รักษาค่าจริง={ch_count} ตอน)")
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

    print(f"✓ [{acc['name']}] ดึงข้อมูลเสร็จสิ้น: ทั้งหมด {len(comics_list)} เรื่อง")
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
    now = datetime.now(timezone.utc)
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")
    snapshot_time_key = now.strftime("%Y-%m-%d_%H%M")

    print("\n" + "=" * 70)
    print(f"🚀 ReadRealm 6-Hour Growth Pipeline: กำลังบันทึกข้อมูลสถิติรอบ {recorded_at}")
    print("=" * 70)

    # 1. Fetch current data across both accounts with individual account fallback
    all_current_comics = []
    for acc in ACCOUNTS:
        acc_comics = []
        try:
            acc_comics = fetch_all_comics_for_account(acc)
        except Exception as e:
            print(f"❌ Error fetching {acc['name']}: {e}")

        # If live fetch returned 0 comics for this account, restore from cache
        if not acc_comics:
            print(f"⚠️ Live fetch returned 0 comics for [{acc['name']}]. Preserving previous snapshot for this account...")
            acc_comics = restore_account_comics_from_cache(acc["id"], acc["name"])

        all_current_comics.extend(acc_comics)

    # Fallback to LATEST_GROWTH_FILE first if live fetch returned 0 (prevents overwriting 368 chapters with old 200-cap cache)
    if not all_current_comics and os.path.exists(LATEST_GROWTH_FILE):
        print("⚠️ Live fetch returned 0 comics. Preserving latest growth snapshot...")
        try:
            with open(LATEST_GROWTH_FILE, "r", encoding="utf-8") as lf:
                latest_snap = json.load(lf)
            for c in latest_snap.get("comics", []):
                all_current_comics.append({
                    "comic_id": str(c.get("comic_id")),
                    "subject": c.get("subject", ""),
                    "account": c.get("account", ""),
                    "account_id": c.get("account_id", ""),
                    "total_views": int(c.get("total_views") or 0),
                    "total_sales": float(c.get("total_sales") or 0.0),
                    "chapters_count": int(c.get("chapters_count") or 0),
                    "last_chapter_updated_at": c.get("last_chapter_updated_at") or "",
                    "days_inactive": int(c.get("days_inactive") if c.get("days_inactive") is not None else 0),
                    "is_inactive_30d": bool(c.get("is_inactive_30d", False)),
                    "sales_7_chapters": float(c.get("sales_7_chapters") or 0.0),
                    "views_7_chapters": int(c.get("views_7_chapters") or 0),
                })
        except Exception as e:
            print(f"Error loading {LATEST_GROWTH_FILE}: {e}")

    # Secondary fallback to cached stats if LATEST_GROWTH_FILE was also empty
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
                        days_inact = 999
                        if last_ep_str:
                            try:
                                ep_dt = datetime.fromisoformat(last_ep_str.replace("Z", "+00:00"))
                                days_inact = max(0, (now.replace(tzinfo=timezone.utc) - ep_dt).days)
                            except Exception:
                                days_inact = 999
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

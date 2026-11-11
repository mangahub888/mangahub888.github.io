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
from concurrent.futures import ThreadPoolExecutor

from playwright.sync_api import sync_playwright



sys.stdout.reconfigure(encoding='utf-8')



BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(BASE_DIR, "data")

THAI_MONTH_ABBR = {
    "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6,
    "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12
}

def parse_thai_chapter_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    parts = date_str.strip().split()
    if len(parts) >= 3:
        try:
            d = int(parts[0])
            m_abbr = parts[1]
            y = int(parts[2])
            m = THAI_MONTH_ABBR.get(m_abbr, 1)
            ce_year = y - 543 if y > 2400 else y
            return datetime(ce_year, m, d)
        except Exception:
            pass
    return None

THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
]

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



try:

    from browser_utils import get_browser_executable_path, set_browser_window_bottom_most

except ImportError:

    try:

        from tools.browser_utils import get_browser_executable_path, set_browser_window_bottom_most

    except ImportError:

        def get_browser_executable_path() -> Optional[str]:

            if sys.platform == "win32":

                candidates = [

                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",

                    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",

                ]

                for p in candidates:

                    if os.path.exists(p):

                        return p

            return None



        def set_browser_window_bottom_most(title_filter: str = ""):

            pass



def is_token_valid(token: str) -> bool:

    """Check if JWT Bearer token is non-empty and unexpired (with 5-minute buffer)."""

    if not token or not token.startswith("Bearer "):

        return False

    parts = token.split(" ")

    if len(parts) != 2:

        return False

    jwt_parts = parts[1].split(".")

    if len(jwt_parts) != 3:

        return False

    try:

        import base64

        padded = jwt_parts[1] + "=" * ((4 - len(jwt_parts[1]) % 4) % 4)

        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))

        exp = payload.get("exp", 0)

        return exp > (time.time() + 300)

    except Exception:

        return False



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



def refresh_account_token(acc: Dict[str, Any], headless: bool = False, force_browser: bool = False, no_api: bool = False) -> str:

    """Obtain fresh Bearer token using Direct NextAuth HTTP strategy (Primary) or Playwright browser (Fallback)."""

    bearer_file = acc["bearer_file"]

    profile_dir = acc["profile_dir"]



    token = None

    if not force_browser and not no_api:

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



    # Strategy 2: Persistent Browser Session via Playwright Chrome

    mode_str = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"

    print(f"🌐 [{acc['name']}] กำลังเปิด {mode_str} เพื่อดึง Token...", flush=True)

    exec_path = get_browser_executable_path()

    try:

        with sync_playwright() as p:

            launch_kwargs = {

                "headless": headless,

                "channel": "chrome",

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



            try:

                context = p.chromium.launch_persistent_context(

                    user_data_dir=profile_dir,

                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",

                    **launch_kwargs

                )

            except Exception as e_launch:

                print(f"⚠️ [{acc['name']}] ไม่สามารถเปิดด้วย channel='chrome' ({e_launch}) กำลังลองใช้ Chromium ปกติ...")

                launch_kwargs.pop("channel", None)

                context = p.chromium.launch_persistent_context(

                    user_data_dir=profile_dir,

                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",

                    **launch_kwargs

                )



            if not headless:

                set_browser_window_bottom_most("readrealm")



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

            if not headless:

                set_browser_window_bottom_most("readrealm")

            page.wait_for_timeout(3500)



            # If redirected to login, perform smart NextAuth in-browser login

            if "/login" in page.url:

                print(f"🔑 [{acc['name']}] ตรวจพบหน้าเข้าสู่ระบบ -> ทำการล็อกอิน...", flush=True)

                tokens.clear()



                # Strategy 2A: Direct in-browser NextAuth API execution via page.evaluate

                # This seamlessly sets cookies in Chrome's session and bypasses Cloudflare Turnstile

                try:

                    auth_result = page.evaluate("""async (creds) => {

                        try {

                            const csrfRes = await fetch('/api/auth/csrf');

                            const { csrfToken } = await csrfRes.json();

                            if (!csrfToken) return { ok: false, error: 'No CSRF' };



                            const params = new URLSearchParams();

                            params.append('csrfToken', csrfToken);

                            params.append('username_or_email', creds.username);

                            params.append('password', creds.password);

                            params.append('callbackUrl', 'https://readrealm.co');

                            params.append('json', 'true');



                            const cbRes = await fetch('/api/auth/callback/credentials', {

                                method: 'POST',

                                headers: {

                                    'Content-Type': 'application/x-www-form-urlencoded',

                                    'X-Auth-Return-Redirect': '1'

                                },

                                body: params.toString()

                            });



                            const sessRes = await fetch('/api/auth/session');

                            const sessData = await sessRes.json();

                            const rawToken = sessData?.accessToken || sessData?.token || sessData?.user?.accessToken || sessData?.user?.token;

                            return { ok: !!rawToken, token: rawToken };

                        } catch (e) {

                            return { ok: false, error: e.toString() };

                        }

                    }""", {"username": acc["username"], "password": acc["password"]})



                    if auth_result and auth_result.get("ok"):

                        raw_t = auth_result.get("token")

                        token = f"Bearer {raw_t}" if not str(raw_t).startswith("Bearer ") else str(raw_t)

                        print(f"✓ [{acc['name']}] ล็อกอินในเบราว์เซอร์ผ่าน NextAuth สำเร็จ ({len(token)} chars)", flush=True)

                except Exception as e_eval:

                    print(f"⚠️ [{acc['name']}] In-page NextAuth evaluation notice: {e_eval}")



                # Strategy 2B: Fallback to DOM input fill if in-page eval did not yield token

                if not token:

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

                    for sec in range(15):

                        page.wait_for_timeout(1000)

                        if "/login" not in page.url:

                            print(f"✓ [{acc['name']}] นำทางออกจากหน้าล็อกอินแล้ว")

                            break



                        # Cloudflare Turnstile checkbox handling

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

                                page.wait_for_timeout(3000)

                                break

                        except Exception:

                            pass



                tokens.clear()

                page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")

                page.wait_for_timeout(3500)



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



            # Final safety net: Direct HTTP fallback if browser session yielded nothing (only when not in no-api mode)

            if not token and not force_browser and not no_api:

                print(f"🔄 [{acc['name']}] เบราว์เซอร์ไม่คืนค่า Token -> สลับใช้ Direct HTTP สำรองทันที...", flush=True)

                token = authenticate_via_direct_http(acc)



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

    """Retrieve existing cached token or refresh if missing / expired."""

    bearer_file = acc["bearer_file"]

    if not force_refresh and os.path.exists(bearer_file):

        try:

            with open(bearer_file, "r", encoding="utf-8") as f:

                d = json.load(f)

                token = d.get("bearer") or d.get("full") or ""

                if token and token.startswith("Bearer ") and is_token_valid(token):

                    return token

                token_only = d.get("token") or ""

                if token_only and is_token_valid(f"Bearer {token_only}"):

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



def fetch_exact_month_sale(cid: str, year_ce: int, month: int, token: str, acc: Optional[Dict[str, Any]] = None) -> Optional[float]:

    """

    Fetch exact monthly sale from writer Sale Report endpoint (getMonthSaleReport) 1:1 with writer portal.

    Endpoint: https://api-writer.readrealm.co/writer/comics/analytics/getMonthSaleReport?month={iso}&comic_ID={cid}

    """

    try:

        iso_ts = f"{year_ce}-{month:02d}-01T00:00:00.000Z"

        url = f"https://api-writer.readrealm.co/writer/comics/analytics/getMonthSaleReport?month={urllib.parse.quote(iso_ts)}&comic_ID={cid}"

        res = call_api(url, token, acc) if acc else {}

        if res and "sum_data" in res and res["sum_data"] is not None:

            return float(res["sum_data"])

    except Exception:

        pass

    return None



def fetch_writer_total_sales(cid: str, token: str, acc: Optional[Dict[str, Any]] = None) -> Optional[float]:

    """

    Fetch all_sale_sum from getDefaultSaleReport matching total sales header shown on writer portal 1:1.

    Endpoint: https://api-writer.readrealm.co/writer/comics/analytics/getDefaultSaleReport?comic_ID={cid}

    """

    try:

        url = f"https://api-writer.readrealm.co/writer/comics/analytics/getDefaultSaleReport?comic_ID={cid}"

        res = call_api(url, token, acc) if acc else {}

        if res and "all_sale_sum" in res and res["all_sale_sum"] is not None:

            return float(res["all_sale_sum"])

    except Exception:

        pass

    return None



def fetch_all_comics_for_account(acc: Dict[str, Any], headless: bool = False) -> List[Dict[str, Any]]:
    """Fetch complete comics list and latest stats for an account by automating the real visible Google Chrome browser page-by-page and comic-by-comic (mgeko style, zero API calls)."""
    comics_list = []
    now_utc = datetime.now(timezone.utc)
    now_dt = datetime.now()
    cur_month_th = THAI_MONTHS[now_dt.month - 1]

    print(f"\n=======================================================")
    print(f"🌐 [{acc['name']}] กำลังเปิดเบราว์เซอร์จริง (Non-Headless) ดึงข้อมูลหน้าเว็บ...")
    print(f"=======================================================")

    profile_dir = acc["profile_dir"]
    os.makedirs(profile_dir, exist_ok=True)

    # Pre-load known monthly sales cache from disk for baseline
    stats_cache_map = {}
    for p_name in ["readrealm_stats_lionking.json", "readrealm_stats.json"]:
        p_path = os.path.join(DATA_DIR, p_name)
        if os.path.exists(p_path):
            try:
                with open(p_path, "r", encoding="utf-8") as f:
                    s_data = json.load(f)
                    for c_item in s_data.get("comics", []):
                        if c_item.get("comic_id"):
                            stats_cache_map[c_item["comic_id"]] = c_item.get("monthly_sales", {})
            except Exception:
                pass

    chrome_exe = get_browser_executable_path()
    launch_kwargs = {
        "headless": headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--window-size=1280,800"
        ]
    }
    if chrome_exe:
        launch_kwargs["executable_path"] = chrome_exe
    else:
        launch_kwargs["channel"] = "chrome"

    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=profile_dir,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                **launch_kwargs
            )
        except Exception as e_launch:
            launch_kwargs.pop("channel", None)
            launch_kwargs.pop("executable_path", None)
            context = p.chromium.launch_persistent_context(
                user_data_dir=profile_dir,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                **launch_kwargs
            )

        if not headless:
            set_browser_window_bottom_most("readrealm")

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

        analytics_cache = {}
        def on_res(res):
            u = res.url
            if "analytics" in u:
                try:
                    analytics_cache[u] = res.json()
                except Exception:
                    pass
        page.on("response", on_res)

        page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
        if not headless:
            set_browser_window_bottom_most("readrealm")
        page.wait_for_timeout(2500)

        if "/login" in page.url:
            print(f"🔑 [{acc['name']}] ตรวจพบหน้าเข้าสู่ระบบ -> ทำการล็อกอิน...", flush=True)
            try:
                page.evaluate("""async (creds) => {
                    const csrfRes = await fetch('/api/auth/csrf');
                    const { csrfToken } = await csrfRes.json();
                    if (!csrfToken) return;
                    const params = new URLSearchParams();
                    params.append('csrfToken', csrfToken);
                    params.append('username_or_email', creds.username);
                    params.append('password', creds.password);
                    params.append('callbackUrl', 'https://readrealm.co');
                    await fetch('/api/auth/callback/credentials', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });
                }""", {"username": acc["username"], "password": acc["password"]})
            except Exception:
                pass
            page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

        if tokens:
            latest_tok = tokens[-1]
            acc["_cached_token"] = latest_tok
            try:
                with open(acc["bearer_file"], "w", encoding="utf-8") as bf:
                    json.dump({"bearer_token": latest_tok, "updated_at": now_utc.isoformat()}, bf, indent=2)
            except Exception:
                pass

        print(f"📄 [{acc['name']}] กำลังกวาดรายชื่อการ์ตูนทีละหน้าจาก DOM...", flush=True)
        page_nums = page.evaluate(r"""() => {
            const btns = Array.from(document.querySelectorAll('button, .join-item'));
            const nums = [];
            btns.forEach(b => {
                const txt = b.innerText.trim();
                if (/^\d+$/.test(txt)) nums.push(parseInt(txt));
            });
            return nums.length ? Math.max(...nums) : 1;
        }""")
        total_pages = max(1, page_nums)
        print(f"  [{acc['name']}] ตรวจพบทั้งหมด {total_pages} หน้า")

        seen_cids = set()

        for cur_p in range(1, total_pages + 1):
            if cur_p > 1:
                clicked = page.evaluate(f"""() => {{
                    const btns = Array.from(document.querySelectorAll('button, .join-item'));
                    const target = btns.find(b => b.innerText.trim() === '{cur_p}');
                    if (target) {{
                        target.click();
                        return true;
                    }}
                    return false;
                }}""")
                if not clicked:
                    btn_loc = page.locator("button.join-item, button").filter(has_text=f"^{cur_p}$").first
                    if btn_loc.count():
                        btn_loc.click()
                page.wait_for_timeout(1200)

            page_cards = page.evaluate(r"""() => {
                const links = Array.from(document.querySelectorAll('a[href*="/writer/comic/"]')).filter(a => !a.href.endsWith('/add'));
                return links.map(a => {
                    const href = a.getAttribute('href') || '';
                    const cid = href.split('/').pop();
                    const parent = a.parentElement;
                    const fullText = parent ? parent.innerText : a.innerText;
                    
                    const linkLines = a.innerText.split('\n').map(s => s.trim()).filter(Boolean);
                    const title = linkLines[0] || '';
                    
                    let chCount = 0;
                    let views = 0;
                    if (linkLines.length >= 2) {
                        chCount = parseInt(linkLines[1].replace(/,/g, '')) || 0;
                    }
                    if (linkLines.length >= 3) {
                        let vStr = linkLines[2].replace(/,/g, '');
                        let f = 1;
                        if (vStr.endsWith('K') || vStr.endsWith('k')) { f = 1000; vStr = vStr.slice(0, -1); }
                        else if (vStr.endsWith('M') || vStr.endsWith('m')) { f = 1000000; vStr = vStr.slice(0, -1); }
                        views = Math.round((parseFloat(vStr) || 0) * f);
                    }
                    
                    let sales = 0;
                    const mSales = fullText.match(/ยอดขาย\s*\n\s*([\d,\.]+[KkMm]?)/);
                    if (mSales) {
                        let sStr = mSales[1].replace(/,/g, '');
                        let f = 1;
                        if (sStr.endsWith('K') || sStr.endsWith('k')) { f = 1000; sStr = sStr.slice(0, -1); }
                        else if (sStr.endsWith('M') || sStr.endsWith('m')) { f = 1000000; sStr = sStr.slice(0, -1); }
                        sales = (parseFloat(sStr) || 0) * f;
                    }
                    
                    return {
                        cid: cid,
                        subject: title,
                        chapters_count: chCount,
                        total_views: views,
                        total_sales: sales
                    };
                });
            }""")

            new_cards_count = 0
            for c in page_cards:
                cid = c.get("cid")
                if cid and cid not in seen_cids:
                    seen_cids.add(cid)
                    c["comic_id"] = cid
                    c["account"] = acc["name"]
                    c["account_id"] = acc["id"]
                    c["days_inactive"] = 0
                    c["is_inactive_30d"] = False
                    c["monthly_sales"] = dict(stats_cache_map.get(cid, {}))
                    c["sales_7_chapters"] = 0.0
                    c["views_7_chapters"] = 0
                    c["last_chapter_updated_at"] = ""
                    comics_list.append(c)
                    new_cards_count += 1

            print(f"  [{acc['name']}] หน้า {cur_p}/{total_pages}: ได้รับ {new_cards_count} เรื่อง (สะสม {len(comics_list)} เรื่อง)")

        print(f"✓ [{acc['name']}] กวาดรายชื่อหน้าเว็บสำเร็จ: รวมทั้งสิ้น {len(comics_list)} เรื่อง\n")

        print(f"🔍 [{acc['name']}] กำลังกดเข้าไปดูทีละเรื่อง เพื่อดึงยอดรายตอน, ยอดรายเดือน, ยอดรวมตลอดกาล...", flush=True)

        for idx, c in enumerate(comics_list, 1):
            cid = c["comic_id"]
            subj = c["subject"]
            t0 = time.time()
            print(f"  [{acc['name']}] [{idx}/{len(comics_list)}] {subj} ({cid})...", end="", flush=True)

            try:
                analytics_cache.clear()
                page.goto(f"https://readrealm.co/writer/comic/{cid}", wait_until="domcontentloaded")

                # Tab A: รายงานและสถิติ
                stat_btn = page.locator("button:has-text('รายงานและสถิติ'), li:has-text('รายงานและสถิติ'), a:has-text('รายงานและสถิติ')").first
                if stat_btn.count():
                    stat_btn.click()
                    try:
                        page.wait_for_selector("text='รายงานการขายรายเดือน'", timeout=2000)
                        page.wait_for_timeout(350)
                    except Exception:
                        page.wait_for_timeout(500)

                dom_stats = page.evaluate(r"""() => {
                    const txt = document.body.innerText;
                    const mTot = txt.match(/ยอดขายรวม\s*:\s*([\d,\.]+)/);
                    const mMonth = txt.match(/ยอดขายรวมรายเดือน\s*:\s*([\d,\.]+)/);
                    const mYear = txt.match(/ยอดขายรวมรายปี\s*:\s*([\d,\.]+)/);
                    return {
                        total_sales: mTot ? parseFloat(mTot[1].replace(/,/g, '')) : 0,
                        month_sales: mMonth ? parseFloat(mMonth[1].replace(/,/g, '')) : 0,
                        year_sales: mYear ? parseFloat(mYear[1].replace(/,/g, '')) : 0
                    };
                }""")

                tot_sales = dom_stats.get("total_sales", 0)
                month_sales = dom_stats.get("month_sales", 0)
                m_dict = dict(c.get("monthly_sales", {}))

                for u, b in analytics_cache.items():
                    if "getDefaultSaleReport" in u and isinstance(b, dict):
                        api_tot = float(b.get("all_sale_sum") or 0)
                        if api_tot > 0 and tot_sales == 0:
                            tot_sales = api_tot
                    elif "getMonthSaleReport" in u and isinstance(b, dict):
                        api_mon = float(b.get("sum_data") or 0)
                        if api_mon > 0 and month_sales == 0:
                            month_sales = api_mon
                    elif "getYearSaleReport" in u and isinstance(b, dict):
                        year_arr = b.get("data", [])
                        if isinstance(year_arr, list):
                            for m_idx, m_val in enumerate(year_arr):
                                if m_idx < len(THAI_MONTHS):
                                    th_m = THAI_MONTHS[m_idx]
                                    m_dict[th_m] = round(float(m_val or 0.0), 2)

                # Fallback: If getYearSaleReport wasn't in cache, fetch it directly in browser context
                if not any("getYearSaleReport" in u for u in analytics_cache):
                    try:
                        tok = tokens[-1] if tokens else (acc.get("_cached_token") or "")
                        if tok:
                            yr_res = page.evaluate("""async ([tok, cid]) => {
                                const res = await fetch(`https://api-writer.readrealm.co/writer/comics/analytics/getYearSaleReport?year=2569&comic_ID=${cid}`, {
                                    headers: { 'Authorization': tok }
                                });
                                return await res.json();
                            }""", [tok, cid])
                            if yr_res and isinstance(yr_res.get("data"), list):
                                for m_idx, m_val in enumerate(yr_res["data"]):
                                    if m_idx < len(THAI_MONTHS):
                                        m_dict[THAI_MONTHS[m_idx]] = round(float(m_val or 0.0), 2)
                    except Exception:
                        pass

                if tot_sales > 0:
                    c["total_sales"] = tot_sales
                if cur_month_th not in m_dict or month_sales > 0:
                    m_dict[cur_month_th] = month_sales
                c["monthly_sales"] = m_dict

                # Tab B: รายชื่อตอน
                ch_btn = page.locator("button:has-text('รายชื่อตอน'), li:has-text('รายชื่อตอน'), a:has-text('รายชื่อตอน')").first
                if ch_btn.count():
                    ch_btn.click()
                    try:
                        page.wait_for_selector("table tbody tr", timeout=2000)
                        page.evaluate(r"""() => {
                            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '1000 รายการ');
                            if (btn) btn.click();
                        }""")
                        page.wait_for_timeout(350)
                    except Exception:
                        page.wait_for_timeout(300)

                ch_data = page.evaluate(r"""() => {
                    const trs = Array.from(document.querySelectorAll('table tbody tr'));
                    if (!trs.length) return { ch_count: 0, sales_7: 0, views_7: 0, last_date: '' };
                    
                    const eps = trs.map(tr => {
                        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                        let v = (tds[2] || '0').replace(/,/g, '');
                        let f = 1;
                        if (v.endsWith('K') || v.endsWith('k')) { f = 1000; v = v.slice(0, -1); }
                        else if (v.endsWith('M') || v.endsWith('m')) { f = 1000000; v = v.slice(0, -1); }
                        let parsedViews = Math.round((parseFloat(v) || 0) * f);
                        
                        return {
                            idx: tds[0],
                            name: tds[1],
                            views: parsedViews,
                            sales: parseFloat((tds[4] || '0').replace(/,/g, '')) || 0,
                            status: tds[5],
                            date: tds[6]
                        };
                    });
                    const last7 = eps.slice(-7);
                    const s7 = last7.reduce((a, b) => a + b.sales, 0);
                    const v7 = last7.reduce((a, b) => a + b.views, 0);
                    
                    let lastDate = '';
                    for (let i = eps.length - 1; i >= 0; i--) {
                        if (eps[i].date) {
                            lastDate = eps[i].date;
                            break;
                        }
                    }
                    
                    return {
                        ch_count: eps.length,
                        sales_7: Math.round(s7 * 100) / 100,
                        views_7: v7,
                        last_date: lastDate
                    };
                }""")

                ch_count = ch_data.get("ch_count", 0)
                if ch_count > 0:
                    c["chapters_count"] = max(c.get("chapters_count", 0), ch_count)
                c["sales_7_chapters"] = ch_data.get("sales_7", 0.0)
                c["views_7_chapters"] = ch_data.get("views_7", 0)

                last_date_str = ch_data.get("last_date", "")
                if last_date_str:
                    dt = parse_thai_chapter_date(last_date_str)
                    if dt:
                        c["last_chapter_updated_at"] = dt.isoformat()
                        c["days_inactive"] = max(0, (now_dt - dt).days)
                        c["is_inactive_30d"] = c["days_inactive"] > 30

                elapsed = time.time() - t0
                non_zero_m = [f"{m[:3]}:{v:,.0f}" for m, v in m_dict.items() if v > 0]
                m_summary = " ".join(non_zero_m) if non_zero_m else f"{cur_month_th}:{month_sales:,.1f}"
                print(f" ✓ รวม: {c['total_sales']:,.2f} ฿ | เดือนนี้: {month_sales:,.2f} ฿ | ประวัติ 2569: [{m_summary}] | 7 ตอน: {c['sales_7_chapters']:,.2f} ฿ | {c['chapters_count']} ตอน ({elapsed:.1f}s)", flush=True)

            except Exception as e_c:
                print(f" ⚠️ ({e_c})", flush=True)

        try:
            context.close()
        except Exception:
            pass

    # Persist into stats file
    try:
        stats_file_name = "readrealm_stats_lionking.json" if acc["id"] == "lionking" else "readrealm_stats.json"
        stats_file_path = os.path.join(DATA_DIR, stats_file_name)
        with open(stats_file_path, "w", encoding="utf-8") as sf:
            json.dump({"comics": comics_list, "updated_at": datetime.now().isoformat()}, sf, ensure_ascii=False, indent=2)
        print(f"💾 [{acc['name']}] บันทึกข้อมูลลง {stats_file_name} สำเร็จ")
    except Exception as e_sf:
        print(f"⚠️ [{acc['name']}] ไม่สามารถบันทึกแคชสถิติ: {e_sf}")

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



def run_growth_pipeline(send_to_gas: bool = False, gas_url: str = "", passcode: str = "10211032", use_browser: bool = True, force_refresh: bool = False, no_api: bool = False):

    now = datetime.now(timezone.utc)

    recorded_at = now.isoformat()

    snapshot_date_key = now.strftime("%Y-%m-%d")

    snapshot_time_key = now.strftime("%Y-%m-%d_%H%M")



    print("\n" + "=" * 70)

    print(f"🚀 ReadRealm 6-Hour Growth Pipeline: กำลังบันทึกข้อมูลสถิติรอบ {recorded_at}")

    if no_api:

        print("   🔒 [NO API Mode] ใช้เบราว์เซอร์จริง 100% ไม่พึ่งพา Direct NextAuth API")

    print("=" * 70)



    # 1. Fetch current data across both accounts with individual account fallback

    all_current_comics = []

    for acc in ACCOUNTS:

        # In browser / no_api mode, fetch_all_comics_for_account directly automates the browser
        if not (use_browser or no_api):
            token = get_valid_token(acc, force_refresh=force_refresh)
            if not token:
                token = refresh_account_token(acc, headless=not use_browser, force_browser=False, no_api=False)
            acc["_cached_token"] = token

        acc_comics = []

        try:

            acc_comics = fetch_all_comics_for_account(acc, headless=not use_browser)

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

            "sales_7_chapters": round(float(c.get("sales_7_chapters") or prev_7ch_map.get(str(cid), {}).get("sales_7_chapters") or 0.0), 2),

            "views_7_chapters": int(c.get("views_7_chapters") or prev_7ch_map.get(str(cid), {}).get("views_7_chapters") or 0)

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



    # Attach monthly_sales from readrealm_stats files so growth_results has full monthly_sales parity

    stats_map = {}

    for p_name in ["readrealm_stats_lionking.json", "readrealm_stats.json"]:

        p_path = os.path.join(DATA_DIR, p_name)

        if os.path.exists(p_path):

            try:

                with open(p_path, "r", encoding="utf-8") as f:

                    s_data = json.load(f)

                    for c_item in s_data.get("comics", []):

                        if c_item.get("comic_id"):

                            stats_map[c_item["comic_id"]] = c_item.get("monthly_sales", {})

                        if c_item.get("subject"):

                            stats_map[c_item["subject"].strip()] = c_item.get("monthly_sales", {})

            except Exception:

                pass



    for c in growth_results:

        cid = c.get("comic_id")

        subj = (c.get("subject") or "").strip()

        m_sales = c.get("monthly_sales") or stats_map.get(cid) or stats_map.get(subj)

        if m_sales:

            c["monthly_sales"] = m_sales

        elif "monthly_sales" not in c:

            c["monthly_sales"] = {}



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

    parser.add_argument("--browser", action="store_true", default=True, help="Launch real visible Google Chrome browser (default: True)")

    parser.add_argument("--headless", action="store_true", default=False, help="Run browser in headless mode (default: False)")

    parser.add_argument("--force-refresh", action="store_true", default=False, help="Force refresh tokens even if cached tokens are still unexpired")

    parser.add_argument("--no-api", action="store_true", default=False, help="Disable direct HTTP/API login, force real browser session only")

    parser.add_argument("--sync-gas", action="store_true", help="Send data to GAS Web App")

    parser.add_argument("--gas-url", type=str, default="", help="GAS Web App exec URL")

    parser.add_argument("--passcode", type=str, default="10211032", help="GAS Passcode")

    args = parser.parse_args()



    use_browser = False if args.headless else args.browser

    force_refresh = args.force_refresh or args.no_api

    no_api = args.no_api



    run_growth_pipeline(

        send_to_gas=args.sync_gas or bool(os.environ.get("GAS_URL")),

        gas_url=args.gas_url or os.environ.get("GAS_URL", ""),

        passcode=args.passcode or os.environ.get("PASSCODE", "10211032"),

        use_browser=use_browser,

        force_refresh=force_refresh,

        no_api=no_api

    )


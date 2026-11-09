#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KuaiKan Manhua Playwright Headless Auto-Purchaser
-----------------------------------------------------------
Automated VIP chapter purchaser using Playwright Headless browser.
Runs seamlessly both on local machines (Windows Edge/Chrome fallback)
and in GitHub Actions CI/CD (Chromium).

Features:
- Injects KuaiKan VIP session cookies (via GAS or KUAIKAN_COOKIE env)
- Navigates to KuaiKan chapter reader (SPA)
- Auto-detects lock status, VIP 8.5 discount, and wallet balance
- Clicks '立即支付' / '确认购买' if modal appears, or handles auto-pay
- Intercepts network order response from /v2/comicbuy/encrypt_buy_h5
- Verifies chapter unlock and image availability
- Notifies MangaHub GAS backend to sync wallet status & WorkQueue
"""

import os
import sys
import time
import json
import re
import argparse
import urllib.request
from typing import Dict, Any, Optional, List

sys.stdout.reconfigure(encoding='utf-8')

# Default Configurations
GAS_URL = os.environ.get(
    "GAS_URL",
    "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
)
PASSCODE = os.environ.get("PASSCODE", "10211032")


def call_gas(action: str, payload: Optional[Dict[str, Any]] = None, retries: int = 3) -> Dict[str, Any]:
    """Call MangaHub Google Apps Script backend API."""
    body = {
        "passcode": PASSCODE,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode('utf-8')
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                GAS_URL,
                data=data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(2 * attempt)
    return {}


def get_kuaikan_session_cookie() -> str:
    """Retrieve KuaiKan session cookie from environment variable or GAS."""
    env_cookie = os.environ.get("KUAIKAN_COOKIE", "").strip()
    if env_cookie:
        return env_cookie

    res = call_gas("GET_KUAIKAN_AUTH_STATUS")
    if res.get("status") == "success" and res.get("data"):
        data = res["data"]
        cookie = data.get("cookie", "").strip()
        if cookie:
            return cookie

    raise RuntimeError("Could not retrieve KuaiKan session cookie from env or GAS backend.")


def parse_cookie_string(cookie_str: str) -> List[Dict[str, str]]:
    """Parse HTTP Cookie header string into Playwright cookie format."""
    cookies = []
    for item in cookie_str.split(';'):
        if '=' in item:
            name, val = item.strip().split('=', 1)
            name = name.strip()
            val = val.strip()
            if name and val:
                cookies.append({
                    "name": name,
                    "value": val,
                    "domain": ".kuaikanmanhua.com",
                    "path": "/"
                })
    return cookies


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
                    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
                ]
                for p in candidates:
                    if os.path.exists(p):
                        return p
            return None

        def set_browser_window_bottom_most(title_filter: str = ""):
            pass


def purchase_chapter_playwright(comic_id: str, topic_id: str = "", headless: bool = False, timeout_ms: int = 40000) -> Dict[str, Any]:
    """
    Execute KuaiKan Chapter Auto-Purchase using Playwright Headless.
    Returns:
        dict: {
            'success': bool,
            'comicId': str,
            'title': str,
            'orderId': str,
            'discountPrice': int,
            'balance': int,
            'vipDiscount': bool,
            'imagesCount': int,
            'message': str
        }
    """
    from playwright.sync_api import sync_playwright

    comic_id = str(comic_id).strip()
    target_url = f"https://www.kuaikanmanhua.com/webs/comic-next/{comic_id}"

    result: Dict[str, Any] = {
        "success": False,
        "comicId": comic_id,
        "topicId": topic_id,
        "title": "",
        "orderId": "",
        "orderPrice": None,
        "discountPrice": None,
        "balance": None,
        "vipDiscount": False,
        "imagesCount": 0,
        "isVipExclusive": False,
        "outOfCoins": False,
        "message": ""
    }

    # 1. Obtain and parse cookies
    raw_cookie = get_kuaikan_session_cookie()
    pw_cookies = parse_cookie_string(raw_cookie)
    if not pw_cookies:
        result["message"] = "No valid KuaiKan cookies found."
        return result

    executable_path = get_browser_executable_path()

    print(f"\n=======================================================")
    print(f"🛒 KuaiKan Playwright Purchaser: ComicID {comic_id}")
    print(f"🌐 Target: {target_url}")
    print(f"=======================================================")

    with sync_playwright() as p:
        launch_args = {
            "headless": headless,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled"
            ]
        }
        if executable_path:
            launch_args["executable_path"] = executable_path

        browser = p.chromium.launch(**launch_args)
        if not headless:
            set_browser_window_bottom_most("kuaikan")

        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900}
        )
        context.add_cookies(pw_cookies)

        page = context.new_page()

        # Track network calls
        order_received = False

        def handle_response(response):
            nonlocal order_received
            url = response.url

            # 1. Check comic_pay_window price & wallet info
            if "comic_pay_window" in url and response.status == 200:
                try:
                    data = response.json()
                    p_info = data.get("data", {}).get("price_info", {})
                    bal = p_info.get("kk_currency_balance")
                    if bal is not None:
                        result["balance"] = bal
                        print(f"   💰 KK Coin Balance from API: {bal}")
                except Exception:
                    pass

            # 2. Check encrypt_buy_h5 purchase response
            if "encrypt_buy_h5" in url:
                try:
                    data = response.json()
                    print(f"   📡 Purchase API Response: code={data.get('code')}, message={data.get('message')}")
                    if data.get("code") == 200:
                        order_received = True
                        c_order = data.get("data", {}).get("comic_order", {})
                        result["orderId"] = str(c_order.get("order_id") or c_order.get("order_id_str") or "")
                        result["orderPrice"] = c_order.get("order_price")
                        result["discountPrice"] = c_order.get("discount_price")
                        result["success"] = True
                        if result["orderPrice"] and result["discountPrice"] and result["discountPrice"] < result["orderPrice"]:
                            result["vipDiscount"] = True
                        print(f"   🎉 Purchase order created: #{result['orderId']}, Price: {result['discountPrice']} KK Coins (Orig: {result['orderPrice']})")
                    elif data.get("code") in [3004, 3005] or "余额不足" in str(data.get("message")):
                        result["outOfCoins"] = True
                        result["message"] = "KuaiKan wallet balance insufficient / out of coins."
                except Exception:
                    pass

            # 3. Check VIP Enjoy unlock
            if "vip_enjoy_h5" in url:
                try:
                    data = response.json()
                    if data.get("code") == 200:
                        result["success"] = True
                        result["isVipExclusive"] = True
                        print("   👑 VIP Enjoy unlocked successfully!")
                except Exception:
                    pass

        page.on("response", handle_response)

        try:
            mode_desc = "Headless browser" if headless else "Google Chrome จริง (HWND_BOTTOM)"
            print(f"1. Loading chapter page in {mode_desc}...")
            page.goto(target_url, wait_until="networkidle", timeout=timeout_ms)
            if not headless:
                set_browser_window_bottom_most("kuaikan")
            result["title"] = page.title()
            print(f"✓ Page Title: {result['title']}")

            # Wait 3 seconds for initial client-side hooks & auto_pay
            page.wait_for_timeout(3000)

            # Check if order was already triggered automatically
            if not order_received and not result["outOfCoins"]:
                print("2. Checking for purchase modals / buttons on screen...")

                # Look for '立即支付' or purchase buttons
                pay_selectors = [
                    "button:has-text('立即支付')",
                    "div:has-text('立即支付')",
                    ".pay-btn",
                    ".btn-pay",
                    "button:has-text('确认购买')",
                    "div:has-text('确认购买')",
                    "button:has-text('购买本话')",
                    ".OneClickBuyPopup button",
                    ".BatchBuyPop button"
                ]

                button_found = None
                for sel in pay_selectors:
                    elem = page.query_selector(sel)
                    if elem and elem.is_visible():
                        button_found = elem
                        print(f"   ✓ Found visible purchase element matching: {sel}")
                        break

                if button_found:
                    # Check for VIP discount text before clicking
                    body_text = page.inner_text("body")
                    if "8.5折" in body_text or "会员折扣" in body_text:
                        result["vipDiscount"] = True
                        print("   👑 VIP 8.5 discount tag detected on modal!")

                    print("   👉 Clicking '立即支付'...")
                    button_found.click()
                    page.wait_for_timeout(4000)

            # Wait an additional 2 seconds for state updates
            page.wait_for_timeout(2000)

        except Exception as e:
            print(f"⚠️ Playwright navigation/interaction warning: {e}")
        finally:
            browser.close()

    # 3. Verify unlock with GAS TEST_KUAIKAN_CHAPTER
    print("3. Verifying unlock status & extracting images via GAS backend...")
    verify_res = call_gas("TEST_KUAIKAN_CHAPTER", {"comicId": comic_id, "skipAutoPurchase": True})
    v_data = verify_res.get("data") if isinstance(verify_res.get("data"), dict) else {}
    v_status = verify_res.get("status")

    imgs_count = v_data.get("imagesCount", 0)
    result["imagesCount"] = imgs_count
    if v_data.get("title"):
        result["title"] = v_data.get("title")

    if imgs_count > 1 and not v_data.get("isLocked"):
        result["success"] = True
        result["message"] = f"Chapter {result['title']} is unlocked! ({imgs_count} HD images available)"
        print(f"✅ Success! {result['message']}")
        # Dismiss any coin alerts if previously raised
        call_gas("DISMISS_KUAIKAN_COIN_ALERT")
    elif result["success"]:
        # Order succeeded in browser, might take a couple seconds to reflect
        time.sleep(3)
        v2 = call_gas("TEST_KUAIKAN_CHAPTER", {"comicId": comic_id, "skipAutoPurchase": True})
        v2_data = v2.get("data") if isinstance(v2.get("data"), dict) else {}
        if v2_data.get("imagesCount", 0) > 1:
            result["imagesCount"] = v2_data.get("imagesCount")
            result["message"] = f"Chapter unlocked on retry: {v2_data.get('imagesCount')} images."
            print(f"✅ Success! {result['message']}")
            call_gas("DISMISS_KUAIKAN_COIN_ALERT")
        else:
            result["message"] = "Order sent but images not yet ready."
    else:
        result["message"] = v_data.get("error") or "Chapter remains locked."
        print(f"❌ Result: {result['message']}")

    return result


def main():
    parser = argparse.ArgumentParser(description="KuaiKan Playwright Headless Auto-Purchaser")
    parser.add_argument("--comic-id", help="Single KuaiKan Comic ID to purchase and unlock")
    parser.add_argument("--topic-id", default="", help="KuaiKan Topic ID (optional)")
    parser.add_argument("--all-pending", action="store_true", help="Process all pending chapters from RawTracker")
    parser.add_argument("--max-chapters", type=int, default=0, help="Max chapters to process (0 = all)")
    parser.add_argument("--cooldown", type=int, default=300, help="Cooldown in seconds between purchases (default: 300)")

    args = parser.parse_args()

    print("=================================================================")
    print("🚀 KuaiKan Playwright Headless Auto-Purchaser")
    print(f"⏱️ Safety Rule: Cooldown {args.cooldown}s between chapters")
    print("=================================================================")

    target_comics = []

    if args.comic_id:
        target_comics.append({"comicId": str(args.comic_id), "topicId": args.topic_id, "mangaName": "KuaiKan Manga"})
    elif args.all_pending:
        print("\n1. Fetching pending tasks from MangaHub RawTracker...")
        res = call_gas("GET_RAW_TRACKER_PENDING_CHAPTERS")
        tasks = res.get("data", {}).get("tasks", []) if res.get("status") == "success" else []
        for t in tasks:
            cid = t.get("comicId")
            if cid:
                target_comics.append({
                    "comicId": str(cid),
                    "topicId": str(t.get("topicId") or ""),
                    "mangaName": t.get("mangaName") or "",
                    "chapterTitle": t.get("chapterTitle") or ""
                })

    if not target_comics:
        print("ℹ️ No target chapters specified or pending.")
        return

    if args.max_chapters > 0 and len(target_comics) > args.max_chapters:
        target_comics = target_comics[:args.max_chapters]

    total = len(target_comics)
    print(f"\n📋 Total chapters to process: {total}")

    success_count = 0
    for idx, item in enumerate(target_comics):
        cid = item["comicId"]
        tid = item.get("topicId", "")
        m_name = item.get("mangaName", "")
        c_title = item.get("chapterTitle", "")

        print(f"\n[{idx + 1}/{total}] Processing: {m_name} {c_title} (ComicID: {cid})")
        res = purchase_chapter_playwright(comic_id=cid, topic_id=tid)

        if res["success"]:
            success_count += 1
            print(f"   ✓ Chapter {cid} unlocked successfully!")
        else:
            print(f"   ❌ Chapter {cid} unlock failed: {res['message']}")

        if idx < total - 1:
            print(f"\n☕ Resting {args.cooldown} seconds before next chapter...")
            time.sleep(args.cooldown)

    print("\n=================================================================")
    print(f"🏁 Finished: {success_count}/{total} chapters unlocked.")
    print("=================================================================")


if __name__ == "__main__":
    main()

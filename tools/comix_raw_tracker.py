#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comix.to Real Browser RawTracker Checker
----------------------------------------
Inspects and updates RawTracker entries on Google Sheets for Comix.to titles
using a real Google Chrome browser session (DOM extraction), completely immune to:
1. Cloudflare bot detection
2. Retired API signature tokens ({"message":"Invalid token.","code":"key_retired"})
3. Multi-group discrepancies (supports ?group_id=... query parameters and ScanGroup)

Features:
- Runs in background (HWND_BOTTOM / doesn't steal focus)
- Accurately checks chapter counts and calculates deltas
- Updates RawTracker sheet directly via Google Apps Script (UPDATE_RAW_TRACKER)
- Supports optional auto-enqueue or 1-click batch execution
"""

import os
import sys
import re
import json
import time
import argparse
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

try:
    from browser_utils import get_browser_executable_path, set_browser_window_bottom_most
except ImportError:
    def get_browser_executable_path() -> Optional[str]:
        return None
    def set_browser_window_bottom_most(title_filter: str = ""):
        pass

DEFAULT_GAS_URL = os.environ.get("GAS_URL") or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = os.environ.get("PASSCODE", "10211032")
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def call_gas(action: str, payload: Optional[Dict[str, Any]] = None, gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE, retries: int = 3) -> Dict[str, Any]:
    """Call MangaHub Google Apps Script backend."""
    body = {
        "passcode": passcode,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(gas_url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                print(f"❌ call_gas failed [{action}]: {e}")
                return {"status": "error", "message": str(e)}
            time.sleep(1.5 * attempt)
    return {"status": "error", "message": "Unknown error"}


def extract_comix_info_from_url(url: str) -> Dict[str, Any]:
    """Extract HID, slug, and query group_id from Comix.to URL."""
    res = {
        "hid": "",
        "slug": "",
        "query_group_id": "",
        "clean_url": url
    }
    if not url:
        return res

    m = re.search(r"comix\.to/title/([a-z0-9]+)(?:-([^/?#]+))?", url, re.I)
    if m:
        res["hid"] = m.group(1)
        res["slug"] = m.group(2) or ""

    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    if "group_id" in qs and qs["group_id"]:
        res["query_group_id"] = str(qs["group_id"][0]).strip()

    return res


def inspect_comix_title_dom(page, url: str, scan_group: str = "", query_group_id: str = "") -> Dict[str, Any]:
    """Inspect Comix.to title page in real Chrome and extract accurate chapter data."""
    output = {
        "success": False,
        "title": "",
        "latest_chapter": 0.0,
        "latest_text": "",
        "matched_group_name": scan_group or "All Groups",
        "matched_group_id": query_group_id or "",
        "available_groups": [],
        "chapters": [],
        "error": ""
    }

    try:
        page.goto(url, wait_until="commit", timeout=35000)
        set_browser_window_bottom_most("comix")
        page.wait_for_timeout(3000)

        # Step 1: Extract JSON from initial-data script tag
        init_str = page.evaluate("() => document.getElementById('initial-data')?.innerText || ''")
        title_meta = None
        groups_list = []

        if init_str:
            try:
                init_data = json.loads(init_str)
                queries = init_data.get("queries", {})
                for k in queries:
                    if '"manga","detail"' in k and isinstance(queries[k], dict):
                        title_meta = queries[k]
                    elif '"manga","groups"' in k and isinstance(queries[k], list):
                        groups_list = queries[k]
            except Exception as e_json:
                print(f"   ⚠️ initial-data parsing notice: {e_json}")

        if title_meta:
            output["title"] = title_meta.get("title") or ""
            raw_latest = float(title_meta.get("latestChapter") or 0)
            output["latest_chapter"] = raw_latest
            output["latest_text"] = f"Chapter {raw_latest}"
        else:
            output["title"] = page.evaluate("() => document.querySelector('h1')?.innerText?.trim() || document.title")

        output["available_groups"] = groups_list

        # Resolve target group name from ID or scan_group
        target_group_id = query_group_id
        target_group_name = scan_group

        for g in groups_list:
            gid_str = str(g.get("id"))
            gname = str(g.get("name") or "").strip()
            if target_group_id and gid_str == target_group_id:
                target_group_name = gname
                output["matched_group_name"] = gname
                output["matched_group_id"] = gid_str
                break
            elif target_group_name and (target_group_name.lower() in gname.lower() or gname.lower() in target_group_name.lower()):
                target_group_id = gid_str
                output["matched_group_name"] = gname
                output["matched_group_id"] = gid_str
                break

        # Step 2: Scrape DOM chapter rows for accurate group-specific chapter numbers
        rows = page.evaluate("""() => {
            const links = Array.from(document.querySelectorAll('a[href*="/title/"]'))
                .filter(a => a.href.includes('-chapter-'));
            return links.map(a => {
                const parent = a.closest('tr, li, div[class*="chapter"], div.flex') || a.parentElement;
                return {
                    href: a.href,
                    text: a.innerText.trim(),
                    parentText: parent ? parent.innerText.trim() : ''
                };
            });
        }""")

        parsed_chaps = []
        for r in rows:
            href = r.get("href", "")
            m = re.search(r'/(\d+)-chapter-([0-9.]+)', href)
            if not m:
                continue
            cid = int(m.group(1))
            num = float(m.group(2))

            p_text = r.get("parentText", "")
            lines = [l.strip() for l in p_text.split("\n") if l.strip()]
            grp = "Unknown"
            for l in lines:
                if not l.startswith("Ch.") and not re.search(r'\d+[dwm]\s+ago', l, re.I) and l not in ["·", ""]:
                    grp = l
                    break

            parsed_chaps.append({
                "chapter_id": cid,
                "number": num,
                "group_name": grp,
                "url": href
            })

        output["chapters"] = parsed_chaps

        # If filtered by group
        if target_group_name and target_group_name != "All Groups":
            filtered = [c for c in parsed_chaps if target_group_name.lower() in c["group_name"].lower()]
            if filtered:
                filtered.sort(key=lambda x: x["number"], reverse=True)
                top_ch = filtered[0]
                output["latest_chapter"] = top_ch["number"]
                output["latest_text"] = f"Chapter {top_ch['number']} ({top_ch['group_name']})"
                output["matched_group_name"] = top_ch["group_name"]
            elif parsed_chaps:
                # Group has no specific match in DOM, fall back to overall highest
                parsed_chaps.sort(key=lambda x: x["number"], reverse=True)
                top_ch = parsed_chaps[0]
                output["latest_chapter"] = top_ch["number"]
                output["latest_text"] = f"Chapter {top_ch['number']} ({top_ch['group_name']})"
        elif parsed_chaps:
            parsed_chaps.sort(key=lambda x: x["number"], reverse=True)
            top_ch = parsed_chaps[0]
            output["latest_chapter"] = top_ch["number"]
            output["latest_text"] = f"Chapter {top_ch['number']} ({top_ch['group_name']})"

        output["success"] = (output["latest_chapter"] > 0)
        return output

    except Exception as e:
        output["error"] = str(e)
        return output


def check_comix_raw_trackers(target_tracker_id: Optional[str] = None, target_manga_id: Optional[str] = None, headless: bool = False, update_gas: bool = True) -> List[Dict[str, Any]]:
    """Check all or specific Comix.to trackers in RawTracker using real Chrome DOM."""
    from playwright.sync_api import sync_playwright

    print("=" * 80)
    print("🚀 MangaHub Comix.to Real Browser RawTracker Engine")
    mode_str = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่หลังสุด HWND_BOTTOM ไม่แย่งโฟกัส)"
    print(f"   โหมดเบราว์เซอร์: {mode_str}")
    print(f"   เป้าหมาย: ตรวจสอบเลขตอนต้นฉบับจริงจาก DOM (ไม่ต้องพึ่งพา API Signature)")
    print("=" * 80)

    # 1. Fetch RawTracker list
    print("\n▶ กำลังดึงรายการ RawTracker จาก Google Sheets...")
    rt_res = call_gas("GET_RAW_TRACKER_LIST")
    if rt_res.get("status") != "success":
        print(f"❌ ไม่สามารถดึง RawTracker list: {rt_res}")
        return []

    trackers = rt_res.get("data") or rt_res.get("list") or []
    comix_trackers = [t for t in trackers if "comix.to" in str(t.get("url", "")).lower()]

    if target_tracker_id:
        comix_trackers = [t for t in comix_trackers if str(t.get("trackerid")).strip() == str(target_tracker_id).strip()]
    if target_manga_id:
        q = str(target_manga_id).strip().lower()
        comix_trackers = [
            t for t in comix_trackers 
            if str(t.get("mangaid")).strip().lower() == q or q in str(t.get("url", "")).lower() or q in str(t.get("manganame", "")).lower()
        ]

    print(f"✓ พบมังงะ Comix.to ในระบบทั้งหมด: {len(comix_trackers)} เรื่อง")
    if not comix_trackers:
        print("ℹ️ ไม่พบรายการที่ตรงกับเงื่อนไขการตรวจ")
        return []

    # 2. Fetch Manga list to resolve ScanGroup & system chapter
    m_res = call_gas("GET_MANGA_LIST")
    m_map = {}
    if m_res.get("status") == "success":
        for m in (m_res.get("data") or []):
            m_map[str(m.get("mangaid"))] = m

    # 3. Launch Chrome browser
    exec_path = get_browser_executable_path()
    launch_kwargs = {
        "channel": "chrome",
        "headless": headless,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-infobars"
        ]
    }
    if exec_path:
        launch_kwargs["executable_path"] = exec_path

    results = []
    now_iso = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(**launch_kwargs)
        except Exception:
            launch_kwargs.pop("channel", None)
            browser = p.chromium.launch(**launch_kwargs)

        page = browser.new_page(user_agent=DEFAULT_USER_AGENT)
        if not headless:
            set_browser_window_bottom_most("comix")

        for idx, trk in enumerate(comix_trackers, 1):
            tracker_id = trk.get("trackerid")
            manga_id = str(trk.get("mangaid"))
            manga_name = trk.get("manganame") or "Unknown"
            url = trk.get("url") or ""

            m_obj = m_map.get(manga_id, {})
            scan_group = str(m_obj.get("scangroup") or m_obj.get("ScanGroup") or trk.get("pattern") or "").strip()

            # Parse query params
            parsed_info = extract_comix_info_from_url(url)
            query_group_id = parsed_info.get("query_group_id", "")

            # Resolve current system chapter
            try:
                curr_chap_rt = float(trk.get("currentchapter") or trk.get("currentChapter") or 0)
            except Exception:
                curr_chap_rt = 0.0
            try:
                curr_chap_m = float(m_obj.get("lastchapter") or 0)
            except Exception:
                curr_chap_m = 0.0
            system_chap = max(curr_chap_rt, curr_chap_m)

            print(f"\n[{idx}/{len(comix_trackers)}] 🔍 กำลังตรวจสอบ: {manga_name} (ID: {manga_id})")
            print(f"   🌐 URL: {url}")
            if query_group_id:
                print(f"   🏷️ Target Group ID (from URL): {query_group_id}")
            if scan_group:
                print(f"   🏷️ Scan Group (from Mangas): {scan_group}")
            print(f"   📖 ในระบบปัจจุบัน: ตอนที่ {system_chap}")

            data = inspect_comix_title_dom(page, url, scan_group=scan_group, query_group_id=query_group_id)

            if not data.get("success"):
                print(f"   ❌ ไม่สามารถดึงข้อมูลตอนได้: {data.get('error')}")
                status_text = f"ตรวจไม่ได้: {data.get('error')}"
                if update_gas:
                    call_gas("UPDATE_RAW_TRACKER", {
                        "id": tracker_id,
                        "data": {
                            "status": status_text,
                            "lastchecked": now_iso
                        }
                    })
                continue

            latest_count = data["latest_chapter"]
            raw_text = data["latest_text"]
            matched_group = data["matched_group_name"]
            diff = round(max(0.0, latest_count - system_chap), 2)

            if diff > 0:
                status_text = f"มีตอนใหม่ (+{diff} ตอน)"
                icon = "🔥"
            else:
                status_text = f"อัปเดตล่าสุดแล้ว (Ch.{latest_count})"
                icon = "✓"

            print(f"   {icon} ต้นฉบับล่าสุด: {raw_text} (ตอนที่ {latest_count})")
            print(f"   📊 ผลต่าง: {diff} ตอน -> สถานะ: {status_text}")

            item_res = {
                "trackerId": tracker_id,
                "mangaId": manga_id,
                "mangaName": manga_name,
                "url": url,
                "systemChapter": system_chap,
                "latestChapter": latest_count,
                "rawText": raw_text,
                "matchedGroup": matched_group,
                "diff": diff,
                "status": status_text
            }
            results.append(item_res)

            # Update Google Sheet
            if update_gas:
                update_payload = {
                    "id": tracker_id,
                    "data": {
                        "lastrawcount": latest_count,
                        "lastrawtext": raw_text,
                        "status": status_text,
                        "lastchecked": now_iso
                    }
                }
                up_res = call_gas("UPDATE_RAW_TRACKER", update_payload)
                if up_res.get("status") == "success":
                    print(f"   💾 ซิงค์สถานะลง Google Sheet (RawTracker) เรียบร้อย")
                else:
                    print(f"   ⚠️ ไม่สามารถซิงค์สถานะลง Google Sheet: {up_res}")

        browser.close()

    print("\n" + "=" * 80)
    print("🏆 สรุปผลการตรวจ RawTracker ของ Comix.to:")
    updated_new = sum(1 for r in results if r["diff"] > 0)
    print(f"   - ตรวจทั้งหมด: {len(results)} เรื่อง")
    print(f"   - พบตอนใหม่ที่ต้องทำ: {updated_new} เรื่อง")
    for r in results:
        flag = "🔥 [มีตอนใหม่]" if r["diff"] > 0 else "✓ [ล่าสุดแล้ว]"
        print(f"   {flag} {r['mangaName']} -> ในระบบ: {r['systemChapter']} | ต้นฉบับ: {r['latestChapter']} ({r['rawText']}) | ผลต่าง: {r['diff']}")
    print("=" * 80)

    return results


def main():
    parser = argparse.ArgumentParser(description="Comix.to Real Browser RawTracker Checker Engine")
    parser.add_argument("--tracker-id", type=str, default="", help="Target specific tracker ID")
    parser.add_argument("--manga-id", type=str, default="", help="Target specific manga ID")
    parser.add_argument("--headless", action="store_true", default=False, help="Run browser in headless mode (default: False)")
    parser.add_argument("--no-update", action="store_true", default=False, help="Inspect without updating Google Sheets")
    args = parser.parse_args()

    check_comix_raw_trackers(
        target_tracker_id=args.tracker_id,
        target_manga_id=args.manga_id,
        headless=args.headless,
        update_gas=not args.no_update
    )


if __name__ == "__main__":
    main()

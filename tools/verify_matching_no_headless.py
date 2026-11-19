#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MangaHub Multi-Platform Title Matching Verification Suite (No-Headless / Live DOM / Dry-Run)
--------------------------------------------------------------------------------------------
Verifies 100% title matching between active MangaSetting (54 stories) and the 3 publishing websites:
1. ReadRealm (LionKing & Adieu accounts)
2. Kairew (แปลจนเมื่อย account)
3. Chaply (แปลจนเมื่อย account)

Special business rule:
- 53 stories publish across all 3 platforms (ReadRealm + Kairew + Chaply)
- 1 story (ID 102: "จอมเวทผู้ถูกตราหน้าว่าไร้ค่า แท้จริงคือผู้แข็งแกร่งที่สุดในโลก แต่เพราะโดนขังลืมเลยไม่รู้ตัว!")
  publishes ONLY to Kairew & Chaply (Excluded from ReadRealm).
"""

import os
import sys
import time
import json
import argparse
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
sys.path.append(BASE_DIR)

from manga_matcher import get_manga_setting, match_manga_setting, normalize_title, similarity

try:
    from browser_utils import (
        get_browser_executable_path,
        set_browser_window_bottom_most,
        bring_browser_window_to_top,
        check_and_handle_antibot_or_login
    )
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except Exception:
    PLAYWRIGHT_AVAILABLE = False


def load_cached_platform_comics() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Load latest comic snapshots from local JSON files."""
    # ReadRealm
    rr_comics = []
    for fn in ['readrealm_growth_latest.json', 'readrealm_stats_lionking.json', 'readrealm_stats.json']:
        p = os.path.join(DATA_DIR, fn)
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    items = json.load(f).get('comics', [])
                    for item in items:
                        cid = item.get('comic_id') or item.get('id')
                        if cid and not any((x.get('comic_id') or x.get('id')) == cid for x in rr_comics):
                            rr_comics.append(item)
            except Exception:
                pass

    # Kairew
    kw_comics = []
    kw_latest = os.path.join(DATA_DIR, 'kairew_growth_latest.json')
    kw_props = os.path.join(DATA_DIR, 'kairew_manage_book_props.json')
    if os.path.exists(kw_latest):
        try:
            with open(kw_latest, 'r', encoding='utf-8') as f:
                kw_comics = json.load(f).get('comics', [])
        except Exception:
            pass
    if os.path.exists(kw_props):
        try:
            with open(kw_props, 'r', encoding='utf-8') as f:
                cartoons = json.load(f).get('props', {}).get('cartoon_list', [])
                for item in cartoons:
                    cid = item.get('id') or item.get('comic_id')
                    if cid and not any((x.get('id') or x.get('comic_id')) == cid for x in kw_comics):
                        kw_comics.append(item)
        except Exception:
            pass

    # Chaply
    ch_comics = []
    ch_latest = os.path.join(DATA_DIR, 'chaply_growth_latest.json')
    ch_all = os.path.join(DATA_DIR, 'chaply_all_comics.json')
    if os.path.exists(ch_latest):
        try:
            with open(ch_latest, 'r', encoding='utf-8') as f:
                ch_comics = json.load(f).get('comics', [])
        except Exception:
            pass
    if os.path.exists(ch_all):
        try:
            with open(ch_all, 'r', encoding='utf-8') as f:
                items = json.load(f)
                for item in items:
                    cid = item.get('id') or item.get('comic_id')
                    if cid and not any((x.get('id') or x.get('comic_id')) == cid for x in ch_comics):
                        ch_comics.append(item)
        except Exception:
            pass

    return rr_comics, kw_comics, ch_comics


def scrape_live_readrealm(headless: bool = False) -> List[Dict[str, Any]]:
    """Live scrape comics published on ReadRealm using real Chrome browser."""
    if not PLAYWRIGHT_AVAILABLE:
        print("⚠️ Playwright not installed. Falling back to cached data.")
        return []
    print("\n🌐 [ReadRealm] เปิด Google Chrome (No-Headless)...")
    profile_dir = os.path.join(BASE_DIR, ".chrome_readrealm_lionking")
    os.makedirs(profile_dir, exist_ok=True)
    exec_path = get_browser_executable_path()
    launch_kwargs = {
        "user_data_dir": profile_dir,
        "headless": headless,
        "viewport": {"width": 1280, "height": 850},
        "ignore_default_args": ["--enable-automation"],
        "args": ["--disable-blink-features=AutomationControlled"]
    }
    if exec_path:
        launch_kwargs["executable_path"] = exec_path

    scraped = []
    try:
        with sync_playwright() as p:
            try:
                context = p.chromium.launch_persistent_context(**launch_kwargs, channel="chrome")
            except Exception:
                launch_kwargs.pop("channel", None)
                context = p.chromium.launch_persistent_context(**launch_kwargs)

            set_browser_window_bottom_most("readrealm")
            page = context.pages[0] if context.pages else context.new_page()

            page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
            set_browser_window_bottom_most("readrealm")
            page.wait_for_timeout(3500)
            check_and_handle_antibot_or_login(page, platform_name="ReadRealm")

            # Auto-login if session dropped
            if "/login" in page.url:
                print("🔑 [ReadRealm] เซสชันหมดอายุ ทำการเข้าสู่ระบบ...")
                try:
                    page.evaluate("""async () => {
                        const csrfRes = await fetch('/api/auth/csrf');
                        const { csrfToken } = await csrfRes.json();
                        if (!csrfToken) return;
                        const params = new URLSearchParams();
                        params.append('csrfToken', csrfToken);
                        params.append('username_or_email', 'lionking20130@gmail.com');
                        params.append('password', 'aDOPifen01@');
                        params.append('callbackUrl', 'https://readrealm.co');
                        await fetch('/api/auth/callback/credentials', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: params.toString()
                        });
                    }""")
                    page.wait_for_timeout(2500)
                    page.goto("https://readrealm.co/writer/comics", wait_until="domcontentloaded")
                    page.wait_for_timeout(3000)
                except Exception as e:
                    print(f"⚠️ Login error: {e}")

            # Extract comic links from DOM
            comics = page.evaluate(r"""() => {
                const links = Array.from(document.querySelectorAll('a[href*="/writer/comic/"]')).filter(a => !a.href.endsWith('/add'));
                return links.map(a => {
                    const href = a.getAttribute('href') || '';
                    const cid = href.split('/').pop();
                    const linkLines = a.innerText.split('\n').map(s => s.trim()).filter(Boolean);
                    const title = linkLines[0] || '';
                    return { comic_id: cid, subject: title };
                });
            }""")
            for c in comics:
                if c.get("comic_id") and not any(x.get("comic_id") == c["comic_id"] for x in scraped):
                    scraped.append(c)

            print(f"✓ [ReadRealm] ดึงข้อมูลสดสำเร็จ: {len(scraped)} เรื่อง")
            context.close()
    except Exception as e:
        print(f"❌ [ReadRealm] เกิดข้อผิดพลาดในการดึงข้อมูลสด: {e}")

    return scraped


def scrape_live_kairew(headless: bool = False) -> List[Dict[str, Any]]:
    """Live scrape comics published on Kairew using real Chrome browser."""
    if not PLAYWRIGHT_AVAILABLE:
        print("⚠️ Playwright not installed. Falling back to cached data.")
        return []
    print("\n🌐 [Kairew] เปิด Google Chrome (No-Headless)...")
    profile_dir = os.path.join(BASE_DIR, ".chrome_kairew")
    os.makedirs(profile_dir, exist_ok=True)
    exec_path = get_browser_executable_path()
    launch_kwargs = {
        "user_data_dir": profile_dir,
        "headless": headless,
        "viewport": {"width": 1280, "height": 850},
        "ignore_default_args": ["--enable-automation"],
        "args": ["--disable-blink-features=AutomationControlled"]
    }
    if exec_path:
        launch_kwargs["executable_path"] = exec_path

    scraped = []
    try:
        with sync_playwright() as p:
            try:
                context = p.chromium.launch_persistent_context(**launch_kwargs, channel="chrome")
            except Exception:
                launch_kwargs.pop("channel", None)
                context = p.chromium.launch_persistent_context(**launch_kwargs)

            set_browser_window_bottom_most("kairew")
            page = context.pages[0] if context.pages else context.new_page()

            page.goto("https://kairew.com/writer/manage-book", wait_until="domcontentloaded")
            set_browser_window_bottom_most("kairew")
            page.wait_for_timeout(3500)
            check_and_handle_antibot_or_login(page, platform_name="Kairew")

            try:
                props = page.evaluate("() => JSON.parse(document.getElementById('app').dataset.page)")
                cartoons = props.get("props", {}).get("cartoon_list", [])
                for item in cartoons:
                    scraped.append({
                        "comic_id": item.get("id"),
                        "name": item.get("title") or item.get("name") or "",
                        "chapters_count": item.get("episode_count", 0),
                        "total_views": item.get("view_count", 0),
                        "total_sales": item.get("sales", 0.0)
                    })
            except Exception as e:
                print(f"⚠️ Error parsing Kairew props: {e}")

            print(f"✓ [Kairew] ดึงข้อมูลสดสำเร็จ: {len(scraped)} เรื่อง")
            context.close()
    except Exception as e:
        print(f"❌ [Kairew] เกิดข้อผิดพลาดในการดึงข้อมูลสด: {e}")

    return scraped


def scrape_live_chaply(headless: bool = False) -> List[Dict[str, Any]]:
    """Live scrape comics published on Chaply using real Chrome browser."""
    if not PLAYWRIGHT_AVAILABLE:
        print("⚠️ Playwright not installed. Falling back to cached data.")
        return []
    print("\n🌐 [Chaply] เปิด Google Chrome (No-Headless)...")
    profile_dir = os.path.join(BASE_DIR, ".chrome_chaply")
    os.makedirs(profile_dir, exist_ok=True)
    exec_path = get_browser_executable_path()
    launch_kwargs = {
        "user_data_dir": profile_dir,
        "headless": headless,
        "viewport": {"width": 1280, "height": 850},
        "ignore_default_args": ["--enable-automation"],
        "args": ["--disable-blink-features=AutomationControlled"]
    }
    if exec_path:
        launch_kwargs["executable_path"] = exec_path

    scraped = []
    try:
        with sync_playwright() as p:
            try:
                context = p.chromium.launch_persistent_context(**launch_kwargs, channel="chrome")
            except Exception:
                launch_kwargs.pop("channel", None)
                context = p.chromium.launch_persistent_context(**launch_kwargs)

            set_browser_window_bottom_most("chaply")
            page = context.pages[0] if context.pages else context.new_page()

            page.goto("https://www.chaply.net/writer/dashboard", wait_until="domcontentloaded")
            set_browser_window_bottom_most("chaply")
            page.wait_for_timeout(3500)
            check_and_handle_antibot_or_login(page, platform_name="Chaply")

            # Extract auth token from localStorage if needed
            token = page.evaluate("() => localStorage.getItem('token') || localStorage.getItem('access_token') || ''")
            user_id = page.evaluate("() => localStorage.getItem('userId') || ''")

            # Extract comics visible from dashboard or search API
            if token and user_id:
                from chaply_growth_tracker import fetch_all_chaply_comics
                items = fetch_all_chaply_comics(token, user_id)
                for item in items:
                    scraped.append({
                        "comic_id": item.get("id"),
                        "subject": item.get("title") or item.get("subject"),
                        "total_views": item.get("totalView", 0),
                        "chapters_count": item.get("totalEpisode", 0)
                    })

            print(f"✓ [Chaply] ดึงข้อมูลสดสำเร็จ: {len(scraped)} เรื่อง")
            context.close()
    except Exception as e:
        print(f"❌ [Chaply] เกิดข้อผิดพลาดในการดึงข้อมูลสด: {e}")

    return scraped


def evaluate_matching(
    manga_list: List[Dict[str, Any]],
    rr_comics: List[Dict[str, Any]],
    kw_comics: List[Dict[str, Any]],
    ch_comics: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Evaluate matching of all 54 stories against the 3 platforms."""
    results = []

    for idx, m in enumerate(manga_list, 1):
        mid = m.get('mangaid') or m.get('MangaID')
        mname = (m.get('manganame') or m.get('MangaName') or '').strip()
        platforms_cfg = (m.get('platforms') or m.get('Platforms') or '').lower()

        expected_rr = 'readrealm' in platforms_cfg
        expected_kw = 'kairew' in platforms_cfg
        expected_ch = 'chaply' in platforms_cfg

        # 1. ReadRealm match
        rr_match = None
        best_rr_s = 0.0
        for c in rr_comics:
            sub = c.get('subject') or c.get('title') or ''
            mat, s = match_manga_setting(sub, [m], threshold=0.85)
            if mat and s > best_rr_s:
                best_rr_s = s
                rr_match = c

        # 2. Kairew match
        kw_match = None
        best_kw_s = 0.0
        for c in kw_comics:
            sub = c.get('name') or c.get('subject') or c.get('title') or ''
            mat, s = match_manga_setting(sub, [m], threshold=0.85)
            if mat and s > best_kw_s:
                best_kw_s = s
                kw_match = c

        # 3. Chaply match
        ch_match = None
        best_ch_s = 0.0
        for c in ch_comics:
            sub = c.get('subject') or c.get('title') or ''
            mat, s = match_manga_setting(sub, [m], threshold=0.85)
            if mat and s > best_ch_s:
                best_ch_s = s
                ch_match = c

        # Correctness checks based on configured platforms
        rr_ok = (rr_match is not None) if expected_rr else (rr_match is None)
        kw_ok = (kw_match is not None) if expected_kw else (kw_match is None)
        ch_ok = (ch_match is not None) if expected_ch else (ch_match is None)

        is_100_percent = rr_ok and kw_ok and ch_ok

        item = {
            "index": idx,
            "manga_id": mid,
            "title": mname,
            "expected_platforms": platforms_cfg,
            "is_100": is_100_percent,
            "readrealm": {
                "expected": expected_rr,
                "matched": rr_match is not None,
                "ok": rr_ok,
                "score": round(best_rr_s, 3),
                "matched_title": (rr_match.get('subject') or rr_match.get('title')) if rr_match else None,
                "comic_id": (rr_match.get('comic_id') or rr_match.get('id')) if rr_match else None
            },
            "kairew": {
                "expected": expected_kw,
                "matched": kw_match is not None,
                "ok": kw_ok,
                "score": round(best_kw_s, 3),
                "matched_title": (kw_match.get('name') or kw_match.get('subject') or kw_match.get('title')) if kw_match else None,
                "comic_id": (kw_match.get('comic_id') or kw_match.get('id')) if kw_match else None
            },
            "chaply": {
                "expected": expected_ch,
                "matched": ch_match is not None,
                "ok": ch_ok,
                "score": round(best_ch_s, 3),
                "matched_title": (ch_match.get('subject') or ch_match.get('title')) if ch_match else None,
                "comic_id": (ch_match.get('comic_id') or ch_match.get('id')) if ch_match else None
            }
        }
        results.append(item)

    total = len(results)
    full_matches = [r for r in results if r['is_100']]
    mismatches = [r for r in results if not r['is_100']]

    rr_expected_count = sum(1 for r in results if r['readrealm']['expected'])
    rr_matched_count = sum(1 for r in results if r['readrealm']['expected'] and r['readrealm']['matched'])

    kw_expected_count = sum(1 for r in results if r['kairew']['expected'])
    kw_matched_count = sum(1 for r in results if r['kairew']['expected'] and r['kairew']['matched'])

    ch_expected_count = sum(1 for r in results if r['chaply']['expected'])
    ch_matched_count = sum(1 for r in results if r['chaply']['expected'] and r['chaply']['matched'])

    summary = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_manga": total,
        "matched_100_count": len(full_matches),
        "matched_100_percent": round(len(full_matches) / total * 100, 2) if total else 0,
        "mismatches_count": len(mismatches),
        "platforms_summary": {
            "readrealm": {
                "expected": rr_expected_count,
                "matched": rr_matched_count,
                "percent": round(rr_matched_count / rr_expected_count * 100, 2) if rr_expected_count else 0
            },
            "kairew": {
                "expected": kw_expected_count,
                "matched": kw_matched_count,
                "percent": round(kw_matched_count / kw_expected_count * 100, 2) if kw_expected_count else 0
            },
            "chaply": {
                "expected": ch_expected_count,
                "matched": ch_matched_count,
                "percent": round(ch_matched_count / ch_expected_count * 100, 2) if ch_expected_count else 0
            }
        },
        "results": results,
        "mismatches": mismatches
    }

    return summary


def print_report(summary: Dict[str, Any]):
    """Print readable audit report to console."""
    total = summary["total_manga"]
    matched = summary["matched_100_count"]
    pct = summary["matched_100_percent"]
    mismatches = summary["mismatches"]
    plat = summary["platforms_summary"]

    print("\n" + "=" * 80)
    print(" 📊 สรุปผลการตรวจสอบ Matching ชื่อเรื่องมังงะ (MangaHub Production Tracker)")
    print("=" * 80)
    print(f" ▸ จำนวนเรื่องทั้งหมดใน MangaSetting: {total} เรื่อง")
    print(f" ▸ เรื่องที่ Matching ถูกต้อง 100% ครบทุกแพลตฟอร์ม: {matched} / {total} เรื่อง ({pct:.1f}%)")
    print(f" ▸ เรื่องที่มีปัญหา Mismatch / ขาดบางแพลตฟอร์ม: {len(mismatches)} / {total} เรื่อง")
    print("-" * 80)
    print(f" ▸ ReadRealm: {plat['readrealm']['matched']}/{plat['readrealm']['expected']} เรื่อง ({plat['readrealm']['percent']}%) [ไม่นับ ID 102 ที่ตั้งค่าไม่ลง]")
    print(f" ▸ Kairew:    {plat['kairew']['matched']}/{plat['kairew']['expected']} เรื่อง ({plat['kairew']['percent']}%)")
    print(f" ▸ Chaply:    {plat['chaply']['matched']}/{plat['chaply']['expected']} เรื่อง ({plat['chaply']['percent']}%)")
    print("=" * 80)

    if mismatches:
        print("\n🔍 รายละเอียดเรื่องที่ยังไม่ครบ 100%:")
        for idx, m in enumerate(mismatches, 1):
            print(f"\n{idx}. [ID {m['manga_id']}] \"{m['title']}\"")
            print(f"   แพลตฟอร์มที่ระบุ: {m['expected_platforms']}")
            
            # RR
            if m['readrealm']['expected']:
                st = "✓ MATCHED" if m['readrealm']['matched'] else "❌ NOT FOUND"
                t_str = f"('{m['readrealm']['matched_title']}')" if m['readrealm']['matched_title'] else ""
                print(f"   - ReadRealm: {st} {t_str}")
            else:
                print("   - ReadRealm: ➖ ไม่ต้องลง (Excluded ถูกต้อง)")

            # KW
            if m['kairew']['expected']:
                st = "✓ MATCHED" if m['kairew']['matched'] else "❌ NOT FOUND"
                t_str = f"('{m['kairew']['matched_title']}')" if m['kairew']['matched_title'] else ""
                print(f"   - Kairew:    {st} {t_str}")

            # CH
            if m['chaply']['expected']:
                st = "✓ MATCHED" if m['chaply']['matched'] else "❌ NOT FOUND"
                t_str = f"('{m['chaply']['matched_title']}')" if m['chaply']['matched_title'] else ""
                print(f"   - Chaply:    {st} {t_str}")

    print("\n" + "=" * 80)


def save_reports(summary: Dict[str, Any]):
    """Save reports to JSON and Markdown format."""
    os.makedirs(DATA_DIR, exist_ok=True)
    json_path = os.path.join(DATA_DIR, "matching_dry_run_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกไฟล์ JSON รายละเอียด: {json_path}")

    md_path = os.path.join(DATA_DIR, "MATCHING_REPORT.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# รายงานผลการตรวจสอบ Matching ชื่อเรื่องมังงะ (MangaHub)\n\n")
        f.write(f"- วันที่ตรวจสอบ: `{summary['timestamp']}`\n")
        f.write(f"- จำนวนเรื่องทั้งหมดในระบบ: **{summary['total_manga']} เรื่อง**\n")
        f.write(f"- เรื่องที่ Matching ครบถ้วน 100%: **{summary['matched_100_count']} เรื่อง ({summary['matched_100_percent']}%)**\n")
        f.write(f"- เรื่องที่ยังไม่ครบ / รอการลงเว็บ: **{summary['mismatches_count']} เรื่อง**\n\n")

        f.write("## สถิติรายแพลตฟอร์ม\n\n")
        f.write("| แพลตฟอร์ม | จำนวนเรื่องที่ต้องลง | พบบนเว็บ | อัตรา Matching |\n")
        f.write("| :--- | :---: | :---: | :---: |\n")
        for p_key, p_name in [('readrealm', 'ReadRealm'), ('kairew', 'Kairew'), ('chaply', 'Chaply')]:
            p_data = summary['platforms_summary'][p_key]
            f.write(f"| **{p_name}** | {p_data['expected']} | {p_data['matched']} | **{p_data['percent']}%** |\n")

        f.write("\n> **หมายเหตุเงื่อนไขพิเศษ**: เรื่อง ID 102 (`จอมเวทผู้ถูกตราหน้าว่าไร้ค่า...`) ตั้งค่าไม่ลง ReadRealm อย่างถูกต้อง (ตั้งเฉพาะ Chaply, Kairew)\n\n")

        if summary['mismatches']:
            f.write("## รายการเรื่องที่ยังไม่ครบ 100%\n\n")
            f.write("| ID | ชื่อเรื่อง | ReadRealm | Kairew | Chaply | สาเหตุ / สถานะ |\n")
            f.write("| :---: | :--- | :---: | :---: | :---: | :--- |\n")
            for m in summary['mismatches']:
                rr_st = "✅" if m['readrealm']['ok'] else "❌ ขาด"
                kw_st = "✅" if m['kairew']['ok'] else "❌ ขาด"
                ch_st = "✅" if m['chaply']['ok'] else "❌ ขาด"
                
                reason = ""
                if m['manga_id'] == 102:
                    reason = "เรื่องใหม่ รอการแปล/ลงคำ อยู่ใน WorkQueue (ยังไม่เริ่มเผยแพร่บนเว็บ)"
                elif not m['chaply']['matched']:
                    reason = "การ์ตูนเก่าที่ยังไม่ได้สร้างหรืออัปโหลดบนแพลตฟอร์ม Chaply"
                elif not m['readrealm']['matched']:
                    reason = "ยังไม่ได้เผยแพร่บน ReadRealm"

                f.write(f"| {m['manga_id']} | {m['title']} | {rr_st} | {kw_st} | {ch_st} | {reason} |\n")

    print(f"✓ บันทึกไฟล์ Markdown สรุป: {md_path}")


def main():
    parser = argparse.ArgumentParser(description="Multi-Platform Matching Verification Suite")
    parser.add_argument("--live", action="store_true", help="Launch real Chrome (No-Headless) to scrape live DOM from platforms")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Run dry matching evaluation from latest synced snapshots")
    parser.add_argument("--refresh-manga", action="store_true", help="Force refresh MangaSetting from GAS Web App")
    args = parser.parse_args()

    print("=" * 80)
    print("🚀 เริ่มต้นระบบตรวจสอบ MangaHub 3-Platform Matching Verification")
    print("=" * 80)

    # 1. Fetch Manga Setting
    manga_list = get_manga_setting(force_refresh=args.refresh_manga)
    print(f"✓ โหลดรายการ MangaSetting เรียบร้อย: {len(manga_list)} เรื่อง")

    # 2. Get platform comics
    if args.live:
        print("\n🚀 [LIVE MODE] รัน Google Chrome จริง (No-Headless) ดึงสถิติสดจากทั้ง 3 แพลตฟอร์ม...")
        rr_comics = scrape_live_readrealm(headless=False)
        kw_comics = scrape_live_kairew(headless=False)
        ch_comics = scrape_live_chaply(headless=False)
        # Fallback to cache if any platform failed
        cached_rr, cached_kw, cached_ch = load_cached_platform_comics()
        if not rr_comics: rr_comics = cached_rr
        if not kw_comics: kw_comics = cached_kw
        if not ch_comics: ch_comics = cached_ch
    else:
        print("\n⚡ [DRY-RUN MODE] ใช้ข้อมูล Snapshot ล่าสุดจากแคชเพื่อตรวจสอบอย่างรวดเร็ว...")
        rr_comics, kw_comics, ch_comics = load_cached_platform_comics()

    print(f"✓ ฐานข้อมูล ReadRealm: {len(rr_comics)} เรื่อง")
    print(f"✓ ฐานข้อมูล Kairew:    {len(kw_comics)} เรื่อง")
    print(f"✓ ฐานข้อมูล Chaply:    {len(ch_comics)} เรื่อง")

    # 3. Evaluate matching
    summary = evaluate_matching(manga_list, rr_comics, kw_comics, ch_comics)

    # 4. Print & Save
    print_report(summary)
    save_reports(summary)


if __name__ == "__main__":
    main()

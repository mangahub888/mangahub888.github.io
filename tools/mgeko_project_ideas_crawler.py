#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MangaHub New Project Ideas Crawler Engine (Mgeko + Comix.to)
------------------------------------------------------------
Crawls newly updated and popular manga from:
1. Mgeko (https://www.mgeko.cc/browse-comics/)
2. Comix (https://comix.to/)

Filters strictly for new projects with:
- RULE: NOT MORE THAN 100 CHAPTERS (<= 100 ตอน)

Features:
- Crawls both websites into separate source datasets (`sources.mgeko` & `sources.comix`)
- Extracts Title, Cover image link, Latest Chapter, Score, Origin, and Update time
- Extracts Total Views / Follows count and Bookmarks
- Translates story synopsis to Thai using Google Translate API (เรื่องย่อแปลไทย)
- Sorts candidates by Views/Follows count descending (เรียงตามความนิยมสูงสุด)
- Generates JSON feeds for MangaHub frontend:
  - tools/data/project_ideas_latest.json
  - frontend/src/data/project_ideas_latest.json
  - frontend/public/data/project_ideas_latest.json
  - frontend/src/data/comix_project_ideas_latest.json
  - frontend/public/data/comix_project_ideas_latest.json
"""

import os
import subprocess
import sys
import time
import json
import re
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional
import requests
import lxml.html
import ctypes

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Comix & Mgeko crawler uses real Google Chrome DOM & SSR without token-based API
# Chrome window runs at HWND_BOTTOM (หน้าหลังสุด / ตรงกันข้ามกับ topmost) to avoid stealing focus

def set_browser_window_bottom_most(title_filter: str = ""):
    """
    Sets the Chrome browser window to HWND_BOTTOM (behind all active windows).
    Opposite of topmost (หน้าหลังสุด / ตรงกันข้ามกับ topmost) so that it remains
    visible on screen in the background without stealing user focus or interrupting work.
    """
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        HWND_BOTTOM = 1
        SWP_NOSIZE = 0x0001
        SWP_NOMOVE = 0x0002
        SWP_NOACTIVATE = 0x0010

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        found_hwnds = []

        def enum_windows_callback(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    txt = buf.value.lower()
                    if "chrome" in txt or "manga" in txt or "comix" in txt or "mgeko" in txt or (title_filter and title_filter.lower() in txt):
                        found_hwnds.append(hwnd)
            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        for hwnd in found_hwnds:
            user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    except Exception:
        pass


def get_or_create_chrome_page(headless: bool = False):
    """
    Launch real Google Chrome browser in non-headless mode by default.
    Ensures a visible Google Chrome window opens immediately on the user's screen,
    and positions it at HWND_BOTTOM (หน้าหลังสุด / ตรงกันข้ามกับ topmost) so it doesn't steal focus.
    """
    from playwright.sync_api import sync_playwright
    p = sync_playwright().start()
    mode_desc = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"
    print(f"\n🌐 [Browser Engine] กำลังเปิด {mode_desc} บนหน้าจอทันที...")
    
    browser = None
    try:
        browser = p.chromium.launch(
            channel="chrome",
            headless=headless,
            args=[
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox"
            ]
        )
    except Exception as e:
        print(f"⚠️ ไม่สามารถเปิดด้วย channel='chrome' ({e}) กำลังลองใช้ Playwright Chromium...")
        try:
            browser = p.chromium.launch(
                headless=headless,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
        except Exception as e2:
            print(f"❌ ไม่สามารถเปิดเบราว์เซอร์ได้: {e2}")
            p.stop()
            return None, None, None

    context = browser.new_context(
        no_viewport=True,
        user_agent=DEFAULT_HEADERS.get("User-Agent")
    )
    page = context.new_page()
    
    if not headless:
        set_browser_window_bottom_most()
        
    return p, browser, page

DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "..", "frontend", "dist", "data")

OUTPUT_FILE = os.path.join(DATA_DIR, "project_ideas_latest.json")
COMIX_OUTPUT_FILE = os.path.join(DATA_DIR, "comix_project_ideas_latest.json")

DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"


os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
}


def parse_chapter_num(ch_text: str) -> float:
    """Parse numeric chapter count from string like 'Chapter 26-eng-li' or 'Ch. 5.5'."""
    if not ch_text:
        return 0.0
    m = re.search(r'(?:chapter|ch\.?|ep\.?|ตอนที่)\s*([\d\.]+)', ch_text, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    m2 = re.search(r'([\d\.]+)', ch_text)
    if m2:
        try:
            return float(m2.group(1))
        except Exception:
            pass
    return 0.0


def parse_views_count(view_str: str) -> int:
    """Parse '209 K', '6.6 M', '1,234' into integer."""
    if not view_str:
        return 0
    clean = view_str.replace("supervised_user_circle", "").replace(",", "").strip()
    m = re.search(r'([\d\.]+)\s*([KkMm]?)', clean)
    if not m:
        return 0
    val = float(m.group(1))
    unit = m.group(2).upper()
    if unit == 'K':
        return int(val * 1000)
    elif unit == 'M':
        return int(val * 1000000)
    return int(val)


def format_compact_number(num: int) -> str:
    """Format integer like 94550 into '94.6 K' or '1.2 M'."""
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f} M"
    if num >= 1_000:
        return f"{num / 1_000:.1f} K"
    return f"{num:,}"


TRANSLATION_CACHE_FILE = os.path.join(DATA_DIR, "translation_cache.json")
_TRANSLATION_CACHE: Dict[str, str] = {}


def load_translation_cache() -> Dict[str, str]:
    """Load persistent translation cache from disk."""
    global _TRANSLATION_CACHE
    if _TRANSLATION_CACHE:
        return _TRANSLATION_CACHE
    if os.path.exists(TRANSLATION_CACHE_FILE):
        try:
            with open(TRANSLATION_CACHE_FILE, "r", encoding="utf-8") as f:
                _TRANSLATION_CACHE = json.load(f)
        except Exception:
            _TRANSLATION_CACHE = {}
    return _TRANSLATION_CACHE


def save_translation_cache():
    """Save persistent translation cache to disk."""
    global _TRANSLATION_CACHE
    if _TRANSLATION_CACHE:
        try:
            with open(TRANSLATION_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(_TRANSLATION_CACHE, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"⚠️ Failed to save translation cache: {e}")


def translate_to_thai(text: str) -> str:
    """Translate synopsis from English to Thai using Google Translate API with persistent cache and rate-limit protection."""
    if not text or not text.strip() or text.strip() in ["-", "(ไม่มีเรื่องย่อ)"]:
        return ""
    clean_text = text.strip()
    cache = load_translation_cache()
    if clean_text in cache:
        return cache[clean_text]

    for attempt in range(3):
        try:
            chunk = clean_text[:1200].strip()
            url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=th&dt=t&q=" + urllib.parse.quote(chunk)
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                translated = "".join([part[0] for part in res[0] if part[0]])
                if translated.strip():
                    cache[clean_text] = translated.strip()
                    time.sleep(0.12)  # Polite pacing to avoid Google Translate rate limits
                    return translated.strip()
        except Exception:
            time.sleep(0.4 * (attempt + 1))
    return clean_text


def clean_comix_synopsis(raw_synopsis: str) -> str:
    """Clean markdown links and promotional footers from Comix.to synopsis."""
    if not raw_synopsis:
        return ""
    text = raw_synopsis
    # Strip markdown links section at the bottom like **Original Webtoon:** ...
    text = re.split(r'\*\*(?:Original|Official)\s+(?:Webtoon|Novel|Translations?|Links?)', text, flags=re.IGNORECASE)[0]
    # Replace markdown links [Label](url) with Label
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # Remove bold/italic markers
    text = re.sub(r'\*{1,2}', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def clean_time_updated(raw_time: str) -> str:
    """Clean raw update time string."""
    if not raw_time:
        return ""
    cleaned = raw_time.replace("update", "").replace("Added", "").strip()
    return f"อัปเดตเมื่อ {cleaned}" if cleaned else ""


def fetch_manga_detail_and_translate(item: Dict[str, Any], session: requests.Session) -> Dict[str, Any]:
    """Fetch synopsis, views, chapter count, and genres for Mgeko item, then translate synopsis to Thai."""
    url = item.get("url", "")
    if not url:
        return item

    try:
        r = session.get(url, headers=DEFAULT_HEADERS, timeout=15)
        if r.status_code == 200:
            doc = lxml.html.fromstring(r.text)
            genres = [a.text_content().strip() for a in doc.xpath('//a[contains(@href, "genre_included=") or contains(@href, "/genre/")]')]
            genres = list(dict.fromkeys(genres))

            # Extract chapter info from header-stats (e.g. <span><strong><i class="material-icons">book</i> 39-2-eng-li </strong><small>Chapters</small></span>)
            ch_raw = ""
            ch_spans = doc.xpath('//*[contains(@class, "header-stats")]//small[contains(text(), "Chapters")]')
            if ch_spans:
                p_span = ch_spans[0].getparent()
                if p_span is not None:
                    strong = p_span.xpath('.//strong')
                    if strong:
                        ch_raw = strong[0].text_content().replace("book", "").strip()
            if not ch_raw:
                for small in doc.xpath('//small[contains(text(), "Chapters")]'):
                    parent = small.getparent()
                    if parent is not None:
                        strong = parent.xpath('.//strong')
                        if strong:
                            ch_raw = strong[0].text_content().replace("book", "").strip()
                            break

            ch_num = parse_chapter_num(ch_raw)
            if ch_num > 0:
                item["chapter_count"] = int(ch_num) if ch_num.is_integer() else ch_num
                if not item.get("latest_chapter_text"):
                    item["latest_chapter_text"] = f"Chapter {ch_raw}"

            # Extract views
            views_text = ""
            views_count = 0
            views_spans = doc.xpath('//*[contains(@class, "header-stats")]//small[contains(text(), "Views")]')
            if views_spans:
                p_span = views_spans[0].getparent()
                if p_span is not None:
                    strong = p_span.xpath('.//strong')
                    if strong:
                        views_text = strong[0].text_content().replace("supervised_user_circle", "").strip()
                        views_count = parse_views_count(views_text)
            if views_count == 0:
                views_fallback = doc.xpath('//*[contains(text(), "Views")]')
                if views_fallback:
                    p_span = views_fallback[0].getparent()
                    if p_span is not None:
                        views_text = p_span.text_content().replace("Views", "").replace("supervised_user_circle", "").strip()
                        views_count = parse_views_count(views_text)

            # Extract bookmarks
            bookmarks_text = ""
            bm_spans = doc.xpath('//*[contains(@class, "header-stats")]//small[contains(text(), "Bookmarked")]')
            if bm_spans:
                p_span = bm_spans[0].getparent()
                if p_span is not None:
                    strong = p_span.xpath('.//strong')
                    if strong:
                        bookmarks_text = strong[0].text_content().replace("bookmark", "").strip()

            # Extract time updated from updinfo
            upd_spans = doc.xpath('//*[contains(@class, "updinfo")]//strong')
            if upd_spans:
                upd_raw = upd_spans[0].text_content().strip()
                if upd_raw and not item.get("time_updated"):
                    item["time_updated"] = f"อัปเดตเมื่อ {upd_raw}"

            # Extract score if missing
            if not item.get("score"):
                score_spans = doc.xpath('//*[contains(@class, "rating-rate")] | //*[contains(@class, "score")]')
                if score_spans:
                    item["score"] = score_spans[0].text_content().replace("⭐", "").strip()

            # Extract synopsis
            summary_en = ""
            desc_p = doc.xpath('//p[contains(@class, "description")]')
            if desc_p:
                raw_desc = desc_p[0].text_content().strip()
                if "The Summary is" in raw_desc:
                    summary_en = raw_desc.split("The Summary is")[-1].strip()
                else:
                    summary_en = raw_desc
                summary_en = re.sub(r'\s+', ' ', summary_en).strip()

            summary_th = ""
            if summary_en:
                summary_th = translate_to_thai(summary_en)

            detail_status = ""
            for tag in doc.xpath('//*[contains(@class, "header-stats")]//small[contains(text(), "Status")]'):
                parent_span = tag.getparent()
                if parent_span is not None:
                    detail_status = parent_span.text_content().replace("Status", "").strip()
                    break

            if not detail_status:
                for tag in doc.xpath('//*[contains(text(), "Status") or contains(text(), "status")]'):
                    parent_txt = tag.getparent().text_content().strip() if tag.getparent() is not None else ""
                    if "Ongoing" in parent_txt:
                        detail_status = "Ongoing"
                        break
                    elif "Completed" in parent_txt:
                        detail_status = "Completed"
                        break

            if genres:
                item["genres"] = genres
            if summary_en:
                item["summary"] = summary_en
                item["summary_th"] = summary_th or summary_en
            if views_count > 0:
                item["views_count"] = views_count
                item["views_text"] = views_text or format_compact_number(views_count)
            elif not item.get("views_text") or item.get("views_text") == "-":
                item["views_text"] = views_text or f"{views_count:,}"
            if bookmarks_text:
                item["bookmarks_text"] = bookmarks_text
            if detail_status:
                item["status"] = detail_status

            lower_genres = [g.lower() for g in genres]
            if any("manhwa" in g for g in lower_genres):
                item["origin"] = "KR (Manhwa)"
            elif any("manhua" in g for g in lower_genres):
                item["origin"] = "CN (Manhua)"
            elif any("manga" in g for g in lower_genres) and item["origin"] == "Manga":
                item["origin"] = "JP (Manga)"

    except Exception as e:
        item["detail_error"] = str(e)

    return item


# Seed keywords are now optional (default: empty). Crawler reads page-by-page sequentially from main listing.
DEFAULT_SEED_KEYWORDS: List[str] = []


def parse_mgeko_comic_card(it, max_chapters: int = 100) -> Optional[Dict[str, Any]]:
    """Parse a single comic-card element from Mgeko /browse-comics/ HTML."""
    title_el = it.xpath('.//*[contains(@class, "comic-card__title")]//a')
    if not title_el:
        title_el = it.xpath('.//h3//a | .//h4//a | .//a[contains(@href, "/manga/")]')
    if not title_el:
        return None

    title = title_el[0].text_content().strip()
    href = title_el[0].get('href', '').strip()
    if not href:
        cover_a = it.xpath('.//*[contains(@class, "comic-card__cover")]//a')
        if cover_a:
            href = cover_a[0].get('href', '').strip()
    if not href:
        return None

    if not href.startswith('http'):
        href = 'https://www.mgeko.cc' + href

    clean_base_url = href.split('/all-chapters/')[0].split('/chapter-')[0].split('?')[0].rstrip('/') + '/'
    manga_id = clean_base_url.rstrip('/').split('/')[-1]

    img_el = it.xpath('.//*[contains(@class, "comic-card__cover")]//img | .//img')
    cover = ''
    if img_el:
        cover = img_el[0].get('src') or img_el[0].get('data-src') or ''
        if cover.startswith('/'):
            cover = 'https://www.mgeko.cc' + cover

    score_el = it.xpath('.//*[contains(@class, "comic-card__stat--rating")] | .//*[contains(@class, "rating")]')
    score_str = ''
    if score_el:
        score_str = score_el[0].text_content().replace('⭐', '').strip()

    views_count = 0
    views_text = '-'
    hot_el = it.xpath('.//*[contains(@class, "stat-alltime")] | .//*[contains(@class, "comic-card__stat--hot")]')
    if hot_el:
        views_text = hot_el[0].text_content().replace('🔥', '').strip()
        views_count = parse_views_count(views_text)

    desc_el = it.xpath('.//*[contains(@class, "comic-card__description")]')
    summary = ''
    if desc_el:
        raw_desc = desc_el[0].text_content().strip()
        if raw_desc not in ['NA', 'Not Provided', '-']:
            summary = raw_desc

    return {
        "id": manga_id,
        "source": "mgeko",
        "title": title,
        "url": clean_base_url,
        "cover": cover,
        "chapter_count": 0,
        "latest_chapter_text": "",
        "score": score_str,
        "status": "Ongoing",
        "origin": "Manga",
        "time_updated": "",
        "views_count": views_count,
        "views_text": views_text,
        "genres": [],
        "summary": summary,
        "summary_th": ""
    }


def parse_mgeko_novel_element(it, max_chapters: int) -> Optional[Dict[str, Any]]:
    """Parse a single novel-item element from Mgeko HTML."""
    a_tags = it.xpath('.//a')
    if not a_tags:
        return None
    a = a_tags[0]
    href = a.get('href', '')
    if not href:
        return None
    if not href.startswith('http'):
        href = 'https://www.mgeko.cc' + href

    clean_base_url = href.split('/all-chapters/')[0].split('/chapter-')[0]
    title_el = it.xpath('.//*[contains(@class, "novel-title")]')
    title = title_el[0].text_content().strip() if title_el else (a.get('title') or '').strip()

    ch_el = it.xpath('.//*[contains(@class, "chapter-title")]')
    if ch_el:
        ch_raw = ch_el[0].text_content().strip()
    else:
        # Check strong inside novel-stats (e.g. search page: "<strong> Chapters 6-eng-li</strong>")
        stats_strong = it.xpath('.//*[contains(@class, "novel-stats")]//strong')
        ch_raw = stats_strong[0].text_content().strip() if stats_strong else ''
    ch_num = parse_chapter_num(ch_raw)

    if ch_num <= 0 or ch_num > max_chapters:
        return None

    img_el = it.xpath('.//img')
    cover = ''
    if img_el:
        cover = img_el[0].get('data-src') or img_el[0].get('src') or ''
        if cover.startswith('/'):
            cover = 'https://www.mgeko.cc' + cover

    score_el = it.xpath('.//*[contains(@class, "score")]')
    score_str = score_el[0].text_content().strip() if score_el else ''

    status_el = it.xpath('.//*[contains(@class, "status")]')
    status = status_el[0].text_content().strip() if status_el else 'Ongoing'

    time_el = it.xpath('.//*[contains(@class, "novel-stats")]//span')
    time_raw = time_el[0].text_content().strip() if time_el else ''
    time_updated = clean_time_updated(time_raw)

    flag_el = it.xpath('.//*[contains(@class, "novel-stats")]//img')
    origin = 'Manga'
    if flag_el:
        src = flag_el[0].get('src', '')
        if 'rep-cn' in src:
            origin = 'CN (Manhua)'
        elif 'rep-kr' in src:
            origin = 'KR (Manhwa)'
        elif 'rep-jp' in src:
            origin = 'JP (Manga)'

    manga_id = clean_base_url.rstrip('/').split('/')[-1]

    return {
        "id": manga_id,
        "source": "mgeko",
        "title": title,
        "url": clean_base_url,
        "cover": cover,
        "chapter_count": int(ch_num) if ch_num.is_integer() else ch_num,
        "latest_chapter_text": ch_raw,
        "score": score_str,
        "status": status,
        "origin": origin,
        "time_updated": time_updated,
        "views_count": 0,
        "views_text": "-",
        "genres": [],
        "summary": "",
        "summary_th": ""
    }



def load_historical_mgeko_candidates(max_chapters: int) -> Dict[str, Dict[str, Any]]:
    """
    Legacy historical loader disabled.
    Fresh crawl mode: Always starts fresh with empty dict (0 old items) to prevent stale accumulation.
    """
    return {}


def load_historical_comix_candidates(max_chapters: int) -> Dict[str, Dict[str, Any]]:
    """
    Legacy historical loader disabled.
    Fresh crawl mode: Always starts fresh with empty dict (0 old items) to prevent stale accumulation.
    """
    return {}


def crawl_mgeko_project_ideas(max_pages: int = 30, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None, page: Optional[Any] = None) -> Dict[str, Any]:
    """Crawl Mgeko recently updated manga sequentially page by page from main listing."""
    now = datetime.now()
    crawled_at = now.isoformat()
    session = requests.Session()

    if seed_keywords is None:
        seed_keywords = []

    kw_info = f" + คำค้นเฉพาะ {len(seed_keywords)} คำ" if seed_keywords else ""
    print("=" * 80)
    print(f"🚀 [1/2] Mgeko New Project Ideas Crawler Engine")
    print(f"   เป้าหมาย: https://www.mgeko.cc/browse-comics/ (อ่านทีละหน้าตามลำดับ สูงสุด {max_pages} หน้า{kw_info})")
    print(f"   กฎคัดกรอง: เฉพาะเรื่องที่มีไม่เกิน {max_chapters} ตอน (<= {max_chapters} ตอน)")
    print("=" * 80)

    # Fresh crawl: Start completely clean every run with zero old history
    crawled_by_url: Dict[str, Dict[str, Any]] = {}
    new_candidates_to_enrich = []
    seen_urls = set()
    seen_page_item_urls = set()
    total_scanned_count = 0
    print(f"✨ [Mgeko] เริ่มต้นการสแกนแบบสดใหม่ (Fresh Run): ไม่โหลดประวัติเดิม เริ่มต้นจาก 0 เรื่อง")

    for page_idx in range(1, max_pages + 1):
        page_url = f'https://www.mgeko.cc/browse-comics/?page={page_idx}&max_chapters={max_chapters}'

        print(f"▶ [1/2 Mgeko] กำลังเปิดและอ่านหน้า {page_idx}/{max_pages}: {page_url} ...")
        try:
            if page:
                page.goto(page_url, wait_until="commit", timeout=25000)
                try:
                    page.wait_for_selector(".comic-card, .novel-item", timeout=12000)
                except Exception:
                    page.wait_for_timeout(1500)
                set_browser_window_bottom_most()
                page.wait_for_timeout(400)
                html_text = page.content()
            else:
                # Direct requests fallback using Mgeko browse-comics data API
                api_url = f'https://www.mgeko.cc/browse-comics/data/?page={page_idx}&max_chapters={max_chapters}'
                ajax_headers = {
                    **DEFAULT_HEADERS,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': page_url
                }
                r = session.get(api_url, headers=ajax_headers, timeout=20)
                if r.status_code == 200:
                    try:
                        data = r.json()
                        html_text = f"<div>{data.get('results_html', '')}</div>"
                    except Exception:
                        html_text = r.text
                else:
                    r = session.get(page_url, headers=DEFAULT_HEADERS, timeout=20)
                    if r.status_code != 200:
                        print(f"⚠️ หน้า {page_idx} ตอบกลับด้วย HTTP Status {r.status_code}")
                        continue
                    html_text = r.text

            doc = lxml.html.fromstring(html_text)
            items = doc.xpath('//article[contains(@class, "comic-card")] | //div[contains(@class, "comic-card") and not(contains(@class, "comic-card__"))] | //li[contains(@class, "novel-item") and not(contains(@class, "swiper-slide"))]')
            if not items:
                print(f"  ℹ️ [Mgeko] หน้า {page_idx} ไม่พบรายการการ์ตูน -> สิ้นสุดการแบ่งหน้า")
                break

            total_scanned_count += len(items)
            current_page_urls = []
            page_qualified = 0
            page_updated = 0
            page_new = 0

            for it in items:
                if it.tag == 'article' or 'comic-card' in (it.get('class') or ''):
                    candidate = parse_mgeko_comic_card(it, max_chapters)
                else:
                    candidate = parse_mgeko_novel_element(it, max_chapters)
                if not candidate:
                    continue
                clean_base_url = candidate["url"]
                current_page_urls.append(clean_base_url)
                page_qualified += 1

                if clean_base_url in crawled_by_url:
                    # Update latest chapter / time if newer
                    if candidate.get("chapter_count", 0) > 0:
                        crawled_by_url[clean_base_url]["chapter_count"] = candidate["chapter_count"]
                    if candidate.get("latest_chapter_text"):
                        crawled_by_url[clean_base_url]["latest_chapter_text"] = candidate["latest_chapter_text"]
                    if candidate.get("time_updated"):
                        crawled_by_url[clean_base_url]["time_updated"] = candidate["time_updated"]
                    page_updated += 1
                    continue

                if clean_base_url in seen_urls:
                    continue
                seen_urls.add(clean_base_url)
                new_candidates_to_enrich.append(candidate)
                page_new += 1

            # Detect end of pagination:
            # If current page urls are completely a subset of previously seen page urls, pagination has reached the end
            if page_idx > 1 and current_page_urls and set(current_page_urls).issubset(seen_page_item_urls):
                print(f"  ℹ️ [Mgeko] หน้า {page_idx} มีเนื้อหาซ้ำกับหน้าก่อนหน้า (สิ้นสุดการแบ่งหน้าของ Mgeko ที่หน้า {page_idx-1}) -> ยุติการสแกนหน้าถัดไป")
                break
            seen_page_item_urls.update(current_page_urls)

            print(f"  ✓ [Mgeko หน้า {page_idx}] พบตรงเกณฑ์ {page_qualified} เรื่อง (อัปเดตเรื่องเดิมใน DB {page_updated} เรื่อง, เพิ่มใหม่ {page_new} เรื่อง)")

            # Check disabled next pagination button or empty next page
            disabled_next = doc.xpath('//span[contains(@class, "bp-btn--disabled") and (contains(text(), "Next") or .//i[contains(@class, "chevron-right")])]')
            if disabled_next and len(items) < 24:
                print(f"  ℹ️ [Mgeko] หน้า {page_idx} เป็นหน้าสุดท้ายของหมวดนี้แล้ว (พบปุ่ม Next ปิดการใช้งาน) -> สิ้นสุดการแบ่งหน้า")
                break

        except Exception as e:
            print(f"❌ Error crawling Mgeko page {page_idx}: {e}")

    # Optional Seed Keywords Discovery (only runs if keywords are explicitly specified)
    if seed_keywords:
        for kw in seed_keywords:
            try:
                search_url = f'https://www.mgeko.cc/search/?search={urllib.parse.quote(kw)}'
                print(f"▶ [1/2 Mgeko - ค้นหาคำค้นเฉพาะ] '{kw}': {search_url} ...")
                if page:
                    page.goto(search_url, wait_until="commit", timeout=20000)
                    page.wait_for_timeout(800)
                    set_browser_window_bottom_most()
                    page.wait_for_timeout(400)
                    html_text = page.content()
                else:
                    r = session.get(search_url, headers=DEFAULT_HEADERS, timeout=15)
                    html_text = r.text if r.status_code == 200 else ""
                if html_text:
                    doc = lxml.html.fromstring(html_text)
                    items = doc.xpath('//li[contains(@class, "novel-item") and not(contains(@class, "swiper-slide"))]')
                    total_scanned_count += len(items)
                    kw_found = 0
                    kw_updated = 0
                    kw_new = 0
                    for it in items:
                        candidate = parse_mgeko_novel_element(it, max_chapters)
                        if not candidate:
                            continue
                        kw_found += 1
                        clean_base_url = candidate["url"]
                        if clean_base_url in crawled_by_url:
                            crawled_by_url[clean_base_url]["chapter_count"] = candidate["chapter_count"]
                            crawled_by_url[clean_base_url]["latest_chapter_text"] = candidate["latest_chapter_text"]
                            kw_updated += 1
                            continue
                        if clean_base_url in seen_urls:
                            continue
                        seen_urls.add(clean_base_url)
                        new_candidates_to_enrich.append(candidate)
                        kw_new += 1
                    print(f"  ✓ [Mgeko - ค้นหา '{kw}'] พบตรงเกณฑ์ {kw_found} เรื่อง (อัปเดตใน DB {kw_updated} เรื่อง, เพิ่มใหม่ {kw_new} เรื่อง)")
            except Exception as e:
                print(f"❌ Error searching Mgeko for '{kw}': {e}")

    if new_candidates_to_enrich:
        print(f"⚡ [Mgeko] กำลังดึงยอดวิว + แปลเรื่องย่อสำหรับมังงะใหม่ {len(new_candidates_to_enrich)} เรื่อง (หน้าต่าง Chrome เปิดค้างไว้ด้านหลังสุด)...")
        enriched_new = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(fetch_manga_detail_and_translate, item, session): item for item in new_candidates_to_enrich}
            for f in as_completed(futures):
                enriched_new.append(f.result())
        for it in enriched_new:
            crawled_by_url[it["url"]] = it

    # Filter strictly for chapter_count <= max_chapters
    final_candidates = [
        item for item in crawled_by_url.values()
        if 1 <= float(item.get("chapter_count") or 0) <= max_chapters
    ]
    final_candidates.sort(key=lambda x: x.get("views_count", 0), reverse=True)

    genre_counts: Dict[str, int] = {}
    origin_counts: Dict[str, int] = {}
    total_views_portfolio = 0

    for c in final_candidates:
        orig = c.get("origin") or "Unknown"
        origin_counts[orig] = origin_counts.get(orig, 0) + 1
        total_views_portfolio += c.get("views_count", 0)
        for g in c.get("genres", []):
            if g:
                genre_counts[g] = genre_counts.get(g, 0) + 1

    sorted_genres = dict(sorted(genre_counts.items(), key=lambda kv: kv[1], reverse=True))

    return {
        "source_id": "mgeko",
        "source_name": "Mgeko (mgeko.cc)",
        "crawled_at": crawled_at,
        "source_url": "https://www.mgeko.cc/browse-comics/",
        "filter_rule": f"chapter_count <= {max_chapters}",
        "sort_order": "views_count_desc",
        "max_chapters_threshold": max_chapters,
        "total_scanned": total_scanned_count,
        "total_candidates": len(final_candidates),
        "total_views_sum": total_views_portfolio,
        "origin_distribution": origin_counts,
        "top_genres": sorted_genres,
        "items": final_candidates
    }


def enrich_comix_item_translation(item: Dict[str, Any]) -> Dict[str, Any]:
    """Translate Comix.to clean English synopsis to Thai."""
    summary_en = item.get("summary", "")
    if summary_en:
        item["summary_th"] = translate_to_thai(summary_en) or summary_en
    else:
        item["summary_th"] = ""
    return item


def parse_comix_raw_item(raw: Dict[str, Any], max_chapters: int) -> Optional[Dict[str, Any]]:
    """Parse raw Comix manga API object into project idea candidate dict."""
    hid = raw.get("hid") or str(raw.get("id") or "")
    if not hid:
        return None
    ch_num = float(raw.get("latestChapter") or 0)
    if ch_num <= 0 or ch_num > max_chapters:
        return None

    poster = raw.get("poster") or {}
    cover_rel = poster.get("medium") or poster.get("large") or ""
    if cover_rel.startswith("/"):
        cover_url = "https://comix.to" + cover_rel
    else:
        cover_url = cover_rel

    rel_url = raw.get("url") or f"/title/{hid}"
    full_url = "https://comix.to" + rel_url if rel_url.startswith("/") else rel_url

    mtype = (raw.get("type") or "").lower()
    lang = (raw.get("originalLanguage") or "").lower()
    if mtype == "manhwa" or lang == "ko":
        origin = "KR (Manhwa)"
        type_tag = "Manhwa"
    elif mtype == "manhua" or lang == "zh":
        origin = "CN (Manhua)"
        type_tag = "Manhua"
    elif mtype == "manga" or lang == "ja":
        origin = "JP (Manga)"
        type_tag = "Manga"
    else:
        origin = "Manga"
        type_tag = "Comics"

    raw_status = (raw.get("status") or "releasing").lower()
    if raw_status == "releasing":
        status = "Ongoing"
    elif raw_status == "finished":
        status = "Completed"
    elif raw_status == "on_hiatus":
        status = "Hiatus"
    else:
        status = raw_status.capitalize()

    follows = int(raw.get("followsTotal") or 0)
    rated_avg = raw.get("ratedAvg")
    score_str = f"{float(rated_avg):.1f}" if rated_avg else ""

    updated_fmt = raw.get("chapterUpdatedAtFormatted") or ""
    time_updated = f"อัปเดตเมื่อ {updated_fmt}" if updated_fmt else ""

    clean_syn = clean_comix_synopsis(raw.get("synopsis") or "")

    genres = [type_tag]
    if status == "Ongoing":
        genres.append("Releasing")
    elif status == "Completed":
        genres.append("Completed")
    if raw.get("hasOfficial"):
        genres.append("Official")

    # Add raw genres if available
    raw_genres = raw.get("genres") or []
    if isinstance(raw_genres, list):
        for g in raw_genres:
            g_title = g.get("title") if isinstance(g, dict) else str(g)
            if g_title and g_title not in genres:
                genres.append(g_title)

    ch_val = int(ch_num) if ch_num.is_integer() else ch_num

    return {
        "id": hid,
        "source": "comix",
        "title": raw.get("title") or hid,
        "alt_titles": raw.get("altTitles") or [],
        "url": full_url,
        "cover": cover_url,
        "chapter_count": ch_val,
        "latest_chapter_text": f"Chapter {ch_val}",
        "score": score_str,
        "status": status,
        "origin": origin,
        "time_updated": time_updated,
        "views_count": follows,
        "views_text": format_compact_number(follows),
        "bookmarks_text": f"{follows:,}",
        "genres": genres,
        "summary": clean_syn,
        "summary_th": ""
    }


def fetch_comix_metadata_via_html(hid_or_url: str, session: Optional[requests.Session] = None) -> Optional[Dict[str, Any]]:
    """Fetch complete metadata and synopsis directly from Comix title HTML SSR script (immune to API token rotation)."""
    s = session or requests.Session()
    url = hid_or_url if hid_or_url.startswith("http") else f"https://comix.to/title/{hid_or_url}"
    try:
        r = s.get(url, headers=DEFAULT_HEADERS, timeout=12)
        if r.status_code != 200:
            return None
        doc = lxml.html.fromstring(r.text)
        for s_text in doc.xpath('//script/text()'):
            if 'queries' in s_text:
                try:
                    data = json.loads(s_text)
                    for k, v in data.get('queries', {}).items():
                        if isinstance(v, dict) and ('synopsis' in v or 'title' in v or 'id' in v) and v.get('title'):
                            return v
                except Exception:
                    pass
    except Exception:
        pass
    return None


def crawl_comix_homepage_ssr(max_chapters: int = 100, session: Optional[requests.Session] = None) -> Dict[str, Dict[str, Any]]:
    """
    Extract top trending, most followed, and recently updated manga directly from Comix.to homepage SSR queries.
    Provides complete API metadata and synopses without requiring token keys or triggering 403 Forbidden.
    """
    s = session or requests.Session()
    candidates = {}
    try:
        r = s.get("https://comix.to/", headers=DEFAULT_HEADERS, timeout=15)
        if r.status_code == 200:
            doc = lxml.html.fromstring(r.text)
            for script_text in doc.xpath('//script/text()'):
                if 'queries' in script_text and 'trending' in script_text:
                    try:
                        data = json.loads(script_text)
                        for k, v in data.get('queries', {}).items():
                            items = []
                            if isinstance(v, list):
                                items = v
                            elif isinstance(v, dict) and 'items' in v:
                                items = v['items']
                            for raw in items:
                                if isinstance(raw, dict) and raw.get('hid'):
                                    parsed = parse_comix_raw_item(raw, max_chapters)
                                    if parsed and parsed['id'] not in candidates:
                                        candidates[parsed['id']] = parsed
                    except Exception:
                        pass
    except Exception as e:
        print(f"⚠️ Error crawling Comix SSR homepage: {e}")
    return candidates


def extract_and_ingest_comix_lrow_items(
    page: Any,
    raw_items_by_hid: Dict[str, Dict[str, Any]],
    new_hids_to_translate: set,
    max_chapters: int
) -> int:
    """Extract .lrow cards directly from Comix DOM and ingest into dictionary."""
    rows = page.evaluate("""() => {
        const els = Array.from(document.querySelectorAll('.lrow'));
        return els.map(el => {
            const titleEl = el.querySelector('.lrow__title') || el.querySelector('h3');
            const linkEl = el.querySelector('.lrow__title-link') || el.querySelector('a');
            const imgEl = el.querySelector('img');
            const typeEl = el.querySelector('.lrow__type');
            const statusEl = el.querySelector('.lrow__status');
            const chEl = el.querySelector('.lrow__ch');
            const followsEl = el.querySelector('.lrow__follows');
            const scoreEl = el.querySelector('.lrow__score, .lrow__rate');
            
            let synopsis = '';
            const pEl = el.querySelector('p') || el.querySelector('.lrow__synopsis') || el.querySelector('.lrow__desc');
            if (pEl) {
                synopsis = pEl.innerText.trim();
            } else {
                const allText = el.innerText;
                const parts = allText.split('\\n\\n');
                if (parts.length > 1) {
                    synopsis = parts[1].trim();
                }
            }
            
            return {
                title: titleEl ? titleEl.innerText.trim() : '',
                href: linkEl ? linkEl.href : '',
                cover: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '',
                type: typeEl ? typeEl.innerText.trim() : '',
                status: statusEl ? statusEl.innerText.trim() : '',
                chRaw: chEl ? chEl.innerText.trim() : '',
                followsRaw: followsEl ? followsEl.innerText.trim() : '',
                scoreRaw: scoreEl ? scoreEl.innerText.trim() : '',
                rawText: el.innerText,
                synopsis: synopsis
            };
        });
    }""")
    
    added = 0
    for r in rows:
        ch = parse_chapter_num(r.get("chRaw", ""))
        if ch <= 0 or ch > max_chapters:
            continue
        href = r.get("href", "")
        if not href or "-chapter-" in href:
            continue
        m = re.search(r'/title/([a-z0-9]+)', href)
        hid = m.group(1) if m else href.rstrip("/").split("/")[-1]
        if not hid:
            continue
            
        clean_syn = clean_comix_synopsis(r.get("synopsis", ""))
        raw_type = r.get("type", "").upper()
        if "MANHWA" in raw_type:
            origin = "KR (Manhwa)"
            type_tag = "Manhwa"
        elif "MANHUA" in raw_type:
            origin = "CN (Manhua)"
            type_tag = "Manhua"
        elif "MANGA" in raw_type:
            origin = "JP (Manga)"
            type_tag = "Manga"
        else:
            origin = "Manga"
            type_tag = "Comics"

        raw_st = r.get("status", "").upper()
        status = "Completed" if "FINISHED" in raw_st else "Ongoing"
        follows = parse_views_count(r.get("followsRaw", ""))
        
        score_m = re.search(r'\b(\d\.\d)\b', r.get("scoreRaw", "") or r.get("rawText", ""))
        score_str = score_m.group(1) if score_m else ""

        ch_val = int(ch) if ch.is_integer() else ch
        candidate = {
            "id": hid,
            "source": "comix",
            "title": r.get("title") or hid,
            "alt_titles": [],
            "url": href,
            "cover": r.get("cover", ""),
            "chapter_count": ch_val,
            "latest_chapter_text": f"Chapter {ch_val}",
            "score": score_str,
            "status": status,
            "origin": origin,
            "time_updated": "อัปเดตล่าสุด",
            "views_count": follows,
            "views_text": format_compact_number(follows) if follows else "-",
            "bookmarks_text": f"{follows:,}" if follows else "-",
            "genres": [type_tag, status],
            "summary": clean_syn,
            "summary_th": ""
        }
        if hid not in raw_items_by_hid:
            raw_items_by_hid[hid] = candidate
            new_hids_to_translate.add(hid)
            added += 1
        else:
            if clean_syn and not raw_items_by_hid[hid].get("summary"):
                raw_items_by_hid[hid]["summary"] = clean_syn
            if follows and not raw_items_by_hid[hid].get("views_count"):
                raw_items_by_hid[hid]["views_count"] = follows
                raw_items_by_hid[hid]["views_text"] = format_compact_number(follows)
                raw_items_by_hid[hid]["bookmarks_text"] = f"{follows:,}"
    return added


def crawl_comix_project_ideas(
    max_pages_per_feed: int = 30,
    max_chapters: int = 100,
    seed_keywords: Optional[List[str]] = None,
    headless: bool = False,
    page: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Crawl Comix.to sequentially page by page using Google Chrome DOM crawler
    and SSR queries without any token-based API or HMAC signature keys.
    Filtering strictly for 1 <= chapter_count <= max_chapters.
    """
    now = datetime.now()
    crawled_at = now.isoformat()

    if seed_keywords is None:
        seed_keywords = []

    mode_str = "Headless Mode" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"
    kw_info = f" + คำค้นเฉพาะ {len(seed_keywords)} คำ" if seed_keywords else ""
    print("\n" + "=" * 80)
    print("🚀 [2/2] Comix.to New Project Ideas Crawler Engine (Pure Chrome DOM & SSR)")
    print(f"   เป้าหมาย: https://comix.to/ (อ่านหน้าแรก SSR + หน้า Browse ทีละหน้าตามลำดับ สูงสุด {max_pages_per_feed} หน้า{kw_info})")
    print(f"   โหมดเบราว์เซอร์: {mode_str}")
    print(f"   กฎคัดกรอง: เฉพาะเรื่องที่มีไม่เกิน {max_chapters} ตอน (1 - {max_chapters} ตอน)")
    print("   ระบบเชื่อมต่อ: Pure Chrome DOM & SSR Engine (ตัดระบบ Token-Based API ที่เกิด 403 ออก 100%)")
    print("=" * 80)

    # Fresh crawl: Start completely clean every run with zero old history
    raw_items_by_hid: Dict[str, Dict[str, Any]] = {}
    new_hids_to_translate = set()
    total_scanned = 0
    print(f"✨ [Comix.to] เริ่มต้นการสแกนแบบสดใหม่ (Fresh Run): ไม่โหลดประวัติเดิม เริ่มต้นจาก 0 เรื่อง")

    session = requests.Session()
    local_p = None
    local_browser = None
    active_page = page

    if active_page is None:
        local_p, local_browser, active_page = get_or_create_chrome_page(headless=headless)

    try:
        # Step 1: Comix Homepage SSR Data via Chrome
        if active_page:
            print("▶ [2/2 Comix.to] กำลังเปิดหน้าแรก https://comix.to/ ใน Chrome เพื่อดึง Trending & Top Follows SSR...")
            try:
                active_page.goto("https://comix.to/", wait_until="commit", timeout=30000)
                active_page.wait_for_timeout(1200)
                set_browser_window_bottom_most()
                active_page.wait_for_timeout(1000)
                raw_json = active_page.evaluate("() => document.getElementById('initial-data')?.innerText || ''")
                if raw_json:
                    data = json.loads(raw_json)
                    for k, v in data.get("queries", {}).items():
                        items = v if isinstance(v, list) else (v.get("items", []) if isinstance(v, dict) else [])
                        for raw in items:
                            if isinstance(raw, dict) and raw.get("hid"):
                                parsed = parse_comix_raw_item(raw, max_chapters)
                                if parsed and parsed["id"] not in raw_items_by_hid:
                                    raw_items_by_hid[parsed["id"]] = parsed
                                    new_hids_to_translate.add(parsed["id"])
                                    total_scanned += 1
                print(f"  ✓ [Comix.to SSR] ดึงข้อมูลสำเร็จ: {len(raw_items_by_hid)} เรื่องตรงเกณฑ์ (<= {max_chapters} ตอน)")
            except Exception as e:
                print(f"⚠️ Error loading Comix homepage in Chrome: {e}")
        else:
            # Fallback to requests if browser unavailable
            ssr_items = crawl_comix_homepage_ssr(max_chapters=max_chapters, session=session)
            total_scanned += len(ssr_items)
            for hid, item_dict in ssr_items.items():
                if hid not in raw_items_by_hid:
                    raw_items_by_hid[hid] = item_dict
                    new_hids_to_translate.add(hid)

        # Step 2: Browse pages sequentially via Chrome
        if active_page:
            print(f"🌐 [Google Chrome DOM Crawler] อ่านหน้า Browse ทีละหน้าตามลำดับ (1 -> {max_pages_per_feed})...")
            for p_num in range(1, max_pages_per_feed + 1):
                browse_url = f"https://comix.to/browse?page={p_num}"
                print(f"▶ [2/2 Comix.to] กำลังเปิดหน้า Browse {p_num}/{max_pages_per_feed}: {browse_url} ...")
                try:
                    active_page.goto(browse_url, wait_until="commit", timeout=25000)
                    try:
                        active_page.wait_for_selector(".lrow", timeout=10000)
                    except Exception:
                        active_page.wait_for_timeout(1000)
                    set_browser_window_bottom_most()
                    try:
                        active_page.wait_for_selector(".lrow", timeout=5000)
                    except Exception:
                        pass
                    card_count = active_page.evaluate("() => document.querySelectorAll('.lrow').length")
                    if card_count == 0:
                        print(f"  ℹ️ [Comix.to] หน้า {p_num} ไม่พบรายการการ์ตูนเพิ่มเติม -> สิ้นสุดการแบ่งหน้า")
                        break
                    added = extract_and_ingest_comix_lrow_items(active_page, raw_items_by_hid, new_hids_to_translate, max_chapters)
                    total_scanned += card_count
                    print(f"  ✓ หน้า {p_num} สแกน {card_count} เรื่อง (เพิ่มใหม่ตรงเกณฑ์ {added} เรื่อง, รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
                except Exception as e:
                    print(f"⚠️ Error browsing page {p_num}: {e}")

            # Optional search keywords via Chrome URL navigation
            if seed_keywords:
                for kw in seed_keywords:
                    search_url = f"https://comix.to/browse?keyword={urllib.parse.quote(kw)}"
                    print(f"▶ [2/2 Comix.to - ค้นหาคำค้นเฉพาะ] '{kw}' ...")
                    try:
                        active_page.goto(search_url, wait_until="commit", timeout=20000)
                        try:
                            active_page.wait_for_selector(".lrow", timeout=8000)
                        except Exception:
                            active_page.wait_for_timeout(1000)
                        set_browser_window_bottom_most()
                        try:
                            active_page.wait_for_selector(".lrow", timeout=5000)
                        except Exception:
                            pass
                        added = extract_and_ingest_comix_lrow_items(active_page, raw_items_by_hid, new_hids_to_translate, max_chapters)
                        print(f"  ✓ ค้นหา '{kw}' พบตรงเกณฑ์เพิ่มใหม่ {added} เรื่อง (รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
                    except Exception as e:
                        print(f"⚠️ Error searching '{kw}' in Chrome: {e}")

    finally:
        if local_browser:
            try:
                local_browser.close()
            except Exception:
                pass
        if local_p:
            try:
                local_p.stop()
            except Exception:
                pass

    # Step 3: Enrich missing synopses directly from HTML SSR for items that lack summary
    items_missing_summary = [it for it in raw_items_by_hid.values() if not it.get("summary") and it.get("id")]
    if items_missing_summary:
        print(f"⚡ [Comix.to] กำลังดึงเรื่องย่อ + ยอดวิวสำหรับมังงะที่ยังไม่มีข้อมูล {len(items_missing_summary)} เรื่อง...")
        def _enrich_one(item):
            meta = fetch_comix_metadata_via_html(item.get("url") or item.get("id"), session)
            if meta:
                raw_syn = meta.get("synopsis") or ""
                clean_syn = clean_comix_synopsis(raw_syn)
                if clean_syn:
                    item["summary"] = clean_syn
                if meta.get("followsTotal") and not item.get("views_count"):
                    f = int(meta["followsTotal"])
                    item["views_count"] = f
                    item["views_text"] = format_compact_number(f)
                    item["bookmarks_text"] = f"{f:,}"
                if meta.get("ratedAvg") and not item.get("score"):
                    item["score"] = f"{float(meta['ratedAvg']):.1f}"
            return item

        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(_enrich_one, it) for it in items_missing_summary]
            for f in as_completed(futures):
                f.result()

    candidates = [
        it for it in raw_items_by_hid.values()
        if 1 <= float(it.get("chapter_count") or 0) <= max_chapters
    ]
    
    # Step 4: Translate synopses ONLY for items that have English synopsis AND are missing Thai translation
    items_to_translate = [
        c for c in candidates
        if bool(c.get("summary", "").strip()) and (not c.get("summary_th") or c.get("summary_th") in ["-", c.get("summary")])
    ]
    for c in candidates:
        if not c.get("summary", "").strip() and not c.get("summary_th"):
            c["summary_th"] = "-"

    if items_to_translate:
        print(f"⚡ [Comix.to] กำลังแปลเรื่องย่อภาษาไทยสำหรับมังงะใหม่ {len(items_to_translate)} เรื่อง (ใช้ Translation Cache เพื่อความรวดเร็ว)...")
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(enrich_comix_item_translation, item): item for item in items_to_translate}
            for f in as_completed(futures):
                res = f.result()
                raw_items_by_hid[res["id"]] = res
        save_translation_cache()
    else:
        print("✓ [Comix.to] เรื่องย่อภาษาไทยทั้งหมดได้รับการแปลและแคชไว้ครบถ้วนแล้ว (ไม่ต้องแปลซ้ำ)")

    final_comix = [
        it for it in raw_items_by_hid.values()
        if 1 <= float(it.get("chapter_count") or 0) <= max_chapters
    ]
    final_comix.sort(key=lambda x: x.get("views_count", 0), reverse=True)

    genre_counts: Dict[str, int] = {}
    origin_counts: Dict[str, int] = {}
    total_views_sum = 0

    for c in final_comix:
        orig = c.get("origin") or "Unknown"
        origin_counts[orig] = origin_counts.get(orig, 0) + 1
        total_views_sum += c.get("views_count", 0)
        for g in c.get("genres", []):
            if g:
                genre_counts[g] = genre_counts.get(g, 0) + 1

    sorted_genres = dict(sorted(genre_counts.items(), key=lambda kv: kv[1], reverse=True))

    return {
        "source_id": "comix",
        "source_name": "Comix (comix.to)",
        "crawled_at": crawled_at,
        "source_url": "https://comix.to/",
        "filter_rule": f"chapter_count <= {max_chapters}",
        "sort_order": "follows_total_desc",
        "max_chapters_threshold": max_chapters,
        "total_scanned": total_scanned,
        "total_candidates": len(final_comix),
        "total_views_sum": total_views_sum,
        "origin_distribution": origin_counts,
        "top_genres": sorted_genres,
        "items": final_comix
    }



def send_project_ideas_to_gas(
    combined_payload: Dict[str, Any],
    gas_url: Optional[str] = None,
    passcode: Optional[str] = None
) -> bool:
    """
    Send freshly crawled project ideas to Google Apps Script backend.
    Strictly overwrites the 'ProjectIdeas' sheet tab (clears old data first,
    writing only the fresh crawl from this run).
    """
    target_url = gas_url or os.environ.get("GAS_URL") or os.environ.get("GAS_WEBAPP_URL") or DEFAULT_GAS_URL
    req_pass = passcode or os.environ.get("PASSCODE") or DEFAULT_PASSCODE

    if not target_url:
        print("⚠️ GAS_URL not configured. Skipping Google Sheet sync.")
        return False

    m_items = combined_payload.get("sources", {}).get("mgeko", {}).get("items", []) or combined_payload.get("items", [])
    c_items = combined_payload.get("sources", {}).get("comix", {}).get("items", [])
    total_items = len(m_items) + len(c_items)

    print("\n" + "=" * 80)
    print(f"📡 [Google Sheets Overwrite] กำลังส่งข้อมูลไอเดียสดใหม่ไปยัง Google Sheet ({target_url[:50]}...)...")
    print(f"   แท็บชีทเป้าหมาย: 'ProjectIdeas' (ล้างประวัติเก่าทิ้งทั้งหมด เขียนทับด้วยข้อมูลสดใหม่ {total_items} เรื่อง)")
    print("=" * 80)

    try:
        req_body = {
            "action": "SAVE_PROJECT_IDEAS_DATA",
            "passcode": req_pass,
            "payload": {
                "crawled_at": combined_payload.get("crawled_at") or datetime.now().isoformat(),
                "max_chapters_threshold": combined_payload.get("max_chapters_threshold", 100),
                "sources": {
                    "mgeko": {"items": m_items, "count": len(m_items)},
                    "comix": {"items": c_items, "count": len(c_items)}
                },
                "items": m_items + c_items
            }
        }

        data_bytes = json.dumps(req_body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            target_url,
            data=data_bytes,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "MangaHub-ProjectIdeas-Crawler"
            }
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_raw = resp.read().decode("utf-8")
            res_json = json.loads(resp_raw)
            if res_json.get("status") == "success" or res_json.get("success"):
                msg = res_json.get("message") or (res_json.get("data") and res_json.get("data").get("message")) or "Success"
                print(f"✓ [Google Sheets] เขียนข้อมูลทับลงชีท 'ProjectIdeas' สำเร็จเรียบร้อย! ({msg})")
                return True
            else:
                print(f"⚠️ [Google Sheets] ได้รับการตอบกลับ: {res_json}")
                return False
    except Exception as e:
        print(f"❌ [Google Sheets] ส่งข้อมูลไปยัง Google Apps Script ไม่สำเร็จ: {e}")
        return False


def crawl_all_project_ideas(max_pages: int = 30, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None, headless: bool = False, send_gas: bool = True, gas_url: Optional[str] = None, passcode: Optional[str] = None, source: str = "all") -> Dict[str, Any]:
    """Crawl both Mgeko and Comix.to sequentially page by page and write unified + separate JSON feeds."""
    if seed_keywords is None:
        seed_keywords = []

    mode_title = "Headless" if headless else "Google Chrome จริง (หน้าต่างเปิดอยู่ด้านหลังสุด / HWND_BOTTOM ไม่แย่งโฟกัส)"
    print("=" * 90)
    print("🚀 MangaHub New Project Ideas Crawler Engine (Mgeko + Comix.to)")
    print(f"   โหมดเบราว์เซอร์: {mode_title}")
    print(f"   เกณฑ์คัดกรอง: มังงะใหม่/กำลังมาแรงที่มีไม่เกิน {max_chapters} ตอน (1 - {max_chapters} ตอน)")
    print(f"   การสแกน: ทีละหน้าตามลำดับ (Sequential 1 -> {max_pages})")
    print("=" * 90)

    playwright_inst, browser, page = None, None, None
    try:
        playwright_inst, browser, page = get_or_create_chrome_page(headless=headless)
    except Exception as e:
        print(f"⚠️ ไม่สามารถเปิดเบราว์เซอร์อัตโนมัติ: {e} -> สลับไปใช้ HTTP Requests")

    try:
        mgeko_payload = {}
        comix_payload = {}
        if source in ["all", "mgeko"]:
            mgeko_payload = crawl_mgeko_project_ideas(
                max_pages=max_pages,
                max_chapters=max_chapters,
                seed_keywords=seed_keywords,
                page=page
            )
        if source in ["all", "comix"]:
            comix_payload = crawl_comix_project_ideas(
                max_pages_per_feed=max_pages,
                max_chapters=max_chapters,
                seed_keywords=seed_keywords,
                headless=headless,
                page=page
            )
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if playwright_inst:
            try:
                playwright_inst.stop()
            except Exception:
                pass

    base_payload = mgeko_payload if mgeko_payload else comix_payload
    combined_payload = {
        **base_payload,
        "sources": {
            "mgeko": mgeko_payload,
            "comix": comix_payload,
        }
    }

    # Ensure translation cache is saved to disk
    save_translation_cache()

    # Save main combined payload & Comix standalone payload
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(combined_payload, f, ensure_ascii=False, indent=2)
    with open(COMIX_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(comix_payload, f, ensure_ascii=False, indent=2)
    print(f"\n✓ บันทึกผลลัพธ์ลงใน: {OUTPUT_FILE} และ {COMIX_OUTPUT_FILE}")

    for out_dir in [FRONTEND_SRC_DIR, FRONTEND_PUB_DIR, FRONTEND_DIST_DIR]:
        if os.path.exists(out_dir):
            for fname, payload_obj in [
                ("project_ideas_latest.json", combined_payload),
                ("comix_project_ideas_latest.json", comix_payload),
            ]:
                target = os.path.join(out_dir, fname)
                try:
                    with open(target, "w", encoding="utf-8") as f:
                        json.dump(payload_obj, f, ensure_ascii=False, indent=2)
                    print(f"✓ อัปเดตข้อมูลไปยัง Frontend: {target}")
                except Exception as e:
                    print(f"⚠️ บันทึกไปยัง {target} ล้มเหลว: {e}")

    print("\n" + "=" * 95)
    print(f"🏆 สรุปผลการดึงไอเดียโปรเจคใหม่ (<= {max_chapters} ตอน):")
    mgeko_cand = mgeko_payload.get('total_candidates', 0)
    mgeko_scan = mgeko_payload.get('total_scanned', 0)
    comix_cand = comix_payload.get('total_candidates', 0)
    comix_scan = comix_payload.get('total_scanned', 0)
    print(f"   1. Mgeko (mgeko.cc) : {mgeko_cand} เรื่อง (สแกน {mgeko_scan} เรื่อง)")
    print(f"   2. Comix (comix.to) : {comix_cand} เรื่อง (สแกน {comix_scan} เรื่อง)")
    print("=" * 95)

    if send_gas:
        send_project_ideas_to_gas(combined_payload, gas_url=gas_url, passcode=passcode)

    return combined_payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MangaHub Project Ideas Crawler (Mgeko + Comix.to)")
    parser.add_argument("--source", choices=["all", "mgeko", "comix"], default="all", help="Source to crawl: all, mgeko, or comix (default: all)")
    parser.add_argument("--pages", type=int, default=30, help="Maximum pagination pages to scan sequentially for Mgeko & Comix (default: 30)")
    parser.add_argument("--max-chapters", type=int, default=100, help="Maximum chapter count threshold (default: 100)")
    parser.add_argument("--keywords", nargs="*", default=None, help="Optional search keywords (default: None, reads sequentially from main listing)")
    parser.add_argument("--headless", action="store_true", default=False, help="Run browser in headless mode (default: False, runs visible Google Chrome window)")
    parser.add_argument("--send-gas", action="store_true", default=True, help="Send and overwrite fresh data to Google Sheets (default: True)")
    parser.add_argument("--no-send-gas", dest="send_gas", action="store_false", help="Skip sending to Google Sheets")
    parser.add_argument("--gas-url", type=str, default=DEFAULT_GAS_URL, help="GAS Web App URL")
    parser.add_argument("--passcode", type=str, default=DEFAULT_PASSCODE, help="GAS Web App Passcode")
    parser.add_argument("--sync-sheet-only", action="store_true", help="Sync existing latest JSON file to Google Sheet without re-crawling")
    args = parser.parse_args()

    if args.sync_sheet_only:
        if os.path.exists(OUTPUT_FILE):
            print(f"📂 [Sync-Sheet-Only] โหลดข้อมูลจาก {OUTPUT_FILE}...")
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            send_project_ideas_to_gas(data, gas_url=args.gas_url, passcode=args.passcode)
            sys.exit(0)
        else:
            print(f"❌ ไม่พบไฟล์ {OUTPUT_FILE} สำหรับ --sync-sheet-only")
            sys.exit(1)

    crawl_all_project_ideas(
        max_pages=args.pages,
        max_chapters=args.max_chapters,
        seed_keywords=args.keywords if args.keywords else [],
        headless=args.headless,
        send_gas=args.send_gas,
        gas_url=args.gas_url,
        passcode=args.passcode,
        source=args.source
    )

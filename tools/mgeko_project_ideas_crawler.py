#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MangaHub New Project Ideas Crawler Engine (Mgeko + Comix.to)
------------------------------------------------------------
Crawls newly updated and popular manga from:
1. Mgeko (https://www.mgeko.cc/jumbo/manga/)
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

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from comix_purchaser import call_comix_api

DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "..", "frontend", "dist", "data")

OUTPUT_FILE = os.path.join(DATA_DIR, "project_ideas_latest.json")
COMIX_OUTPUT_FILE = os.path.join(DATA_DIR, "comix_project_ideas_latest.json")

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


def translate_to_thai(text: str) -> str:
    """Translate synopsis from English to Thai using Google Translate API with retry."""
    if not text:
        return ""
    for attempt in range(3):
        try:
            chunk = text[:1200].strip()
            url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=th&dt=t&q=" + urllib.parse.quote(chunk)
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                translated = "".join([part[0] for part in res[0] if part[0]])
                if translated.strip():
                    return translated.strip()
        except Exception:
            time.sleep(0.4)
    return text


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
    """Fetch synopsis, views, and genres for Mgeko item, then translate synopsis to Thai."""
    url = item.get("url", "")
    if not url:
        return item

    try:
        r = session.get(url, headers=DEFAULT_HEADERS, timeout=15)
        if r.status_code == 200:
            doc = lxml.html.fromstring(r.text)
            genres = [a.text_content().strip() for a in doc.xpath('//a[contains(@href, "genre_included=")]')]
            genres = list(dict.fromkeys(genres))

            # Extract views
            views_text = ""
            views_count = 0
            views_spans = doc.xpath('//*[contains(text(), "Views")]')
            if views_spans:
                p_span = views_spans[0].getparent()
                if p_span is not None:
                    views_text = p_span.text_content().replace("Views", "").replace("supervised_user_circle", "").strip()
                    views_count = parse_views_count(views_text)

            # Extract bookmarks
            bookmarks_text = ""
            bm_spans = doc.xpath('//*[contains(text(), "Bookmarked")]')
            if bm_spans:
                p_bm = bm_spans[0].getparent()
                if p_bm is not None:
                    bookmarks_text = p_bm.text_content().replace("Bookmarked", "").replace("bookmark", "").strip()

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
            for tag in doc.xpath('//*[contains(text(), "Status") or contains(text(), "status")]'):
                parent_txt = tag.getparent().text_content().strip() if tag.getparent() is not None else ""
                if "Ongoing" in parent_txt:
                    detail_status = "Ongoing"
                    break
                elif "Completed" in parent_txt:
                    detail_status = "Completed"
                    break

            item["genres"] = genres
            item["summary"] = summary_en
            item["summary_th"] = summary_th or summary_en
            item["views_text"] = views_text or f"{views_count:,}"
            item["views_count"] = views_count
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


DEFAULT_SEED_KEYWORDS = [
    "The Return of the Scorned Genius",
    "Scorned Genius",
    "Cyberpunk Chivalry",
    "Cyberpunk",
    "How A Cyberpunk Fixer Lives",
]


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
    """Load existing Mgeko items from disk or git backup f6ceead to preserve 30-chapter gems."""
    candidates_by_url: Dict[str, Dict[str, Any]] = {}
    
    # 1. From OUTPUT_FILE on disk
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                items = d.get("sources", {}).get("mgeko", {}).get("items", []) or d.get("items", [])
                for it in items:
                    u = it.get("url")
                    ch = it.get("chapter_count", 0)
                    if u and 1 <= ch <= max_chapters:
                        candidates_by_url[u] = it
        except Exception as e:
            print(f"⚠️ Error loading local existing Mgeko items: {e}")

    # 2. Always backfill / merge from git baseline (commit f6ceead) to preserve all 30-chapter gems
    try:
        repo_root = os.path.dirname(BASE_DIR)
        cmd = ["git", "-C", repo_root, "show", "f6ceead:tools/data/project_ideas_latest.json"]
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL)
        d = json.loads(out)
        items = d.get("sources", {}).get("mgeko", {}).get("items", []) or d.get("items", [])
        for it in items:
            u = it.get("url")
            ch = it.get("chapter_count", 0)
            if u and 1 <= ch <= max_chapters and u not in candidates_by_url:
                candidates_by_url[u] = it
    except Exception as e:
        print(f"⚠️ Notice: git baseline lookup: {e}")

    return candidates_by_url


def load_historical_comix_candidates(max_chapters: int) -> Dict[str, Dict[str, Any]]:
    """Load existing Comix items from disk or git backup f6ceead to preserve 30-chapter gems."""
    candidates_by_hid: Dict[str, Dict[str, Any]] = {}

    # 1. From disk
    for path in [COMIX_OUTPUT_FILE, OUTPUT_FILE]:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                    items = d.get("items", []) if "comix" in path else (d.get("sources", {}).get("comix", {}).get("items", []))
                    for it in items:
                        hid = it.get("id")
                        ch = it.get("chapter_count", 0)
                        if hid and 1 <= ch <= max_chapters:
                            candidates_by_hid[hid] = it
            except Exception:
                pass

    # 2. Always backfill / merge from git baseline (commit f6ceead) to preserve all 389 Comix gems
    try:
        repo_root = os.path.dirname(BASE_DIR)
        cmd = ["git", "-C", repo_root, "show", "f6ceead:tools/data/comix_project_ideas_latest.json"]
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL)
        d = json.loads(out)
        items = d.get("items", [])
        for it in items:
            hid = it.get("id")
            ch = it.get("chapter_count", 0)
            if hid and 1 <= ch <= max_chapters and hid not in candidates_by_hid:
                candidates_by_hid[hid] = it
    except Exception as e:
        print(f"⚠️ Notice: git baseline lookup: {e}")

    return candidates_by_hid


def crawl_mgeko_project_ideas(max_pages: int = 5, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """Crawl Mgeko recently updated manga and search seed keywords, merging with historical portfolio."""
    now = datetime.now()
    crawled_at = now.isoformat()
    session = requests.Session()

    if seed_keywords is None:
        seed_keywords = DEFAULT_SEED_KEYWORDS

    print("=" * 80)
    print(f"🚀 [1/2] Mgeko New Project Ideas Crawler Engine")
    print(f"   เป้าหมาย: https://www.mgeko.cc/jumbo/manga/ (สแกน {max_pages} หน้า + คำค้นเจาะจง {len(seed_keywords)} คำ)")
    print(f"   กฎคัดกรอง: เฉพาะเรื่องที่มีไม่เกิน {max_chapters} ตอน (<= {max_chapters} ตอน)")
    print("=" * 80)

    # 1. Load historical portfolio to ensure existing <= max_chapters gems (including 30-chapter comics) are never lost
    existing_by_url = load_historical_mgeko_candidates(max_chapters)
    print(f"📦 โหลดประวัติมังงะเดิมของ Mgeko: {len(existing_by_url)} เรื่อง เพื่อรักษาเรื่อง 30 ตอนไม่ให้หลุดหาย")

    new_candidates_to_enrich = []
    seen_urls = set(existing_by_url.keys())
    total_scanned_count = 0

    for page in range(1, max_pages + 1):
        if page == 1:
            page_url = 'https://www.mgeko.cc/jumbo/manga/'
        else:
            page_url = f'https://www.mgeko.cc/jumbo/manga/?results={page}&filter=All'

        print(f"▶ [Mgeko] กำลังดึงข้อมูลหน้า {page}/{max_pages}: {page_url} ...")
        try:
            r = session.get(page_url, headers=DEFAULT_HEADERS, timeout=20)
            if r.status_code != 200:
                print(f"⚠️ หน้า {page} ตอบกลับด้วย HTTP Status {r.status_code}")
                continue

            doc = lxml.html.fromstring(r.text)
            items = doc.xpath('//li[contains(@class, "novel-item") and not(contains(@class, "swiper-slide"))]')
            total_scanned_count += len(items)

            page_qualified = 0
            for it in items:
                candidate = parse_mgeko_novel_element(it, max_chapters)
                if not candidate:
                    continue
                clean_base_url = candidate["url"]
                if clean_base_url in existing_by_url:
                    # Update latest chapter / time if newer
                    existing_by_url[clean_base_url]["chapter_count"] = candidate["chapter_count"]
                    existing_by_url[clean_base_url]["latest_chapter_text"] = candidate["latest_chapter_text"]
                    if candidate.get("time_updated"):
                        existing_by_url[clean_base_url]["time_updated"] = candidate["time_updated"]
                    continue

                if clean_base_url in seen_urls:
                    continue
                seen_urls.add(clean_base_url)
                new_candidates_to_enrich.append(candidate)
                page_qualified += 1

            print(f"  ✓ [Mgeko หน้า {page}] คัดกรองมังงะใหม่ได้ {page_qualified} เรื่อง")

        except Exception as e:
            print(f"❌ Error crawling Mgeko page {page}: {e}")

    # Seed Keywords Discovery (targeted search to catch gems like Cyberpunk Chivalry)
    for kw in seed_keywords:
        try:
            search_url = f'https://www.mgeko.cc/search/?search={urllib.parse.quote(kw)}'
            print(f"▶ [Mgeko - ค้นหาคำค้นเจาะจง] '{kw}': {search_url} ...")
            r = session.get(search_url, headers=DEFAULT_HEADERS, timeout=15)
            if r.status_code == 200:
                doc = lxml.html.fromstring(r.text)
                items = doc.xpath('//li[contains(@class, "novel-item") and not(contains(@class, "swiper-slide"))]')
                total_scanned_count += len(items)
                added_kw = 0
                for it in items:
                    candidate = parse_mgeko_novel_element(it, max_chapters)
                    if not candidate:
                        continue
                    clean_base_url = candidate["url"]
                    if clean_base_url in existing_by_url:
                        existing_by_url[clean_base_url]["chapter_count"] = candidate["chapter_count"]
                        existing_by_url[clean_base_url]["latest_chapter_text"] = candidate["latest_chapter_text"]
                        continue
                    if clean_base_url in seen_urls:
                        continue
                    seen_urls.add(clean_base_url)
                    new_candidates_to_enrich.append(candidate)
                    added_kw += 1
                print(f"  ✓ [Mgeko - ค้นหา '{kw}'] เพิ่มใหม่ {added_kw} เรื่อง")
        except Exception as e:
            print(f"❌ Error searching Mgeko for '{kw}': {e}")

    if new_candidates_to_enrich:
        print(f"⚡ [Mgeko] กำลังดึงยอดวิว + แปลเรื่องย่อสำหรับมังงะใหม่ {len(new_candidates_to_enrich)} เรื่อง...")
        enriched_new = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(fetch_manga_detail_and_translate, item, session): item for item in new_candidates_to_enrich}
            for f in as_completed(futures):
                enriched_new.append(f.result())
        for it in enriched_new:
            existing_by_url[it["url"]] = it

    # Filter strictly for chapter_count <= max_chapters (retires series that passed max_chapters)
    final_candidates = [
        item for item in existing_by_url.values()
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
        "source_url": "https://www.mgeko.cc/jumbo/manga/",
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


def crawl_comix_via_chrome(max_chapters: int = 100, seed_keywords: Optional[List[str]] = None, headless: bool = False) -> Dict[str, Dict[str, Any]]:
    """Crawl Comix.to using Playwright real Chrome DOM (Immune to API token rotation and Cloudflare 403)."""
    from playwright.sync_api import sync_playwright
    import time
    
    candidates = {}
    if seed_keywords is None:
        seed_keywords = DEFAULT_SEED_KEYWORDS
        
    print("\n🌐 [Chrome DOM Crawler] กำลังดึงข้อมูลจาก Comix.to ผ่าน Google Chrome จริง...")
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel="chrome", headless=headless)
            except Exception:
                browser = p.chromium.launch(headless=headless)
                
            page = browser.new_page(user_agent=DEFAULT_HEADERS.get("User-Agent"))
            page.goto("https://comix.to/", wait_until="networkidle", timeout=45000)
            
            items = page.evaluate("""() => {
                const links = Array.from(document.querySelectorAll('a[href*="/title/"]'));
                return links.map(a => {
                    return {
                        href: a.href,
                        text: a.innerText.trim(),
                        img: a.querySelector('img')?.src || ''
                    };
                }).filter(x => x.text && !x.href.includes('-chapter-'));
            }""")
            
            def _parse_dom_item(it_dict):
                raw_text = it_dict.get("text", "")
                href = it_dict.get("href", "")
                img = it_dict.get("img", "")
                
                ch_m = re.search(r'Ch\.([0-9.]+)', raw_text)
                if not ch_m:
                    return None
                ch = float(ch_m.group(1))
                if ch <= 0 or ch > max_chapters:
                    return None
                    
                lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
                title = ""
                for line in lines:
                    if not line.startswith("Ch.") and not re.search(r'\d+[dwm]\s+ago', line, re.I) and line not in ["MANHWA", "MANGA", "OTHER", "·"]:
                        title = line
                        break
                if not title and lines:
                    title = lines[-1] if not lines[-1].startswith("Ch.") else lines[0]
                    
                hid_m = re.search(r'/title/([a-z0-9]+)', href)
                hid = hid_m.group(1) if hid_m else href.rstrip("/").split("/")[-1]
                
                origin = "KR (Manhwa)" if "MANHWA" in raw_text.upper() else ("CN (Manhua)" if "MANHUA" in raw_text.upper() else ("JP (Manga)" if "MANGA" in raw_text.upper() else "Manga"))
                score_m = re.search(r'\b(\d\.\d)\b', raw_text)
                score = score_m.group(1) if score_m else ""
                
                ch_val = int(ch) if ch.is_integer() else ch
                return {
                    "id": hid,
                    "source": "comix",
                    "title": title or hid,
                    "alt_titles": [],
                    "url": href,
                    "cover": img,
                    "chapter_count": ch_val,
                    "latest_chapter_text": f"Chapter {ch_val}",
                    "score": score,
                    "status": "Ongoing",
                    "origin": origin,
                    "time_updated": "อัปเดตล่าสุด",
                    "views_count": 0,
                    "views_text": "-",
                    "bookmarks_text": "-",
                    "genres": [origin.split()[0]],
                    "summary": "",
                    "summary_th": ""
                }

            for it in items:
                parsed = _parse_dom_item(it)
                if parsed and parsed["id"] not in candidates:
                    candidates[parsed["id"]] = parsed
            print(f"✓ ดึงการ์ตูนหน้าแรก Comix สำเร็จ: {len(candidates)} เรื่อง")

            for kw in seed_keywords:
                inp = page.locator("input[placeholder*='Search']").first
                if inp.count():
                    inp.fill("")
                    inp.fill(kw)
                    time.sleep(1.5)
                    kw_items = page.evaluate("""() => {
                        const links = Array.from(document.querySelectorAll('a[href*="/title/"]'));
                        return links.map(a => ({
                            href: a.href,
                            text: a.innerText.trim(),
                            img: a.querySelector('img')?.src || ''
                        })).filter(x => x.text && !x.href.includes('-chapter-'));
                    }""")
                    added_kw = 0
                    for kit in kw_items:
                        parsed = _parse_dom_item(kit)
                        if parsed and parsed["id"] not in candidates:
                            candidates[parsed["id"]] = parsed
                            added_kw += 1
                    print(f"  ✓ ค้นหาคำว่า '{kw}' พบใหม่: {added_kw} เรื่อง")

            browser.close()
    except Exception as ex:
        print(f"⚠️ ข้อผิดพลาดใน Chrome DOM crawler: {ex}")
        
    return candidates


def crawl_comix_project_ideas(max_pages_per_feed: int = 3, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Crawl Comix.to via encrypted API `/api/v1/manga`
    filtering strictly for `1 <= latestChapter <= max_chapters`,
    preserving and incrementally merging with historical candidates.
    """
    now = datetime.now()
    crawled_at = now.isoformat()

    if seed_keywords is None:
        seed_keywords = DEFAULT_SEED_KEYWORDS

    print("\n" + "=" * 80)
    print(f"🚀 [2/2] Comix.to New Project Ideas Crawler Engine")
    print(f"   เป้าหมาย: https://comix.to/ (สแกนผ่าน API /api/v1/manga + ค้นหาเจาะจง {len(seed_keywords)} คำ)")
    print(f"   กฎคัดกรอง: เฉพาะเรื่องที่มีไม่เกิน {max_chapters} ตอน (1 - {max_chapters} ตอน)")
    print("=" * 80)

    # 1. Load historical candidates so no 30-chapter gems are wiped out
    existing_by_hid = load_historical_comix_candidates(max_chapters)
    print(f"📦 โหลดประวัติมังงะเดิมของ Comix.to: {len(existing_by_hid)} เรื่อง เพื่อรักษาฐานข้อมูลไม่ให้หาย")

    raw_items_by_hid: Dict[str, Dict[str, Any]] = dict(existing_by_hid)
    new_hids_to_translate = set()
    total_scanned = 0

    feed_configs = [
        ("Trending 7d", {"order[views_7d]": "desc"}, max_pages_per_feed),
        ("Trending 30d", {"order[views_30d]": "desc"}, max_pages_per_feed),
        ("Most Followed", {"order[follows_total]": "desc"}, max_pages_per_feed),
        ("Recently Updated", {"order[chapter_updated_at]": "desc"}, max_pages_per_feed + 2),
        ("Newly Created", {"order[created_at]": "desc"}, 2),
    ]

    for feed_label, extra_params, pages in feed_configs:
        for page in range(1, pages + 1):
            params = {
                "page": page,
                "limit": 30,
                "min_chap": 1,
                "max_chap": max_chapters,
                **extra_params,
            }
            print(f"▶ [Comix.to - {feed_label}] หน้า {page}/{pages} ...")
            try:
                res = call_comix_api("/manga", params)
                batch = res.get("items", []) if isinstance(res, dict) else []
                total_scanned += len(batch)
                added = 0
                for raw in batch:
                    hid = raw.get("hid") or str(raw.get("id") or "")
                    if not hid:
                        continue
                    item_dict = parse_comix_raw_item(raw, max_chapters)
                    if not item_dict:
                        continue
                    if hid in raw_items_by_hid:
                        # Update dynamic fields
                        raw_items_by_hid[hid]["chapter_count"] = item_dict["chapter_count"]
                        raw_items_by_hid[hid]["latest_chapter_text"] = item_dict["latest_chapter_text"]
                        raw_items_by_hid[hid]["views_count"] = item_dict["views_count"]
                        raw_items_by_hid[hid]["views_text"] = item_dict["views_text"]
                        raw_items_by_hid[hid]["bookmarks_text"] = item_dict["bookmarks_text"]
                        raw_items_by_hid[hid]["status"] = item_dict["status"]
                        raw_items_by_hid[hid]["time_updated"] = item_dict["time_updated"]
                    else:
                        raw_items_by_hid[hid] = item_dict
                        new_hids_to_translate.add(hid)
                        added += 1
                print(f"  ✓ [Comix.to - {feed_label} หน้า {page}] เพิ่มใหม่ {added} เรื่อง (รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
            except Exception as e:
                print(f"❌ Error fetching Comix.to ({feed_label} page {page}): {e}")

        # If API yielded 0 items (e.g. key_retired or Cloudflare 403), trigger Chrome DOM crawler fallback
    if total_scanned == 0:
        print("⚠️ Comix API ตอบกลับ 0 รายการ (Token Key หมดอายุหรือถูกปฏิเสธ) -> เปิดระบบดึงข้อมูลอัตโนมัติผ่าน Google Chrome จริง...")
        chrome_items = crawl_comix_via_chrome(max_chapters=max_chapters, seed_keywords=seed_keywords)
        for hid, item in chrome_items.items():
            if hid in raw_items_by_hid:
                raw_items_by_hid[hid]["chapter_count"] = item["chapter_count"]
                raw_items_by_hid[hid]["latest_chapter_text"] = item["latest_chapter_text"]
            else:
                raw_items_by_hid[hid] = item
                new_hids_to_translate.add(hid)
        print(f"✓ รวมข้อมูลจาก Chrome DOM สำเร็จ: สะสมทั้งหมด {len(raw_items_by_hid)} เรื่อง")

    # Seed Keywords Search (guarantees targeted titles like Cyberpunk Chivalry are discovered)
    for kw in seed_keywords:
        print(f"▶ [Comix.to - ค้นหาคำค้นเจาะจง] '{kw}' ...")
        try:
            res = call_comix_api("/manga", {
                "keyword": kw,
                "limit": 30,
                "min_chap": 1,
                "max_chap": max_chapters,
            })
            batch = res.get("items", []) if isinstance(res, dict) else []
            total_scanned += len(batch)
            added_kw = 0
            for raw in batch:
                hid = raw.get("hid") or str(raw.get("id") or "")
                if not hid:
                    continue
                item_dict = parse_comix_raw_item(raw, max_chapters)
                if not item_dict:
                    continue
                if hid in raw_items_by_hid:
                    raw_items_by_hid[hid]["chapter_count"] = item_dict["chapter_count"]
                    raw_items_by_hid[hid]["latest_chapter_text"] = item_dict["latest_chapter_text"]
                else:
                    raw_items_by_hid[hid] = item_dict
                    new_hids_to_translate.add(hid)
                    added_kw += 1
            print(f"  ✓ [Comix.to - ค้นหา '{kw}'] เพิ่มใหม่ {added_kw} เรื่อง (รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
        except Exception as e:
            print(f"❌ Error searching Comix for '{kw}': {e}")

    candidates = [
        it for it in raw_items_by_hid.values()
        if 1 <= float(it.get("chapter_count") or 0) <= max_chapters
    ]
    
    # Translate synopses only for items missing translation or freshly discovered
    items_to_translate = [c for c in candidates if not c.get("summary_th") or c.get("id") in new_hids_to_translate]
    if items_to_translate:
        print(f"⚡ [Comix.to] กำลังแปลเรื่องย่อภาษาไทยสำหรับมังงะใหม่ {len(items_to_translate)} เรื่อง...")
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(enrich_comix_item_translation, item): item for item in items_to_translate}
            for f in as_completed(futures):
                res = f.result()
                raw_items_by_hid[res["id"]] = res

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


def crawl_all_project_ideas(max_pages: int = 5, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """Crawl both Mgeko and Comix.to and write unified + separate JSON feeds."""
    if seed_keywords is None:
        seed_keywords = DEFAULT_SEED_KEYWORDS

    mgeko_payload = crawl_mgeko_project_ideas(max_pages=max_pages, max_chapters=max_chapters, seed_keywords=seed_keywords)
    comix_payload = crawl_comix_project_ideas(max_pages_per_feed=3, max_chapters=max_chapters, seed_keywords=seed_keywords)

    combined_payload = {
        **mgeko_payload,
        "sources": {
            "mgeko": mgeko_payload,
            "comix": comix_payload,
        }
    }

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
    print(f"   1. Mgeko (mgeko.cc) : {mgeko_payload['total_candidates']} เรื่อง (สแกน {mgeko_payload['total_scanned']} เรื่อง)")
    print(f"   2. Comix (comix.to) : {comix_payload['total_candidates']} เรื่อง (สแกน {comix_payload['total_scanned']} เรื่อง)")
    print("=" * 95)
    return combined_payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MangaHub Project Ideas Crawler (Mgeko + Comix.to)")
    parser.add_argument("--pages", type=int, default=5, help="Number of Mgeko pagination pages to scan (default: 5)")
    parser.add_argument("--max-chapters", type=int, default=100, help="Maximum chapter count threshold (default: 100)")
    parser.add_argument("--keywords", nargs="*", default=DEFAULT_SEED_KEYWORDS, help="Seed keywords to search and include (default: Cyberpunk Chivalry, Cyberpunk)")
    args = parser.parse_args()

    crawl_all_project_ideas(max_pages=args.pages, max_chapters=args.max_chapters, seed_keywords=args.keywords)

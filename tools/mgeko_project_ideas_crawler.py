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


def crawl_mgeko_project_ideas(max_pages: int = 5, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """Crawl Mgeko recently updated manga and search seed keywords, filtering for <= max_chapters."""
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

    all_raw_candidates = []
    seen_urls = set()
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
                if clean_base_url in seen_urls:
                    continue
                seen_urls.add(clean_base_url)
                all_raw_candidates.append(candidate)
                page_qualified += 1

            print(f"  ✓ [Mgeko หน้า {page}] คัดกรอง <= {max_chapters} ตอนได้ {page_qualified} เรื่อง")

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
                    if clean_base_url in seen_urls:
                        continue
                    seen_urls.add(clean_base_url)
                    all_raw_candidates.append(candidate)
                    added_kw += 1
                print(f"  ✓ [Mgeko - ค้นหา '{kw}'] เพิ่มใหม่ {added_kw} เรื่อง (รวมสะสม {len(all_raw_candidates)} เรื่อง)")
        except Exception as e:
            print(f"❌ Error searching Mgeko for '{kw}': {e}")

    print(f"⚡ [Mgeko] กำลังดึงยอดวิว + แปลเรื่องย่อ {len(all_raw_candidates)} เรื่อง...")
    enriched_candidates = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_manga_detail_and_translate, item, session): item for item in all_raw_candidates}
        for f in as_completed(futures):
            enriched_candidates.append(f.result())

    enriched_candidates.sort(key=lambda x: x.get("views_count", 0), reverse=True)

    genre_counts: Dict[str, int] = {}
    origin_counts: Dict[str, int] = {}
    total_views_portfolio = 0

    for c in enriched_candidates:
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
        "total_candidates": len(enriched_candidates),
        "total_views_sum": total_views_portfolio,
        "origin_distribution": origin_counts,
        "top_genres": sorted_genres,
        "items": enriched_candidates
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


def crawl_comix_project_ideas(max_pages_per_feed: int = 3, max_chapters: int = 100, seed_keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Crawl Comix.to (https://comix.to/) via encrypted API `/api/v1/manga`
    filtering strictly for `1 <= latestChapter <= max_chapters`.
    Combines:
    - Trending 7 days (`order[views_7d]=desc`)
    - Trending 30 days (`order[views_30d]=desc`)
    - Most Followed (`order[follows_total]=desc`)
    - Recently Updated (`order[chapter_updated_at]=desc`)
    - Newly Created (`order[created_at]=desc`)
    - Seed Keywords Search (e.g. Cyberpunk Chivalry)
    so the dataset has rich representation across all chapter ranges (1-5, 6-10 ... 96-100).
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

    feed_configs = [
        ("Trending 7d", {"order[views_7d]": "desc"}, max_pages_per_feed),
        ("Trending 30d", {"order[views_30d]": "desc"}, max_pages_per_feed),
        ("Most Followed", {"order[follows_total]": "desc"}, max_pages_per_feed),
        ("Recently Updated", {"order[chapter_updated_at]": "desc"}, max_pages_per_feed + 2),
        ("Newly Created", {"order[created_at]": "desc"}, 2),
    ]

    raw_items_by_hid: Dict[str, Dict[str, Any]] = {}
    total_scanned = 0

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
                    if not hid or hid in raw_items_by_hid:
                        continue
                    item_dict = parse_comix_raw_item(raw, max_chapters)
                    if not item_dict:
                        continue
                    raw_items_by_hid[hid] = item_dict
                    added += 1
                print(f"  ✓ [Comix.to - {feed_label} หน้า {page}] เพิ่มใหม่ {added} เรื่อง (รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
            except Exception as e:
                print(f"❌ Error fetching Comix.to ({feed_label} page {page}): {e}")

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
                if not hid or hid in raw_items_by_hid:
                    continue
                item_dict = parse_comix_raw_item(raw, max_chapters)
                if not item_dict:
                    continue
                raw_items_by_hid[hid] = item_dict
                added_kw += 1
            print(f"  ✓ [Comix.to - ค้นหา '{kw}'] เพิ่มใหม่ {added_kw} เรื่อง (รวมสะสม {len(raw_items_by_hid)} เรื่อง)")
        except Exception as e:
            print(f"❌ Error searching Comix for '{kw}': {e}")

    candidates = list(raw_items_by_hid.values())
    print(f"⚡ [Comix.to] กำลังแปลเรื่องย่อภาษาไทยสำหรับ {len(candidates)} เรื่อง...")
    enriched_comix = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(enrich_comix_item_translation, item): item for item in candidates}
        for f in as_completed(futures):
            enriched_comix.append(f.result())

    enriched_comix.sort(key=lambda x: x.get("views_count", 0), reverse=True)

    genre_counts: Dict[str, int] = {}
    origin_counts: Dict[str, int] = {}
    total_views_sum = 0

    for c in enriched_comix:
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
        "total_candidates": len(enriched_comix),
        "total_views_sum": total_views_sum,
        "origin_distribution": origin_counts,
        "top_genres": sorted_genres,
        "items": enriched_comix
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

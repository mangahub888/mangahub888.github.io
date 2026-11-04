#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mgeko New Project Ideas Crawler Engine
--------------------------------------
Crawls newly updated manga from https://www.mgeko.cc/jumbo/manga/
Filters strictly for new projects with:
- RULE: NOT MORE THAN 30 CHAPTERS (<= 30 ตอน)

Features:
- Loops through pagination pages (1 to 5)
- Extracts Title, Cover image link, Latest Chapter, Score, Origin, and Update time
- Extracts Total Views count (ยอดวิว) and Bookmarks from manga detail page
- Translates story synopsis to Thai using Google Translate API (เรื่องย่อแปลไทย)
- Sorts candidates by Views count descending (เรียงตามยอดวิวสูงสุด)
- Generates JSON feeds for MangaHub frontend:
  - tools/data/project_ideas_latest.json
  - frontend/src/data/project_ideas_latest.json
  - frontend/public/data/project_ideas_latest.json
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
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")
FRONTEND_DIST_DIR = os.path.join(BASE_DIR, "..", "frontend", "dist", "data")

OUTPUT_FILE = os.path.join(DATA_DIR, "project_ideas_latest.json")

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

def translate_to_thai(text: str) -> str:
    """Translate synopsis from English to Thai using Google Translate API."""
    if not text:
        return ""
    try:
        # Keep chunk size within safe limit for Google Translate single endpoint
        chunk = text[:1500].strip()
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=th&dt=t&q=" + urllib.parse.quote(chunk)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=12) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            translated = "".join([part[0] for part in res[0] if part[0]])
            return translated.strip()
    except Exception as e:
        print(f"⚠️ Google Translate notice: {e}")
        return text

def clean_time_updated(raw_time: str) -> str:
    """Clean raw update time string."""
    if not raw_time:
        return ""
    cleaned = raw_time.replace("update", "").replace("Added", "").replace("", " ").strip()
    return f"อัปเดตเมื่อ {cleaned}" if cleaned else ""

def fetch_manga_detail_and_translate(item: Dict[str, Any], session: requests.Session) -> Dict[str, Any]:
    """Fetch synopsis, views, and genres, then translate synopsis to Thai."""
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

            # Translate to Thai via Google Translate API
            summary_th = ""
            if summary_en:
                summary_th = translate_to_thai(summary_en)

            # Status from detail page
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

            # Refine origin based on genres
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

def crawl_mgeko_project_ideas(max_pages: int = 5, max_chapters: int = 30) -> Dict[str, Any]:
    """Crawl Mgeko recently updated manga and filter for candidates with <= max_chapters."""
    now = datetime.now()
    crawled_at = now.isoformat()
    session = requests.Session()

    print("=" * 80)
    print(f"🚀 Mgeko New Project Ideas Crawler Engine")
    print(f"   เป้าหมาย: https://www.mgeko.cc/jumbo/manga/ (สแกน {max_pages} หน้า)")
    print(f"   กฎคัดกรอง: เฉพาะเรื่องที่มีไม่เกิน {max_chapters} ตอน (<= {max_chapters} ตอน)")
    print(f"   ฟีเจอร์: ดึงยอดวิว + แปลเรื่องย่อด้วย Google Translate API + เรียงตามยอดวิว")
    print("=" * 80)

    all_raw_candidates = []
    seen_urls = set()
    total_scanned_count = 0

    for page in range(1, max_pages + 1):
        if page == 1:
            page_url = 'https://www.mgeko.cc/jumbo/manga/'
        else:
            page_url = f'https://www.mgeko.cc/jumbo/manga/?results={page}&filter=All'

        print(f"\n▶ กำลังดึงข้อมูลหน้า {page}/{max_pages}: {page_url} ...")
        try:
            r = session.get(page_url, headers=DEFAULT_HEADERS, timeout=20)
            if r.status_code != 200:
                print(f"⚠️ หน้า {page} ตอบกลับด้วย HTTP Status {r.status_code}")
                continue

            doc = lxml.html.fromstring(r.text)
            items = doc.xpath('//li[contains(@class, "novel-item") and not(contains(@class, "swiper-slide"))]')
            print(f"  ✓ พบมังงะอัปเดตใหม่ทั้งหมดในหน้านี้: {len(items)} เรื่อง")
            total_scanned_count += len(items)

            page_qualified = 0
            for it in items:
                a_tags = it.xpath('.//a')
                if not a_tags:
                    continue
                a = a_tags[0]
                href = a.get('href', '')
                if not href:
                    continue
                if not href.startswith('http'):
                    href = 'https://www.mgeko.cc' + href

                clean_base_url = href.split('/all-chapters/')[0].split('/chapter-')[0]
                if clean_base_url in seen_urls:
                    continue
                seen_urls.add(clean_base_url)

                title_el = it.xpath('.//*[contains(@class, "novel-title")]')
                title = title_el[0].text_content().strip() if title_el else (a.get('title') or '').strip()

                ch_el = it.xpath('.//*[contains(@class, "chapter-title")]')
                ch_raw = ch_el[0].text_content().strip() if ch_el else ''
                ch_num = parse_chapter_num(ch_raw)

                # RULE FILTER: Must be <= max_chapters and > 0
                if ch_num <= 0 or ch_num > max_chapters:
                    continue

                img_el = it.xpath('.//img')
                cover = ''
                if img_el:
                    cover = img_el[0].get('data-src') or img_el[0].get('src') or ''

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

                all_raw_candidates.append({
                    "id": manga_id,
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
                })
                page_qualified += 1

            print(f"  ✓ มีตอนไม่เกิน {max_chapters} ตอนในหน้านี้: {page_qualified} เรื่อง")

        except Exception as e:
            print(f"❌ Error crawling page {page}: {e}")

    print("\n" + "=" * 80)
    print(f"🎯 รวมพบเรื่องที่มีไม่เกิน {max_chapters} ตอนทั้งหมด: {len(all_raw_candidates)} เรื่อง (จากที่สแกน {total_scanned_count} เรื่อง)")
    print("⚡ กำลังดึงยอดวิว + แปลเรื่องย่อด้วย Google Translate API แบบขนาน...")
    print("=" * 80)

    enriched_candidates = []
    start_enrich = time.time()
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_manga_detail_and_translate, item, session): item for item in all_raw_candidates}
        for f in as_completed(futures):
            res = f.result()
            enriched_candidates.append(res)

    enrich_time = time.time() - start_enrich
    print(f"✓ ดึงยอดวิวและแปลเรื่องย่อครบทั้ง {len(enriched_candidates)} เรื่อง สำเร็จในเวลา {enrich_time:.2f} วินาที!")

    # Sort strictly by VIEWS COUNT descending (เรียงตามยอดวิวสูงสุด)
    enriched_candidates.sort(key=lambda x: x.get("views_count", 0), reverse=True)

    # Compute genre & origin distribution
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

    output_payload = {
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

    # Save to disk
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกผลลัพธ์ลงใน: {OUTPUT_FILE}")

    for out_dir in [FRONTEND_SRC_DIR, FRONTEND_PUB_DIR, FRONTEND_DIST_DIR]:
        if os.path.exists(out_dir):
            target = os.path.join(out_dir, "project_ideas_latest.json")
            try:
                with open(target, "w", encoding="utf-8") as f:
                    json.dump(output_payload, f, ensure_ascii=False, indent=2)
                print(f"✓ อัปเดตข้อมูลไปยัง Frontend: {target}")
            except Exception as e:
                print(f"⚠️ บันทึกไปยัง {target} ล้มเหลว: {e}")

    # Print Leaderboard sorted by Views
    print("\n" + "=" * 95)
    print("🏆 อันดับมังงะไอเดียใหม่ (<= 30 ตอน) เรียงตามยอดวิวสูงสุด:")
    print("=" * 95)
    print(f"{'อันดับ':<6} | {'ชื่อเรื่อง':<38} | {'สัญชาติ':<13} | {'ตอน':<7} | {'ยอดวิวรวม':>12} | {'หมวดหมู่'}")
    print("-" * 95)
    for idx, c in enumerate(enriched_candidates[:15], 1):
        genres_str = ", ".join(c.get("genres", [])[:2]) or "General"
        v_str = f"{c.get('views_count', 0):,} วิว ({c.get('views_text')})"
        print(f"#{idx:<5} | {c.get('title')[:36]:<38} | {c.get('origin'):<13} | Ch.{c.get('chapter_count'):<4} | {v_str:>12} | {genres_str}")
        if c.get("summary_th"):
            print(f"        🇹🇭 เรื่องย่อแปลไทย: {c.get('summary_th')[:90]}...")

    return output_payload

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mgeko Project Ideas Crawler")
    parser.add_argument("--pages", type=int, default=5, help="Number of pagination pages to scan (default: 5)")
    parser.add_argument("--max-chapters", type=int, default=30, help="Maximum chapter count threshold (default: 30)")
    args = parser.parse_args()

    crawl_mgeko_project_ideas(max_pages=args.pages, max_chapters=args.max_chapters)

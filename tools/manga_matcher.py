#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MangaHub MangaSetting Filter & Matcher Engine
---------------------------------------------
Matches platform comic titles against active MangaSetting projects.
Only tracks stories that exist in MangaSetting; skips deleted/inactive projects.
"""

import os
import re
import json
import urllib.request
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MANGA_CACHE_FILE = os.path.join(DATA_DIR, "manga_list_cache.json")
DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"

def normalize_title(text: str) -> str:
    """Normalize comic title for robust Thai similarity matching."""
    if not text:
        return ""
    # 1. Strip text after pipe separator
    t = text.split('|')[0].strip()
    # 2. Strip English suffix appended without pipe (e.g., 'ชื่อไทย English Title')
    m = re.search(r'([\u0E00-\u0E7F\s:;!?,~*()\-]+?)(?=[A-Za-z]{3,})', t)
    if m and len(m.group(1).strip()) > 3:
        t = m.group(1).strip()
    # 3. Extract Thai characters and numbers
    thai_only = re.sub(r'[^0-9\u0E00-\u0E7F]', '', t)
    if thai_only:
        return thai_only
    # 4. Fallback to alphanumeric lowercase for non-Thai titles
    return re.sub(r'[^a-zA-Z0-9]', '', t).lower()

def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()

_CACHED_MANGA_SETTING = None

def get_manga_setting(gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE, force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Fetch active MangaList from GAS or load from local cache."""
    global _CACHED_MANGA_SETTING
    if _CACHED_MANGA_SETTING is not None and not force_refresh:
        return _CACHED_MANGA_SETTING

    manga_list = []
    # Try fetching fresh from GAS
    try:
        payload = {"action": "GET_MANGA_LIST", "passcode": passcode}
        req = urllib.request.Request(
            gas_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=12) as res:
            data = json.loads(res.read().decode("utf-8"))
            manga_list = data.get("data") or data.get("mangaList") or []
            if manga_list:
                os.makedirs(DATA_DIR, exist_ok=True)
                with open(MANGA_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(manga_list, f, ensure_ascii=False, indent=2)
                _CACHED_MANGA_SETTING = manga_list
                return manga_list
    except Exception as e:
        # Fallback to local cache if offline or timeout
        pass

    # Read from cache
    if os.path.exists(MANGA_CACHE_FILE):
        try:
            with open(MANGA_CACHE_FILE, "r", encoding="utf-8") as f:
                manga_list = json.load(f)
        except Exception:
            manga_list = []

    _CACHED_MANGA_SETTING = manga_list
    return manga_list

def match_manga_setting(platform_title: str, manga_list: Optional[List[Dict[str, Any]]] = None, threshold: float = 0.85) -> Tuple[Optional[Dict[str, Any]], float]:
    """Check if a platform title matches any active MangaSetting story with similarity >= threshold."""
    if manga_list is None:
        manga_list = get_manga_setting()

    p_norm = normalize_title(platform_title)
    if not p_norm:
        return None, 0.0

    best_m = None
    best_score = 0.0

    for m in manga_list:
        m_name = (m.get("manganame") or m.get("MangaName") or "").strip()
        m_norm = normalize_title(m_name)
        if not m_norm:
            continue

        score = similarity(p_norm, m_norm)
        if score > best_score:
            best_score = score
            best_m = m

    if best_score >= threshold:
        return best_m, best_score
    return None, best_score

def filter_comics_by_manga_setting(
    comics: List[Dict[str, Any]],
    title_key: str = "subject",
    threshold: float = 0.85,
    platform_name: str = "Platform"
) -> List[Dict[str, Any]]:
    """Filter platform comics, keeping only those that match active MangaSetting projects."""
    manga_list = get_manga_setting()
    if not manga_list:
        print(f"⚠️ [MangaFilter] ไม่พบรายการ MangaSetting ข้ามขั้นตอนการกรอง")
        return comics

    filtered = []
    skipped = []
    seen_manga_ids = set()

    for c in comics:
        title = c.get(title_key) or c.get("name") or c.get("title") or ""
        matched_manga, score = match_manga_setting(title, manga_list, threshold=threshold)
        if matched_manga:
            mid = matched_manga.get("mangaid") or matched_manga.get("MangaID")
            c["matched_manga_id"] = mid
            c["canonical_title"] = matched_manga.get("manganame") or matched_manga.get("MangaName")
            c["match_score"] = round(score, 3)
            seen_manga_ids.add(mid)
            filtered.append(c)
        else:
            skipped.append((title, round(score, 3)))

    print(f"🎯 [{platform_name}] กรองตาม MangaSetting (เกณฑ์ >={int(threshold*100)}%):")
    print(f"   ✓ พบเรื่องที่เปิดใช้งาน: {len(filtered)} เรื่อง")
    print(f"   ⏭️ ข้ามเรื่องที่ลบ/ไม่มีในระบบ: {len(skipped)} เรื่อง (ประหยัดเวลาการประมวลผล)")

    return filtered

if __name__ == "__main__":
    ml = get_manga_setting()
    print(f"MangaSetting loaded: {len(ml)} projects")

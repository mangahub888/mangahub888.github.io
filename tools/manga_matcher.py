#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MangaHub MangaSetting Filter & Matcher Engine
---------------------------------------------
Matches platform comic titles against active MangaSetting projects.
Only tracks stories that exist in MangaSetting with similarity > threshold (default 80%);
skips deleted/inactive projects and respects per-manga Platforms configuration.
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
DEFAULT_MATCH_THRESHOLD = 0.80


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


def _meets_threshold(score: float, threshold: float, strict: bool = True) -> bool:
    """Return True if score satisfies threshold (> threshold when strict and threshold > 0)."""
    if strict and threshold > 0.0:
        return score > threshold
    return score >= threshold


def infer_platform_key(platform_name: Optional[str]) -> Optional[str]:
    """Infer canonical platform key ('readrealm', 'kairew', 'chaply') from a display label."""
    if not platform_name:
        return None
    low = platform_name.strip().lower()
    if "readrealm" in low:
        return "readrealm"
    if "kairew" in low:
        return "kairew"
    if "chaply" in low:
        return "chaply"
    return None


def is_platform_enabled(manga: Dict[str, Any], platform_key: Optional[str]) -> bool:
    """Check whether a MangaSetting entry has the given platform enabled in its Platforms field."""
    if not platform_key:
        return True
    raw_plats = manga.get("platforms")
    if raw_plats is None or (isinstance(raw_plats, str) and not raw_plats.strip()):
        raw_plats = manga.get("Platforms")
    if raw_plats is None:
        return True

    if isinstance(raw_plats, list):
        tokens = [str(p).strip().lower() for p in raw_plats if str(p).strip()]
    else:
        tokens = [p.strip().lower() for p in re.split(r'[,;/|]+', str(raw_plats)) if p.strip()]

    if not tokens:
        return True
    return platform_key.strip().lower() in tokens


_CACHED_MANGA_SETTING = None


def get_manga_setting(gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE, force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Fetch active MangaList from GAS or load from local cache."""
    global _CACHED_MANGA_SETTING
    if _CACHED_MANGA_SETTING is not None and not force_refresh:
        return _CACHED_MANGA_SETTING

    manga_list = []
    if not force_refresh and os.path.exists(MANGA_CACHE_FILE):
        try:
            with open(MANGA_CACHE_FILE, "r", encoding="utf-8") as f:
                _CACHED_MANGA_SETTING = json.load(f)
                return _CACHED_MANGA_SETTING
        except Exception:
            pass

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
    except Exception:
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


_MAPPINGS_LOOKUP = None


def _get_mappings_lookup() -> Dict[str, Dict[str, Any]]:
    global _MAPPINGS_LOOKUP
    if _MAPPINGS_LOOKUP is not None:
        return _MAPPINGS_LOOKUP
    _MAPPINGS_LOOKUP = {}
    map_file = os.path.join(DATA_DIR, "comic_cross_platform_mapping.json")
    if os.path.exists(map_file):
        try:
            with open(map_file, "r", encoding="utf-8") as f:
                mappings = json.load(f).get("mappings", [])
                for item in mappings:
                    ckey = item.get("canonical_key") or normalize_title(item.get("canonical_title", ""))
                    if ckey:
                        _MAPPINGS_LOOKUP[ckey] = item
                    for alias in item.get("aliases", []):
                        akey = normalize_title(alias)
                        if akey and akey not in _MAPPINGS_LOOKUP:
                            _MAPPINGS_LOOKUP[akey] = item
        except Exception:
            pass
    return _MAPPINGS_LOOKUP


def match_manga_setting(
    platform_title: str,
    manga_list: Optional[List[Dict[str, Any]]] = None,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    strict: bool = True,
    platform_key: Optional[str] = None
) -> Tuple[Optional[Dict[str, Any]], float]:
    """Check if a platform title matches any active MangaSetting story with similarity > threshold."""
    if manga_list is None:
        manga_list = get_manga_setting()

    if not platform_title:
        return None, 0.0

    candidates = [platform_title]
    if '|' in platform_title:
        for part in platform_title.split('|'):
            p_strip = part.strip()
            if p_strip and p_strip not in candidates:
                candidates.append(p_strip)

    best_m = None
    best_score = 0.0

    # 1. Direct candidate matching
    for cand in candidates:
        p_norm = normalize_title(cand)
        if not p_norm:
            continue

        for m in manga_list:
            m_name = (m.get("manganame") or m.get("MangaName") or "").strip()
            m_norm = normalize_title(m_name)
            if not m_norm:
                continue

            if p_norm == m_norm:
                if platform_key and not is_platform_enabled(m, platform_key):
                    return None, 1.0
                return m, 1.0

            score = similarity(p_norm, m_norm)
            if score > best_score:
                best_score = score
                best_m = m

    if best_m is not None and _meets_threshold(best_score, threshold, strict=strict):
        if platform_key and not is_platform_enabled(best_m, platform_key):
            return None, best_score
        return best_m, best_score

    # 2. Fast mapping lookup using normalized keys
    lookup = _get_mappings_lookup()
    for cand in candidates:
        p_norm = normalize_title(cand)
        if p_norm and p_norm in lookup:
            map_item = lookup[p_norm]
            c_title = map_item.get("canonical_title", "")
            c_norm = normalize_title(c_title)
            for m in manga_list:
                m_name = (m.get("manganame") or m.get("MangaName") or "").strip()
                m_norm = normalize_title(m_name)
                if m_norm == c_norm or _meets_threshold(similarity(m_norm, c_norm), threshold, strict=strict):
                    if platform_key and not is_platform_enabled(m, platform_key):
                        return None, 1.0
                    return m, 1.0

    return None, best_score


def filter_comics_by_manga_setting(
    comics: List[Dict[str, Any]],
    title_key: str = "subject",
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    platform_name: str = "Platform",
    platform_key: Optional[str] = None,
    strict: bool = True,
    force_refresh: bool = False
) -> List[Dict[str, Any]]:
    """Filter platform comics, keeping only those that match active MangaSetting projects (> threshold)
    and are enabled for the target platform."""
    manga_list = get_manga_setting(force_refresh=force_refresh)
    if not manga_list:
        print(f"⚠️ [MangaFilter] ไม่พบรายการ MangaSetting ข้ามขั้นตอนการกรอง")
        return comics

    resolved_platform_key = platform_key or infer_platform_key(platform_name)

    filtered = []
    skipped_unmatched = []
    skipped_platform = []
    seen_manga_ids = set()

    for c in comics:
        title = c.get(title_key) or c.get("name") or c.get("title") or ""
        matched_manga, score = match_manga_setting(
            title,
            manga_list,
            threshold=threshold,
            strict=strict
        )
        if matched_manga:
            if resolved_platform_key and not is_platform_enabled(matched_manga, resolved_platform_key):
                skipped_platform.append((title, matched_manga.get("manganame") or matched_manga.get("MangaName") or "", round(score, 3)))
                continue
            mid = matched_manga.get("mangaid") or matched_manga.get("MangaID")
            c["matched_manga_id"] = mid
            c["canonical_title"] = matched_manga.get("manganame") or matched_manga.get("MangaName")
            c["match_score"] = round(score, 3)
            seen_manga_ids.add(mid)
            filtered.append(c)
        else:
            skipped_unmatched.append((title, round(score, 3)))

    op_label = ">" if (strict and threshold > 0.0) else ">="
    pct_label = int(round(threshold * 100))
    total_skipped = len(skipped_unmatched) + len(skipped_platform)

    print(f"🎯 [{platform_name}] กรองตาม MangaSetting (เกณฑ์แมทช์ {op_label} {pct_label}%):")
    print(f"   ✓ ดึงข้อมูล (ผ่านเกณฑ์): {len(filtered)}/{len(comics)} เรื่อง")
    if skipped_platform:
        print(f"   ⏭️ ข้ามทั้งหมด: {total_skipped} เรื่อง (ลบโปรเจกต์/แมทช์ <={pct_label}%: {len(skipped_unmatched)} | ปิดแพลตฟอร์มนี้ใน Settings: {len(skipped_platform)})")
    else:
        print(f"   ⏭️ ข้ามเรื่องที่ลบ/แมทช์ <={pct_label}%: {total_skipped} เรื่อง (skip ทันที ไม่เข้าไปดึงข้อมูล)")

    return filtered


if __name__ == "__main__":
    ml = get_manga_setting()
    print(f"MangaSetting loaded: {len(ml)} projects (default threshold > {int(DEFAULT_MATCH_THRESHOLD * 100)}%)")

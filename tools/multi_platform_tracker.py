#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Platform 6-Hour Growth Tracker Engine
-------------------------------------------
Runs automated 6-hour growth tracking for all platforms:
1. ReadRealm (LionKing + Adieu accounts)
2. Kairew (แปลจนเมื่อย account)
3. Chaply (แปลจนเมื่อย account)

Calculates:
- 7-day & 30-day delta and growth rate (% เติบโต) based on our recording dates
- Inactivity classification (no new chapter > 30 days)
- Overwrites Google Sheet current snapshot (Strategy 3+1: Zero Sheet Bloat)
- Stores full historical timeline in Git JSON
- Generates unified multi-platform snapshot for MangaHub dashboard
"""

import os
import sys
import time
import json
import argparse
import subprocess
from datetime import datetime, timezone
from typing import Dict, Any, List

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")

DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"
DEFAULT_MIN_MATCH = 0.80

READREALM_LATEST = os.path.join(DATA_DIR, "readrealm_growth_latest.json")
KAIREW_LATEST = os.path.join(DATA_DIR, "kairew_growth_latest.json")
CHAPLY_LATEST = os.path.join(DATA_DIR, "chaply_growth_latest.json")
UNIFIED_LATEST = os.path.join(DATA_DIR, "multi_platform_growth_latest.json")
MONTHLY_SUMMARY_MD = os.path.join(DATA_DIR, "MONTHLY_SUMMARY_2026.md")
MAPPING_FILE = os.path.join(DATA_DIR, "comic_cross_platform_mapping.json")

TARGET_YEAR = 2026
THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
]
THAI_MONTH_TO_NUM = {m: idx + 1 for idx, m in enumerate(THAI_MONTHS)}
MONTH_KEYS_2026 = [f"{TARGET_YEAR}-{m:02d}" for m in range(1, 13)]


def normalize_monthly_sales_2026(raw_monthly: Any, year: int = TARGET_YEAR) -> Dict[str, float]:
    """Normalize monthly sales dict (Thai month names or YYYY-MM) to standard YYYY-01..YYYY-12 keys."""
    result = {f"{year}-{m:02d}": 0.0 for m in range(1, 13)}
    if not isinstance(raw_monthly, dict):
        return result
    for k, v in raw_monthly.items():
        try:
            val = round(float(v or 0.0), 2)
        except (ValueError, TypeError):
            val = 0.0
        k_str = str(k).strip()
        if k_str in result:
            result[k_str] = val
        elif k_str in THAI_MONTH_TO_NUM:
            ym_key = f"{year}-{THAI_MONTH_TO_NUM[k_str]:02d}"
            result[ym_key] = val
    return result


def monthly_2026_to_thai(monthly_2026: Dict[str, float], year: int = TARGET_YEAR) -> Dict[str, float]:
    """Convert standard YYYY-01..YYYY-12 monthly_sales dict to Thai month names."""
    return {
        THAI_MONTHS[m - 1]: round(float(monthly_2026.get(f"{year}-{m:02d}", 0.0) or 0.0), 2)
        for m in range(1, 13)
    }


def sum_monthly_dicts(dicts: List[Dict[str, float]], year: int = TARGET_YEAR) -> Dict[str, float]:
    """Sum a list of YYYY-01..YYYY-12 monthly_sales dicts."""
    keys = [f"{year}-{m:02d}" for m in range(1, 13)]
    out = {k: 0.0 for k in keys}
    for d in dicts:
        if not isinstance(d, dict):
            continue
        for k in keys:
            out[k] = round(out[k] + float(d.get(k, 0.0) or 0.0), 2)
    return out


def generate_monthly_summary_markdown(unified_output: Dict[str, Any], out_path: str = MONTHLY_SUMMARY_MD) -> str:
    """Generate tools/data/MONTHLY_SUMMARY_2026.md covering Months 1-12/2026 across all 3 platforms."""
    recorded_at = unified_output.get("pipeline_recorded_at", "")
    date_ref = unified_output.get("date_reference", "")
    breakdown = unified_output.get("platforms_breakdown", {})
    port_monthly = unified_output.get("portfolio_monthly_sales_2026", {})
    comics_monthly = unified_output.get("comics_monthly_summary_2026", [])

    rr_m = (breakdown.get("readrealm") or {}).get("monthly_sales", {})
    kr_m = (breakdown.get("kairew") or {}).get("monthly_sales", {})
    ch_m = (breakdown.get("chaply") or {}).get("monthly_sales", {})

    lines = [
        f"# 📊 สรุปยอดขายรายเดือน ปี 2569 (2026) — ครบทั้ง 3 แพลตฟอร์ม",
        "",
        f"- **อัปเดตล่าสุด:** `{recorded_at}` (วันที่อ้างอิง: `{date_ref}`)",
        f"- **ยอดขายสะสมรวมทั้งพอร์ต:** `{unified_output.get('total_sales_portfolio', 0.0):,.2f}` บาท",
        f"- **ยอดวิวสะสมรวมทั้งพอร์ต:** `{unified_output.get('total_views_portfolio', 0):,}` วิว",
        f"- **จำนวนการ์ตูนในพอร์ต:** `{unified_output.get('total_comics', 0)}` รายการ (รวม `{len(comics_monthly)}` เรื่องหลัก)",
        "",
        "## 1. สรุปยอดขายรายเดือนทั้งพอร์ต (เดือน 1–12 ปี 2569 / 2026)",
        "",
        "| เดือน (2026) | ReadRealm (฿) | Kairew (฿) | Chaply (฿) | รวมทั้งพอร์ต (฿) |",
        "| :--- | ---: | ---: | ---: | ---: |",
    ]

    tot_rr = tot_kr = tot_ch = tot_all = 0.0
    for idx, ym in enumerate(MONTH_KEYS_2026):
        th_name = THAI_MONTHS[idx]
        v_rr = float(rr_m.get(ym, 0.0) or 0.0)
        v_kr = float(kr_m.get(ym, 0.0) or 0.0)
        v_ch = float(ch_m.get(ym, 0.0) or 0.0)
        v_all = float(port_monthly.get(ym, 0.0) or 0.0)
        tot_rr += v_rr
        tot_kr += v_kr
        tot_ch += v_ch
        tot_all += v_all
        lines.append(f"| {ym} ({th_name}) | {v_rr:,.2f} | {v_kr:,.2f} | {v_ch:,.2f} | **{v_all:,.2f}** |")

    lines.append(f"| **รวมทั้งปี 2026** | **{tot_rr:,.2f}** | **{tot_kr:,.2f}** | **{tot_ch:,.2f}** | **{tot_all:,.2f}** |")
    lines.extend([
        "",
        "## 2. สรุปยอดขายรายเดือน 1–12/2026 แยกรายเรื่อง (รวมทุกแพลตฟอร์ม)",
        "",
        "| # | ชื่อเรื่อง (Canonical) | แพลตฟอร์ม | ม.ค. | ก.พ. | มี.ค. | เม.ย. | พ.ค. | มิ.ย. | ก.ค. | ส.ค. | ก.ย. | ต.ค. | พ.ย. | ธ.ค. | รวม 2026 (฿) |",
        "| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])

    for i, item in enumerate(comics_monthly, 1):
        title = str(item.get("canonical_title") or "").replace("|", "/")
        plats = ", ".join(item.get("platforms", []))
        m_map = item.get("monthly_sales", {})
        m_cells = [f"{float(m_map.get(ym, 0.0) or 0.0):,.0f}" for ym in MONTH_KEYS_2026]
        total_2026 = float(item.get("total_sales_2026", 0.0) or 0.0)
        lines.append(f"| {i} | {title} | {plats} | " + " | ".join(m_cells) + f" | **{total_2026:,.2f}** |")

    content = "\n".join(lines) + "\n"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)
    return out_path


def load_cross_platform_mappings() -> List[Dict[str, Any]]:
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, "r", encoding="utf-8") as f:
                return json.load(f).get("mappings", [])
        except Exception as e:
            print(f"⚠️ Failed to load cross platform mapping: {e}")
    return []


def run_script(script_name: str, args: List[str]) -> bool:
    """Run an individual platform tracker script."""
    cmd = [sys.executable, os.path.join(BASE_DIR, script_name)] + args
    print(f"\n▶ กำลังรัน {script_name}...")
    start_t = time.time()
    try:
        res = subprocess.run(cmd, cwd=os.path.join(BASE_DIR, ".."), capture_output=False)
        elapsed = time.time() - start_t
        if res.returncode == 0:
            print(f"✓ {script_name} ทำงานสำเร็จ (ใช้เวลา {elapsed:.1f} วินาที)")
            return True
        else:
            print(f"❌ {script_name} เกิดข้อผิดพลาด (Exit code: {res.returncode})")
            return False
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดในการเรียก {script_name}: {e}")
        return False


def consolidate_multi_platform_data(min_match: float = DEFAULT_MIN_MATCH) -> Dict[str, Any]:
    """Merge latest snapshots from ReadRealm, Kairew, and Chaply into unified format."""
    now = datetime.now(timezone.utc)
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")

    unified_comics = []
    breakdown = {}
    rr_comics: List[Dict[str, Any]] = []
    kr_comics: List[Dict[str, Any]] = []
    ch_comics: List[Dict[str, Any]] = []
    rr_data: Dict[str, Any] = {}

    total_sales_portfolio = 0.0
    total_views_portfolio = 0
    total_comics_count = 0
    total_inactive_30d = 0
    total_active_30d = 0

    sys.path.append(BASE_DIR)
    from manga_matcher import get_manga_setting, match_manga_setting, normalize_title
    manga_setting_list = get_manga_setting()

    mappings = load_cross_platform_mappings()

    def apply_cross_platform_canonical(c: Dict[str, Any], platform_name: str):
        sub = c.get("subject") or c.get("name") or c.get("title") or ""
        matched_m, score = match_manga_setting(
            sub,
            manga_setting_list,
            threshold=min_match,
            platform_key=platform_name
        )
        if matched_m:
            c["canonical_title"] = matched_m.get("manganame") or matched_m.get("MangaName")
            c["cross_platform_key"] = normalize_title(c["canonical_title"])
            c["matched_manga_id"] = matched_m.get("mangaid") or matched_m.get("MangaID")
            c["match_score"] = round(score, 3)
            return

        cid = str(c.get("comic_id") or c.get("id") or "")
        for m in mappings:
            plat_info = m.get("platforms", {}).get(platform_name, {})
            if plat_info.get("comic_id") and str(plat_info.get("comic_id")) == cid:
                c["canonical_title"] = m.get("canonical_title")
                c["cross_platform_key"] = m.get("canonical_key")
                return
            for alias in m.get("aliases", []):
                if alias.lower() in sub.lower() or sub.lower() in alias.lower():
                    c["canonical_title"] = m.get("canonical_title")
                    c["cross_platform_key"] = m.get("canonical_key")
                    return
        c["canonical_title"] = sub.split('|')[0].strip()
        c["cross_platform_key"] = normalize_title(sub)

    pct_label = int(round(min_match * 100))

    # 1. ReadRealm
    if os.path.exists(READREALM_LATEST):
        try:
            with open(READREALM_LATEST, "r", encoding="utf-8") as f:
                rr_data = json.load(f)
            raw_rr = rr_data.get("comics", [])
            rr_comics = [
                c for c in raw_rr
                if match_manga_setting(
                    c.get("subject", ""),
                    manga_setting_list,
                    threshold=min_match,
                    platform_key="readrealm"
                )[0] is not None
            ]
            rr_skipped = len(raw_rr) - len(rr_comics)
            print(f"🎯 [Consolidate ReadRealm] ดึงเข้าพอร์ต: {len(rr_comics)} เรื่อง | ข้าม (ไม่ตรง Settings/แมทช์ <={pct_label}%): {rr_skipped} เรื่อง")
            for c in rr_comics:
                c["platform"] = "readrealm"
                c["monthly_sales"] = normalize_monthly_sales_2026(c.get("monthly_sales"), year=TARGET_YEAR)
                c["monthly_sales_th"] = monthly_2026_to_thai(c["monthly_sales"], year=TARGET_YEAR)
                apply_cross_platform_canonical(c, "readrealm")
                unified_comics.append(c)

            rr_sales = round(sum(float(c.get("total_sales", 0.0) or 0.0) for c in rr_comics), 2)
            rr_views = sum(int(c.get("total_views", 0) or 0) for c in rr_comics)
            rr_inactive = sum(1 for c in rr_comics if c.get("is_inactive_30d"))
            rr_active = len(rr_comics) - rr_inactive
            rr_monthly = sum_monthly_dicts([c["monthly_sales"] for c in rr_comics], year=TARGET_YEAR)

            breakdown["readrealm"] = {
                "name": "ReadRealm",
                "sales": rr_sales,
                "views": rr_views,
                "comics_count": len(rr_comics),
                "inactive_30d": rr_inactive,
                "active_30d": rr_active,
                "monthly_sales": rr_monthly,
                "last_recorded": rr_data.get("pipeline_recorded_at", recorded_at)
            }
            total_sales_portfolio += rr_sales
            total_views_portfolio += rr_views
            total_inactive_30d += rr_inactive
            total_active_30d += rr_active
        except Exception as e:
            print(f"⚠️ Error reading ReadRealm latest data: {e}")

    # 2. Kairew
    if os.path.exists(KAIREW_LATEST):
        try:
            with open(KAIREW_LATEST, "r", encoding="utf-8") as f:
                kr_data = json.load(f)
            raw_kr = kr_data.get("comics", [])
            kr_comics = [
                c for c in raw_kr
                if match_manga_setting(
                    c.get("name") or c.get("subject") or "",
                    manga_setting_list,
                    threshold=min_match,
                    platform_key="kairew"
                )[0] is not None
            ]
            kr_skipped = len(raw_kr) - len(kr_comics)
            print(f"🎯 [Consolidate Kairew] ดึงเข้าพอร์ต: {len(kr_comics)} เรื่อง | ข้าม (ไม่ตรง Settings/แมทช์ <={pct_label}%): {kr_skipped} เรื่อง")
            for c in kr_comics:
                c["platform"] = "kairew"
                c["monthly_sales"] = normalize_monthly_sales_2026(c.get("monthly_sales"), year=TARGET_YEAR)
                c["monthly_sales_th"] = monthly_2026_to_thai(c["monthly_sales"], year=TARGET_YEAR)
                apply_cross_platform_canonical(c, "kairew")
                unified_comics.append(c)

            kr_sales = round(sum(float(c.get("total_sales", 0.0) or 0.0) for c in kr_comics), 2)
            kr_views = sum(int(c.get("total_views", 0) or 0) for c in kr_comics)
            kr_inactive = sum(1 for c in kr_comics if c.get("is_inactive_30d"))
            kr_active = len(kr_comics) - kr_inactive
            kr_monthly = sum_monthly_dicts([c["monthly_sales"] for c in kr_comics], year=TARGET_YEAR)

            breakdown["kairew"] = {
                "name": "Kairew",
                "sales": kr_sales,
                "views": kr_views,
                "comics_count": len(kr_comics),
                "inactive_30d": kr_inactive,
                "active_30d": kr_active,
                "monthly_sales": kr_monthly,
                "last_recorded": kr_data.get("pipeline_recorded_at", recorded_at)
            }
            total_sales_portfolio += kr_sales
            total_views_portfolio += kr_views
            total_inactive_30d += kr_inactive
            total_active_30d += kr_active
        except Exception as e:
            print(f"⚠️ Error reading Kairew latest data: {e}")

    # 3. Chaply
    if os.path.exists(CHAPLY_LATEST):
        try:
            with open(CHAPLY_LATEST, "r", encoding="utf-8") as f:
                ch_data = json.load(f)
            raw_ch = ch_data.get("comics", [])
            ch_comics = [
                c for c in raw_ch
                if match_manga_setting(
                    c.get("subject") or c.get("title") or "",
                    manga_setting_list,
                    threshold=min_match,
                    platform_key="chaply"
                )[0] is not None
            ]
            ch_skipped = len(raw_ch) - len(ch_comics)
            print(f"🎯 [Consolidate Chaply] ดึงเข้าพอร์ต: {len(ch_comics)} เรื่อง | ข้าม (ไม่ตรง Settings/แมทช์ <={pct_label}%): {ch_skipped} เรื่อง")
            for c in ch_comics:
                c["platform"] = "chaply"
                c["monthly_sales"] = normalize_monthly_sales_2026(c.get("monthly_sales"), year=TARGET_YEAR)
                c["monthly_sales_th"] = monthly_2026_to_thai(c["monthly_sales"], year=TARGET_YEAR)
                apply_cross_platform_canonical(c, "chaply")
                unified_comics.append(c)

            ch_sales = round(sum(float(c.get("total_sales", 0.0) or 0.0) for c in ch_comics), 2)
            ch_views = sum(int(c.get("total_views", 0) or 0) for c in ch_comics)
            ch_inactive = sum(1 for c in ch_comics if c.get("is_inactive_30d"))
            ch_active = len(ch_comics) - ch_inactive
            ch_monthly = sum_monthly_dicts([c["monthly_sales"] for c in ch_comics], year=TARGET_YEAR)

            breakdown["chaply"] = {
                "name": "Chaply",
                "sales": ch_sales,
                "views": ch_views,
                "comics_count": len(ch_comics),
                "inactive_30d": ch_inactive,
                "active_30d": ch_active,
                "monthly_sales": ch_monthly,
                "last_recorded": ch_data.get("pipeline_recorded_at", recorded_at)
            }
            total_sales_portfolio += ch_sales
            total_views_portfolio += ch_views
            total_inactive_30d += ch_inactive
            total_active_30d += ch_active
        except Exception as e:
            print(f"⚠️ Error reading Chaply latest data: {e}")

    # Phase 3: Smart Public Chapter Resolver & Cross-Platform Reconciliation
    # Cross-check ReadRealm chapter counts against Kairew & Chaply.
    # If other platforms have more chapters (due to ReadRealm Writer API -1 bug),
    # query ReadRealm Public Reader API (which requires no login) to resolve the real chapter count.
    import re

    def normalize_thai(text: str) -> str:
        if not text:
            return ""
        for m in mappings:
            for alias in m.get("aliases", []):
                if alias.lower() in text.lower():
                    return m.get("canonical_key", "")
        if any(k in text for k in ["ผู้ชายแสนดีเช่นข้า", "จอมมารแสนดีเช่นข้า", "จอมมารแสนดีขนาดนี้"]):
            return "จอมมารแสนดี"
        return "".join(re.findall(r'[\u0E00-\u0E7F]', text or ""))

    other_platform_max_chapters: Dict[str, int] = {}
    for other_c in kr_comics + ch_comics:
        th = normalize_thai(other_c.get("subject", ""))
        if th and len(th) >= 4:
            ch_num = int(other_c.get("chapters_count") or 0)
            if ch_num > other_platform_max_chapters.get(th, 0):
                other_platform_max_chapters[th] = ch_num

    # Strictly No-API: Public API chapter resolver is disabled.
    total_comics_count = len(unified_comics)
    unified_comics.sort(key=lambda x: x.get("total_sales", 0.0), reverse=True)

    # Aggregate 2026 monthly sales across all 3 platforms (portfolio & per-comic)
    portfolio_monthly_sales_2026 = sum_monthly_dicts(
        [
            (breakdown.get("readrealm") or {}).get("monthly_sales", {}),
            (breakdown.get("kairew") or {}).get("monthly_sales", {}),
            (breakdown.get("chaply") or {}).get("monthly_sales", {}),
        ],
        year=TARGET_YEAR,
    )

    comics_monthly_map: Dict[str, Dict[str, Any]] = {}
    for c in unified_comics:
        canon_title = (c.get("canonical_title") or c.get("subject") or c.get("name") or "Unknown").strip()
        plat = c.get("platform", "")
        c_m = normalize_monthly_sales_2026(c.get("monthly_sales"), year=TARGET_YEAR)
        if canon_title not in comics_monthly_map:
            comics_monthly_map[canon_title] = {
                "canonical_title": canon_title,
                "platforms": [],
                "monthly_sales": {f"{TARGET_YEAR}-{m:02d}": 0.0 for m in range(1, 13)},
                "total_sales_2026": 0.0,
            }
        entry = comics_monthly_map[canon_title]
        if plat and plat not in entry["platforms"]:
            entry["platforms"].append(plat)
        for ym_k, val in c_m.items():
            if ym_k in entry["monthly_sales"]:
                entry["monthly_sales"][ym_k] = round(entry["monthly_sales"][ym_k] + val, 2)

    comics_monthly_summary_2026 = []
    for entry in comics_monthly_map.values():
        entry["total_sales_2026"] = round(sum(entry["monthly_sales"].values()), 2)
        comics_monthly_summary_2026.append(entry)
    comics_monthly_summary_2026.sort(key=lambda x: x["total_sales_2026"], reverse=True)

    unified_output = {
        "pipeline_recorded_at": recorded_at,
        "date_reference": snapshot_date_key,
        "total_sales_portfolio": round(total_sales_portfolio, 2),
        "total_views_portfolio": total_views_portfolio,
        "total_comics": total_comics_count,
        "total_inactive_30d": total_inactive_30d,
        "total_active_30d": total_active_30d,
        "platforms_breakdown": breakdown,
        "portfolio_monthly_sales_2026": portfolio_monthly_sales_2026,
        "comics_monthly_summary_2026": comics_monthly_summary_2026,
        "top_sales_comic": unified_comics[0]["subject"] if unified_comics else "",
        "comics": unified_comics
    }

    # Save to disk
    with open(UNIFIED_LATEST, "w", encoding="utf-8") as f:
        json.dump(unified_output, f, ensure_ascii=False, indent=2)
    print(f"✓ บันทึกภาพรวมทุกแพลตฟอร์ม: {UNIFIED_LATEST}")

    for out_dir in [FRONTEND_SRC_DIR, FRONTEND_PUB_DIR]:
        if os.path.exists(out_dir):
            target = os.path.join(out_dir, "multi_platform_growth_latest.json")
            try:
                with open(target, "w", encoding="utf-8") as f:
                    json.dump(unified_output, f, ensure_ascii=False, indent=2)
                print(f"✓ อัปเดตข้อมูลไปยัง Frontend: {target}")
            except Exception as e:
                print(f"⚠️ ไม่สามารถบันทึกไปยัง {target}: {e}")

    try:
        md_path = generate_monthly_summary_markdown(unified_output, MONTHLY_SUMMARY_MD)
        print(f"✓ สร้างรายงานสรุปรายเดือนอัตโนมัติ: {md_path}")
    except Exception as e:
        print(f"⚠️ ไม่สามารถสร้างรายงานสรุปรายเดือน {MONTHLY_SUMMARY_MD}: {e}")

    return unified_output


def main():
    parser = argparse.ArgumentParser(description="Multi-Platform 6-Hour Growth Tracker")
    parser.add_argument("--platform", type=str, default="all", choices=["all", "readrealm", "kairew", "chaply"], help="Target platform to track")
    parser.add_argument("--browser", action="store_true", default=True, help="Launch real visible Google Chrome browser")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    parser.add_argument("--no-api", action="store_true", default=False, help="Disable direct HTTP/API login, force real visible Google Chrome browser only")
    parser.add_argument("--force-refresh", action="store_true", default=False, help="Force refresh tokens through real browser session")
    parser.add_argument("--send-gas", action="store_true", help="Send data to GAS Web App")
    parser.add_argument("--gas-url", type=str, default=os.environ.get("GAS_URL") or os.environ.get("GAS_WEBAPP_URL") or DEFAULT_GAS_URL, help="GAS Web App URL")
    parser.add_argument("--passcode", type=str, default=os.environ.get("PASSCODE", DEFAULT_PASSCODE), help="GAS Web App Passcode")
    parser.add_argument("--consolidate-only", action="store_true", help="Consolidate existing latest JSON files without re-fetching")
    parser.add_argument("--live-html", action="store_true", default=False, help="Force direct live HTML DOM scraping, skip local JSON cache fallback")
    parser.add_argument("--no-cache", action="store_true", default=False, help="Disable reading or falling back to local JSON cache files")
    parser.add_argument("--min-match", type=float, default=DEFAULT_MIN_MATCH, help="Minimum title match ratio against MangaSetting (strictly > threshold, default: 0.80)")
    args = parser.parse_args()

    # Refresh active MangaSetting whitelist from GAS once before running scrapers
    # so deleted projects are immediately excluded instead of relying on stale cache.
    if not args.consolidate_only and (args.force_refresh or args.no_cache):
        try:
            sys.path.append(BASE_DIR)
            from manga_matcher import get_manga_setting
            fresh_ml = get_manga_setting(
                gas_url=args.gas_url or DEFAULT_GAS_URL,
                passcode=args.passcode or DEFAULT_PASSCODE,
                force_refresh=True
            )
            print(f"✓ โหลดรายชื่อโปรเจกต์ปัจจุบันจาก MangaSetting สำเร็จ: {len(fresh_ml)} เรื่อง (เกณฑ์แมทช์ > {int(round(args.min_match * 100))}%)")
        except Exception as e:
            print(f"⚠️ ไม่สามารถรีเฟรช MangaSetting จาก GAS ใช้แคชล่าสุดแทน: {e}")

    # Strictly enforce Real Chrome Visible (No-Headless) and No-API mode
    common_args = ["--min-match", str(args.min_match), "--browser", "--no-api"]
    if args.live_html:
        common_args.append("--live-html")
    if args.no_cache:
        common_args.append("--no-cache")
    if args.send_gas:
        common_args.append("--send-gas")
        common_args.extend(["--gas-url", args.gas_url or DEFAULT_GAS_URL])
        common_args.extend(["--passcode", args.passcode or DEFAULT_PASSCODE])

    if not args.consolidate_only:
        # Run ReadRealm
        if args.platform in ("all", "readrealm"):
            # readrealm uses --sync-gas
            rr_args = ["--min-match", str(args.min_match), "--browser", "--no-api", "--force-refresh"]
            if args.live_html:
                rr_args.append("--live-html")
            if args.no_cache:
                rr_args.append("--no-cache")
            if args.send_gas:
                rr_args.append("--sync-gas")
                rr_args.extend(["--gas-url", args.gas_url or DEFAULT_GAS_URL])
                rr_args.extend(["--passcode", args.passcode or DEFAULT_PASSCODE])
            run_script("readrealm_growth_tracker.py", rr_args)

        # Run Kairew
        if args.platform in ("all", "kairew"):
            run_script("kairew_growth_tracker.py", common_args)

        # Run Chaply
        if args.platform in ("all", "chaply"):
            run_script("chaply_growth_tracker.py", common_args)

    # Consolidate results
    print("\n" + "=" * 70)
    print(f"📊 รวมสถิติอัตราการเติบโตทุกแพลตฟอร์ม (Consolidating Multi-Platform Stats | Match > {int(round(args.min_match * 100))}%)...")
    print("=" * 70)
    unified = consolidate_multi_platform_data(min_match=args.min_match)
    run_script("group_matching_comics.py", ["--min-match", str(args.min_match)])

    print("\n" + "=" * 70)
    print("🌟 สรุปภาพรวมทุกแพลตฟอร์ม (ReadRealm + Kairew + Chaply):")
    print(f"   💰 ยอดขายสะสมรวม: {unified['total_sales_portfolio']:,.2f} บาท")
    print(f"   👀 ยอดวิวสะสมรวม: {unified['total_views_portfolio']:,} วิว")
    print(f"   📚 จำนวนการ์ตูนรวม: {unified['total_comics']} เรื่อง")
    print(f"   🔥 เรื่องที่มีตอนใหม่ใน 30 วัน: {unified['total_active_30d']} เรื่อง")
    print(f"   ⚠️ เรื่องที่ไม่มีตอนใหม่ > 30 วัน: {unified['total_inactive_30d']} เรื่อง")
    print("=" * 70)


if __name__ == "__main__":
    main()

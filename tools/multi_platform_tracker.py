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

READREALM_LATEST = os.path.join(DATA_DIR, "readrealm_growth_latest.json")
KAIREW_LATEST = os.path.join(DATA_DIR, "kairew_growth_latest.json")
CHAPLY_LATEST = os.path.join(DATA_DIR, "chaply_growth_latest.json")
UNIFIED_LATEST = os.path.join(DATA_DIR, "multi_platform_growth_latest.json")
MAPPING_FILE = os.path.join(DATA_DIR, "comic_cross_platform_mapping.json")

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

def consolidate_multi_platform_data() -> Dict[str, Any]:
    """Merge latest snapshots from ReadRealm, Kairew, and Chaply into unified format."""
    now = datetime.now(timezone.utc)
    recorded_at = now.isoformat()
    snapshot_date_key = now.strftime("%Y-%m-%d")

    unified_comics = []
    breakdown = {}

    total_sales_portfolio = 0.0
    total_views_portfolio = 0
    total_comics_count = 0
    total_inactive_30d = 0
    total_active_30d = 0

    mappings = load_cross_platform_mappings()

    def apply_cross_platform_canonical(c: Dict[str, Any], platform_name: str):
        sub = c.get("subject", "")
        cid = str(c.get("comic_id") or "")
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

    # 1. ReadRealm
    if os.path.exists(READREALM_LATEST):
        try:
            with open(READREALM_LATEST, "r", encoding="utf-8") as f:
                rr_data = json.load(f)
            rr_comics = rr_data.get("comics", [])
            for c in rr_comics:
                c["platform"] = "readrealm"
                apply_cross_platform_canonical(c, "readrealm")
                unified_comics.append(c)

            rr_sales = float(rr_data.get("total_sales_portfolio", sum(c.get("total_sales", 0.0) for c in rr_comics)))
            rr_views = int(rr_data.get("total_views_portfolio", sum(c.get("total_views", 0) for c in rr_comics)))
            rr_inactive = sum(1 for c in rr_comics if c.get("is_inactive_30d"))
            rr_active = len(rr_comics) - rr_inactive

            breakdown["readrealm"] = {
                "name": "ReadRealm",
                "sales": rr_sales,
                "views": rr_views,
                "comics_count": len(rr_comics),
                "inactive_30d": rr_inactive,
                "active_30d": rr_active,
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
            kr_comics = kr_data.get("comics", [])
            for c in kr_comics:
                c["platform"] = "kairew"
                apply_cross_platform_canonical(c, "kairew")
                unified_comics.append(c)

            kr_sales = float(kr_data.get("total_sales_portfolio", sum(c.get("total_sales", 0.0) for c in kr_comics)))
            kr_views = int(kr_data.get("total_views_portfolio", sum(c.get("total_views", 0) for c in kr_comics)))
            kr_inactive = sum(1 for c in kr_comics if c.get("is_inactive_30d"))
            kr_active = len(kr_comics) - kr_inactive

            breakdown["kairew"] = {
                "name": "Kairew",
                "sales": kr_sales,
                "views": kr_views,
                "comics_count": len(kr_comics),
                "inactive_30d": kr_inactive,
                "active_30d": kr_active,
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
            ch_comics = ch_data.get("comics", [])
            for c in ch_comics:
                c["platform"] = "chaply"
                apply_cross_platform_canonical(c, "chaply")
                unified_comics.append(c)

            ch_sales = float(ch_data.get("total_sales_portfolio", sum(c.get("total_sales", 0.0) for c in ch_comics)))
            ch_views = int(ch_data.get("total_views_portfolio", sum(c.get("total_views", 0) for c in ch_comics)))
            ch_inactive = sum(1 for c in ch_comics if c.get("is_inactive_30d"))
            ch_active = len(ch_comics) - ch_inactive

            breakdown["chaply"] = {
                "name": "Chaply",
                "sales": ch_sales,
                "views": ch_views,
                "comics_count": len(ch_comics),
                "inactive_30d": ch_inactive,
                "active_30d": ch_active,
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

    rr_discrepancy_resolved = 0
    try:
        from readrealm_growth_tracker import fetch_public_readrealm_chapters
        for c in rr_comics:
            rr_cid = c.get("comic_id")
            th = normalize_thai(c.get("subject", ""))
            expected_ch = other_platform_max_chapters.get(th, 0)
            current_rr_ch = int(c.get("chapters_count") or 0)

            if expected_ch > current_rr_ch and rr_cid:
                pub_ch = fetch_public_readrealm_chapters(rr_cid)
                if pub_ch > current_rr_ch:
                    print(f"🔄 [Smart Resolver] ตรวจพบผลต่างตอน {c.get('subject')} (ReadRealm API: {current_rr_ch} -> Public API จริง: {pub_ch} ตอน | แพลตฟอร์มอื่น: {expected_ch})")
                    c["chapters_count"] = pub_ch
                    rr_discrepancy_resolved += 1
    except Exception as e:
        print(f"⚠️ Smart Chapter Resolver cross-check encountered error: {e}")

    # If any ReadRealm comic was corrected, persist updated ReadRealm snapshot
    if rr_discrepancy_resolved > 0 and os.path.exists(READREALM_LATEST):
        try:
            rr_data["comics"] = rr_comics
            with open(READREALM_LATEST, "w", encoding="utf-8") as f:
                json.dump(rr_data, f, ensure_ascii=False, indent=2)
            for out_dir in [FRONTEND_SRC_DIR, FRONTEND_PUB_DIR]:
                if os.path.exists(out_dir):
                    target = os.path.join(out_dir, "readrealm_growth_latest.json")
                    with open(target, "w", encoding="utf-8") as f:
                        json.dump(rr_data, f, ensure_ascii=False, indent=2)
            print(f"✓ [Smart Resolver] บันทึกการแก้ไขจำนวนตอน ReadRealm ทั้งหมด {rr_discrepancy_resolved} เรื่องลงทุกไฟล์เรียบร้อย")
        except Exception as e:
            print(f"⚠️ ไม่สามารถบันทึก snapshot ReadRealm หลังแก้ไขตอน: {e}")

    total_comics_count = len(unified_comics)
    unified_comics.sort(key=lambda x: x.get("total_sales", 0.0), reverse=True)

    unified_output = {
        "pipeline_recorded_at": recorded_at,
        "date_reference": snapshot_date_key,
        "total_sales_portfolio": round(total_sales_portfolio, 2),
        "total_views_portfolio": total_views_portfolio,
        "total_comics": total_comics_count,
        "total_inactive_30d": total_inactive_30d,
        "total_active_30d": total_active_30d,
        "platforms_breakdown": breakdown,
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
    args = parser.parse_args()

    common_args = []
    if args.headless:
        common_args.append("--headless")
    elif args.browser or args.no_api:
        common_args.append("--browser")
    if args.send_gas:
        common_args.append("--send-gas")
        common_args.extend(["--gas-url", args.gas_url or DEFAULT_GAS_URL])
        common_args.extend(["--passcode", args.passcode or DEFAULT_PASSCODE])

    if not args.consolidate_only:
        # Run ReadRealm
        if args.platform in ("all", "readrealm"):
            # readrealm uses --sync-gas
            rr_args = []
            if args.headless:
                rr_args.append("--headless")
            elif args.browser or args.no_api:
                rr_args.append("--browser")
            if args.no_api:
                rr_args.append("--no-api")
            if args.force_refresh or args.no_api:
                rr_args.append("--force-refresh")
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
    print("📊 รวมสถิติอัตราการเติบโตทุกแพลตฟอร์ม (Consolidating Multi-Platform Stats)...")
    print("=" * 70)
    unified = consolidate_multi_platform_data()
    run_script("group_matching_comics.py", [])

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

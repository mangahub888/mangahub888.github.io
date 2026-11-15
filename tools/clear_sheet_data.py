# -*- coding: utf-8 -*-
"""
MangaHub Google Sheets Data Clearing Utility
Safely clears row data (rows 2+) from Monthly P&L and Multi-Platform Growth Tracker sheets
while strictly preserving row 1 headers, column structures, and formatting.

Usage:
  # Check status only (Dry-run / View row counts)
  python tools/clear_sheet_data.py --status

  # Clear only Monthly P&L (MangaSales)
  python tools/clear_sheet_data.py --target pnl

  # Clear only Weekly/Multi-Platform Growth sheets (6 tabs)
  python tools/clear_sheet_data.py --target growth

  # Clear all platform sheets (MangaSales + all 6 Growth tabs)
  python tools/clear_sheet_data.py --target all
"""

import sys
import os
import json
import urllib.request
import urllib.error
import argparse

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"

import time

def post_gas(action: str, payload: dict = None, gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE, retries: int = 3):
    body = {
        "action": action,
        "passcode": passcode,
        "payload": payload or {}
    }
    data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(gas_url, data=data_bytes, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(2)

def check_status(gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE):
    print("=" * 60)
    print("📊 ตรวจสอบสถานะจำนวนข้อมูลปัจจุบันใน Google Sheets")
    print("=" * 60)

    # 1. MangaSales
    try:
        res = post_gas("GET_MANGA_SALES", gas_url=gas_url, passcode=passcode)
        sales = res.get("data", []) if isinstance(res.get("data"), list) else res.get("data", {}).get("list", [])
        months = sorted(list(set(r.get("month") for r in sales if r.get("month"))))
        print(f"• MangaSales (Monthly PnL): {len(sales)} แถว (รอบเดือน: {', '.join(months) if months else 'ไม่มี'})")
    except Exception as e:
        print(f"• MangaSales: ตรวจสอบไม่สำเร็จ ({e})")

    time.sleep(2)

    # 2. ReadRealmGrowth
    try:
        res = post_gas("GET_READREALM_GROWTH_DATA", gas_url=gas_url, passcode=passcode)
        data = res.get("data", {})
        comics = data.get("comics", [])
        print(f"• ReadRealmGrowth (Weekly Tracker): {len(comics)} เรื่อง")
    except Exception as e:
        print(f"• ReadRealmGrowth: ตรวจสอบไม่สำเร็จ ({e})")

    time.sleep(2)

    # 3. KairewGrowth
    try:
        res = post_gas("GET_KAIREW_GROWTH_DATA", gas_url=gas_url, passcode=passcode)
        comics = res.get("data", {}).get("comics", [])
        print(f"• KairewGrowth (Weekly Tracker): {len(comics)} เรื่อง")
    except Exception as e:
        print(f"• KairewGrowth: ตรวจสอบไม่สำเร็จ ({e})")

    time.sleep(2)

    # 4. ChaplyGrowth
    try:
        res = post_gas("GET_CHAPLY_GROWTH_DATA", gas_url=gas_url, passcode=passcode)
        comics = res.get("data", {}).get("comics", [])
        print(f"• ChaplyGrowth (Weekly Tracker): {len(comics)} เรื่อง")
    except Exception as e:
        print(f"• ChaplyGrowth: ตรวจสอบไม่สำเร็จ ({e})")
    print("=" * 60)

def clear_target(target: str, gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE):
    if target == "pnl":
        print("🗑️ กำลังล้างข้อมูลแถวในแท็บ 'MangaSales' (Monthly P&L Ledger)...")
        res = post_gas("CLEAR_MANGA_SALES", gas_url=gas_url, passcode=passcode)
        print("ผลลัพธ์:", json.dumps(res, ensure_ascii=False, indent=2))
    elif target in ("growth", "all"):
        # CLEAR_ALL_PLATFORM_SHEETS clears MangaSales + ReadRealmGrowth + KairewGrowth + ChaplyGrowth + Timeline summaries
        action = "CLEAR_ALL_PLATFORM_SHEETS"
        print(f"🗑️ กำลังล้างข้อมูลแถวในทุกแท็บแพลตฟอร์มด้วย action '{action}'...")
        res = post_gas(action, gas_url=gas_url, passcode=passcode)
        print("ผลลัพธ์:", json.dumps(res, ensure_ascii=False, indent=2))

def main():
    parser = argparse.ArgumentParser(description="MangaHub Sheet Data Clearing Tool")
    parser.add_argument("--status", action="store_true", help="Check current row counts")
    parser.add_argument("--target", choices=["pnl", "growth", "all"], help="Target sheets to clear")
    parser.add_argument("--gas-url", default=DEFAULT_GAS_URL, help="GAS Web App URL")
    parser.add_argument("--passcode", default=DEFAULT_PASSCODE, help="Security Passcode")

    args = parser.parse_args()

    if args.status or not args.target:
        check_status(args.gas_url, args.passcode)
        if not args.target:
            print("\n💡 หากต้องการล้างข้อมูล กรุณาระบุ --target [pnl | growth | all]")
            return

    if args.target:
        clear_target(args.target, args.gas_url, args.passcode)

if __name__ == "__main__":
    main()

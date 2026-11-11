# -*- coding: utf-8 -*-
"""
MangaHub Monthly P&L Ledger Auto-Sync Tool
Synchronizes and calculates monthly Profit & Loss (Revenue - Cost) into Google Apps Script `MangaSales`.

Usage:
  python tools/sync_monthly_pnl.py --all-months
  python tools/sync_monthly_pnl.py --months 2026-10 2026-11
  python tools/sync_monthly_pnl.py --current-only
"""

import sys
import os
import json
import urllib.request
import urllib.error
import argparse
from typing import List, Dict, Any

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"

MONTHS_2026 = [
    "2026-01", "2026-02", "2026-03", "2026-04",
    "2026-05", "2026-06", "2026-07", "2026-08",
    "2026-09", "2026-10", "2026-11"
]

def sync_single_month(gas_url: str, passcode: str, target_month: str, timeout: int = 90) -> Dict[str, Any]:
    """Call GAS API to calculate and sync a single month to MangaSales sheet."""
    payload = {
        "action": "SYNC_AND_CALCULATE_MONTHLY_PL",
        "passcode": passcode,
        "payload": {
            "targetMonth": target_month,
            "month": target_month
        }
    }
    data_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        gas_url,
        data=data_bytes,
        headers={"Content-Type": "application/json"}
    )
    
    with urllib.request.urlopen(req, timeout=timeout) as response:
        resp_text = response.read().decode("utf-8")
        return json.loads(resp_text)

def run_pnl_sync(months: List[str], gas_url: str = DEFAULT_GAS_URL, passcode: str = DEFAULT_PASSCODE):
    print("=" * 70, flush=True)
    print(f"⚡ เริ่มต้นการซิงค์และคำนวณ 'สมุดบันทึกต้นทุน & P&L' ({len(months)} รอบเดือน)", flush=True)
    print(f"   รอบเดือนเป้าหมาย: {', '.join(months)}", flush=True)
    print("=" * 70, flush=True)

    success_count = 0
    total_months = len(months)

    for idx, m in enumerate(months, 1):
        print(f"[{idx}/{total_months}] ⏳ กำลังประมวลผล P&L เดือน {m}...", end="", flush=True)
        retries = 2
        success = False
        while retries >= 0:
            try:
                res = sync_single_month(gas_url, passcode, m)
                inner = res.get("data") if isinstance(res.get("data"), dict) else res
                st = res.get("status") or ("success" if inner.get("success") else "error")
                if st == "success" or inner.get("success"):
                    rows = inner.get("count") or (len(inner.get("list", [])) if isinstance(inner.get("list"), list) else 0)
                    summary = inner.get("summary") or {}
                    rev = summary.get("totalRevenue", 0)
                    profit = summary.get("netProfit", 0)
                    print(f" ✓ สำเร็จ ({rows} เรื่อง | รายได้: ฿{rev:,.2f} | กำไรสุทธิ: ฿{profit:,.2f})", flush=True)
                    success_count += 1
                    success = True
                    break
                else:
                    err = inner.get("message") or inner.get("error") or res.get("message") or "Unknown error"
                    print(f" ⚠️ ไม่สำเร็จ: {err}", flush=True)
                    break
            except Exception as e:
                retries -= 1
                if retries >= 0:
                    print(f" ↻ รหัสข้อผิดพลาด ({e}), กำลังลองใหม่...", end="", flush=True)
                else:
                    print(f" ❌ ล้มเหลว: {e}", flush=True)

    print("-" * 70, flush=True)
    print(f"🎉 เสร็จสิ้นการซิงค์สมุดบันทึก P&L: สำเร็จ {success_count}/{total_months} เดือน", flush=True)
    print("=" * 70, flush=True)
    return success_count == total_months

def main():
    parser = argparse.ArgumentParser(description="Sync Monthly P&L Ledger to Google Sheets")
    parser.add_argument("--all-months", action="store_true", default=True, help="Sync all active months in 2026 (2026-01 through 2026-11)")
    parser.add_argument("--current-only", action="store_true", help="Sync only current month (2026-11)")
    parser.add_argument("--recent-two", action="store_true", help="Sync recent two months (2026-10 and 2026-11)")
    parser.add_argument("--months", nargs="+", help="Specific months to sync (e.g. 2026-10 2026-11)")
    parser.add_argument("--gas-url", type=str, default=os.environ.get("GAS_URL", DEFAULT_GAS_URL), help="GAS WebApp URL")
    parser.add_argument("--passcode", type=str, default=os.environ.get("PASSCODE", DEFAULT_PASSCODE), help="GAS Passcode")
    args = parser.parse_args()

    if args.months:
        target_months = args.months
    elif args.current_only:
        target_months = ["2026-11"]
    elif args.recent_two:
        target_months = ["2026-10", "2026-11"]
    else:
        target_months = MONTHS_2026

    success = run_pnl_sync(target_months, args.gas_url, args.passcode)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()

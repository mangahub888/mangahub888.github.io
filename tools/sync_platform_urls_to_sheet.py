#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sync matched platform URLs (ReadRealmURL, KairewURL, ChaplyURL) from
tools/data/grouped_matched_comics.json into Google Sheet (MangaSetting)
so future browser trackers can navigate directly without fuzzy matching.
"""
import os
import sys
import json
import argparse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
GROUPED_FILE = os.path.join(DATA_DIR, "grouped_matched_comics.json")
DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
DEFAULT_PASSCODE = "10211032"


def build_urls_map(grouped_path: str = GROUPED_FILE):
    with open(grouped_path, "r", encoding="utf-8") as f:
        groups = json.load(f)

    # Map ReadRealm comic_id -> account name from readrealm_growth_latest.json
    rr_account_map = {}
    rr_latest_path = os.path.join(DATA_DIR, "readrealm_growth_latest.json")
    if os.path.exists(rr_latest_path):
        try:
            with open(rr_latest_path, "r", encoding="utf-8") as rf:
                rr_data = json.load(rf)
            for c in rr_data.get("comics", []):
                cid = str(c.get("comic_id") or "").strip()
                acc = str(c.get("account") or "").strip()
                if cid and acc:
                    rr_account_map[cid] = acc
        except Exception:
            pass

    urls_map = {}
    for g in groups:
        mid = str(g.get("manga_id") or "").strip()
        if not mid:
            continue
        rr = g.get("readrealm") or {}
        kr = g.get("kairew") or {}
        ch = g.get("chaply") or {}

        rr_id = str(rr.get("id") or "").strip() if rr.get("exists") else ""
        rr_url = f"https://readrealm.co/writer/comic/{rr_id}" if rr_id else ""
        rr_acc = rr_account_map.get(rr_id, "") if rr_id else ""
        kr_url = f"https://kairew.com/writer/manage-book/stat/{kr['id']}" if kr.get("exists") and kr.get("id") else ""
        ch_url = f"https://www.chaply.net/writer/contents/{ch['id']}/edit" if ch.get("exists") and ch.get("id") else ""

        urls_map[mid] = {
            "readrealm": rr_url,
            "readrealm_account": rr_acc,
            "kairew": kr_url,
            "chaply": ch_url,
        }
    return urls_map


def main():
    parser = argparse.ArgumentParser(description="Sync platform URLs to MangaSetting Google Sheet")
    parser.add_argument("--gas-url", type=str, default=os.environ.get("GAS_URL") or DEFAULT_GAS_URL)
    parser.add_argument("--passcode", type=str, default=os.environ.get("PASSCODE") or DEFAULT_PASSCODE)
    parser.add_argument("--dry-run", action="store_true", help="Print URLs without sending to GAS")
    args = parser.parse_args()

    urls_map = build_urls_map()
    print(f"Prepared platform URLs for {len(urls_map)} manga from {GROUPED_FILE}")
    for mid, u in list(urls_map.items())[:3]:
        print(f"  ID {mid}: RR={u['readrealm']} | KW={u['kairew']} | CH={u['chaply']}")

    if args.dry_run:
        print("Dry-run complete (not sent to GAS).")
        return

    payload = {
        "action": "BATCH_UPDATE_MANGA_PLATFORM_URLS",
        "passcode": args.passcode,
        "payload": {
            "urlsMap": urls_map,
        },
        "urlsMap": urls_map,
    }
    req = urllib.request.Request(
        args.gas_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        print("GAS Response:", raw[:400])


if __name__ == "__main__":
    main()

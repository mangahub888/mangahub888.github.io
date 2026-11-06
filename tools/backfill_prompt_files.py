#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill the "PROMPT2 TEMPT" file for chapters that already went through Auto OCR
(.mtp / OCR .txt exist) but have no [prompt] link in WorkQueue.worklink.

For each candidate:
  1. Get the OCR text (from the [ocr txt] file, else extracted from the .mtp)
  2. Build the PROMPT2 TEMPT content (Docs link from Manga Settings, last 5 chapters,
     current chapter, OCR text)
  3. Upload it into the chapter's Drive folder and append "[prompt] <url>" to worklink

Usage:
  python tools/backfill_prompt_files.py --dry-run
  python tools/backfill_prompt_files.py --limit 5
  python tools/backfill_prompt_files.py
"""

import argparse
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import requests
from tools.gdrive_ocr_job import build_prompt2_tempt_content
from tools.backfill_export_txt_mtp import (
    call_gas,
    download_and_parse_mtp,
    extract_text_from_mtp_data,
    safe_print,
)

PROMPT_FILENAME = "PROMPT2 TEMPT"


def _file_id_after_tag(worklink: str, tag_pattern: str):
    m = re.search(tag_pattern + r"[^\n]*?/file/d/([a-zA-Z0-9_-]+)", worklink, re.IGNORECASE)
    return m.group(1).strip() if m else None


def fetch_candidates(manga_list, queue):
    manga_map = {str(m.get("mangaid")): m for m in manga_list}
    out = []
    for q in queue:
        wl = str(q.get("worklink") or "")
        ocr_status = str(q.get("ocrstatus") or "").strip()
        ocr_name = str(q.get("ocrname") or "").lower()

        has_mtp = "[mtp]" in wl or ".mtp" in wl
        has_txt = "[ocr txt]" in wl.lower()
        ocr_done = ocr_status == "เสร็จแล้ว" or "github" in ocr_name or has_mtp or has_txt
        if not ocr_done or "[prompt]" in wl.lower():
            continue

        folder = re.search(r"folders/([a-zA-Z0-9_-]+)", wl)
        if not folder:
            continue

        m = manga_map.get(str(q.get("mangaid")), {})
        out.append({
            "queue_id": str(q.get("queueid")),
            "manga_name": m.get("manganame", ""),
            "doc_url": str(m.get("translationdocurl") or "").strip(),
            "chapter": str(q.get("chapter") or "").strip(),
            "folder_id": folder.group(1),
            "txt_id": _file_id_after_tag(wl, r"\[ocr txt\]"),
            "mtp_id": _file_id_after_tag(wl, r"\[mtp\]"),
        })
    return out


def get_ocr_text(c):
    """Return OCR text for a candidate, or None if it cannot be obtained."""
    if c["txt_id"]:
        try:
            r = requests.get(
                "https://drive.google.com/uc?export=download&id=" + c["txt_id"], timeout=60
            )
            if r.status_code == 200 and "<html" not in r.text[:200].lower():
                return r.content.decode("utf-8", errors="replace").strip()
        except Exception as e:
            safe_print(f"   ⚠️ txt download failed ({c['queue_id']}): {e}")
    if c["mtp_id"]:
        data = download_and_parse_mtp(c["mtp_id"])
        if data:
            return extract_text_from_mtp_data(data).strip()
    return None


def process(c, idx, total, manga_list, queue, dry_run):
    label = f"[{idx}/{total}] {c['manga_name']} ตอนที่ {c['chapter']} (queue {c['queue_id']})"
    text = get_ocr_text(c)
    if text is None:
        safe_print(f"⏭️  {label}: no OCR text source")
        return {**c, "result": "no_text"}

    content = build_prompt2_tempt_content(
        manga_name=c["manga_name"],
        chapter_num=c["chapter"],
        folder_name="",
        ocr_text=text,
        queue_id=c["queue_id"],
        doc_url=c["doc_url"],
        manga_list=manga_list,
        queue_items=queue,
    )

    if dry_run:
        safe_print(f"🧪 {label}: would upload {len(content)} chars (docs={'yes' if c['doc_url'] else 'NO'})")
        return {**c, "result": "dry_run"}

    res = call_gas("UPLOAD_TEXT_TO_DRIVE_FOLDER", {
        "folderId": c["folder_id"],
        "fileName": PROMPT_FILENAME,
        "content": content,
        "queueId": c["queue_id"],
        "linkTag": "[prompt]",
    })
    data = res.get("data") or {}
    if res.get("status") == "success" and (data.get("fileId") or res.get("fileId")):
        safe_print(f"✅ {label}: uploaded")
        return {**c, "result": "ok"}
    safe_print(f"❌ {label}: {res}")
    return {**c, "result": "failed", "error": str(res)[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    safe_print("📡 Fetching manga list + work queue...")
    ml = call_gas("GET_MANGA_LIST", {})
    wq = call_gas("GET_WORK_QUEUE", {"month": "all", "year": "all", "includeIncomplete": True})
    if ml.get("status") != "success" or wq.get("status") != "success":
        safe_print("❌ GAS fetch failed:", ml.get("message"), wq.get("message"))
        sys.exit(1)
    manga_list, queue = ml["data"], wq["data"]

    cands = fetch_candidates(manga_list, queue)
    if args.limit:
        cands = cands[: args.limit]
    safe_print(f"✓ {len(cands)} chapters need a PROMPT2 TEMPT file")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [
            ex.submit(process, c, i + 1, len(cands), manga_list, queue, args.dry_run)
            for i, c in enumerate(cands)
        ]
        for f in as_completed(futs):
            results.append(f.result())

    def n(k):
        return sum(1 for r in results if r["result"] == k)

    safe_print("\n==== SUMMARY ====")
    safe_print(f"uploaded: {n('ok')} | dry-run: {n('dry_run')} | no text source: {n('no_text')} | failed: {n('failed')}")
    no_docs = sorted({r["manga_name"] for r in results if not r["doc_url"]})
    if no_docs:
        safe_print("เรื่องที่ยังไม่มีลิงก์ Docs (ข้อ 1 ในไฟล์จะว่าง):")
        for name in no_docs:
            safe_print("  -", name)
    for r in results:
        if r["result"] in ("no_text", "failed"):
            safe_print(f"  ⚠️ {r['manga_name']} ตอนที่ {r['chapter']} -> {r['result']} {r.get('error', '')}")


if __name__ == "__main__":
    main()

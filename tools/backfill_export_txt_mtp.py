#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill Export TXT from MTP for WorkQueue items that ran through GitHub Actions
but have not been QC'd (extractstatus != 'เสร็จแล้ว').

Pattern: export_txt_chap_num_ห้ามใช้ลงคำ
File naming: export_txt_chap_{num}_ห้ามใช้ลงคำ.txt
"""

import os
import sys
import re
import json
import time
import urllib.request
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# Ensure stdout handles UTF-8 on Windows
if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import requests
from tools.gdrive_ocr_job import format_ocr_text_blocks

GAS_URL = os.environ.get(
    "GAS_URL",
    "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
)
GAS_PASSCODE = os.environ.get("GAS_PASSCODE", "10211032")

print_lock = threading.Lock()


def safe_print(*args, **kwargs):
    with print_lock:
        print(*args, **kwargs)


def export_txt_chap_num_ห้ามใช้ลงคำ(chapter_num: Any) -> str:
    """
    Standard naming pattern mandated by USER:
    export_txt_chap_num_ห้ามใช้ลงคำ -> export_txt_chap_{num}_ห้ามใช้ลงคำ.txt
    """
    clean_chap = str(chapter_num or "").strip()
    # Normalize chapter number string (e.g. 34.0 -> 34)
    if clean_chap.endswith(".0"):
        clean_chap = clean_chap[:-2]
    # Remove illegal filename characters
    clean_chap = re.sub(r'[/\\:*?"<>|]', '_', clean_chap) or "unknown"
    return f"export_txt_chap_{clean_chap}_ห้ามใช้ลงคำ.txt"


# Alias for ASCII/English code references
export_txt_chap_num_no_typeset = export_txt_chap_num_ห้ามใช้ลงคำ


def call_gas(action: str, payload: Optional[Dict[str, Any]] = None, retries: int = 3) -> Dict[str, Any]:
    """Helper to execute GAS Web App actions."""
    body = {
        "action": action,
        "passcode": GAS_PASSCODE,
        "payload": payload or {}
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                return {"status": "error", "message": f"GAS request failed after {retries} attempts: {e}"}
            time.sleep(1.5 * attempt)
    return {"status": "error", "message": "Unknown error in call_gas"}


def parse_worklink_ids(worklink: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extracts folder_id and mtp_file_id from a WorkQueue worklink string.
    Returns: (folder_id, mtp_file_id)
    """
    if not worklink:
        return None, None

    folder_id = None
    mtp_file_id = None

    # 1. Match folder ID from [อัป Raw] https://drive.google.com/drive/folders/...
    folder_match = re.search(r"folders/([a-zA-Z0-9_-]+)", worklink)
    if folder_match:
        folder_id = folder_match.group(1).strip()

    # 2. Match MTP file ID from [mtp] https://drive.google.com/file/d/...
    mtp_match = re.search(r"\[mtp\][^\n]*?/file/d/([a-zA-Z0-9_-]+)", worklink, re.IGNORECASE)
    if not mtp_match:
        # Fallback to any /file/d/ if [mtp] tag is slight variant
        mtp_match = re.search(r"/file/d/([a-zA-Z0-9_-]+)", worklink)
    if mtp_match:
        mtp_file_id = mtp_match.group(1).strip()

    return folder_id, mtp_file_id


def download_and_parse_mtp(mtp_file_id: str, session: Optional[requests.Session] = None) -> Optional[Dict[str, Any]]:
    """
    Downloads an .mtp project file from Google Drive and parses its JSON project data.
    """
    sess = session or requests.Session()
    url = f"https://drive.google.com/uc?export=download&id={mtp_file_id}"

    try:
        res = sess.get(url, stream=True, timeout=90)
        if res.status_code != 200:
            safe_print(f"   ⚠️ Download failed for MTP ID {mtp_file_id} (Status: {res.status_code})")
            return None

        # Check if Google returned a virus scan confirmation page
        if "download_warning" in res.text or "confirm=" in res.text:
            confirm_match = re.search(r"confirm=([0-9A-Za-z_]+)", res.text)
            if confirm_match:
                confirm_token = confirm_match.group(1)
                url_confirm = f"{url}&confirm={confirm_token}"
                res = sess.get(url_confirm, stream=True, timeout=90)

        # Parse JSON
        content_bytes = res.content
        data = json.loads(content_bytes.decode("utf-8", errors="replace"))
        return data
    except Exception as e:
        safe_print(f"   ❌ Error downloading/parsing MTP ID {mtp_file_id}: {e}")
        return None


def extract_text_from_mtp_data(project_data: Dict[str, Any]) -> str:
    """
    Converts .mtp project data into sequential formatted OCR blocks:
    [#1] text1

    [#2] text2
    """
    if not project_data:
        return ""

    # Determine page order from files list or sorted ocrData keys
    if "files" in project_data and isinstance(project_data["files"], list) and project_data["files"]:
        image_files = [f["name"] for f in project_data["files"] if isinstance(f, dict) and "name" in f]
    else:
        image_files = sorted(list(project_data.get("ocrData", {}).keys()))

    ocr_results = {}
    ocr_data = project_data.get("ocrData", {})
    ts_data = project_data.get("tsData", {})

    for fname in image_files:
        lines = ocr_data.get(fname, [])
        if not lines and fname in ts_data:
            lines = ts_data.get(fname, [])
        ocr_results[fname] = {
            "file": fname,
            "lines": lines
        }

    return format_ocr_text_blocks(image_files, ocr_results)


def upload_txt_to_drive(folder_id: str, filename: str, content: str, queue_id: str = "") -> Dict[str, Any]:
    """
    Uploads the formatted OCR text file into the chapter's Google Drive folder
    and attaches [ocr txt] link in WorkQueue via GAS.
    """
    payload = {
        "folderId": folder_id,
        "fileName": filename,
        "content": content,
        "queueId": queue_id
    }
    return call_gas("UPLOAD_TEXT_TO_DRIVE_FOLDER", payload)


def fetch_backfill_candidates() -> List[Dict[str, Any]]:
    """
    Retrieves all WorkQueue items from GAS that:
    1. Have run through GitHub Actions OCR (have .mtp file or OCR done)
    2. Have NOT been QC'd (extractstatus != 'เสร็จแล้ว')
    """
    safe_print("📡 [GAS Query] Fetching WorkQueue items...")
    res = call_gas("GET_WORK_QUEUE", {"month": "all", "year": "all", "includeIncomplete": True})
    if res.get("status") != "success":
        safe_print(f"❌ Failed to fetch queue: {res}")
        return []

    items = res.get("data", [])
    candidates = []

    for item in items:
        worklink = str(item.get("worklink") or "")
        ocr_status = str(item.get("ocrstatus") or "").strip()
        ocr_name = str(item.get("ocrname") or "").strip()
        extract_status = str(item.get("extractstatus") or "").strip()

        has_mtp_link = "[mtp]" in worklink or ".mtp" in worklink
        is_git_ocr = "github" in ocr_name.lower() or ocr_status == "เสร็จแล้ว" or has_mtp_link
        is_qc_not_done = extract_status not in ["เสร็จแล้ว", "skip", "Skipped", "ข้าม"]

        if (has_mtp_link or is_git_ocr) and is_qc_not_done:
            folder_id, mtp_id = parse_worklink_ids(worklink)
            if folder_id and mtp_id:
                item["_folder_id"] = folder_id
                item["_mtp_id"] = mtp_id
                candidates.append(item)

    safe_print(f"✓ Found {len(candidates)} candidate items matching backfill criteria.")
    return candidates


def process_single_candidate(item: Dict[str, Any], idx: int, total: int, dry_run: bool = False, force: bool = False) -> Dict[str, Any]:
    """Processes a single chapter candidate."""
    qid = str(item.get("queueid"))
    chap = str(item.get("chapter"))
    manga_id = str(item.get("mangaid"))
    folder_id = item["_folder_id"]
    mtp_id = item["_mtp_id"]
    worklink = str(item.get("worklink") or "")

    filename = export_txt_chap_num_ห้ามใช้ลงคำ(chap)
    prefix = f"[{idx+1:02d}/{total}] Queue {qid} (Manga {manga_id} | Ch.{chap})"

    # Check if already processed
    if not force and "[ocr txt]" in worklink and not dry_run:
        safe_print(f"{prefix} ⏭️ Already exported ([ocr txt] in worklink). Skipping.")
        return {
            "queueId": qid,
            "chapter": chap,
            "status": "skipped",
            "reason": "already_has_ocr_txt"
        }

    safe_print(f"\n{prefix}:")
    safe_print(f"   📁 Drive Folder: {folder_id}")
    safe_print(f"   📦 MTP File ID: {mtp_id}")
    safe_print(f"   📄 Target Filename: {filename}")

    if dry_run:
        safe_print(f"   [DRY-RUN] Would download MTP {mtp_id} and export -> {filename}")
        return {
            "queueId": qid,
            "chapter": chap,
            "filename": filename,
            "status": "dry_run"
        }

    # 1. Download and parse MTP
    t0 = time.time()
    project_data = download_and_parse_mtp(mtp_id)
    if not project_data:
        safe_print(f"   ❌ Skipped due to download/parse failure.")
        return {
            "queueId": qid,
            "chapter": chap,
            "status": "download_failed"
        }

    # 2. Extract and format OCR text blocks
    txt_content = extract_text_from_mtp_data(project_data)
    line_count = len([b for b in txt_content.split("\n\n") if b.strip()])
    parse_time = time.time() - t0
    safe_print(f"   ✓ Extracted {line_count} speech bubbles from MTP in {parse_time:.2f}s")

    if not txt_content.strip():
        safe_print(f"   ⚠️ MTP had no recognized text. Writing empty block note.")
        txt_content = f"// No speech bubbles detected in chapter {chap}\n"

    # 3. Upload to Google Drive folder and update WorkQueue
    upload_res = upload_txt_to_drive(
        folder_id=folder_id,
        filename=filename,
        content=txt_content,
        queue_id=qid
    )

    if upload_res.get("status") == "success":
        data_res = upload_res.get("data", {})
        file_id = data_res.get("fileId") or upload_res.get("fileId")
        file_url = data_res.get("fileUrl") or upload_res.get("fileUrl")
        safe_print(f"   🎉 Successfully uploaded {filename} to Google Drive!")
        safe_print(f"   🔗 Drive URL: {file_url}")
        return {
            "queueId": qid,
            "chapter": chap,
            "filename": filename,
            "fileId": file_id,
            "fileUrl": file_url,
            "lineCount": line_count,
            "status": "success"
        }
    else:
        safe_print(f"   ❌ Upload failed: {upload_res}")
        return {
            "queueId": qid,
            "chapter": chap,
            "status": "upload_failed",
            "error": str(upload_res)
        }


def run_backfill(limit: Optional[int] = None, dry_run: bool = False, target_queue_id: Optional[str] = None, workers: int = 4, force: bool = False) -> Dict[str, Any]:
    """
    Executes the backfill pipeline:
    - Finds eligible WorkQueue items
    - Downloads .mtp
    - Formats to [#1] text \n\n [#2] text
    - Uploads as export_txt_chap_{num}_ห้ามใช้ลงคำ.txt to Drive
    - Updates WorkQueue
    """
    candidates = fetch_backfill_candidates()

    if target_queue_id:
        candidates = [c for c in candidates if str(c.get("queueid")) == str(target_queue_id)]
        safe_print(f"🎯 Filtered for single Target Queue ID: {target_queue_id} ({len(candidates)} match)")

    if limit and limit > 0:
        candidates = candidates[:limit]
        safe_print(f"⏱️ Limited execution to first {limit} item(s)")

    stats = {
        "total": len(candidates),
        "succeeded": 0,
        "failed": 0,
        "skipped": 0,
        "results": []
    }

    if not candidates:
        safe_print("✨ No backfill candidates found. Everything is up to date!")
        return stats

    safe_print(f"\n🚀 Starting Backfill Export for {len(candidates)} chapter(s) (Workers: {workers})...")
    safe_print(f"🏷️ File Naming Pattern: export_txt_chap_num_ห้ามใช้ลงคำ")
    safe_print("=" * 70)

    if workers <= 1:
        for idx, item in enumerate(candidates):
            res = process_single_candidate(item, idx, len(candidates), dry_run=dry_run, force=force)
            status = res.get("status")
            if status in ["success", "dry_run"]:
                stats["succeeded"] += 1
            elif status == "skipped":
                stats["skipped"] += 1
            else:
                stats["failed"] += 1
            stats["results"].append(res)
    else:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_item = {
                executor.submit(process_single_candidate, item, idx, len(candidates), dry_run, force): item
                for idx, item in enumerate(candidates)
            }
            for future in as_completed(future_to_item):
                try:
                    res = future.result()
                    status = res.get("status")
                    if status in ["success", "dry_run"]:
                        stats["succeeded"] += 1
                    elif status == "skipped":
                        stats["skipped"] += 1
                    else:
                        stats["failed"] += 1
                    stats["results"].append(res)
                except Exception as exc:
                    item = future_to_item[future]
                    safe_print(f"❌ Worker thread exception for queue {item.get('queueid')}: {exc}")
                    stats["failed"] += 1

    safe_print("\n" + "=" * 70)
    safe_print(f"🏁 Backfill Summary: Total: {stats['total']} | Succeeded: {stats['succeeded']} | Skipped: {stats['skipped']} | Failed: {stats['failed']}")
    safe_print("=" * 70 + "\n")
    return stats


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Backfill Export TXT from MTP (Pattern: export_txt_chap_num_ห้ามใช้ลงคำ)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate run without downloading or uploading")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of items to process")
    parser.add_argument("--queue-id", type=str, default=None, help="Process specific WorkQueue item ID only")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads (default: 4)")
    parser.add_argument("--force", action="store_true", help="Force re-export even if [ocr txt] already exists")
    args = parser.parse_args()

    run_backfill(
        limit=args.limit,
        dry_run=args.dry_run,
        target_queue_id=args.queue_id,
        workers=args.workers,
        force=args.force
    )


if __name__ == "__main__":
    main()

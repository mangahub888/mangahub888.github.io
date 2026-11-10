#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Google Drive Manga OCR Pipeline (YOLO best.pt + PaddleOCR)
Designed for both GitHub Actions (Ubuntu CPU runner) and Local execution.

Workflow:
1. Downloads manga raw images from Google Drive folder (via gdown).
2. Detects text boxes/bubbles using YOLO (models/best.pt).
3. Recognizes text using PaddleOCR (in-process or via local server).
4. Packages images + OCR coordinates into MangaToolPlus (.mtp) format.
5. Saves OCR results JSON and summary TXT.
"""

import os
import sys

# Disable oneDNN/MKLDNN on CPU to prevent PIR instruction runtime bug:
# "ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]"
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import argparse
import json
import time
import base64
from datetime import datetime, timezone
from pathlib import Path

# Ensure UTF-8 output
if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def download_images_from_gdrive(folder_url_or_id, output_dir):
    """Downloads all raw image slices from Google Drive folder."""
    import gdown
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if "drive.google.com" in folder_url_or_id:
        url = folder_url_or_id
    else:
        url = f"https://drive.google.com/drive/folders/{folder_url_or_id}"

    print(f"📥 [Drive] Downloading manga images from: {url}")
    try:
        gdown.download_folder(url, output=str(out_path), quiet=False)
    except Exception as e:
        print(f"⚠️ Warning during gdown download_folder: {e}")

    images = sorted([
        str(f) for f in out_path.glob("*.*")
        if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
    ])
    return images


def image_to_data_url(image_path: Path, quality=90):
    """Reads image, normalizes to high-quality JPEG and returns dataUrl, width, height for MangaToolPlus .mtp."""
    from PIL import Image
    import io
    with Image.open(image_path) as im:
        if im.mode in ("RGBA", "P"):
            im = im.convert("RGB")
        w, h = im.size
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    data_url = f"data:image/jpeg;base64,{b64}"
    return data_url, w, h


def get_paddle_ocr_engine(lang="ch"):
    """Initializes in-process PaddleOCR engine."""
    from paddleocr import PaddleOCR
    print(f"⚙️ Initializing PaddleOCR engine (lang='{lang}')...")
    # For PaddleOCR 3.x / PaddleX: disable doc unwarping and doc orientation
    # to avoid heavy downloads and unnecessary page-level warping on crops
    init_kwargs = {
        "lang": lang,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "enable_mkldnn": False,
    }
    try:
        ocr = PaddleOCR(**init_kwargs)
    except TypeError:
        try:
            ocr = PaddleOCR(lang=lang, use_angle_cls=False, enable_mkldnn=False)
        except Exception:
            try:
                ocr = PaddleOCR(lang=lang, enable_mkldnn=False)
            except Exception:
                ocr = PaddleOCR(lang=lang)
    except Exception as e:
        print(f"⚠️ Fallback init PaddleOCR: {e}")
        ocr = PaddleOCR(lang=lang)
    return ocr


def box_iou(b1, b2):
    """Calculates Intersection-over-Union (IoU) between two bounding boxes."""
    x1 = max(b1[0], b2[0])
    y1 = max(b1[1], b2[1])
    x2 = min(b1[2], b2[2])
    y2 = min(b1[3], b2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
    area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0.0


def filter_overlapping_boxes(boxes, iou_thresh=0.4):
    """Filters duplicate overlapping boxes keeping the most complete ones."""
    if not boxes:
        return []
    boxes_sorted = sorted(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    kept = []
    for b in boxes_sorted:
        if not any(box_iou(b, k) > iou_thresh for k in kept):
            kept.append(b)
    kept.sort(key=lambda b: (b[1], b[0]))
    return kept


def detect_text_boxes_yolo(img_path, model_path, tile_height=2000):
    """
    Detects text boxes using YOLO best.pt model.
    Supports vertical tiling for ultra-long webtoon images.
    """
    from PIL import Image
    import numpy as np
    from ultralytics import YOLO

    model = YOLO(model_path)
    with Image.open(img_path) as pil_img:
        img_w, img_h = pil_img.size
        img_np = np.array(pil_img.convert("RGB"))

    boxes = []
    # If image is long vertical strip, tile vertically to maintain high resolution
    if img_h > tile_height:
        y1 = 0
        step = tile_height - 200  # 200px overlap
        while y1 < img_h:
            y2 = min(img_h, y1 + tile_height)
            tile = img_np[y1:y2, :]
            results = model.predict(tile, verbose=False, conf=0.2, iou=0.4)
            for r in results:
                for b in r.boxes:
                    coords = b.xyxy[0].cpu().numpy().tolist()
                    bx1, by1, bx2, by2 = coords
                    boxes.append([int(bx1), int(by1 + y1), int(bx2), int(by2 + y1)])
            if y2 >= img_h:
                break
            y1 += step
    else:
        results = model.predict(img_np, verbose=False, conf=0.2, iou=0.4)
        for r in results:
            for b in r.boxes:
                coords = b.xyxy[0].cpu().numpy().tolist()
                bx1, by1, bx2, by2 = coords
                boxes.append([int(bx1), int(by1), int(bx2), int(by2)])

    boxes = filter_overlapping_boxes(boxes, iou_thresh=0.4)
    return boxes, img_w, img_h, img_np


def extract_text_from_paddle(res, lang="ch"):
    """
    Extracts recognized text cleanly across all PaddleOCR versions (v2.x, v3.x, paddlex).
    Handles Python generators returned by PaddleX 3.7+ streaming pipelines.
    """
    if not res:
        return ""

    # In PaddleX 3.7+, predict() returns a generator by default.
    # Convert generator / iterator to list to force execution of the inference pipeline.
    if not isinstance(res, (list, tuple, dict, str, bytes)):
        try:
            res = list(res)
        except Exception:
            pass

    texts = []
    items = res if isinstance(res, (list, tuple)) else [res]

    for item in items:
        rec = None
        # 1. Try dict get() or attribute rec_texts (PaddleOCR 3.x / PaddleX OCRResult)
        if hasattr(item, "get") and callable(item.get):
            rec = item.get("rec_texts")
        if rec is None and hasattr(item, "rec_texts"):
            rec = getattr(item, "rec_texts")
        if rec is None and hasattr(item, "__getitem__"):
            try:
                rec = item["rec_texts"]
            except Exception:
                pass

        if rec is not None:
            if hasattr(rec, "tolist"):
                rec = rec.tolist()
            if isinstance(rec, (list, tuple)):
                for t in rec:
                    s = str(t).strip()
                    if s:
                        texts.append(s)
            elif isinstance(rec, str) and rec.strip():
                texts.append(rec.strip())

        # 2. Fallback for PaddleOCR 2.x: item is list of lines [[poly, (text, conf)], ...]
        elif isinstance(item, (list, tuple)):
            for line in item:
                if isinstance(line, (list, tuple)) and len(line) > 1:
                    sub = line[1]
                    if isinstance(sub, (list, tuple)) and len(sub) > 0:
                        s = str(sub[0]).strip()
                        if s:
                            texts.append(s)
                    elif isinstance(sub, str) and sub.strip():
                        texts.append(sub.strip())

    if not texts:
        return ""

    if lang in ["ch", "japan", "chinese", "jp"]:
        return "".join(texts)
    else:
        return " ".join(texts)


def run_ocr_on_chapter(image_files, model_path, lang="ch", ocr_server_url=None):
    """
    Runs text detection (best.pt) + text recognition (PaddleOCR) on all images.
    """
    import numpy as np
    from PIL import Image
    import requests

    use_server = False
    if ocr_server_url:
        try:
            r = requests.get(ocr_server_url, timeout=2)
            if r.status_code in [200, 404]:
                use_server = True
                print(f"🔗 Connected to running PaddleOCR server at {ocr_server_url}")
        except Exception:
            pass

    ocr_engine = None
    if not use_server:
        ocr_engine = get_paddle_ocr_engine(lang)

    results = {}
    print(f"\n🚀 Processing {len(image_files)} pages with YOLO best.pt + PaddleOCR ({'Server' if use_server else 'In-Process'})...\n")

    for idx, img_path_str in enumerate(image_files):
        p = Path(img_path_str)
        t0 = time.time()
        print(f"[{idx+1:02d}/{len(image_files)}] Processing {p.name}...")

        try:
            boxes, img_w, img_h, img_np = detect_text_boxes_yolo(str(p), model_path)
            lines = []

            for b_idx, box in enumerate(boxes):
                bx1, by1, bx2, by2 = box
                # Expand box slightly (6px) for border letters
                cx1 = max(0, bx1 - 6)
                cy1 = max(0, by1 - 6)
                cx2 = min(img_w, bx2 + 6)
                cy2 = min(img_h, by2 + 6)
                if cx2 <= cx1 or cy2 <= cy1:
                    continue

                crop = img_np[cy1:cy2, cx1:cx2]
                text = ""

                if use_server:
                    import cv2
                    _, enc = cv2.imencode(".png", cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
                    try:
                        res = requests.post(
                            f"{ocr_server_url}/ocr",
                            files={"upload": ("crop.png", enc.tobytes(), "image/png")},
                            data={"lang": lang},
                            timeout=30
                        )
                        if res.status_code == 200:
                            data = res.json()
                            parts = [item.get("text", "") for item in data.get("text_lines", []) if item.get("text")]
                            if lang in ["ch", "japan"]:
                                text = "".join(parts).strip()
                            else:
                                text = " ".join(parts).strip()
                    except Exception:
                        pass
                elif ocr_engine:
                    try:
                        # 1. Native PaddleOCR 3.x / PaddleX inference
                        if hasattr(ocr_engine, "predict"):
                            res = ocr_engine.predict(crop)
                            text = extract_text_from_paddle(res, lang=lang)
                    except Exception as e_pred:
                        print(f"      ⚠️ predict error on box {b_idx}: {e_pred}")

                    if not text:
                        try:
                            # 2. Fallback: ocr() call for PaddleOCR 2.x
                            res = ocr_engine.ocr(crop)
                            text = extract_text_from_paddle(res, lang=lang)
                        except Exception as e_ocr:
                            print(f"      ⚠️ ocr error on box {b_idx}: {e_ocr}")

                if text:
                    # 4 corner coordinates [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
                    poly_box = [
                        [cx1, cy1],
                        [cx2, cy1],
                        [cx2, cy2],
                        [cx1, cy2]
                    ]
                    lines.append({
                        "text": text,
                        "box": poly_box,
                        "rect": [cx1, cy1, cx2, cy2]
                    })

            elapsed = time.time() - t0
            print(f"  ✓ {p.name}: Found {len(boxes)} text regions -> {len(lines)} OCR lines ({elapsed:.2f}s)")
            for l_idx, l_obj in enumerate(lines[:3]):
                print(f"     [{l_idx+1}] {l_obj['text']}")
            if len(lines) > 3:
                print(f"     ... ({len(lines)-3} more lines)")

            results[p.name] = {
                "file": p.name,
                "lines_count": len(lines),
                "duration_seconds": round(elapsed, 2),
                "lines": lines,
                "boxes": boxes
            }
        except Exception as e:
            print(f"  ❌ Error processing {p.name}: {e}")
            results[p.name] = {
                "file": p.name,
                "lines_count": 0,
                "lines": [],
                "error": str(e)
            }

    return results


def build_mtp_package(image_files, ocr_results, output_mtp_path):
    """Constructs a valid MangaToolPlus (.mtp) project package."""
    print(f"\n📦 Packaging into MangaToolPlus format: {Path(output_mtp_path).name}...")
    project_data = {
        "version": "1.0.0",
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "currentMode": "ocr",  # Open directly in OCR mode to display bounding boxes and text immediately
        "currentFileIndex": 0,
        "appSettings": {
            "readingDirection": "ttb",
        },
        "fontRegistry": {},
        "fontRealNameMap": {},
        "fontPresetStyles": {},
        "fontFilesData": {},
        "files": [],
        "bannerData": {"top": None, "bottom": None},
        "ocrData": {},
        "tsData": {},
        "textLayersData": {},
        "textGroupsData": {},
        "detectedBubbles": {},
        "paintData": {},
        "originalImages": {},
    }

    for idx, img_path_str in enumerate(image_files):
        p = Path(img_path_str)
        fname = f"{idx+1:03d}.jpg"
        orig_key = p.name
        res = ocr_results.get(orig_key, {})
        lines = res.get("lines", [])
        boxes = res.get("boxes", [])

        # 1. Image metadata & Base64 (Standard JPEG)
        data_url, width, height = image_to_data_url(p)
        project_data["files"].append({
            "name": fname,
            "type": "image/jpeg",
            "width": width,
            "height": height,
            "dataUrl": data_url
        })

        # 2. ocrData
        project_data["ocrData"][fname] = [
            {
                "text": l.get("text", ""),
                "box": [[float(pt[0]), float(pt[1])] for pt in l.get("box", [])]
            }
            for l in lines
            if l.get("text")
        ]

        # 3. tsData (Editable typesetter / OCR layers)
        project_data["tsData"][fname] = [
            {
                "id": f"ts_{idx+1:03d}_{l_idx}",
                "text": l.get("text", ""),
                "originalText": l.get("text", ""),
                "translation": "",
                "box": [[float(pt[0]), float(pt[1])] for pt in l.get("box", [])],
                "visible": True,
                "selected": False,
                "type": "text",
                "fontType": "normal",
                "targetLayerId": None,
                "inpaintModel": None,
                "patchUrl": None,
                "patchExpansion": 0,
                "patchRect": None,
                "inpaintVisible": True,
            }
            for l_idx, l in enumerate(lines)
            if l.get("text")
        ]

        # 4. detectedBubbles
        bubbles_list = []
        if boxes:
            for b in boxes:
                bx1, by1, bx2, by2 = b
                bw = bx2 - bx1
                bh = by2 - by1
                poly = [
                    [float(bx1), float(by1)],
                    [float(bx2), float(by1)],
                    [float(bx2), float(by2)],
                    [float(bx1), float(by2)]
                ]
                bubbles_list.append({
                    "box": [int(bx1), int(by1), int(bw), int(bh)],
                    "polygon": poly,
                    "confidence": 0.95
                })
        elif lines:
            for l in lines:
                r = l.get("rect", [0, 0, 0, 0])
                bubbles_list.append({
                    "box": [int(r[0]), int(r[1]), int(r[2] - r[0]), int(r[3] - r[1])],
                    "polygon": [[float(pt[0]), float(pt[1])] for pt in l.get("box", [])],
                    "confidence": 0.95
                })
        project_data["detectedBubbles"][fname] = bubbles_list

    out_file = Path(output_mtp_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as fp:
        json.dump(project_data, fp, ensure_ascii=False)

    size_mb = out_file.stat().st_size / (1024 * 1024)
    print(f"🎉 Successfully exported .mtp project: {out_file} ({size_mb:.2f} MB)")
    return out_file


def get_drive_service(google_access_token=None, service_account_json=None):
    """
    Initializes Google Drive API service using:
    1. OAuth Bearer Token (passed directly from GAS or CLI)
    2. Google Service Account JSON (env GDRIVE_SERVICE_ACCOUNT_KEY or file)
    """
    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("⚠️ googleapiclient not installed. Google Drive upload unavailable.")
        return None

    # 1. OAuth Access Token (e.g. from GAS ScriptApp.getOAuthToken())
    token = google_access_token or os.environ.get("GOOGLE_ACCESS_TOKEN")
    if token and token.strip():
        try:
            from google.oauth2.credentials import Credentials
            creds = Credentials(token.strip())
            service = build("drive", "v3", credentials=creds)
            print("🔑 Authenticated Google Drive via OAuth Access Token (GAS)")
            return service
        except Exception as e:
            print(f"⚠️ Failed to init with OAuth token: {e}")

    # 2. Service Account JSON
    sa = service_account_json or os.environ.get("GDRIVE_SERVICE_ACCOUNT_KEY")
    if sa and sa.strip():
        try:
            from google.oauth2 import service_account
            scopes = ["https://www.googleapis.com/auth/drive"]
            if os.path.exists(sa):
                creds = service_account.Credentials.from_service_account_file(sa, scopes=scopes)
            else:
                info = json.loads(sa)
                creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            service = build("drive", "v3", credentials=creds)
            print("🔑 Authenticated Google Drive via Service Account")
            return service
        except Exception as e:
            print(f"⚠️ Failed to init with Service Account: {e}")

    return None


def get_source_folder_name(drive_service, folder_id):
    """Retrieves the real folder name from Google Drive."""
    if not drive_service:
        return ""
    try:
        meta = drive_service.files().get(fileId=folder_id, fields="name").execute()
        return meta.get("name", "")
    except Exception:
        return ""


def upload_file_to_source_folder(drive_service, target_folder_id, file_path):
    """
    Uploads a local file directly into target_folder_id (Source Google Drive folder).
    If a file with the same name already exists in target_folder_id, updates it cleanly.
    """
    if not drive_service:
        print(f"⚠️ No authenticated Google Drive service. Skipping cloud upload for {file_path}.")
        return None

    from googleapiclient.http import MediaFileUpload
    p = Path(file_path)
    file_name = p.name
    size_kb = p.stat().st_size / 1024
    size_str = f"{size_kb / 1024:.2f} MB" if size_kb >= 1024 else f"{size_kb:.2f} KB"
    print(f"📤 Uploading {file_name} ({size_str}) directly into Drive source folder ({target_folder_id})...")

    try:
        # Check if file with same name already exists in this folder
        query = f"'{target_folder_id}' in parents and name='{file_name}' and trashed=false"
        existing = drive_service.files().list(q=query, fields="files(id, name)").execute().get("files", [])

        mimetype = "text/plain; charset=utf-8" if (p.suffix.lower() == ".txt" or "PROMPT" in p.name.upper()) else "application/octet-stream"
        media = MediaFileUpload(str(p), mimetype=mimetype, resumable=True)

        if existing:
            file_id = existing[0]["id"]
            print(f"   🔄 File already exists (ID: {file_id}). Updating existing file...")
            updated = drive_service.files().update(
                fileId=file_id,
                media_body=media
            ).execute()
            print(f"   ✓ Successfully updated {file_name} in Google Drive source folder (ID: {updated.get('id')})")
            return updated.get("id")
        else:
            meta = {
                "name": file_name,
                "parents": [target_folder_id]
            }
            uploaded = drive_service.files().create(
                body=meta,
                media_body=media,
                fields="id"
            ).execute()
            print(f"   ✓ Successfully uploaded {file_name} directly to Google Drive source folder (ID: {uploaded.get('id')})")
            return uploaded.get("id")
    except Exception as e:
        print(f"❌ Failed to upload {file_name} to Google Drive: {e}")
        return None


def format_ocr_text_blocks(image_files, ocr_results):
    """
    Formats recognized OCR lines across all chapter pages into sequential numbered blocks.

    Format:
    [#1] text line 1

    [#2] text line 2

    [#3] text line 3
    """
    import re
    blocks = []
    counter = 1

    for img_path_str in image_files:
        fname = Path(img_path_str).name
        data = ocr_results.get(fname, {})
        lines = data.get("lines", [])

        for line_obj in lines:
            raw_text = line_obj.get("text", "")
            if not raw_text:
                continue
            # Normalize internal newlines to spaces while preserving original text & spacing
            cleaned_text = re.sub(r"\s+", " ", str(raw_text)).strip()
            if not cleaned_text:
                continue

            blocks.append(f"[#{counter}] {cleaned_text}")
            counter += 1

    if not blocks:
        return ""

    return "\n\n".join(blocks) + "\n"


def sanitize_filename(name: str) -> str:
    """
    Sanitizes filenames by replacing illegal filesystem characters
    (: " < > | * ? \r \n \\ /) with underscores to maintain NTFS/cross-platform
    and GitHub Actions artifact compatibility.
    """
    import re
    illegal_chars = set(':"<>|*?\r\n\\/')
    cleaned = ''.join('_' if c in illegal_chars else c for c in (name or ''))
    cleaned = re.sub(r'_+', '_', cleaned).strip('_ ')
    return cleaned or 'chapter'


def build_prompt2_tempt_content(manga_name="", chapter_num="", folder_name="", ocr_text="", queue_id="", doc_url="", gas_url=None, passcode="10211032", manga_list=None, queue_items=None):
    """
    Constructs the PROMPT2 TEMPT content according to MangaHub AI Translation spec:
    1. ลิงก์ Google Docs ของเอกสารอ้างอิง (แท็บแรกเป็น Glossary)
    2. ตอนที่ให้ใช้เป็นข้อมูลอ้างอิง 5 ตอนล่าสุด
    3. เลขตอนที่กำลังจะแปล เลขตอนดึงจากชื่อตอนที่ทำการอัพโหลดหน้ามาจากชื่อโฟลเดอร์มาใส่ตรงนี้
    4. เนื้อหาต้นฉบับที่ต้องแปล (วางข้อความได้เลย) : เอาเนื้อหาจาก txt มาแนบวางใต้ข้อ 4
    """
    import urllib.request
    import json
    import re

    final_doc_url = str(doc_url or "").strip()
    ref_chapters_str = ""
    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"

    # Extract numerical chapter value
    curr_ch_val = None
    num_match = re.search(r"([0-9]+(?:\.[0-9]+)?)", str(chapter_num) or str(folder_name))
    if num_match:
        try:
            curr_ch_val = float(num_match.group(1)) if "." in num_match.group(1) else int(num_match.group(1))
        except Exception:
            pass

    # If doc_url not provided, fetch from GAS MangaList
    manga_id = None
    if not final_doc_url or curr_ch_val is not None:
        try:
            if manga_list is None:
                payload = {"action": "GET_MANGA_LIST", "passcode": passcode, "payload": {}}
                req = urllib.request.Request(gas_api_url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    manga_list = res_data.get("data", [])
            if True:
                
                # Match manga
                matched = None
                m_clean = re.sub(r"[^\w\u0e00-\u0e7f]+", "", str(manga_name).lower())
                for m in manga_list:
                    m_name_clean = re.sub(r"[^\w\u0e00-\u0e7f]+", "", str(m.get("manganame", "")).lower())
                    if m.get("manganame") == manga_name or (m_clean and m_clean in m_name_clean) or (m_name_clean and m_name_clean in m_clean):
                        matched = m
                        break

                if matched:
                    manga_id = matched.get("mangaid")
                    if not final_doc_url:
                        final_doc_url = str(matched.get("translationdocurl") or "").strip()
        except Exception as e:
            print(f"⚠️ Could not fetch manga info from GAS: {e}")

    # Fetch previous chapters from WorkQueue if possible
    if manga_id and curr_ch_val is not None:
        try:
            q_items = queue_items
            if q_items is None:
                payload = {"action": "GET_WORK_QUEUE", "passcode": passcode, "payload": {"month": "all", "year": "all"}}
                req = urllib.request.Request(gas_api_url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    q_data = json.loads(resp.read().decode("utf-8"))
                    q_items = q_data.get("data", [])
            if True:
                prev_chaps = []
                for q in q_items:
                    if str(q.get("mangaid")) == str(manga_id):
                        ch_str = str(q.get("chapter", ""))
                        c_match = re.search(r"([0-9]+(?:\.[0-9]+)?)", ch_str)
                        if c_match:
                            try:
                                c_num = float(c_match.group(1)) if "." in c_match.group(1) else int(c_match.group(1))
                                if c_num < curr_ch_val:
                                    prev_chaps.append(c_num)
                            except Exception:
                                pass
                prev_chaps = sorted(list(set(prev_chaps)))
                if prev_chaps:
                    last5 = prev_chaps[-5:]
                    ref_chapters_str = "ตอนที่ " + ", ".join(str(c) for c in last5)
        except Exception as e:
            print(f"⚠️ Could not fetch queue history: {e}")

    # Fallback calculation if queue didn't return previous chapters
    if not ref_chapters_str and curr_ch_val is not None:
        if curr_ch_val > 5:
            last5 = list(range(int(curr_ch_val) - 5, int(curr_ch_val)))
            ref_chapters_str = "ตอนที่ " + ", ".join(str(c) for c in last5)
        elif curr_ch_val > 1:
            last5 = list(range(1, int(curr_ch_val)))
            ref_chapters_str = "ตอนที่ " + ", ".join(str(c) for c in last5)
        else:
            ref_chapters_str = "ไม่มี (ตอนแรก)"

    # Resolve chapter display for item 3
    # "เลขตอนดึงจากชื่อตอนที่ทำการอัพโหลดหน้ามาจากชื่อโฟลเดอร์มาใส่ตรงนี้"
    ch_display = ""
    if folder_name and folder_name.strip():
        f_clean = folder_name.strip()
        ch_display = f_clean
    elif chapter_num and str(chapter_num).strip():
        c_str = str(chapter_num).strip()
        ch_display = f"ตอนที่ {c_str}" if not c_str.startswith("ตอน") else c_str
    elif curr_ch_val is not None:
        ch_display = f"ตอนที่ {curr_ch_val}"
    else:
        ch_display = "-"

    # Build prompt content
    content_lines = [
        "1.ลิงก์ Google Docs ของเอกสารอ้างอิง (แท็บแรกเป็น Glossary)",
        final_doc_url,
        "",
        "2. ตอนที่ให้ใช้เป็นข้อมูลอ้างอิง 5 ตอนล่าสุด",
        ref_chapters_str or "-",
        "",
        "3. เลขตอนที่กำลังจะแปล",
        ch_display,
        "",
        "4. เนื้อหาต้นฉบับที่ต้องแปล (วางข้อความได้เลย) :",
        (ocr_text or "").strip()
    ]

    return "\n".join(content_lines) + "\n"


def notify_gas_ocr_completed(folder_id, queue_id="", chapter="", manga_name="", mtp_file_id="", txt_file_id="", prompt_file_id="", gas_url=None, passcode="10211032"):
    """
    Notifies Google Apps Script to mark OCR as 'เสร็จแล้ว' in WorkQueue (without attaching links to worklink).
    """
    import urllib.request
    import json

    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
    payload = {
        "action": "COMPLETE_MANGA_OCR",
        "passcode": passcode,
        "payload": {
            "folderId": folder_id,
            "queueId": queue_id,
            "chapter": chapter,
            "mangaName": manga_name
        }
    }
    try:
        req = urllib.request.Request(
            gas_api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        print(f"\n📡 [GAS Update] Notifying Google Apps Script to mark OCR as 'เสร็จแล้ว' (Queue: {queue_id or folder_id})...")
        with urllib.request.urlopen(req, timeout=30) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("status") == "success":
                up = res.get("data", {}).get("updated", {})
                print(f"   ✓ Successfully updated WorkQueue in Google Sheet! Chapter {up.get('chapter', chapter)} marked as OCR 'เสร็จแล้ว'!")
            else:
                print(f"   ⚠️ GAS response: {res}")
    except Exception as e:
        print(f"   ⚠️ Failed to notify GAS OCR completion: {e}")


def main():
    parser = argparse.ArgumentParser(description="Manga OCR Pipeline (best.pt + PaddleOCR)")
    parser.add_argument("--folder-id", default="19P4c1nLybE1KshF-7HSbhfQPX2H60A54", help="Google Drive folder ID or URL")
    parser.add_argument("--manga-name", default="", help="Manga title")
    parser.add_argument("--chapter-num", default="", help="Chapter number")
    parser.add_argument("--mtp-filename", default="", help="Custom filename for the .mtp project file (default: (ชั่วคราว) <manga_name> ตอนที่ <chapter_num>.mtp)")
    parser.add_argument("--txt-filename", default="", help="Custom filename for the OCR text file")
    parser.add_argument("--queue-id", default="", help="WorkQueue item ID to update status in Google Sheet")
    parser.add_argument("--gas-url", default=None, help="GAS Web App exec URL")
    parser.add_argument("--gas-passcode", default="10211032", help="GAS Passcode")
    parser.add_argument("--lang", default="ch", help="OCR Language code (ch, japan, korean, en)")
    parser.add_argument("--output-dir", default="./ocr_output", help="Output directory")
    parser.add_argument("--model-path", default=None, help="Path to best.pt text detection model")
    parser.add_argument("--ocr-server-url", default="http://127.0.0.1:8080", help="Local PaddleOCR server URL")
    parser.add_argument("--google-access-token", default="", help="Google OAuth Access Token from GAS")
    parser.add_argument("--service-account", default=None, help="Path or raw JSON of Google Service Account")
    parser.add_argument("--prompt-filename", default="PROMPT2 TEMPT", help="Custom filename for the AI translation prompt template")
    parser.add_argument("--doc-url", default="", help="Google Docs reference URL from manga settings")
    parser.add_argument("--upload-to-source", action="store_true", default=True, help="Upload .mtp directly into source folder")
    parser.add_argument("--cleanup", action="store_true", default=False, help="Clean up local images and files after upload")
    args = parser.parse_args()

    # Clean folder ID
    clean_folder_id = args.folder_id.split("/")[-1].split("?")[0].strip()

    # Initialize Drive service early
    drive_service = get_drive_service(
        google_access_token=args.google_access_token,
        service_account_json=args.service_account
    )
    folder_real_name = get_source_folder_name(drive_service, clean_folder_id) if drive_service else ""

    # Resolve manga title & chapter name for file naming
    manga_title = args.manga_name.strip()
    chapter_num = args.chapter_num.strip()
    c_str = chapter_num
    if c_str.endswith(".0"):
        c_str = c_str[:-2]
    if c_str.startswith("ตอนที่"):
        chap_display = c_str
    elif c_str.startswith("ตอน"):
        chap_display = f"ตอนที่ {c_str[3:].strip()}"
    elif c_str:
        chap_display = f"ตอนที่ {c_str}"
    else:
        chap_display = ""

    if manga_title and chap_display:
        raw_name = f"{manga_title}_{chap_display.replace(' ', '_')}"
        mtp_raw_name = f"(ชั่วคราว) {manga_title} {chap_display}"
    elif manga_title:
        raw_name = manga_title
        mtp_raw_name = f"(ชั่วคราว) {manga_title}"
    elif folder_real_name:
        raw_name = folder_real_name
        mtp_raw_name = f"(ชั่วคราว) {folder_real_name}"
    else:
        raw_name = f"chapter_{clean_folder_id[:8]}"
        mtp_raw_name = f"(ชั่วคราว) chapter_{clean_folder_id[:8]}"

    base_filename = sanitize_filename(raw_name)
    default_mtp_filename = f"{sanitize_filename(mtp_raw_name)}.mtp"

    # Resolve model path
    model_path = args.model_path
    if not model_path:
        candidates = [
            PROJECT_ROOT / "models" / "best.pt",
            Path("D:/MangaToolPlus_TEST/models/best.pt"),
            Path("models/best.pt"),
        ]
        for c in candidates:
            if c.exists():
                model_path = str(c)
                break

    if not model_path or not os.path.exists(model_path):
        print(f"❌ Error: YOLO model 'best.pt' not found at {model_path}!")
        sys.exit(1)

    print("=================================================================")
    print(f"📖 Manga OCR Pipeline: {base_filename}")
    print(f"📁 Target Google Drive Folder: {clean_folder_id} ({folder_real_name or 'Source Folder'})")
    print(f"🧠 Model: {model_path} + PaddleOCR (lang='{args.lang}')")
    print("=================================================================\n")

    # 1. Download images
    download_dir = Path("./downloaded_manga")
    image_files = download_images_from_gdrive(args.folder_id, download_dir)
    if not image_files:
        print("❌ No images found in folder!")
        sys.exit(1)

    # 2. Run OCR
    t_start = time.time()
    ocr_results = run_ocr_on_chapter(
        image_files=image_files,
        model_path=model_path,
        lang=args.lang,
        ocr_server_url=args.ocr_server_url
    )
    total_time = time.time() - t_start

    # 3. Save JSON, text summary, and formatted OCR text file
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / f"{base_filename}_ocr.json"
    with open(json_path, "w", encoding="utf-8") as fp:
        json.dump(ocr_results, fp, ensure_ascii=False, indent=2)

    # Export formatted OCR .txt file ([#1] line 1 \n\n [#2] line 2 ...)
    ocr_txt_content = format_ocr_text_blocks(image_files, ocr_results)
    txt_filename = args.txt_filename.strip() if args.txt_filename else f"{base_filename}_ocr.txt"
    ocr_txt_path = out_dir / txt_filename
    with open(ocr_txt_path, "w", encoding="utf-8") as fp:
        fp.write(ocr_txt_content)

    summary_path = out_dir / f"{base_filename}_summary.txt"
    total_lines = sum(data.get("lines_count", 0) for data in ocr_results.values())
    with open(summary_path, "w", encoding="utf-8") as fp:
        fp.write(f"=== {base_filename} OCR Summary ===\n")
        fp.write(f"Total Pages: {len(image_files)} | Total Lines: {total_lines} | Time: {total_time:.1f}s\n")
        fp.write("=" * 60 + "\n\n")
        for f in image_files:
            fname = Path(f).name
            data = ocr_results.get(fname, {})
            fp.write(f"--- {fname} ({data.get('lines_count', 0)} lines) ---\n")
            for line in data.get("lines", []):
                fp.write(f"  {line.get('text', '')}\n")
            fp.write("\n")

    # Build AI Translation Prompt File (PROMPT2 TEMPT)
    prompt_filename = args.prompt_filename.strip() if args.prompt_filename else "PROMPT2 TEMPT"
    prompt_content = build_prompt2_tempt_content(
        manga_name=manga_title,
        chapter_num=chapter_num,
        folder_name=folder_real_name,
        ocr_text=ocr_txt_content,
        queue_id=args.queue_id,
        doc_url=args.doc_url,
        gas_url=args.gas_url,
        passcode=args.gas_passcode
    )
    prompt_path = out_dir / prompt_filename
    with open(prompt_path, "w", encoding="utf-8") as fp:
        fp.write(prompt_content)
    
    # Save a backup copy with .txt extension as well
    ascii_prompt = out_dir / f"{prompt_filename}.txt"
    with open(ascii_prompt, "w", encoding="utf-8") as fp:
        fp.write(prompt_content)

    print(f"📄 AI Translation Prompt File: {prompt_path}")

    # 4. Build MangaToolPlus .mtp project file
    # Default: (ชั่วคราว) <ชื่อเรื่อง> ตอนที่ <เลขตอน>.mtp
    passed_mtp = (getattr(args, "mtp_filename", "") or "").strip()
    if passed_mtp and passed_mtp.lower() != "tempt.mtp":
        mtp_filename = passed_mtp
    else:
        mtp_filename = default_mtp_filename

    if not mtp_filename.lower().endswith(".mtp"):
        mtp_filename += ".mtp"
    mtp_path = out_dir / mtp_filename
    build_mtp_package(image_files, ocr_results, mtp_path)

    # ASCII-safe copies for cross-platform safety
    import shutil
    ascii_mtp = out_dir / "chapter.mtp"
    if mtp_path.resolve() != ascii_mtp.resolve():
        shutil.copy2(mtp_path, ascii_mtp)
    ascii_txt = out_dir / "chapter_ocr.txt"
    if ocr_txt_path.resolve() != ascii_txt.resolve():
        shutil.copy2(ocr_txt_path, ascii_txt)

    print("\n=================================================================")
    print(f"🏁 Finished OCR for {len(image_files)} pages in {total_time:.1f}s ({total_time/60:.2f} mins)!")
    print(f"📄 OCR Text File: {ocr_txt_path}")
    print(f"📄 Debug Summary: {summary_path}")
    print(f"📦 MTP Project: {mtp_path}")
    print("=================================================================")

    # 5. Upload .MTP and OCR .TXT directly into source Google Drive folder
    uploaded_mtp_id = None
    uploaded_txt_id = None
    uploaded_prompt_id = None
    if args.upload_to_source and drive_service:
        print(f"\n☁️ [Google Drive Upload] 1/3 Uploading {mtp_filename} directly into source folder...")
        uploaded_mtp_id = upload_file_to_source_folder(drive_service, clean_folder_id, mtp_path)

        print("\n☁️ [Google Drive Upload] 2/3 Uploading OCR .txt directly into source folder...")
        uploaded_txt_id = upload_file_to_source_folder(drive_service, clean_folder_id, ocr_txt_path)

        print(f"\n☁️ [Google Drive Upload] 3/3 Uploading {prompt_filename} directly into source folder...")
        uploaded_prompt_id = upload_file_to_source_folder(drive_service, clean_folder_id, prompt_path)
    elif not drive_service:
        print("\n⚠️ Google Drive service not initialized. Files saved locally in ocr_output/")

    # Notify GAS WorkQueue that OCR has finished
    notify_gas_ocr_completed(
        folder_id=clean_folder_id,
        queue_id=args.queue_id,
        chapter=args.chapter_num,
        manga_name=args.manga_name,
        mtp_file_id=uploaded_mtp_id or "",
        txt_file_id=uploaded_txt_id or "",
        prompt_file_id=uploaded_prompt_id or "",
        gas_url=args.gas_url,
        passcode=args.gas_passcode
    )

    # 6. Cleanup local files if requested
    if args.cleanup:
        print("\n🧹 [Cleanup] Clearing downloaded images and temporary OCR files from disk...")
        try:
            if download_dir.exists():
                shutil.rmtree(download_dir, ignore_errors=True)
            if out_dir.exists():
                shutil.rmtree(out_dir, ignore_errors=True)
            print("✓ Local disk cleanup completed successfully!")
        except Exception as e:
            print(f"⚠️ Cleanup warning: {e}")


if __name__ == "__main__":
    main()

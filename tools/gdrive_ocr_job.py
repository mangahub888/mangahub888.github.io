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


def image_to_data_url(image_path: Path):
    """Reads image and returns dataUrl, width, height for MangaToolPlus .mtp."""
    from PIL import Image
    with Image.open(image_path) as im:
        w, h = im.size
        fmt = (im.format or 'JPEG').lower()
        if fmt == 'jpg':
            fmt = 'jpeg'
        mime = f"image/{fmt}"

    with open(image_path, "rb") as fp:
        b64 = base64.b64encode(fp.read()).decode("utf-8")
    data_url = f"data:{mime};base64,{b64}"
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
    }
    try:
        ocr = PaddleOCR(**init_kwargs)
    except TypeError:
        try:
            ocr = PaddleOCR(lang=lang, use_angle_cls=False)
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
        "currentMode": "typesetter",
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

    for img_path_str in image_files:
        p = Path(img_path_str)
        fname = p.name
        res = ocr_results.get(fname, {})
        lines = res.get("lines", [])

        # 1. Image metadata & Base64
        data_url, width, height = image_to_data_url(p)
        project_data["files"].append({
            "name": fname,
            "type": "image/jpeg" if p.suffix.lower() in [".jpg", ".jpeg"] else f"image/{p.suffix.lower().lstrip('.')}",
            "width": width,
            "height": height,
            "dataUrl": data_url
        })

        # 2. ocrData
        project_data["ocrData"][fname] = [
            {"text": l.get("text", ""), "box": l.get("box", [])}
            for l in lines
            if l.get("text")
        ]

        # 3. tsData (Editable typesetter layers)
        project_data["tsData"][fname] = [
            {
                "id": f"ts_{p.stem}_{l_idx}",
                "text": l.get("text", ""),
                "originalText": l.get("text", ""),
                "translation": "",
                "box": l.get("box", []),
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
        project_data["detectedBubbles"][fname] = [
            {
                "box": [l.get("rect", [0, 0, 0, 0])[0], l.get("rect", [0, 0, 0, 0])[1],
                        l.get("rect", [0, 0, 0, 0])[2] - l.get("rect", [0, 0, 0, 0])[0],
                        l.get("rect", [0, 0, 0, 0])[3] - l.get("rect", [0, 0, 0, 0])[1]],
                "polygon": l.get("box"),
                "confidence": 0.95
            }
            for l in lines
        ]

    out_file = Path(output_mtp_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as fp:
        json.dump(project_data, fp, ensure_ascii=False)

    size_mb = out_file.stat().st_size / (1024 * 1024)
    print(f"🎉 Successfully exported .mtp project: {out_file} ({size_mb:.2f} MB)")
    return out_file


def main():
    parser = argparse.ArgumentParser(description="Manga OCR Pipeline (best.pt + PaddleOCR)")
    parser.add_argument("--folder-id", default="19P4c1nLybE1KshF-7HSbhfQPX2H60A54", help="Google Drive folder ID or URL")
    parser.add_argument("--manga-name", default="ราชันนักฆ่าเกิดใหม่เป็นลูกเขย", help="Manga title")
    parser.add_argument("--chapter-num", default="35", help="Chapter number")
    parser.add_argument("--lang", default="ch", help="OCR Language code (ch, japan, korean, en)")
    parser.add_argument("--output-dir", default="./ocr_output", help="Output directory")
    parser.add_argument("--model-path", default=None, help="Path to best.pt text detection model")
    parser.add_argument("--ocr-server-url", default="http://127.0.0.1:8080", help="Local PaddleOCR server URL")
    args = parser.parse_args()

    # Resolve model path
    model_path = args.model_path
    if not model_path:
        # Check standard locations
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
    print(f"📖 Manga OCR Pipeline: {args.manga_name} (ตอนที่ {args.chapter_num})")
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

    # 3. Save JSON and text summary
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / f"ocr_{args.manga_name}_ch{args.chapter_num}.json"
    with open(json_path, "w", encoding="utf-8") as fp:
        json.dump(ocr_results, fp, ensure_ascii=False, indent=2)

    summary_path = out_dir / f"ocr_{args.manga_name}_ch{args.chapter_num}_summary.txt"
    total_lines = sum(data.get("lines_count", 0) for data in ocr_results.values())
    with open(summary_path, "w", encoding="utf-8") as fp:
        fp.write(f"=== {args.manga_name} ตอนที่ {args.chapter_num} OCR Summary ===\n")
        fp.write(f"Total Pages: {len(image_files)} | Total Lines: {total_lines} | Time: {total_time:.1f}s\n")
        fp.write("=" * 60 + "\n\n")
        for f in image_files:
            fname = Path(f).name
            data = ocr_results.get(fname, {})
            fp.write(f"--- {fname} ({data.get('lines_count', 0)} lines) ---\n")
            for line in data.get("lines", []):
                fp.write(f"  {line.get('text', '')}\n")
            fp.write("\n")

    # 4. Build .mtp file
    mtp_path = out_dir / f"{args.manga_name}_ตอนที่_{args.chapter_num}.mtp"
    build_mtp_package(image_files, ocr_results, mtp_path)

    print("\n=================================================================")
    print(f"🏁 Finished OCR for {len(image_files)} pages in {total_time:.1f}s ({total_time/60:.2f} mins)!")
    print(f"📄 Text Summary: {summary_path}")
    print(f"📦 MTP Project: {mtp_path}")
    print("=================================================================")


if __name__ == "__main__":
    main()

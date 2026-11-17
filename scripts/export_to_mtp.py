"""
MangaToolPlus (.mtp) Exporter
Converts image files and OCR results into MangaToolPlus's native .mtp project format.
"""

import sys
import os
import json
import base64
import time
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.services.ocr_service import scan_with_ocr_server, scan_with_easyocr, scan_with_google


def image_to_data_url(image_path: Path) -> tuple[str, int, int]:
    """Reads image file and returns (dataUrl, width, height)."""
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


def export_chapter_to_mtp(
    images_dir: str | Path,
    output_mtp_path: str | Path,
    lang: str = "ch",
    engine: str = "paddle",
    ocr_server_url: str = "http://127.0.0.1:8080",
    detect_model_path: str = None
) -> dict:
    """
    Scans all images in images_dir and packages them into a native .mtp project file.
    """
    images_dir = Path(images_dir)
    image_files = sorted([
        f for f in images_dir.glob("*.*")
        if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
    ])

    if not image_files:
        raise ValueError(f"No image files found in {images_dir}")

    if detect_model_path is None:
        default_model = PROJECT_ROOT / "models" / "best.pt"
        if default_model.exists():
            detect_model_path = str(default_model)

    print(f"📦 Packaging {len(image_files)} pages into .mtp project: {Path(output_mtp_path).name}")
    print(f"⚙️ Engine: {engine} | Lang: {lang} | Custom Model: {detect_model_path}")

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

    t_start = time.time()
    for idx, img_path in enumerate(image_files):
        t0 = time.time()
        print(f"[{idx+1}/{len(image_files)}] Processing {img_path.name}...")

        # 1. Base64 & metadata
        data_url, width, height = image_to_data_url(img_path)
        project_data["files"].append({
            "name": img_path.name,
            "type": "image/jpeg" if img_path.suffix.lower() in [".jpg", ".jpeg"] else f"image/{img_path.suffix.lower().lstrip('.')}",
            "width": width,
            "height": height,
            "dataUrl": data_url
        })

        # 2. Run OCR
        with open(img_path, "rb") as fp:
            content = fp.read()

        if engine == "paddle":
            res = scan_with_ocr_server(
                image_content=content,
                langs_list=[lang],
                server_url=ocr_server_url,
                detect_model_path=detect_model_path,
            )
        elif engine == "easyocr":
            import numpy as np
            with Image.open(img_path) as pil_img:
                np_img = np.array(pil_img.convert("RGB"))
            res = scan_with_easyocr(np_img, [lang])
        elif engine == "google":
            res = scan_with_google(content)
        else:
            res = {"lines": [], "bubbles": []}

        lines = res.get("lines", [])
        bubbles = res.get("bubbles", [])

        # 3. Populate ocrData
        project_data["ocrData"][img_path.name] = [
            {"text": l.get("text", ""), "box": l.get("box", [])}
            for l in lines
            if l.get("text")
        ]

        # 4. Populate tsData (Typesetter Layers)
        project_data["tsData"][img_path.name] = [
            {
                "id": f"ts_{img_path.stem}_{l_idx}",
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

        # 5. Populate detectedBubbles
        project_data["detectedBubbles"][img_path.name] = [
            {
                "box": b.get("box"),
                "polygon": b.get("polygon"),
                "confidence": b.get("confidence", 0.9)
            }
            for b in bubbles
        ]

        elapsed = time.time() - t0
        print(f"   -> {len(lines)} lines | {len(bubbles)} bubbles ({elapsed:.2f}s)")

    total_time = time.time() - t_start
    print(f"\n✓ Completed OCR in {total_time:.2f}s ({total_time/60:.2f} mins)")

    # Write .mtp file
    out_file = Path(output_mtp_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as fp:
        json.dump(project_data, fp, ensure_ascii=False)

    size_mb = out_file.stat().st_size / (1024 * 1024)
    print(f"🎉 Successfully exported to .mtp: {out_file} ({size_mb:.2f} MB)")
    return project_data


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Export Manga to MangaToolPlus .mtp project")
    parser.add_argument("--images-dir", default=r"C:\Users\HP01\.gemini\antigravity\brain\57c1751d-b1f0-4dc3-8a6e-b963a7c5079b\scratch\gd_test", help="Directory of images")
    parser.add_argument("--output", default=r"D:\MangaToolPlus_TEST\第34话.mtp", help="Output .mtp file path")
    parser.add_argument("--lang", default="ch", help="Language code (ch, japan, korean, en)")
    parser.add_argument("--engine", default="paddle", choices=["paddle", "easyocr", "google"], help="OCR Engine")
    args = parser.parse_args()

    export_chapter_to_mtp(
        images_dir=args.images_dir,
        output_mtp_path=args.output,
        lang=args.lang,
        engine=args.engine
    )

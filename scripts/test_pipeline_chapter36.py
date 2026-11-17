"""
Chapter 36 MangaToolPlus Local & CI Test Pipeline
=================================================
Automates:
1. Downloading images from Google Drive (Chapter 36).
2. Fetching translation text directly from Google Docs tab (t.bdbfibdpplpv).
3. Numbered translation parsing and matching with OCR layers, filtering unmatched layers.
4. Cleaning/inpainting speech bubbles using offline LaMa model (models/big-lama.pt) as INDIVIDUAL LAYERS per bubble.
5. Saving/updating native MangaToolPlus (.mtp) project format.
6. Typesetting translation onto images ("วางคำแปลลงบนภาพ") with font "TF BOLD".
7. Exporting to native editable PSD format via ag-psd standalone script:
   - Background Layer = Original uncleaned image (ภาพก่อน Inpaint)
   - Inpaint Patches Group = กล่องละ 1 เลเยอร์
   - Translated Text Group = ข้อความภาษาไทย ฟอนต์ "TF BOLD"

Usage:
  python scripts/test_pipeline_chapter36.py --limit 3    # Quick test on first 3 pages
  python scripts/test_pipeline_chapter36.py --full       # Full chapter test
"""

import os
import sys
import argparse
import json
import time
import re
import math
import subprocess
import urllib.request
from pathlib import Path
from PIL import Image
import numpy as np
import cv2
import pythainlp

# Ensure UTF-8 output on Windows
if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Standalone LaMa Runner (Zero dependency on app.services)
class StandaloneLama:
    """Lightweight standalone LaMa TorchScript runner."""
    def __init__(self, model_path, device=None):
        import torch
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = device
        print(f"🧠 Loading offline LaMa model from {model_path} onto {self.device}...")
        self.model = torch.jit.load(str(model_path), map_location=self.device)
        self.model.eval()
        self.model.to(self.device)
        print("   ✓ LaMa model ready!")

    def inpaint(self, image_np, mask_np):
        import torch
        h, w = image_np.shape[:2]
        div = 8
        new_h = int(np.ceil(h / div) * div)
        new_w = int(np.ceil(w / div) * div)

        pad_bottom = new_h - h
        pad_right = new_w - w

        img_pad = cv2.copyMakeBorder(image_np, 0, pad_bottom, 0, pad_right, cv2.BORDER_REFLECT)
        mask_pad = cv2.copyMakeBorder(mask_np, 0, pad_bottom, 0, pad_right, cv2.BORDER_CONSTANT, value=0)

        img_rgb = cv2.cvtColor(img_pad, cv2.COLOR_BGR2RGB)
        img_t = torch.from_numpy(img_rgb).float().permute(2, 0, 1).unsqueeze(0) / 255.0
        mask_t = torch.from_numpy(mask_pad).float().unsqueeze(0).unsqueeze(0)
        mask_t = (mask_t > 0).float()

        img_t = img_t.to(self.device)
        mask_t = mask_t.to(self.device)

        with torch.no_grad():
            output = self.model(img_t, mask_t)

        out_np = output[0].permute(1, 2, 0).detach().cpu().numpy()
        out_np = np.clip(out_np * 255.0, 0, 255).astype(np.uint8)
        out_bgr = cv2.cvtColor(out_np, cv2.COLOR_RGB2BGR)

        res = out_bgr[:h, :w]
        mask_binary = (mask_np > 0)[:, :, None]
        cleaned = np.where(mask_binary, res, image_np)
        return cleaned


DOC_ID = "1l2aF-cyk39Xiaz7e1ejBMJMKFv77Ur7hieuvI_CsFh0"
TAB_ID = "t.bdbfibdpplpv"
GDRIVE_FOLDER_ID = "1auZHllgyjL1TESH7TQxclE27YmeUNOzM"


# ==============================================================================
# Step 1: Fetch Doc Tab Text
# ==============================================================================
def fetch_doc_tab_text(doc_id: str = DOC_ID, tab_id: str = TAB_ID) -> str:
    """
    ดึงเนื้อหาจากแท็บ Google Docs โดยตรงด้วย Export URL
    """
    url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt&tab={tab_id}"
    print(f"📥 [Step 1] Fetching translation from Google Docs tab: {tab_id} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    print(f"   -> Retrieved {len(text)} characters from Google Docs")
    return text


def parse_numbered_translations(doc_text: str) -> dict[int, str]:
    """
    แยกคำแปลตามเลข [#N] ที่จับคู่กับ OCR ใน MangaToolPlus
    """
    lines = [line.strip() for line in doc_text.splitlines() if line.strip()]
    by_number = {}
    current_num = None

    thai_char_re = re.compile(r"[\u0E00-\u0E7F]")
    marker_re = re.compile(r"^\[#(\d+)\]\s*(.*)$")

    for line in lines:
        m = marker_re.match(line)
        if m:
            current_num = int(m.group(1))
            content = m.group(2).strip()
            if current_num not in by_number:
                by_number[current_num] = []
            if content:
                by_number[current_num].append(content)
        elif current_num is not None:
            by_number[current_num].append(line)

    translations = {}
    for num, parts in by_number.items():
        thai_parts = [p for p in parts if thai_char_re.search(p)]
        if thai_parts:
            translations[num] = "\n".join(thai_parts)
        elif parts:
            translations[num] = parts[-1]

    print(f"📝 [Step 2] Parsed {len(translations)} translation blocks (indices #{min(translations.keys())} - #{max(translations.keys())})")
    return translations


# ==============================================================================
# Step 2: Typesetting / Thai Word Wrap ("วางคำแปลลงบนภาพ")
# ==============================================================================
def wrap_thai_text_for_bubble(text: str, box_w: float, box_h: float) -> tuple[str, int]:
    """
    คำนวณการตัดคำภาษาไทย (PyThaiNLP) และปรับขนาดฟอนต์ให้พอดีกับบอลลูนรูปทรงวงรี (Ellipse Bubble Fitting)
    """
    raw_text = text.strip()
    if not raw_text:
        return "", 24

    visual_text = re.sub(r"[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]", "", raw_text)
    visual_len = max(1, len(visual_text))

    aspect = box_w / max(1.0, box_h)
    bubble_area = box_w * box_h * 0.785

    est_font_size = int(math.sqrt((bubble_area * 0.55) / (visual_len * 0.65)))

    if visual_len <= 4:
        font_size = max(24, min(56, int(box_h * 0.45)))
    elif visual_len <= 10:
        font_size = max(20, min(50, int(box_h * 0.35)))
    else:
        font_size = max(16, min(48, est_font_size))

    max_line_width_chars = max(4, int(box_w / (font_size * 0.55)))
    est_lines = max(1, int(math.ceil(visual_len / max(1, max_line_width_chars))))

    raw_tokens = pythainlp.word_tokenize(raw_text, engine="newmm")

    # Merge broken tokens (e.g. 'เห' + 'รอ' -> 'เหรอ', numbers attached to previous word)
    merged = []
    i = 0
    while i < len(raw_tokens):
        tok = raw_tokens[i]
        # Common Thai split fixes
        if i + 1 < len(raw_tokens) and tok == "เห" and raw_tokens[i+1].startswith("รอ"):
            merged.append(tok + raw_tokens[i+1])
            i += 2
            continue
        # Attach standalone numbers to previous token (e.g. 'ที่' + '4' -> 'ที่ 4')
        if merged and re.match(r"^\d+$", tok):
            merged[-1] += " " + tok if not merged[-1].endswith(" ") else tok
            i += 1
            continue
        merged.append(tok)
        i += 1

    # Attach sticky punctuation (without space) & particles (with space if needed)
    sticky_punct = {"!", "?", ".", ",", "...", "ๆ", "ฯ", "”", "’", ")", "]", "}"}
    sticky_words = {"นะ", "คะ", "ครับ", "ล่ะ", "สิ", "วะ"}
    tokens = []
    for tok in merged:
        if tokens and (tok in sticky_punct or tok.startswith(("!", "?", ".", "ๆ"))):
            tokens[-1] = tokens[-1].rstrip() + tok
        elif tokens and tok in sticky_words:
            tokens[-1] = tokens[-1].rstrip() + (" " if not tokens[-1].endswith(" ") else "") + tok
        else:
            tokens.append(tok)

    bad_start_words = {"ที่", "ของ", "ใน", "จะ", "ให้", "ได้", "ก็", "ต้อง", "นะ", "ครับ", "ค่ะ", "ยัง", "แล้ว", "คง", "ด้วย", "ไว้", "มา", "ไป", "อยู่", "คือ", "นั้น", "นี่", "นี้", "เหรอ", "ล่ะ", "สิ", "วะ", "เว้ย", "น่ะ", "เลย", "กัน"}

    lines = []
    curr = ""
    for tok in tokens:
        tok_vis = len(re.sub(r"[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]", "", tok))
        curr_vis = len(re.sub(r"[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]", "", curr))

        line_idx = len(lines)
        if est_lines > 1:
            norm_y = abs((line_idx + 0.5) - (est_lines / 2.0)) / (est_lines / 2.0)
            norm_y = min(0.9, norm_y)
            width_factor = math.sqrt(max(0.35, 1.0 - norm_y ** 2))
        else:
            width_factor = 1.0

        allowed_chars = max(4, int(max_line_width_chars * width_factor))

        is_bad_start = (tok in bad_start_words and curr_vis + tok_vis <= allowed_chars + 3)

        if (curr_vis + tok_vis > allowed_chars and not is_bad_start) and curr:
            lines.append(curr.strip())
            curr = tok
        else:
            curr += tok
    if curr.strip():
        lines.append(curr.strip())

    # Fix orphan line (single short word at end): merge with previous line if fits
    if len(lines) >= 2:
        last_vis = len(re.sub(r"[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]", "", lines[-1]))
        if last_vis <= 4:
            lines[-2] += " " + lines[-1]
            lines.pop()

    # Ensure vertical fit
    line_count = len(lines)
    while line_count * (font_size * 1.25) > box_h * 0.95 and font_size > 14:
        font_size = int(font_size * 0.9)

    return "\n".join(lines), font_size


# ==============================================================================
# Main Pipeline Function
# ==============================================================================
def run_pipeline(
    work_dir: str | Path,
    limit_pages: int | None = None,
    font_family: str = "TF LANNA Bold",
    do_inpaint: bool = True,
    do_psd: bool = True
):
    t_start = time.time()
    work_path = Path(work_dir)
    work_path.mkdir(parents=True, exist_ok=True)
    out_psd_dir = work_path / "psd_output"
    out_psd_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("🚀 MangaToolPlus Test Pipeline: Chapter 36")
    print(f"📁 Working Directory: {work_path}")
    print(f"🎨 Typeset Font: {font_family}")
    print("=" * 60)

    # 1. Load MTP Project
    mtp_files = list(work_path.glob("*.mtp"))
    if not mtp_files:
        raise FileNotFoundError(f"No .mtp project found in {work_path}. Please ensure .mtp is downloaded.")

    # Prefer the original downloaded mtp file
    original_mtp = [f for f in mtp_files if not f.name.endswith("_updated.mtp")]
    mtp_file = original_mtp[0] if original_mtp else mtp_files[0]
    print(f"📂 Loading MTP Project: {mtp_file.name}")
    with open(mtp_file, "r", encoding="utf-8") as f:
        project_data = json.load(f)

    # 2. Fetch Translations from Google Docs Tab
    doc_text = fetch_doc_tab_text(DOC_ID, TAB_ID)
    translations = parse_numbered_translations(doc_text)

    # 3. Match Translations & Filter Unmatched Layers
    print("\n🔍 [Step 3] Matching translations with OCR layers...")
    all_files = project_data.get("files", [])
    if limit_pages and limit_pages > 0:
        all_files = all_files[:limit_pages]
        print(f"   (Limiting to first {limit_pages} pages for fast testing)")

    ts_data = project_data.get("tsData", {})
    text_layers_data = {}

    global_index = 1
    matched_count = 0
    unmatched_count = 0

    # Initialize offline LaMa model if inpainting
    lama_service = None
    if do_inpaint:
        lama_model_file = PROJECT_ROOT / "models" / "big-lama.pt"
        if lama_model_file.exists():
            print(f"\n🧠 [Step 4] Loading offline LaMa model: {lama_model_file.name} ...")
            lama_service = StandaloneLama(model_path=str(lama_model_file))
            print("   -> LaMa model ready!")
        else:
            print(f"⚠️ [Step 4] LaMa model not found at {lama_model_file}. Skipping inpaint.")

    # Process each page
    for file_idx, f_info in enumerate(all_files):
        fname = f_info["name"]
        print(f"\n📄 [{file_idx+1}/{len(all_files)}] Processing {fname} ({f_info.get('width')}x{f_info.get('height')})...")
        img_file = work_path / fname
        if not img_file.exists():
            print(f"   ⚠️ Image file {fname} not found on disk, skipping.")
            continue

        # Requirement 1: Background Layer is RAW ORIGINAL IMAGE (ก่อน inpaint)
        raw_img = cv2.imread(str(img_file))
        h, w = raw_img.shape[:2]

        layers = ts_data.get(fname, [])
        page_matched_layers = []

        for l in layers:
            current_num = global_index
            global_index += 1

            if current_num in translations:
                thai_trans = translations[current_num]
                l["translation"] = thai_trans
                page_matched_layers.append((current_num, l))
                matched_count += 1
            else:
                # Unmatched layer (credits/watermark) -> remove/clear translation
                l["translation"] = ""
                unmatched_count += 1

        print(f"   -> Matched: {len(page_matched_layers)} layers | Unmatched (cleared): {len(layers) - len(page_matched_layers)} layers")

        # Requirement 3: Inpainted แปะเป็นกล่องละ 1 เลเยอร์ (Individual Inpaint Patch per Box)
        inpaint_patches = []
        temp_patch_files = []

        if do_inpaint and lama_service and page_matched_layers:
            t_inp0 = time.time()
            pad = 12  # Padding around the bounding box

            for num, l in page_matched_layers:
                box = l.get("box", [])
                if not box:
                    continue

                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                min_x = max(0, int(min(xs)) - pad)
                min_y = max(0, int(min(ys)) - pad)
                max_x = min(w, int(max(xs)) + pad)
                max_y = min(h, int(max(ys)) + pad)
                patch_w = max_x - min_x
                patch_h = max_y - min_y

                if patch_w <= 0 or patch_h <= 0:
                    continue

                # Crop from the original raw image
                patch_crop = raw_img[min_y:max_y, min_x:max_x].copy()

                # Local mask within the crop
                patch_mask = np.zeros((patch_h, patch_w), dtype=np.uint8)
                local_pts = np.array([[p[0] - min_x, p[1] - min_y] for p in box], dtype=np.int32)
                cv2.fillPoly(patch_mask, [local_pts], 255)

                # Dilate mask for smooth edge blending
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                patch_mask = cv2.dilate(patch_mask, kernel)

                # Inpaint the single box with offline LaMa
                cleaned_patch = lama_service.inpaint(patch_crop, patch_mask)

                # Save raw RGBA buffer for this patch
                patch_rgba = cv2.cvtColor(cleaned_patch, cv2.COLOR_BGR2RGBA)
                patch_bin_path = work_path / f"{Path(fname).stem}_patch_{num}.bin"
                with open(patch_bin_path, "wb") as f_p:
                    f_p.write(patch_rgba.tobytes())
                temp_patch_files.append(patch_bin_path)

                inpaint_patches.append({
                    "name": f"Inpaint #{num}",
                    "number": num,
                    "left": min_x,
                    "top": min_y,
                    "right": max_x,
                    "bottom": max_y,
                    "width": patch_w,
                    "height": patch_h,
                    "rawPath": str(patch_bin_path)
                })

                # Record in mtp layer structure
                l["patchRect"] = [min_x, min_y, max_x, max_y]
                l["inpaintVisible"] = True
                l["inpaintModel"] = "lama"

            print(f"   🎨 Inpainted {len(inpaint_patches)} individual box patches in {time.time() - t_inp0:.2f}s")

        # Requirement 2: Typesetting with Font "TF BOLD"
        page_text_layers = []
        for num, l in page_matched_layers:
            box = l.get("box", [])
            if not box:
                continue

            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            center_x = (min(xs) + max(xs)) / 2.0
            center_y = (min(ys) + max(ys)) / 2.0
            box_w = max(xs) - min(xs)
            box_h = max(ys) - min(ys)

            wrapped_text, font_size = wrap_thai_text_for_bubble(l["translation"], box_w, box_h)

            layer_obj = {
                "id": f"ts_layer_{fname}_{num}",
                "text": wrapped_text,
                "x": round(center_x),
                "y": round(center_y),
                "boxWidth": round(box_w),
                "boxHeight": round(box_h),
                "fontSize": font_size,
                "fontFamily": font_family,  # "TF BOLD"
                "color": "#000000",
                "strokeWidth": 3,
                "strokeColor": "#FFFFFF"
            }
            page_text_layers.append(layer_obj)

        text_layers_data[fname] = page_text_layers

        # Export to PSD via ag-psd
        if do_psd:
            raw_bg_bin = work_path / f"{Path(fname).stem}_raw_bg.bin"
            raw_rgb = cv2.cvtColor(raw_img, cv2.COLOR_BGR2RGBA)
            with open(raw_bg_bin, "wb") as f_bg:
                f_bg.write(raw_rgb.tobytes())

            psd_manifest = {
                "width": w,
                "height": h,
                "rawImagePath": str(raw_bg_bin),  # Original uncleaned image as Background
                "outputPath": str(out_psd_dir / f"{Path(fname).stem}.psd"),
                "inpaintPatches": inpaint_patches,  # Individual layer per box
                "textLayers": page_text_layers  # Font "TF BOLD"
            }

            manifest_file = work_path / f"{Path(fname).stem}_psd_manifest.json"
            with open(manifest_file, "w", encoding="utf-8") as f_m:
                json.dump(psd_manifest, f_m, ensure_ascii=False)

            node_script = PROJECT_ROOT / "scripts" / "export_psd_node.js"
            cmd = ["node", str(node_script), "--manifest", str(manifest_file)]
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            out_str = (res.stdout or "").strip()
            err_str = (res.stderr or "").strip()
            if res.returncode == 0:
                print(f"   💾 {out_str}")
            else:
                print(f"   ❌ PSD Export error: {err_str}")

            # Clean up temp binaries
            if os.path.exists(raw_bg_bin):
                os.remove(raw_bg_bin)
            if os.path.exists(manifest_file):
                os.remove(manifest_file)
            for p_file in temp_patch_files:
                if os.path.exists(p_file):
                    os.remove(p_file)

    # Update and Save MTP Project
    project_data["textLayersData"] = text_layers_data
    out_mtp_file = work_path / f"{mtp_file.stem}_updated.mtp"
    with open(out_mtp_file, "w", encoding="utf-8") as f:
        json.dump(project_data, f, ensure_ascii=False)

    print("\n" + "=" * 60)
    print("🎉 Pipeline Execution Summary:")
    print(f"   Total Pages Processed: {len(all_files)}")
    print(f"   Matched & Typeset Layers: {matched_count}")
    print(f"   Unmatched / Dropped Layers: {unmatched_count}")
    print(f"   Updated MTP Project: {out_mtp_file.name}")
    print(f"   Exported PSD Files: {len(list(out_psd_dir.glob('*.psd')))} files in {out_psd_dir}")
    print(f"   Total Elapsed Time: {time.time() - t_start:.2f}s")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MangaToolPlus Pipeline Test")
    parser.add_argument("--work-dir", default=str(PROJECT_ROOT / "psd_work" / "test_chapter36"), help="Chapter files directory")
    parser.add_argument("--limit", type=int, default=3, help="Limit number of pages to process for quick testing")
    parser.add_argument("--full", action="store_true", help="Process all pages in the chapter")
    parser.add_argument("--font", default="TF LANNA Bold", help="Font family name for typesetting (Default: TF LANNA Bold)")
    parser.add_argument("--no-inpaint", action="store_true", help="Skip inpainting step")
    parser.add_argument("--no-psd", action="store_true", help="Skip PSD export step")
    args = parser.parse_args()

    page_limit = None if args.full else args.limit

    run_pipeline(
        work_dir=args.work_dir,
        limit_pages=page_limit,
        font_family=args.font,
        do_inpaint=not args.no_inpaint,
        do_psd=not args.no_psd
    )

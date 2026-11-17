#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Manga PSD Export & Drive Upload Job
=============================================
Automates:
1. Downloads manga raw images & .mtp project from Google Drive source folder.
2. Fetches translation text directly from Google Docs tab (matching chapter number or tab ID).
3. Parses numbered translation [#N] and matches with OCR layers.
4. Cleans speech bubbles using LaMa model as individual cropped layers (Inpaint #N).
5. Typesets translation text onto images using 'TF LANNA Bold' font.
6. Generates native editable PSD files via tools/export_psd_node.js:
   - Background: Raw uncleaned image before inpainting
   - Inpaint Patches Group: Individual box layer per bubble
   - Translated Text Group: Centered Thai text with TF LANNA Bold and white stroke
7. Uploads all generated .psd files directly back into the Google Drive source folder (1. อัป Raw).
8. Notifies Google Apps Script (COMPLETE_EXPORT_PSD) to update WorkQueue status to 'เสร็จแล้ว'.
"""

import os
import sys
import re
import json
import time
import shutil
import subprocess
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from PIL import Image
import numpy as np
import cv2

# Ensure UTF-8 on Windows
if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import pythainlp
except ImportError:
    pythainlp = None


# ==============================================================================
# 1. Google Drive & Docs Helpers
# ==============================================================================
def get_drive_service(google_access_token=None, service_account_json=None):
    """Initializes Google Drive v3 client using OAuth token or Service Account."""
    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("⚠️ googleapiclient not installed. Google Drive upload unavailable.")
        return None

    # 1. OAuth Access Token (from GAS ScriptApp.getOAuthToken())
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


def upload_file_to_source_folder(drive_service, target_folder_id, file_path):
    """Uploads a local file directly into target_folder_id, updating if already exists."""
    if not drive_service:
        print(f"⚠️ No Google Drive service. Skipping cloud upload for {file_path}.")
        return None

    from googleapiclient.http import MediaFileUpload
    p = Path(file_path)
    file_name = p.name
    size_mb = p.stat().st_size / (1024 * 1024)
    print(f"📤 Uploading {file_name} ({size_mb:.2f} MB) to Drive folder ({target_folder_id})...")

    try:
        query = f"'{target_folder_id}' in parents and name='{file_name}' and trashed=false"
        existing = drive_service.files().list(q=query, fields="files(id, name)").execute().get("files", [])

        mimetype = "image/vnd.adobe.photoshop" if p.suffix.lower() == ".psd" else "application/octet-stream"
        media = MediaFileUpload(str(p), mimetype=mimetype, resumable=True)

        if existing:
            file_id = existing[0]["id"]
            updated = drive_service.files().update(fileId=file_id, media_body=media).execute()
            print(f"   ✓ Updated existing {file_name} (ID: {updated.get('id')})")
            return updated.get("id")
        else:
            meta = {"name": file_name, "parents": [target_folder_id]}
            uploaded = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
            print(f"   ✓ Uploaded new {file_name} (ID: {uploaded.get('id')})")
            return uploaded.get("id")
    except Exception as e:
        print(f"❌ Failed to upload {file_name} to Google Drive: {e}")
        return None


def extract_folder_id(url_or_id):
    """Extracts raw folder ID from Drive folder URL or returns id as-is."""
    if not url_or_id:
        return ""
    m = re.search(r"folders/([a-zA-Z0-9_-]+)", str(url_or_id))
    if m:
        return m.group(1)
    m = re.search(r"id=([a-zA-Z0-9_-]+)", str(url_or_id))
    if m:
        return m.group(1)
    return str(url_or_id).strip()


def extract_doc_id(url_or_id):
    """Extracts document ID from Google Docs URL."""
    if not url_or_id:
        return ""
    m = re.search(r"/document/d/([a-zA-Z0-9_-]+)", str(url_or_id))
    if m:
        return m.group(1)
    return str(url_or_id).strip()


def extract_tab_id_from_url(url: str) -> str:
    """Extracts tab ID (tab=t.xxx) from Google Docs URL if present."""
    if not url:
        return ""
    m = re.search(r"[?&]tab=(t\.[a-zA-Z0-9_-]+)", str(url))
    if m:
        return m.group(1)
    return ""


def download_images_from_gdrive(folder_url_or_id, output_dir):
    """Downloads images from Google Drive folder."""
    import gdown
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    folder_id = extract_folder_id(folder_url_or_id)
    url = f"https://drive.google.com/drive/folders/{folder_id}"
    print(f"📥 [Drive] Downloading files from: {url}")
    try:
        gdown.download_folder(url, output=str(out_path), quiet=False)
    except Exception as e:
        print(f"⚠️ Warning during gdown download_folder: {e}")

    images = sorted([
        f for f in out_path.glob("*.*")
        if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
    ])
    return images


# ==============================================================================
# 2. Google Docs Tab Discovery & Text Extraction
# ==============================================================================
def find_matching_tab_id(doc_id: str, chapter_num: str, access_token: str = None) -> str:
    """Discovers tab_id corresponding to chapter_num from Google Docs HTML export or API."""
    # Attempt HTML export to find tabs
    url = f"https://docs.google.com/document/d/{doc_id}/export?format=html"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    if access_token:
        req.add_header("Authorization", f"Bearer {access_token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        # Search for tab elements or tab URLs: tab=t.xxx
        tab_matches = re.findall(r'tab=(t\.[a-zA-Z0-9_-]+)[^"]*[\'"]?[^>]*>([^<]+)<', html)
        if not tab_matches:
            tab_matches = re.findall(r'data-tab-id=[\'"](t\.[a-zA-Z0-9_-]+)[\'"][^>]*>([^<]+)<', html)

        clean_chap = str(chapter_num).strip().lstrip("0") or "0"
        for tid, ttitle in tab_matches:
            clean_title = ttitle.strip()
            num_match = re.search(r"(\d+)", clean_title)
            if num_match and (num_match.group(1).lstrip("0") or "0") == clean_chap:
                print(f"   ✓ Auto-detected tab for Chapter {chapter_num}: {tid} ('{clean_title}')")
                return tid

        if tab_matches:
            print(f"   ℹ️ First tab fallback: {tab_matches[0][0]} ('{tab_matches[0][1]}')")
            return tab_matches[0][0]
    except Exception as e:
        print(f"   ⚠️ Could not auto-detect tab list: {e}")

    return ""


def fetch_doc_translation_text(doc_id: str, tab_id: str = "", chapter_num: str = "", access_token: str = None) -> str:
    """Fetches text content from the specified Google Docs tab, with fallback to full doc."""
    text = ""
    # 1. Try specified tab_id first
    if tab_id:
        url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt&tab={tab_id}"
        print(f"📄 Fetching translation from Google Docs tab ({tab_id}): {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        if access_token:
            req.add_header("Authorization", f"Bearer {access_token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"   ⚠️ Tab {tab_id} fetch failed: {e}")

    # Verify if tab content contains actual dialogue items [#N]
    test_d = parse_dialogue_map(text, quiet=True) if text else {}
    if len(test_d) > 0:
        return text

    if tab_id:
        print(f"   ⚠️ Tab '{tab_id}' returned 0 dialogue items (likely glossary or wrong tab). Trying auto-detect / full document fallback...")

    # 2. Try auto-detecting tab if chapter_num provided
    if chapter_num:
        detected_tab = find_matching_tab_id(doc_id, chapter_num, access_token)
        if detected_tab and detected_tab != tab_id:
            url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt&tab={detected_tab}"
            print(f"📄 Fetching translation from auto-detected tab ({detected_tab}): {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            if access_token:
                req.add_header("Authorization", f"Bearer {access_token}")
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    cand_text = resp.read().decode("utf-8", errors="replace")
                if len(parse_dialogue_map(cand_text, quiet=True)) > 0:
                    return cand_text
            except Exception as e:
                print(f"   ⚠️ Auto-detected tab fetch failed: {e}")

    # 3. Fallback to full doc export without tab parameter
    url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    print(f"📄 Fetching full document translation (no tab): {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    if access_token:
        req.add_header("Authorization", f"Bearer {access_token}")

    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="replace")

    return text


def extract_chapter_section(raw_text: str, chapter_num: str) -> str:
    """Extracts the specific chapter section from text containing multiple chapters."""
    if not raw_text or not chapter_num:
        return raw_text

    target = str(chapter_num).strip().lstrip("0") or "0"
    lines = raw_text.splitlines()

    # Find candidate chapter start line indices
    # A true chapter header is followed closely by a dialogue item [#N]
    chap_starts = []
    header_pattern = re.compile(r"^\s*(?:Chapter|ตอนที่|ตอน|Ch\.|EP\.)\s*(\d+)\s*$", re.IGNORECASE)

    for i, line in enumerate(lines):
        m = header_pattern.match(line.strip())
        if m:
            num = m.group(1).lstrip("0") or "0"
            # Verify it's not a table row by checking if next non-empty lines contain [#
            is_real_header = False
            for j in range(i + 1, min(i + 8, len(lines))):
                sub = lines[j].strip()
                if sub.startswith("[#") or sub.startswith("["):
                    is_real_header = True
                    break
            if is_real_header:
                chap_starts.append((i, num))

    if not chap_starts:
        return raw_text

    # Locate target chapter
    start_line = None
    end_line = len(lines)
    for idx, (line_idx, c_num) in enumerate(chap_starts):
        if c_num == target:
            start_line = line_idx
            if idx + 1 < len(chap_starts):
                end_line = chap_starts[idx + 1][0]
            break

    if start_line is not None:
        print(f"   ✓ Sliced Chapter {chapter_num} section (lines {start_line+1} to {end_line})")
        return "\n".join(lines[start_line:end_line])
    else:
        print(f"   ℹ️ Chapter {chapter_num} header not explicitly separated; using full document")
        return raw_text


def parse_dialogue_map(raw_text: str, quiet: bool = False) -> dict:
    """
    Parses [#N] dialogue lines into a dictionary {num: text}.
    When both original OCR text and translated text exist under [#N],
    prefers the Thai translated line(s).
    """
    if not raw_text:
        return {}

    lines = raw_text.splitlines()
    dialogues = {}
    current_num = None
    items_for_num = []

    pattern = re.compile(r"^\s*\[#?(\d+)\]\s*(.*)$")

    def has_thai(text: str) -> bool:
        return any('\u0e00' <= ch <= '\u0e7f' for ch in text)

    def finalize_num(num, blocks):
        if num is None or not blocks:
            return
        # Prefer block with Thai characters
        thai_blocks = [b for b in blocks if has_thai(b)]
        if thai_blocks:
            dialogues[num] = "\n".join(thai_blocks).strip()
        else:
            # Fallback to the last non-empty block
            non_empty = [b for b in blocks if b.strip()]
            if non_empty:
                dialogues[num] = non_empty[-1].strip()

    current_block_lines = []

    for line in lines:
        stripped = line.strip()
        m = pattern.match(stripped)
        if m:
            new_num = int(m.group(1))
            first_text = m.group(2).strip()

            if current_num is not None:
                if current_block_lines:
                    items_for_num.append("\n".join(current_block_lines).strip())
                    current_block_lines = []

                if new_num != current_num:
                    finalize_num(current_num, items_for_num)
                    items_for_num = []
                    current_num = new_num
            else:
                current_num = new_num

            if first_text:
                current_block_lines.append(first_text)
        elif current_num is not None:
            if stripped:
                current_block_lines.append(stripped)

    if current_num is not None:
        if current_block_lines:
            items_for_num.append("\n".join(current_block_lines).strip())
        finalize_num(current_num, items_for_num)

    if not quiet:
        print(f"   ✓ Parsed {len(dialogues)} dialogue items from Docs (dialogue #{min(dialogues.keys(), default=0)} to #{max(dialogues.keys(), default=0)})")
    return dialogues


# ==============================================================================
# 3. LaMa Inpainting Engine
# ==============================================================================
class StandaloneLama:
    """Lightweight LaMa TorchScript runner."""
    def __init__(self, model_path, device=None):
        import torch
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = device
        print(f"🧠 Loading LaMa model from {model_path} onto {self.device}...")
        self.model = torch.jit.load(str(model_path), map_location=self.device)
        self.model.eval()
        self.model.to(self.device)
        print("   ✓ LaMa model loaded successfully!")

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


# ==============================================================================
# 4. Text Wrapping & Typesetting
# ==============================================================================
def thai_word_wrap(text: str, max_chars_per_line: int) -> str:
    """Wraps Thai text nicely at word boundaries."""
    if not pythainlp:
        return text

    words = pythainlp.word_tokenize(text, engine="newmm")
    lines = []
    current_line = ""

    for w in words:
        if w == "\n":
            if current_line:
                lines.append(current_line)
                current_line = ""
            continue

        if len(current_line) + len(w) <= max_chars_per_line:
            current_line += w
        else:
            if current_line:
                lines.append(current_line)
            current_line = w

    if current_line:
        lines.append(current_line)

    return "\n".join(lines)


# ==============================================================================
# 5. GAS Notification
# ==============================================================================
def notify_gas_export_psd_completed(folder_id, queue_id="", chapter="", manga_name="", psd_count=0, gas_url=None, passcode="10211032"):
    """Notifies Google Apps Script to mark Export PSD as 'เสร็จแล้ว'."""
    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
    payload = {
        "action": "COMPLETE_EXPORT_PSD",
        "passcode": passcode,
        "payload": {
            "folderId": folder_id,
            "queueId": queue_id,
            "chapter": str(chapter),
            "mangaName": manga_name,
            "psdCount": psd_count,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%S+07:00")
        }
    }
    print(f"\n📡 Notifying Google Apps Script (COMPLETE_EXPORT_PSD) for queue {queue_id}...")
    try:
        req = urllib.request.Request(
            gas_api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "MangaHub-PSD-Job"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("status") == "success" or res.get("success"):
                print(f"   ✓ Successfully updated WorkQueue in Google Sheet! Export PSD marked as 'เสร็จแล้ว'!")
            else:
                print(f"   ⚠️ GAS response: {res}")
    except Exception as e:
        print(f"   ❌ GAS callback notification failed: {e}")


# ==============================================================================
# Main Pipeline Function
# ==============================================================================
def run_export_psd_pipeline(args):
    start_time = time.time()
    work_dir = Path(args.output_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    psd_out_dir = work_dir / "psd_output"
    psd_out_dir.mkdir(parents=True, exist_ok=True)

    folder_id = extract_folder_id(args.folder_id)
    doc_id = extract_doc_id(args.doc_url)
    chapter_num = str(args.chapter_num).strip()
    manga_name = args.manga_name.strip()

    print("=================================================================")
    print("🚀 Manga PSD Export Pipeline")
    print(f"📁 Folder ID:     {folder_id}")
    print(f"📖 Manga Name:    {manga_name}")
    print(f"🔢 Chapter:       {chapter_num}")
    print(f"📄 Doc ID:        {doc_id}")
    print(f"🔤 Font:          {args.font}")
    print("=================================================================")

    # 1. Initialize Google Drive Service
    drive_service = get_drive_service(args.google_access_token)

    # 2. Download Images & .mtp from Drive Folder
    image_files = download_images_from_gdrive(folder_id, work_dir)
    if not image_files:
        print("❌ No images found in folder!")
        sys.exit(1)

    # Find .mtp file in folder if available (pick the best one with valid pages)
    mtp_files = sorted(work_dir.glob("*.mtp"), key=lambda f: f.stat().st_size, reverse=True)
    mtp_data = None
    for mf in mtp_files:
        try:
            with open(mf, "r", encoding="utf-8") as f:
                cand = json.load(f)
            if cand and isinstance(cand, dict) and cand.get("pages"):
                mtp_data = cand
                print(f"📦 Loaded project file: {mf.name} ({len(cand['pages'])} pages)")
                break
        except Exception as e:
            print(f"⚠️ Could not load {mf.name}: {e}")

    # 3. Fetch Google Docs Translation
    doc_text = ""
    if doc_id:
        try:
            target_tab = args.tab_id or extract_tab_id_from_url(args.doc_url)
            doc_text = fetch_doc_translation_text(
                doc_id=doc_id,
                tab_id=target_tab,
                chapter_num=chapter_num,
                access_token=args.google_access_token
            )
            # Slices the requested chapter section if the document holds multiple chapters
            doc_text = extract_chapter_section(doc_text, chapter_num)
        except Exception as e:
            print(f"⚠️ Failed to fetch doc text: {e}")

    dialogues = parse_dialogue_map(doc_text) if doc_text else {}

    # 4. Initialize LaMa Inpainter
    lama_service = None
    model_paths = [
        Path("models/big-lama.pt"),
        Path(__file__).resolve().parent.parent / "models" / "big-lama.pt",
        Path("D:/MangaToolPlus_TEST/models/big-lama.pt")
    ]
    for mp in model_paths:
        # big-lama.pt is ~200MB; skip 404 error strings or incomplete downloads
        if mp.exists() and mp.stat().st_size > 50_000_000:
            try:
                lama_service = StandaloneLama(mp)
                break
            except Exception as e:
                print(f"⚠️ Failed to init LaMa from {mp}: {e}")

    if not lama_service:
        print("ℹ️ LaMa model not available or offline. Fallback to OpenCV bubble inpainting.")

    # 5. Process each page
    pages_to_process = image_files if args.full else image_files[:args.limit]
    total_pages = len(pages_to_process)
    generated_psds = []

    print(f"\n🎨 Processing {total_pages} pages...")

    for idx, img_path in enumerate(pages_to_process, start=1):
        page_start = time.time()
        fname = img_path.name
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            continue
        h, w = img_bgr.shape[:2]

        # Find layers for this page in .mtp
        page_layers = []
        if mtp_data and "pages" in mtp_data:
            # Match page by filename or index
            for p in mtp_data["pages"]:
                p_name = p.get("fileName", "") or p.get("name", "")
                if p_name == fname or p_name.replace(" ", "") == fname.replace(" ", ""):
                    page_layers = p.get("layers", [])
                    break
            if not page_layers and idx <= len(mtp_data["pages"]):
                page_layers = mtp_data["pages"][idx - 1].get("layers", [])

        # Match layers with dialogue
        matched_layers = []
        for l in page_layers:
            num = l.get("number")
            if num is None and "number" in l:
                try:
                    num = int(l["number"])
                except Exception:
                    pass
            if num in dialogues:
                matched_layers.append((num, l))

        inpaint_patches = []
        temp_patch_files = []

        # Run inpainting on each bubble individually (LaMa or OpenCV fallback)
        if matched_layers:
            pad = 12
            for num, l in matched_layers:
                box = l.get("box", [])
                if not box:
                    continue
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                min_x = max(0, int(min(xs)) - pad)
                max_x = min(w, int(max(xs)) + pad)
                min_y = max(0, int(min(ys)) - pad)
                max_y = min(h, int(max(ys)) + pad)

                box_w = max_x - min_x
                box_h = max_y - min_y
                if box_w <= 0 or box_h <= 0:
                    continue

                patch_crop = img_bgr[min_y:max_y, min_x:max_x].copy()
                patch_mask = np.zeros((box_h, box_w), dtype=np.uint8)
                rel_box = np.array([[p[0] - min_x, p[1] - min_y] for p in box], dtype=np.int32)
                cv2.fillPoly(patch_mask, [rel_box], 255)

                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                patch_mask = cv2.dilate(patch_mask, kernel)

                try:
                    if lama_service:
                        cleaned_patch = lama_service.inpaint(patch_crop, patch_mask)
                    else:
                        cleaned_patch = cv2.inpaint(patch_crop, patch_mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

                    patch_rgba = cv2.cvtColor(cleaned_patch, cv2.COLOR_BGR2RGBA)
                    patch_bin_path = work_dir / f"{img_path.stem}_patch_{num}.bin"
                    with open(patch_bin_path, "wb") as f_p:
                        f_p.write(patch_rgba.tobytes())
                    temp_patch_files.append(patch_bin_path)

                    inpaint_patches.append({
                        "name": f"Inpaint #{num}",
                        "number": num,
                        "rawPath": str(patch_bin_path).replace("\\", "/"),
                        "left": min_x,
                        "top": min_y,
                        "right": max_x,
                        "bottom": max_y,
                        "width": box_w,
                        "height": box_h
                    })
                except Exception as inp_err:
                    print(f"⚠️ Inpaint error #{num}: {inp_err}")

        # Build text layers
        text_layers = []
        for num, l in matched_layers:
            box = l.get("box", [])
            if not box:
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            bw = max(xs) - min(xs)
            bh = max(ys) - min(ys)
            cx = (min(xs) + max(xs)) / 2.0
            cy = (min(ys) + max(ys)) / 2.0

            trans_text = dialogues.get(num, "")
            if not trans_text:
                continue

            font_size = max(18, min(36, int(bh / 3.2))) if bh > 40 else 24
            max_chars = max(6, int(bw / (font_size * 0.75)))
            wrapped_text = thai_word_wrap(trans_text, max_chars)

            text_layers.append({
                "number": num,
                "text": wrapped_text,
                "x": round(cx),
                "y": round(cy),
                "fontSize": font_size,
                "fontFamily": args.font,
                "weight": "bold",
                "color": "#000000",
                "strokeColor": "#FFFFFF",
                "strokeWidth": 3,
                "boxWidth": round(bw),
                "boxHeight": round(bh)
            })

        # Save raw image buffer for Background layer
        raw_rgba = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGBA)
        raw_bin_path = work_dir / f"{img_path.stem}_bg.bin"
        with open(raw_bin_path, "wb") as f_bg:
            f_bg.write(raw_rgba.tobytes())
        temp_patch_files.append(raw_bin_path)

        # Build manifest for export_psd_node.js
        psd_filename = f"{img_path.stem}.psd"
        out_psd_path = psd_out_dir / psd_filename
        manifest = {
            "width": w,
            "height": h,
            "rawImagePath": str(raw_bin_path).replace("\\", "/"),
            "outputPath": str(out_psd_path).replace("\\", "/"),
            "inpaintPatches": inpaint_patches,
            "textLayers": text_layers
        }

        manifest_path = work_dir / f"{img_path.stem}_manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f_m:
            json.dump(manifest, f_m, ensure_ascii=False)
        temp_patch_files.append(manifest_path)

        # Call tools/export_psd_node.js
        node_script = Path(__file__).resolve().parent / "export_psd_node.js"
        node_cmd = ["node", str(node_script), "--manifest", str(manifest_path)]
        try:
            res = subprocess.run(node_cmd, check=True, capture_output=True, text=True)
            if out_psd_path.exists():
                generated_psds.append(out_psd_path)
                print(f"[{idx}/{total_pages}] ✓ Created {psd_filename} ({time.time() - page_start:.2f}s, {len(inpaint_patches)} patches, {len(text_layers)} texts)")
            else:
                print(f"[{idx}/{total_pages}] ⚠️ PSD not generated: {res.stderr}")
        except Exception as e:
            print(f"[{idx}/{total_pages}] ❌ Node export error: {e}")

        # Clean up temporary page bin files
        for tf in temp_patch_files:
            try:
                if tf.exists():
                    tf.unlink()
            except Exception:
                pass

    print(f"\n🎉 Successfully created {len(generated_psds)} PSD files in {time.time() - start_time:.2f}s!")

    # 6. Upload PSD files directly to Google Drive Folder
    if args.upload_to_source and drive_service and generated_psds:
        print(f"\n☁️ [Google Drive Upload] Uploading {len(generated_psds)} PSD files to Drive folder ({folder_id})...")
        up_count = 0
        for psd_file in generated_psds:
            up_id = upload_file_to_source_folder(drive_service, folder_id, psd_file)
            if up_id:
                up_count += 1
        print(f"   ✓ Uploaded {up_count}/{len(generated_psds)} PSD files to Google Drive!")

    # 7. Notify GAS that Export PSD is complete
    notify_gas_export_psd_completed(
        folder_id=folder_id,
        queue_id=args.queue_id,
        chapter=chapter_num,
        manga_name=manga_name,
        psd_count=len(generated_psds),
        gas_url=args.gas_url,
        passcode=args.gas_passcode
    )

    # 8. Clean up local files if requested
    if args.cleanup:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
            print("✓ Local disk cleanup completed!")
        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")


def main():
    parser = argparse.ArgumentParser(description="MangaToolPlus PSD Export & Upload Job")
    parser.add_argument("--folder-id", required=True, help="Google Drive Source Folder ID or URL")
    parser.add_argument("--manga-name", default="", help="Manga Title")
    parser.add_argument("--chapter-num", default="", help="Chapter Number")
    parser.add_argument("--queue-id", default="", help="WorkQueue item ID")
    parser.add_argument("--doc-url", default="", help="Google Docs Reference URL")
    parser.add_argument("--tab-id", default="", help="Google Docs Tab ID (optional)")
    parser.add_argument("--font", default="TF LANNA Bold", help="Font family for typesetting")
    parser.add_argument("--google-access-token", default="", help="Google OAuth Access Token from GAS")
    parser.add_argument("--gas-url", default=None, help="GAS Web App exec URL")
    parser.add_argument("--gas-passcode", default="10211032", help="GAS Passcode")
    parser.add_argument("--output-dir", default="./psd_work", help="Local working directory")
    parser.add_argument("--upload-to-source", action="store_true", default=True, help="Upload PSDs to Drive folder")
    parser.add_argument("--cleanup", action="store_true", default=False, help="Clean up local files")
    parser.add_argument("--full", action="store_true", default=False, help="Process all chapter pages")
    parser.add_argument("--limit", type=int, default=3, help="Limit number of pages to process (for test)")

    args = parser.parse_args()
    run_export_psd_pipeline(args)


if __name__ == "__main__":
    main()

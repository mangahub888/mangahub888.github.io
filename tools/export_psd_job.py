#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Manga PSD Export & Drive Upload Job
=============================================
Automates:
1. Downloads manga raw images & .mtp project from Google Drive source folder.
2. Fetches translation text directly from Google Docs tab (matching chapter number or tab ID).
3. Parses numbered translation [#N] and matches with OCR layers sequentially across the chapter.
4. Cleans speech bubbles using LaMa model (or OpenCV fallback) as individual cropped layers (Inpaint #N).
5. Typesets translation text onto images using 'TF LANNA Bold' font with Thai word wrap & bubble auto-fit.
6. Generates native editable PSD files via tools/export_psd_node.js:
   - Background: Raw uncleaned image before inpainting
   - Inpaint Patches Group: Individual box layer per bubble
   - Translated Text Group: Centered Thai text with TF LANNA Bold and white stroke
7. Updates and saves native MangaToolPlus project (*_updated.mtp).
8. Uploads all generated .psd files directly back into the Google Drive source folder (PSD subfolder).
9. Notifies Google Apps Script (COMPLETE_EXPORT_PSD) to update WorkQueue status to 'เสร็จแล้ว'.
"""

import os
import sys
import re
import json
import time
import math
import shutil
import subprocess
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from PIL import Image
import numpy as np
import cv2

# Ensure UTF-8 output on Windows
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


def get_or_create_subfolder(drive_service, parent_folder_id, folder_name="PSD"):
    """
    Finds or creates a subfolder named `folder_name` under `parent_folder_id` in Google Drive.
    Returns the subfolder ID, or parent_folder_id on failure.
    """
    if not drive_service or not parent_folder_id:
        return parent_folder_id

    clean_parent_id = extract_folder_id(parent_folder_id)
    try:
        query = (
            f"'{clean_parent_id}' in parents and "
            f"name='{folder_name}' and "
            f"mimeType='application/vnd.google-apps.folder' and "
            f"trashed=false"
        )
        res = drive_service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name)"
        ).execute()
        files = res.get("files", [])
        if files:
            subfolder_id = files[0]["id"]
            print(f"📁 [Drive] Found existing '{folder_name}' subfolder (ID: {subfolder_id})")
            return subfolder_id

        # Subfolder does not exist, create it
        meta = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [clean_parent_id]
        }
        created = drive_service.files().create(body=meta, fields="id").execute()
        subfolder_id = created.get("id")
        print(f"📁 [Drive] Created new '{folder_name}' subfolder under parent ({clean_parent_id}) -> (ID: {subfolder_id})")
        return subfolder_id
    except Exception as e:
        print(f"⚠️ [Drive] Could not get or create subfolder '{folder_name}': {e}. Falling back to parent folder ({clean_parent_id}).")
        return clean_parent_id


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
    """Downloads images & files from Google Drive folder."""
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
    url = f"https://docs.google.com/document/d/{doc_id}/export?format=html"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    if access_token:
        req.add_header("Authorization", f"Bearer {access_token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="replace")

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

    # Verify if tab content contains dialogue items [#N]
    test_d = parse_numbered_translations(text, quiet=True) if text else {}
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
                if len(parse_numbered_translations(cand_text, quiet=True)) > 0:
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

    chap_starts = []
    header_pattern = re.compile(r"^\s*(?:Chapter|ตอนที่|ตอน|Ch\.|EP\.)\s*(\d+)\s*$", re.IGNORECASE)

    for i, line in enumerate(lines):
        m = header_pattern.match(line.strip())
        if m:
            num = m.group(1).lstrip("0") or "0"
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


def parse_numbered_translations(doc_text: str, quiet: bool = False) -> dict[int, str]:
    """
    Parses numbered translation blocks [#N] matching MangaToolPlus sequential OCR layers.
    Selects Thai translated text if present, otherwise uses last available line.
    """
    if not doc_text:
        return {}

    lines = [line.strip() for line in doc_text.splitlines() if line.strip()]
    by_number = {}
    current_num = None

    thai_char_re = re.compile(r"[\u0E00-\u0E7F]")
    # Matches [#1], [#01], [# 1], or [1]
    marker_re = re.compile(r"^\[#?\s*(\d+)\]\s*(.*)$")

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

    if not quiet:
        if translations:
            print(f"📝 Parsed {len(translations)} translation blocks (indices #{min(translations.keys())} - #{max(translations.keys())})")
        else:
            print("⚠️ Parsed 0 translation blocks from document text")
    return translations


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


# ==============================================================================
# 4. Text Wrapping & Typesetting (Aligned with test_pipeline_chapter36.py)
# ==============================================================================
def wrap_thai_text_for_bubble(text: str, box_w: float, box_h: float) -> tuple[str, int]:
    """
    Calculates Thai word wrap (PyThaiNLP) and fits font size dynamically to speech bubble area.
    100% matched with MangaToolPlus typesetting engine.
    """
    raw_ratio = box_w / max(1.0, box_h)
    clamped_ratio = max(0.8, min(3.5, raw_ratio))
    raw_text = text.strip()
    visual_text = re.sub(r"[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]", "", raw_text)
    visual_len = max(1, len(visual_text))

    shape_mult = 3.5 if raw_ratio >= 1.0 else 1.8
    est_chars = max(6, int(math.sqrt(clamped_ratio * visual_len * shape_mult)))

    font_size = max(16, min(56, int(box_w / (est_chars * 0.55))))
    if visual_len <= 8:
        font_size = int(font_size * 1.15)

    if pythainlp:
        tokens = pythainlp.word_tokenize(raw_text, engine="newmm")
    else:
        tokens = list(raw_text)

    lines = []
    curr = ""
    for tok in tokens:
        if len(curr) + len(tok) > est_chars and curr:
            lines.append(curr)
            curr = tok
        else:
            curr += tok
    if curr:
        lines.append(curr)

    wrapped_text = "\n".join(lines)
    return wrapped_text, font_size


# ==============================================================================
# 5. GAS Notification Callback
# ==============================================================================
def notify_gas_export_psd_completed(folder_id, queue_id="", chapter="", manga_name="", psd_count=0, psd_folder_id="", subfolder_name="PSD", gas_url=None, passcode="10211032"):
    """Notifies Google Apps Script to mark Export PSD as 'เสร็จแล้ว'."""
    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
    psd_folder_url = f"https://drive.google.com/drive/folders/{psd_folder_id}" if psd_folder_id else ""
    payload = {
        "action": "COMPLETE_EXPORT_PSD",
        "passcode": passcode,
        "payload": {
            "folderId": folder_id,
            "queueId": queue_id,
            "chapter": str(chapter),
            "mangaName": manga_name,
            "psdCount": psd_count,
            "subfolder": subfolder_name,
            "psdFolderId": psd_folder_id,
            "psdFolderUrl": psd_folder_url,
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
# 6. Main Pipeline Function
# ==============================================================================
def run_export_psd_pipeline(args):
    start_time = time.time()
    work_dir = Path(args.output_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    subfolder_name = getattr(args, "subfolder_name", None) or getattr(args, "psd_subfolder", "PSD") or "PSD"
    psd_out_dir = work_dir / subfolder_name
    psd_out_dir.mkdir(parents=True, exist_ok=True)

    folder_id = extract_folder_id(args.folder_id)
    doc_id = extract_doc_id(args.doc_url)
    chapter_num = str(args.chapter_num).strip()
    manga_name = args.manga_name.strip()
    font_family = args.font or "TF LANNA Bold"

    print("=" * 65)
    print("🚀 Manga PSD Export Pipeline (MangaToolPlus Native Logic)")
    print(f"📁 Folder ID:     {folder_id}")
    print(f"📂 Subfolder:     {subfolder_name}")
    print(f"📖 Manga Name:    {manga_name}")
    print(f"🔢 Chapter:       {chapter_num}")
    print(f"📄 Doc ID:        {doc_id}")
    print(f"🔤 Font:          {font_family}")
    print("=" * 65)

    # 1. Initialize Google Drive Service
    drive_service = get_drive_service(args.google_access_token)

    # 2. Download Images & Project Files from Drive Folder
    image_files = download_images_from_gdrive(folder_id, work_dir)
    if not image_files:
        print("❌ No images found in folder!")
        sys.exit(1)

    # 3. Load MangaToolPlus Project (.mtp)
    # Prefer original downloaded .mtp file (not *_updated.mtp)
    mtp_files = list(work_dir.glob("*.mtp"))
    original_mtps = [f for f in mtp_files if not f.name.endswith("_updated.mtp")]
    selected_mtp = original_mtps[0] if original_mtps else (mtp_files[0] if mtp_files else None)

    project_data = {}
    if selected_mtp and selected_mtp.exists():
        try:
            print(f"📦 Loading MangaToolPlus Project: {selected_mtp.name}")
            with open(selected_mtp, "r", encoding="utf-8") as f:
                project_data = json.load(f)
        except Exception as e:
            print(f"⚠️ Could not load {selected_mtp.name}: {e}")

    # Prepare files list and layer mappings from MTP
    all_files_info = project_data.get("files", [])
    ts_data = project_data.get("tsData", {})
    ocr_data = project_data.get("ocrData", {})

    # Helper: resolve layers for a given file name
    def get_layers_for_page(filename: str):
        # 1. Exact match in tsData
        if filename in ts_data and ts_data[filename]:
            return ts_data[filename]
        # 2. Case-insensitive or stem match in tsData
        stem = Path(filename).stem.lower()
        for k, v in ts_data.items():
            if Path(k).stem.lower() == stem and v:
                return v
        # 3. Fallback to ocrData
        if filename in ocr_data and ocr_data[filename]:
            return ocr_data[filename]
        for k, v in ocr_data.items():
            if Path(k).stem.lower() == stem and v:
                return v
        # 4. Check legacy 'pages' format if any
        if "pages" in project_data:
            for p in project_data.get("pages", []):
                p_name = p.get("fileName", "") or p.get("name", "")
                if Path(p_name).stem.lower() == stem:
                    return p.get("layers", [])
        return []

    # If project_data["files"] is missing or empty, build from sorted image_files on disk
    if not all_files_info:
        for img_p in image_files:
            all_files_info.append({"name": img_p.name})

    # 4. Fetch Google Docs Translation
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
            # Slices requested chapter section if the document holds multiple chapters
            doc_text = extract_chapter_section(doc_text, chapter_num)
        except Exception as e:
            print(f"⚠️ Failed to fetch doc text: {e}")

    translations = parse_numbered_translations(doc_text) if doc_text else {}

    # 5. Initialize LaMa Inpainting Engine
    lama_service = None
    if not args.no_inpaint:
        model_paths = [
            Path("models/big-lama.pt"),
            Path(__file__).resolve().parent.parent / "models" / "big-lama.pt",
            Path("D:/MangaToolPlus_TEST/models/big-lama.pt")
        ]
        for mp in model_paths:
            if mp.exists() and mp.stat().st_size > 50_000_000:
                try:
                    lama_service = StandaloneLama(mp)
                    break
                except Exception as e:
                    print(f"⚠️ Failed to init LaMa from {mp}: {e}")

        if not lama_service:
            print("ℹ️ LaMa model not available. Fallback to OpenCV bubble inpainting.")

    # 6. Process Pages Sequentially
    pages_to_process = all_files_info if args.full else all_files_info[:args.limit]
    total_pages = len(pages_to_process)
    generated_psds = []
    text_layers_data = {}

    # Sequential global indexing across all pages in the chapter (MangaToolPlus logic)
    global_index = 1
    total_matched_count = 0
    total_unmatched_count = 0

    print(f"\n🎨 Processing {total_pages} pages (matching translations [#1]..[#N])...")

    for file_idx, f_info in enumerate(pages_to_process, start=1):
        page_start = time.time()
        fname = f_info.get("name", "")
        img_path = work_dir / fname
        if not img_path.exists():
            # Try finding image with matching stem
            cand = list(work_dir.glob(f"{Path(fname).stem}.*"))
            cand = [c for c in cand if c.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]]
            if cand:
                img_path = cand[0]
            else:
                print(f"[{file_idx}/{total_pages}] ⚠️ Image {fname} not found on disk, skipping.")
                continue

        raw_img = cv2.imread(str(img_path))
        if raw_img is None:
            print(f"[{file_idx}/{total_pages}] ⚠️ Failed to decode {fname}, skipping.")
            continue
        h, w = raw_img.shape[:2]

        # Retrieve layers for this page
        layers = get_layers_for_page(fname)
        page_matched_layers = []

        for l in layers:
            current_num = global_index
            global_index += 1

            if current_num in translations:
                thai_trans = translations[current_num]
                l["translation"] = thai_trans
                page_matched_layers.append((current_num, l))
                total_matched_count += 1
            else:
                l["translation"] = ""
                total_unmatched_count += 1

        print(f"\n📄 [{file_idx}/{total_pages}] Processing {fname} ({w}x{h}): {len(page_matched_layers)} matched / {len(layers)} total layers")

        # Inpainting speech bubbles as individual layers
        inpaint_patches = []
        temp_patch_files = []
        pad = 12  # Padding around the bounding box

        if not args.no_inpaint and page_matched_layers:
            t_inp0 = time.time()
            for num, l in page_matched_layers:
                box = l.get("box", [])
                if not box:
                    continue

                # Handle polygon / quad points [[x1, y1], [x2, y2], ...] or flat rect [x1, y1, x2, y2]
                if isinstance(box[0], (list, tuple)):
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

                    patch_crop = raw_img[min_y:max_y, min_x:max_x].copy()
                    patch_mask = np.zeros((patch_h, patch_w), dtype=np.uint8)
                    local_pts = np.array([[p[0] - min_x, p[1] - min_y] for p in box], dtype=np.int32)
                    cv2.fillPoly(patch_mask, [local_pts], 255)
                elif len(box) >= 4:
                    min_x = max(0, int(box[0]) - pad)
                    min_y = max(0, int(box[1]) - pad)
                    max_x = min(w, int(box[2]) + pad)
                    max_y = min(h, int(box[3]) + pad)
                    patch_w = max_x - min_x
                    patch_h = max_y - min_y
                    if patch_w <= 0 or patch_h <= 0:
                        continue

                    patch_crop = raw_img[min_y:max_y, min_x:max_x].copy()
                    patch_mask = np.zeros((patch_h, patch_w), dtype=np.uint8)
                    cv2.rectangle(patch_mask, (pad, pad), (patch_w - pad, patch_h - pad), 255, -1)
                else:
                    continue

                # Dilate mask for smooth edge blending
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                patch_mask = cv2.dilate(patch_mask, kernel)

                # Inpaint bubble
                try:
                    if lama_service:
                        cleaned_patch = lama_service.inpaint(patch_crop, patch_mask)
                    else:
                        cleaned_patch = cv2.inpaint(patch_crop, patch_mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

                    patch_rgba = cv2.cvtColor(cleaned_patch, cv2.COLOR_BGR2RGBA)
                    patch_bin_path = work_dir / f"{Path(fname).stem}_patch_{num}.bin"
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
                        "rawPath": str(patch_bin_path).replace("\\", "/")
                    })

                    # Record in mtp layer structure
                    l["patchRect"] = [min_x, min_y, max_x, max_y]
                    l["inpaintVisible"] = True
                    l["inpaintModel"] = "lama" if lama_service else "cv2"
                except Exception as inp_err:
                    print(f"   ⚠️ Inpaint error #{num}: {inp_err}")

            if inpaint_patches:
                print(f"   🎨 Inpainted {len(inpaint_patches)} patches in {time.time() - t_inp0:.2f}s")

        # Typesetting text layers (Font 'TF LANNA Bold')
        page_text_layers = []
        for num, l in page_matched_layers:
            box = l.get("box", [])
            if not box:
                continue

            if isinstance(box[0], (list, tuple)):
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                center_x = (min(xs) + max(xs)) / 2.0
                center_y = (min(ys) + max(ys)) / 2.0
                box_w = max(xs) - min(xs)
                box_h = max(ys) - min(ys)
            elif len(box) >= 4:
                center_x = (box[0] + box[2]) / 2.0
                center_y = (box[1] + box[3]) / 2.0
                box_w = box[2] - box[0]
                box_h = box[3] - box[1]
            else:
                continue

            trans_text = l.get("translation", "")
            if not trans_text:
                continue

            wrapped_text, font_size = wrap_thai_text_for_bubble(trans_text, box_w, box_h)

            layer_obj = {
                "id": f"ts_layer_{Path(fname).stem}_{num}",
                "number": num,
                "text": wrapped_text,
                "x": round(center_x),
                "y": round(center_y),
                "boxWidth": round(box_w),
                "boxHeight": round(box_h),
                "fontSize": font_size,
                "fontFamily": font_family,
                "weight": "bold",
                "color": "#000000",
                "strokeWidth": 3,
                "strokeColor": "#FFFFFF"
            }
            page_text_layers.append(layer_obj)

        text_layers_data[fname] = page_text_layers

        # Export to Native PSD via ag-psd
        raw_bg_bin = work_dir / f"{Path(fname).stem}_raw_bg.bin"
        raw_rgba = cv2.cvtColor(raw_img, cv2.COLOR_BGR2RGBA)
        with open(raw_bg_bin, "wb") as f_bg:
            f_bg.write(raw_rgba.tobytes())
        temp_patch_files.append(raw_bg_bin)

        psd_filename = f"{Path(fname).stem}.psd"
        out_psd_path = psd_out_dir / psd_filename
        psd_manifest = {
            "width": w,
            "height": h,
            "rawImagePath": str(raw_bg_bin).replace("\\", "/"),
            "outputPath": str(out_psd_path).replace("\\", "/"),
            "inpaintPatches": inpaint_patches,
            "textLayers": page_text_layers
        }

        manifest_file = work_dir / f"{Path(fname).stem}_manifest.json"
        with open(manifest_file, "w", encoding="utf-8") as f_m:
            json.dump(psd_manifest, f_m, ensure_ascii=False)
        temp_patch_files.append(manifest_file)

        # Call export_psd_node.js
        node_script = Path(__file__).resolve().parent / "export_psd_node.js"
        if not node_script.exists():
            node_script = Path(__file__).resolve().parent.parent / "scripts" / "export_psd_node.js"

        cmd = ["node", str(node_script), "--manifest", str(manifest_file)]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if res.returncode == 0 and out_psd_path.exists():
                generated_psds.append(out_psd_path)
                print(f"   ✓ Created {psd_filename} ({time.time() - page_start:.2f}s, {len(inpaint_patches)} patches, {len(page_text_layers)} texts)")
            else:
                print(f"   ❌ PSD Export error: {res.stderr.strip() or res.stdout.strip()}")
        except Exception as e:
            print(f"   ❌ Node invocation error: {e}")

        # Clean up temporary page binary files
        for tf in temp_patch_files:
            try:
                if tf.exists():
                    tf.unlink()
            except Exception:
                pass

    # Update and Save Native MangaToolPlus Project
    if project_data:
        project_data["textLayersData"] = text_layers_data
        base_name = selected_mtp.stem if selected_mtp else f"chapter_{chapter_num}"
        out_mtp_file = work_dir / f"{base_name}_updated.mtp"
        with open(out_mtp_file, "w", encoding="utf-8") as f:
            json.dump(project_data, f, ensure_ascii=False)
        print(f"\n📦 Saved updated project: {out_mtp_file.name}")

    print("\n" + "=" * 65)
    print("🎉 PSD Generation Summary:")
    print(f"   Total Pages Processed:     {len(pages_to_process)}")
    print(f"   Total Matched Layers:      {total_matched_count}")
    print(f"   Total Unmatched Layers:    {total_unmatched_count}")
    print(f"   Generated PSD Files:       {len(generated_psds)}")
    print(f"   Total Elapsed Time:        {time.time() - start_time:.2f}s")
    print("=" * 65)

    # 7. Upload PSD files directly to Google Drive Subfolder
    target_upload_folder_id = folder_id
    if args.upload_to_source and drive_service and generated_psds:
        target_upload_folder_id = get_or_create_subfolder(drive_service, folder_id, folder_name=subfolder_name)
        print(f"\n☁️ [Google Drive Upload] Uploading {len(generated_psds)} PSD files to Drive folder '{subfolder_name}' ({target_upload_folder_id})...")
        up_count = 0
        for psd_file in generated_psds:
            up_id = upload_file_to_source_folder(drive_service, target_upload_folder_id, psd_file)
            if up_id:
                up_count += 1
        print(f"   ✓ Uploaded {up_count}/{len(generated_psds)} PSD files to Google Drive subfolder '{subfolder_name}'!")

    # 8. Notify GAS that Export PSD is complete
    notify_gas_export_psd_completed(
        folder_id=folder_id,
        queue_id=args.queue_id,
        chapter=chapter_num,
        manga_name=manga_name,
        psd_count=len(generated_psds),
        psd_folder_id=target_upload_folder_id if target_upload_folder_id != folder_id else "",
        subfolder_name=subfolder_name,
        gas_url=args.gas_url,
        passcode=args.gas_passcode
    )

    # 9. Clean up local files if requested
    if args.cleanup:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
            print("✓ Local disk cleanup completed!")
        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")


def main():
    parser = argparse.ArgumentParser(description="MangaToolPlus PSD Export & Upload Job")
    parser.add_argument("--folder-id", required=True, help="Google Drive Source Folder ID or URL")
    parser.add_argument("--subfolder-name", "--psd-subfolder", dest="subfolder_name", default="PSD", help="Subfolder name for storing PSD files (default: PSD)")
    parser.add_argument("--manga-name", default="", help="Manga Title")
    parser.add_argument("--chapter-num", default="", help="Chapter Number")
    parser.add_argument("--queue-id", default="", help="WorkQueue item ID")
    parser.add_argument("--doc-url", default="", help="Google Docs Reference URL")
    parser.add_argument("--tab-id", default="", help="Google Docs Tab ID (optional)")
    parser.add_argument("--font", default="TF LANNA Bold", help="Font family for typesetting (default: TF LANNA Bold)")
    parser.add_argument("--google-access-token", default="", help="Google OAuth Access Token from GAS")
    parser.add_argument("--gas-url", default=None, help="GAS Web App exec URL")
    parser.add_argument("--gas-passcode", default="10211032", help="GAS Passcode")
    parser.add_argument("--output-dir", default="./psd_work", help="Local working directory")
    parser.add_argument("--upload-to-source", action="store_true", default=True, help="Upload PSDs to Drive folder")
    parser.add_argument("--cleanup", action="store_true", default=False, help="Clean up local files")
    parser.add_argument("--full", action="store_true", default=False, help="Process all chapter pages")
    parser.add_argument("--limit", type=int, default=3, help="Limit number of pages to process (for test)")
    parser.add_argument("--no-inpaint", action="store_true", default=False, help="Skip inpainting step")

    args = parser.parse_args()
    run_export_psd_pipeline(args)


if __name__ == "__main__":
    main()

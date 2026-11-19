#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Manga Edited MTP Export & Drive Upload Job
====================================================
Automates:
1. Downloads manga raw images & .mtp project from Google Drive source folder.
2. Fetches translation text directly from Google Docs tab (matching chapter number or tab ID).
3. Parses numbered translation [#N] and matches with OCR layers sequentially across the chapter.
4. Cleans speech bubbles using LaMa model (or OpenCV fallback) as individual cropped inpaint layers (Inpaint #N) stored directly as PNG Base64 Data URLs in .mtp tsData.
5. Typesets translation text onto images using 'TF LANNA Bold' font with Thai word wrap & bubble auto-fit stored in .mtp textLayersData & fontRegistry.
6. Generates and saves native editable MangaToolPlus project (.mtp) into the PSD subfolder & updates the source folder .mtp (no .psd generation required).
7. Uploads the edited .mtp file directly back into the Google Drive source folder (PSD subfolder & root folder).
8. Notifies Google Apps Script (COMPLETE_EXPORT_PSD) to update WorkQueue status to 'เสร็จแล้ว'.
"""

import os
import sys
import re
import json
import time
import math
import copy
import base64
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

    # 3. Local Clasp OAuth Credentials (~/.clasprc.json)
    try:
        clasprc = os.path.expanduser("~/.clasprc.json")
        if os.path.exists(clasprc):
            with open(clasprc, "r", encoding="utf-8") as f:
                c = json.load(f)
            tok = c.get("tokens", {}).get("default", {}) or c.get("tokens", {})
            if tok.get("refresh_token") and tok.get("client_id"):
                from google.oauth2.credentials import Credentials
                creds = Credentials(
                    token=tok.get("access_token"),
                    refresh_token=tok.get("refresh_token"),
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=tok.get("client_id"),
                    client_secret=tok.get("client_secret"),
                )
                service = build("drive", "v3", credentials=creds)
                print("🔑 Authenticated Google Drive via Clasp OAuth Credentials")
                return service
    except Exception as e:
        print(f"⚠️ Failed to init with Clasp credentials: {e}")

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


def trash_drive_file_via_gas(file_id, gas_url=None, passcode="10211032"):
    """Trashes a file on Google Drive via Google Apps Script (bypasses OAuth application limitations)."""
    if not file_id:
        return False
    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
    try:
        import requests
        resp = requests.post(
            gas_api_url,
            json={
                "action": "TRASH_DRIVE_FILES",
                "passcode": passcode or "10211032",
                "payload": {"fileIds": [file_id]}
            },
            timeout=25
        )
        return resp.status_code == 200
    except Exception as e:
        print(f"⚠️ Failed to trash file {file_id} via GAS: {e}")
        return False


def upload_file_to_source_folder(drive_service, target_folder_id, file_path, gas_url=None, passcode=None):
    """Uploads a local file directly into target_folder_id."""
    if not drive_service:
        print(f"⚠️ No Google Drive service. Skipping cloud upload for {file_path}.")
        return None

    from googleapiclient.http import MediaFileUpload
    p = Path(file_path)
    file_name = p.name
    size_mb = p.stat().st_size / (1024 * 1024)
    print(f"📤 Uploading {file_name} ({size_mb:.2f} MB) to Drive folder ({target_folder_id})...")

    try:
        suffix = p.suffix.lower()
        if suffix == ".psd":
            mimetype = "image/vnd.adobe.photoshop"
        elif suffix == ".mtp":
            mimetype = "application/octet-stream"
        elif suffix == ".json":
            mimetype = "application/json"
        else:
            mimetype = "application/octet-stream"
        media = MediaFileUpload(str(p), mimetype=mimetype, resumable=True)

        meta = {"name": file_name, "parents": [target_folder_id]}
        uploaded = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
        print(f"   ✓ Uploaded new {file_name} (ID: {uploaded.get('id')})")
        return uploaded.get("id")
    except Exception as e:
        print(f"❌ Failed to upload {file_name} to Google Drive: {e}")
        return None


def update_mtp_in_source_folder(drive_service, source_folder_id, local_mtp_path, gas_url=None, passcode=None):
    """Updates existing .mtp project file in source_folder_id on Google Drive (with imported translations & unmatched layers removed)."""
    if not drive_service or not local_mtp_path or not Path(local_mtp_path).exists():
        return None

    from googleapiclient.http import MediaFileUpload
    p = Path(local_mtp_path)
    size_mb = p.stat().st_size / (1024 * 1024)
    clean_folder_id = extract_folder_id(source_folder_id)

    try:
        query = (
            f"'{clean_folder_id}' in parents and "
            f"mimeType != 'application/vnd.google-apps.folder' and "
            f"trashed = false"
        )
        res = drive_service.files().list(q=query, pageSize=200, fields="files(id, name)").execute()
        mtp_files = [f for f in res.get("files", []) if f.get("name", "").lower().endswith(".mtp")]
        media = MediaFileUpload(str(p), mimetype="application/octet-stream", resumable=True)

        if mtp_files:
            primary = [f for f in mtp_files if not f["name"].lower().endswith("_updated.mtp")] or mtp_files
            target = primary[0]
            print(f"📤 [Drive MTP Update] Updating {target['name']} ({size_mb:.2f} MB) in Drive source folder ({clean_folder_id})...")
            try:
                updated = drive_service.files().update(fileId=target["id"], media_body=media).execute()
                print(f"   ✓ Updated .mtp in Google Drive: {target['name']} (ID: {updated.get('id')})")
                return updated.get("id")
            except Exception as upd_err:
                print(f"   ⚠️ Direct update failed ({upd_err}). Trashing old copy via GAS and uploading fresh...")
                trash_drive_file_via_gas(target["id"], gas_url=gas_url, passcode=passcode)
                meta = {"name": p.name, "parents": [clean_folder_id]}
                uploaded = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
                print(f"   ✓ Uploaded replacement .mtp in Google Drive: {p.name} (ID: {uploaded.get('id')})")
                return uploaded.get("id")
        else:
            print(f"📤 [Drive MTP Upload] Uploading {p.name} ({size_mb:.2f} MB) to Drive source folder ({clean_folder_id})...")
            meta = {"name": p.name, "parents": [clean_folder_id]}
            uploaded = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
            print(f"   ✓ Uploaded new .mtp to Google Drive: {p.name} (ID: {uploaded.get('id')})")
            return uploaded.get("id")
    except Exception as e:
        print(f"❌ Failed to update .mtp in Google Drive: {e}")
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


def safe_local_filename(name: str, max_bytes: int = 160) -> str:
    """
    Sanitizes and truncates a filename so its UTF-8 byte length stays safely
    below Linux's 255-byte NAME_MAX limit (even when gdown appends .xxxxxx.part).
    Preserves file extension and chapter suffix.
    """
    p = Path(name or "file")
    suffix = p.suffix
    stem = p.stem if suffix else p.name

    illegal_chars = set(':"<>|*?\r\n\\/')
    stem = "".join("_" if c in illegal_chars else c for c in stem).strip("_ ")
    stem = stem or "file"

    suffix_bytes = len(suffix.encode("utf-8"))
    budget = max(40, max_bytes - suffix_bytes)

    if len(stem.encode("utf-8")) > budget:
        tail_budget = min(45, budget // 3)
        tail = stem
        while len(tail.encode("utf-8")) > tail_budget:
            tail = tail[1:]
        head_budget = budget - len(tail.encode("utf-8")) - 1
        head = stem
        while len(head.encode("utf-8")) > head_budget:
            head = head[:-1]
        stem = f"{head.rstrip('_ ')}_{tail.lstrip('_ ')}"

    return f"{stem}{suffix}"


def download_images_from_gdrive(folder_url_or_id, output_dir, drive_service=None):
    """Downloads images & files from Google Drive folder with UTF-8 length safety."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    folder_id = extract_folder_id(folder_url_or_id)

    # Check if folder marker matches to avoid cross-folder contamination
    marker_file = out_path / ".folder_id"
    if marker_file.exists():
        try:
            cached_id = marker_file.read_text(encoding="utf-8").strip()
            if cached_id != folder_id:
                print(f"🧹 Folder ID changed ({cached_id} -> {folder_id}), cleaning cached files...")
                for f in out_path.glob("*.*"):
                    if not f.name.startswith("."):
                        try:
                            f.unlink()
                        except Exception:
                            pass
        except Exception:
            pass

    # Check if images & .mtp already exist locally for this folder to save bandwidth
    existing_images = sorted([
        f for f in out_path.glob("*.*")
        if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
    ])
    existing_mtp = list(out_path.glob("*.mtp"))
    if len(existing_images) > 0 and len(existing_mtp) > 0:
        print(f"📦 Found {len(existing_images)} existing images & {len(existing_mtp)} .mtp in {out_path}, skipping redownload.")
        return existing_images

    try:
        marker_file.write_text(folder_id, encoding="utf-8")
    except Exception:
        pass

    url = f"https://drive.google.com/drive/folders/{folder_id}"
    print(f"📥 [Drive] Downloading files from: {url}")

    # 1. Primary: Download via authenticated Google Drive API v3 if available
    if drive_service:
        try:
            from googleapiclient.http import MediaIoBaseDownload
            query = (
                f"'{folder_id}' in parents and "
                f"mimeType != 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )
            res = drive_service.files().list(
                q=query,
                pageSize=500,
                fields="files(id, name, mimeType)"
            ).execute()
            drive_files = res.get("files", [])
            if drive_files:
                print(f"   📂 Found {len(drive_files)} files via Google Drive API. Downloading...")
                for df in sorted(drive_files, key=lambda x: x.get("name", "")):
                    fid = df.get("id")
                    orig_name = df.get("name", fid)
                    mime = df.get("mimeType", "")
                    if mime.startswith("application/vnd.google-apps."):
                        continue
                    safe_name = safe_local_filename(orig_name)
                    dest_file = out_path / safe_name
                    try:
                        request = drive_service.files().get_media(fileId=fid)
                        with open(dest_file, "wb") as fh:
                            downloader = MediaIoBaseDownload(fh, request)
                            done = False
                            while not done:
                                _, done = downloader.next_chunk()
                    except Exception as dl_err:
                        print(f"   ⚠️ Skipping file {orig_name}: {dl_err}")
                        if dest_file.exists():
                            try:
                                dest_file.unlink()
                            except Exception:
                                pass
        except Exception as api_err:
            print(f"⚠️ Drive API folder download warning: {api_err}")

    images = sorted([
        f for f in out_path.glob("*.*")
        if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
    ])
    if images:
        return images

    # 2. Fallback: Download via gdown with per-file safe filename truncation
    try:
        import gdown
        try:
            file_list = gdown.download_folder(url, output=str(out_path), quiet=False, skip_download=True)
            if file_list:
                for f_item in file_list:
                    fid = getattr(f_item, "id", None)
                    lpath = getattr(f_item, "local_path", None) or getattr(f_item, "path", "")
                    if not fid:
                        continue
                    safe_name = safe_local_filename(Path(lpath).name if lpath else f"{fid}")
                    dest_path = out_path / safe_name
                    try:
                        gdown.download(id=fid, output=str(dest_path), quiet=False)
                    except Exception as item_err:
                        print(f"   ⚠️ Warning downloading {safe_name} ({fid}): {item_err}")
        except TypeError:
            # Older gdown without skip_download
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
def discover_all_tabs(doc_id: str, access_token: str = None) -> list[dict]:
    """Discovers all document tabs [{id: tid, title: title}] from Docs API or preview/edit HTML."""
    tabs = []

    # 1. Google Docs API (if OAuth access token available)
    if access_token:
        try:
            api_url = f"https://docs.googleapis.com/v1/documents/{doc_id}?includeTabsContent=false"
            req = urllib.request.Request(api_url, headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "Mozilla/5.0"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                for t in data.get('tabs', []):
                    props = t.get('tabProperties', {})
                    tid = props.get('tabId')
                    title = props.get('title')
                    if tid and title:
                        tabs.append({"id": tid, "title": title})
            if tabs:
                return tabs
        except Exception:
            pass

    # 2. Preview & Edit HTML endpoints (works reliably without extra API scopes)
    for endpoint in ['preview', 'edit']:
        try:
            url = f"https://docs.google.com/document/d/{doc_id}/{endpoint}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if access_token:
                req.add_header("Authorization", f"Bearer {access_token}")
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8', errors='replace')

            # Base/initial tab: {"ty":"mkch","d":[[1,"01"]]}
            base_tab = re.search(r'\{"ty":"mkch","d":\[\[\d+,"([^"]+)"\]\]', html)
            if base_tab:
                base_title = base_tab.group(1)
                tabs.append({"id": "t.0", "title": base_title})

            # Added tabs: ["t.xxx", [1, "title"]]
            matches_ac = re.findall(r'\["(t\.[a-zA-Z0-9_-]+)"\s*,\s*\[\d+\s*,\s*"([^"]+)"\]', html)
            for tid, ttitle in matches_ac:
                if not any(t["id"] == tid for t in tabs):
                    tabs.append({"id": tid, "title": ttitle})

            # Alternative tabProperties JSON
            matches_prop = re.findall(r'"tabId":\s*"(t\.[^"]+)"[^}]+"title":\s*"([^"]+)"', html)
            for tid, ttitle in matches_prop:
                if not any(t["id"] == tid for t in tabs):
                    tabs.append({"id": tid, "title": ttitle})

            if tabs:
                return tabs
        except Exception:
            pass

    return tabs


def resolve_tab_id(doc_id: str, tab_id: str = "", chapter_num: str = "", access_token: str = None) -> tuple[str, str]:
    """
    Intelligently resolves the correct tab_id for given chapter_num.
    Translators typically name tabs as just '31', '32', '33' (without 'ch' prefix) or '01', '02', '03'.
    Prevents mismatched tab selection (e.g. Chapter 1 tab sent for Chapter 31).
    """
    tabs = discover_all_tabs(doc_id, access_token)
    if not tabs:
        return tab_id, "direct tab_id or default document (no tabs found)"

    clean_target = str(chapter_num).strip().lstrip("0") or "0" if chapter_num else ""

    matched_tab = None
    if clean_target:
        # Match strategy 1: Exact title match or normalized title match (e.g. '31' == '31', '031' == '31')
        for t in tabs:
            tclean = t["title"].strip()
            if tclean.lower() == str(chapter_num).strip().lower() or (tclean.lstrip("0") or "0") == clean_target:
                matched_tab = t
                break

        # Match strategy 2: Title with prefix (Chapter 31, ตอน 31, ตอนที่ 31, Ch.31)
        if not matched_tab:
            for t in tabs:
                tclean = t["title"].strip()
                m = re.search(r'(?:chapter|ตอนที่|ตอน|ch\.?|ep\.?)\s*(\d+(?:\.\d+)?)', tclean, re.IGNORECASE)
                if m and (m.group(1).lstrip("0") or "0") == clean_target:
                    matched_tab = t
                    break

        # Match strategy 3: Isolated number in title (ignoring glossary)
        if not matched_tab:
            for t in tabs:
                tclean = t["title"].strip()
                if re.search(r'glossary|คำศัพท์', tclean, re.IGNORECASE):
                    continue
                m = re.search(r'\b0*(\d+(?:\.\d+)?)\b', tclean)
                if m and (m.group(1).lstrip("0") or "0") == clean_target:
                    matched_tab = t
                    break

    # If matching tab found for chapter
    if matched_tab:
        if tab_id and tab_id != matched_tab["id"]:
            old_title = next((t["title"] for t in tabs if t["id"] == tab_id), "unknown")
            print(f"   ⚠️ Specified tab '{tab_id}' ('{old_title}') mismatches Chapter {chapter_num}! Auto-switching to '{matched_tab['title']}' ({matched_tab['id']})")
        else:
            print(f"   ✓ Auto-detected tab for Chapter {chapter_num}: {matched_tab['id']} ('{matched_tab['title']}')")
        return matched_tab["id"], f"tab '{matched_tab['title']}'"

    # If no matching tab for chapter but tab_id was given
    if tab_id:
        return tab_id, f"specified tab '{tab_id}'"

    return "", "full document fallback"


def find_matching_tab_id(doc_id: str, chapter_num: str, access_token: str = None) -> str:
    """Discovers tab_id corresponding to chapter_num (legacy wrapper)."""
    tid, _ = resolve_tab_id(doc_id, tab_id="", chapter_num=chapter_num, access_token=access_token)
    return tid


def fetch_doc_translation_text(doc_id: str, tab_id: str = "", chapter_num: str = "", access_token: str = None) -> str:
    """Fetches text content from the specified or auto-resolved Google Docs tab, with fallback to full doc."""
    resolved_tab, tab_desc = resolve_tab_id(doc_id, tab_id, chapter_num, access_token)

    text = ""
    # 1. Try resolved tab_id first
    if resolved_tab:
        url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt&tab={resolved_tab}"
        print(f"📄 Fetching translation from Google Docs tab ({resolved_tab} - {tab_desc}): {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        if access_token:
            req.add_header("Authorization", f"Bearer {access_token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"   ⚠️ Tab {resolved_tab} fetch failed: {e}")

    # Verify if tab content contains dialogue items [#N]
    test_d = parse_numbered_translations(text, quiet=True) if text else {}
    if len(test_d) > 0:
        return text

    if resolved_tab:
        print(f"   ⚠️ Tab '{resolved_tab}' returned 0 dialogue items (likely glossary or empty tab). Trying full document fallback...")

    # 2. Fallback to full doc export without tab parameter
    url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    print(f"📄 Fetching full document translation (no tab): {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    if access_token:
        req.add_header("Authorization", f"Bearer {access_token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"   ⚠️ Full doc export failed: {e}")

    return text


def extract_chapter_section(raw_text: str, chapter_num: str) -> str:
    """Extracts the specific chapter section from text containing multiple chapters."""
    if not raw_text or not chapter_num:
        return raw_text

    target = str(chapter_num).strip().lstrip("0") or "0"
    lines = raw_text.splitlines()

    chap_starts = []
    header_pattern = re.compile(r"^\s*(?:Chapter|ตอนที่|ตอน|Ch\.|EP\.)\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)

    in_glossary = False
    for i, line in enumerate(lines):
        sline = line.strip()
        if "glossary" in sline.lower() or "คำศัพท์" in sline:
            in_glossary = True
        if in_glossary:
            if sline.startswith("[#") or sline.startswith("["):
                in_glossary = False
            else:
                continue

        # Skip table cells (indented with tab)
        if line.startswith("\t"):
            continue

        m = header_pattern.match(sline)
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
        if len(chap_starts) > 1:
            found_nums = [c[1] for c in chap_starts]
            print(f"   ⚠️ Chapter {chapter_num} was NOT found in multi-chapter document! Present chapters: {found_nums[:8]}")
            print(f"   🛑 Blocking full document fallback to avoid corrupting Chapter {chapter_num} with Chapter {found_nums[0]} translations.")
            return ""
        print(f"   ℹ️ Chapter {chapter_num} header not explicitly separated; using full document")
        return raw_text


def parse_numbered_translations(doc_text: str, quiet: bool = False) -> dict[int, str]:
    """
    Parses numbered translation blocks [#N] matching MangaToolPlus sequential OCR layers.
    Selects Thai translated text if present, otherwise uses last available line.
    Prevents concatenating multiple chapters if the document contains repetitive [#1] blocks.
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
            num = int(m.group(1))
            content = m.group(2).strip()

            # If the index drops significantly (e.g. from 20+ down to 1), a new chapter started in the doc
            if current_num is not None and num < current_num and current_num > 5:
                break

            current_num = num
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
            # If translator wrote lines with multiple Thai sentences, combine them cleanly
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

    if pythainlp is not None:
        raw_tokens = pythainlp.word_tokenize(raw_text, engine="newmm")
    else:
        raw_tokens = raw_text.split() or [raw_text]

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
# 5. GAS Notification Callback
# ==============================================================================
def notify_gas_export_psd_completed(folder_id, queue_id="", chapter="", manga_name="", psd_count=0, psd_folder_id="", subfolder_name="PSD", gas_url=None, passcode="10211032"):
    """Notifies Google Apps Script to mark Export PSD as 'เสร็จแล้ว' and attach [Export PSD] link."""
    gas_api_url = gas_url or "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
    effective_folder_id = (psd_folder_id or folder_id or "").strip()
    psd_folder_url = f"https://drive.google.com/drive/folders/{effective_folder_id}" if effective_folder_id else ""
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
            "psdFolderId": effective_folder_id,
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
    folder_id = extract_folder_id(args.folder_id)
    doc_id = extract_doc_id(args.doc_url)
    chapter_num = str(args.chapter_num).strip()
    manga_name = args.manga_name.strip()
    font_family = args.font or "TF LANNA Bold"

    subfolder_name = getattr(args, "subfolder_name", None) or getattr(args, "psd_subfolder", "PSD") or "PSD"

    # Ensure working directory is isolated per folder_id to avoid sharing/polluting cache between runs
    base_out = Path(args.output_dir)
    if base_out.name == "psd_work" or not base_out.is_absolute():
        work_dir = (base_out / folder_id).resolve()
    else:
        work_dir = base_out.resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    psd_out_dir = work_dir / subfolder_name
    psd_out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 65)
    print("🚀 Manga Edited MTP Export Pipeline (MangaToolPlus Native Logic)")
    print(f"📁 Folder ID:     {folder_id}")
    print(f"📂 Subfolder:     {subfolder_name}")
    print(f"📖 Manga Name:    {manga_name}")
    print(f"🔢 Chapter:       {chapter_num}")
    print(f"📄 Doc ID:        {doc_id}")
    print(f"🔤 Font:          {font_family}")
    print(f"💾 Work Dir:      {work_dir}")
    print("=" * 65)

    # 1. Initialize Google Drive Service
    drive_service = get_drive_service(args.google_access_token)
    mtp_only = getattr(args, "mtp_only", False)

    # 2. Download Images & Project Files from Drive Folder (or only .mtp in --mtp-only mode)
    image_files = []
    if mtp_only and drive_service:
        try:
            from googleapiclient.http import MediaIoBaseDownload
            query = (
                f"'{folder_id}' in parents and "
                f"mimeType != 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )
            res = drive_service.files().list(q=query, pageSize=200, fields="files(id, name)").execute()
            mtp_drive_files = [f for f in res.get("files", []) if f.get("name", "").lower().endswith(".mtp")]
            for df in mtp_drive_files:
                safe_name = safe_local_filename(df.get("name", df["id"]))
                dest_file = work_dir / safe_name
                request = drive_service.files().get_media(fileId=df["id"])
                with open(dest_file, "wb") as fh:
                    downloader = MediaIoBaseDownload(fh, request)
                    done = False
                    while not done:
                        _, done = downloader.next_chunk()
                print(f"📥 [MTP-Only] Downloaded {safe_name}")
        except Exception as e:
            print(f"⚠️ [MTP-Only] Error downloading .mtp via Drive API: {e}")
    else:
        image_files = download_images_from_gdrive(folder_id, work_dir, drive_service=drive_service)

    # 3. Load MangaToolPlus Project (.mtp)
    # Prefer original downloaded .mtp file (not *_updated.mtp)
    mtp_files = list(work_dir.glob("*.mtp"))
    original_mtps = [f for f in mtp_files if not f.name.endswith("_updated.mtp")]
    selected_mtp = original_mtps[0] if original_mtps else (mtp_files[0] if mtp_files else None)

    # If no .mtp found locally, search Drive folder explicitly
    if not selected_mtp and drive_service:
        try:
            from googleapiclient.http import MediaIoBaseDownload
            # 1. Search in root folder
            query = f"'{folder_id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false"
            res = drive_service.files().list(q=query, pageSize=100, fields="files(id, name)").execute()
            root_mtps = [f for f in res.get("files", []) if f.get("name", "").lower().endswith(".mtp")]
            # 2. If not in root, check subfolder PSD
            if not root_mtps:
                q_sub = f"'{folder_id}' in parents and name='{subfolder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
                res_sub = drive_service.files().list(q=q_sub, fields="files(id, name)").execute()
                sub_list = res_sub.get("files", [])
                if sub_list:
                    sub_fid = sub_list[0]["id"]
                    q_sub_mtp = f"'{sub_fid}' in parents and trashed=false"
                    res_sub_mtp = drive_service.files().list(q=q_sub_mtp, pageSize=100, fields="files(id, name)").execute()
                    root_mtps = [f for f in res_sub_mtp.get("files", []) if f.get("name", "").lower().endswith(".mtp")]

            for df in root_mtps:
                safe_name = safe_local_filename(df.get("name", df["id"]))
                dest_file = work_dir / safe_name
                request = drive_service.files().get_media(fileId=df["id"])
                with open(dest_file, "wb") as fh:
                    downloader = MediaIoBaseDownload(fh, request)
                    done = False
                    while not done:
                        _, done = downloader.next_chunk()
                print(f"📥 Downloaded source .mtp from Drive: {safe_name}")
            mtp_files = list(work_dir.glob("*.mtp"))
            original_mtps = [f for f in mtp_files if not f.name.endswith("_updated.mtp")]
            selected_mtp = original_mtps[0] if original_mtps else (mtp_files[0] if mtp_files else None)
        except Exception as e:
            print(f"⚠️ Error downloading source .mtp via Drive API: {e}")

    project_data = {}
    if selected_mtp and selected_mtp.exists():
        try:
            print(f"📦 Loading MangaToolPlus Project: {selected_mtp.name}")
            with open(selected_mtp, "r", encoding="utf-8") as f:
                project_data = json.load(f)
        except Exception as e:
            print(f"⚠️ Could not load {selected_mtp.name}: {e}")

    if not image_files and not project_data:
        print("❌ No images or valid .mtp project found in folder!")
        sys.exit(1)

    if mtp_only and not project_data:
        print("❌ [MTP-Only] No valid .mtp project found in folder!")
        return

    # Preserve original unfiltered OCR/TS layers inside project_data so re-syncing is 100% idempotent
    existing_ts_data = copy.deepcopy(project_data.get("tsData", {}))
    if "originalTsData" not in project_data and "tsData" in project_data and project_data["tsData"]:
        project_data["originalTsData"] = copy.deepcopy(project_data["tsData"])
    if "originalOcrData" not in project_data and "ocrData" in project_data and project_data["ocrData"]:
        project_data["originalOcrData"] = copy.deepcopy(project_data["ocrData"])

    # Prepare files list and layer mappings from MTP
    all_files_info = project_data.get("files", [])
    ts_data = project_data.get("tsData", {})
    ocr_data = project_data.get("ocrData", {})
    source_ts_data = copy.deepcopy(project_data.get("originalTsData") or ts_data)
    source_ocr_data = copy.deepcopy(project_data.get("originalOcrData") or ocr_data)

    # Helper: normalize page stems so '001.jpg', '01.jpg', '1.jpg' match cleanly
    def normalize_page_stem(name: str) -> str:
        stem = Path(str(name or "")).stem.lower().strip()
        m = re.match(r"^(.*?)0*(\d+)$", stem)
        if m:
            return f"{m.group(1)}{int(m.group(2))}"
        return stem

    def _filter_text_layers(raw_layers):
        if not isinstance(raw_layers, list):
            return []
        return [copy.deepcopy(l) for l in raw_layers if isinstance(l, dict) and l.get("type") != "inpaint" and not l.get("patchUrl")]

    def get_existing_inpaint_layers_for_page(filename: str):
        raw_layers = []
        if filename in existing_ts_data and existing_ts_data[filename]:
            raw_layers = existing_ts_data[filename]
        else:
            stem = Path(filename).stem.lower()
            norm_stem = normalize_page_stem(filename)
            for k, v in existing_ts_data.items():
                if (Path(k).stem.lower() == stem or normalize_page_stem(k) == norm_stem) and v:
                    raw_layers = v
                    break
        if not isinstance(raw_layers, list):
            return []
        return [copy.deepcopy(l) for l in raw_layers if isinstance(l, dict) and (l.get("type") == "inpaint" or bool(l.get("patchUrl")))]

    # Check if project has valid speech bubble layers defined in tsData across any page
    has_project_ts_layers = False
    if isinstance(source_ts_data, dict):
        for k_val in source_ts_data.values():
            if _filter_text_layers(k_val):
                has_project_ts_layers = True
                break

    # Helper: resolve layers for a given file name
    # When project has tsData, tsData is the absolute authority! Empty list means 0 dialogue layers.
    # NEVER fallback to ocr_data on a per-page basis when tsData exists in the project.
    def get_layers_for_page(filename: str):
        stem = Path(filename).stem.lower()
        norm_stem = normalize_page_stem(filename)

        if has_project_ts_layers:
            # 1. Exact match in source_ts_data
            if filename in source_ts_data:
                return _filter_text_layers(source_ts_data[filename])
            # 2. Case-insensitive or normalized stem match in source_ts_data
            for k, v in source_ts_data.items():
                if Path(k).stem.lower() == stem or normalize_page_stem(k) == norm_stem:
                    return _filter_text_layers(v)
            # 3. Check legacy 'pages' format if any
            if "pages" in project_data and isinstance(project_data.get("pages"), list):
                for p in project_data["pages"]:
                    p_name = p.get("fileName", "") or p.get("name", "")
                    if Path(p_name).stem.lower() == stem or normalize_page_stem(p_name) == norm_stem:
                        return _filter_text_layers(p.get("layers", []))
            return []

        # Only if the entire project has NO tsData at all, fallback to OCR data:
        if filename in source_ocr_data:
            return _filter_text_layers(source_ocr_data[filename])
        for k, v in source_ocr_data.items():
            if Path(k).stem.lower() == stem or normalize_page_stem(k) == norm_stem:
                return _filter_text_layers(v)

        if "pages" in project_data and isinstance(project_data.get("pages"), list):
            for p in project_data["pages"]:
                p_name = p.get("fileName", "") or p.get("name", "")
                if Path(p_name).stem.lower() == stem or normalize_page_stem(p_name) == norm_stem:
                    return _filter_text_layers(p.get("layers", []))
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
    if not args.no_inpaint and not mtp_only:
        model_paths = [
            Path("models/big-lama.pt"),
            Path(__file__).resolve().parent.parent / "models" / "big-lama.pt",
        ]
        repo_model = Path(__file__).resolve().parent.parent / "models" / "big-lama.pt"
        if not any(mp.exists() and mp.stat().st_size > 50_000_000 for mp in model_paths):
            try:
                repo_model.parent.mkdir(parents=True, exist_ok=True)
                lama_url = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt"
                print(f"📥 Downloading LaMa model to {repo_model}...")
                urllib.request.urlretrieve(lama_url, str(repo_model))
            except Exception as dl_err:
                print(f"⚠️ Could not auto-download LaMa model: {dl_err}")
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
    if not all_files_info and source_ts_data:
        for k_name in sorted(source_ts_data.keys()):
            all_files_info.append({"name": k_name})

    pages_to_process = all_files_info if (args.full or mtp_only) else all_files_info[:args.limit]
    total_pages = len(pages_to_process)
    text_layers_data = {}
    total_inpaint_count = 0

    # Sequential global indexing across all pages in the chapter (MangaToolPlus logic)
    global_index = 1
    total_matched_count = 0
    total_unmatched_count = 0

    print(f"\n🎨 Processing {total_pages} pages (matching translations [#1]..[#N])...")

    for file_idx, f_info in enumerate(pages_to_process, start=1):
        page_start = time.time()
        fname = f_info.get("name", "")
        img_path = work_dir / fname
        raw_img = None
        w = int(f_info.get("width") or 800)
        h = int(f_info.get("height") or 1200)

        if not mtp_only:
            if not img_path.exists():
                # 1. Try finding image with exact matching stem
                cand = list(work_dir.glob(f"{Path(fname).stem}.*"))
                cand = [c for c in cand if c.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]]
                # 2. Try normalized numeric stem match (e.g. '01.jpg' in .mtp vs '001.jpg' on disk)
                if not cand:
                    norm_target = normalize_page_stem(fname)
                    cand = [c for c in image_files if normalize_page_stem(c.name) == norm_target]
                # 3. Try positional match if image count matches MTP page count
                if not cand and len(image_files) == len(all_files_info) and 1 <= file_idx <= len(image_files):
                    cand = [image_files[file_idx - 1]]
                # 4. Try decoding embedded base64 dataUrl from .mtp if present
                if not cand and f_info.get("dataUrl") and "base64," in str(f_info.get("dataUrl", "")):
                    try:
                        b64_part = str(f_info["dataUrl"]).split("base64,", 1)[1]
                        decoded_path = work_dir / safe_local_filename(fname or f"{file_idx:03d}.jpg")
                        with open(decoded_path, "wb") as fb:
                            fb.write(base64.b64decode(b64_part))
                        cand = [decoded_path]
                    except Exception as dec_err:
                        print(f"   ⚠️ Failed to decode embedded dataUrl for {fname}: {dec_err}")

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
            f_info["width"] = w
            f_info["height"] = h
            if not f_info.get("dataUrl") or "base64," not in str(f_info.get("dataUrl", "")):
                try:
                    ext = img_path.suffix.lower()
                    mime_map = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
                    mime_type = mime_map.get(ext, "image/jpeg")
                    with open(img_path, "rb") as img_fb:
                        img_b64 = base64.b64encode(img_fb.read()).decode("utf-8")
                    f_info["dataUrl"] = f"data:{mime_type};base64,{img_b64}"
                except Exception as enc_err:
                    print(f"   ⚠️ Could not encode image dataUrl for {fname}: {enc_err}")

        # Retrieve layers for this page (check both MTP fname and actual disk filename)
        layers = get_layers_for_page(fname) or get_layers_for_page(img_path.name)
        existing_inpaint_layers = get_existing_inpaint_layers_for_page(fname) or get_existing_inpaint_layers_for_page(img_path.name)
        page_matched_layers = []

        for l in layers:
            current_num = global_index
            global_index += 1

            if not l.get("id"):
                l["id"] = f"ocr_layer_{Path(fname).stem}_{current_num}"
            if not l.get("type"):
                l["type"] = "text"

            if current_num in translations:
                thai_trans = translations[current_num]
                l["translation"] = thai_trans
                page_matched_layers.append((current_num, l))
                total_matched_count += 1
            elif not translations and l.get("translation") and str(l.get("translation")).strip():
                # Fallback if no doc translations were fetched or provided, keep existing non-empty translation in layer
                page_matched_layers.append((current_num, l))
                total_matched_count += 1
            else:
                l["translation"] = ""
                total_unmatched_count += 1

        print(f"\n📄 [{file_idx}/{total_pages}] Processing {fname} ({w}x{h}): {len(page_matched_layers)} matched / {len(layers) - len(page_matched_layers)} unmatched removed")

        # Inpainting speech bubbles as individual MangaToolPlus inpaint layers
        inpaint_map = {}
        pad = 12  # Padding around the bounding box

        if not args.no_inpaint and not mtp_only and raw_img is not None and page_matched_layers:
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

                    ok_png, png_buf = cv2.imencode(".png", cleaned_patch)
                    if not ok_png:
                        continue
                    patch_b64 = base64.b64encode(png_buf.tobytes()).decode("utf-8")
                    patch_data_url = f"data:image/png;base64,{patch_b64}"

                    inpaint_layer = {
                        "id": f"inpaint_{Path(fname).stem}_{num}",
                        "type": "inpaint",
                        "targetLayerId": l.get("id"),
                        "box": l.get("box", []),
                        "inpaintModel": "lama" if lama_service else "fill",
                        "patchUrl": patch_data_url,
                        "patchExpansion": pad,
                        "patchRect": [min_x, min_y, max_x, max_y],
                        "inpaintVisible": True,
                        "patchTimestamp": int(time.time() * 1000),
                        "visible": True,
                        "selected": False,
                        "text": "",
                        "originalText": "",
                        "translation": "",
                        "isExternalEdit": False,
                    }
                    inpaint_map[num] = inpaint_layer

                    # Record in mtp text layer structure
                    l["patchUrl"] = None
                    l["inpaintModel"] = None
                    l["patchRect"] = [min_x, min_y, max_x, max_y]
                    l["inpaintVisible"] = True
                except Exception as inp_err:
                    print(f"   ⚠️ Inpaint error #{num}: {inp_err}")

            if inpaint_map:
                total_inpaint_count += len(inpaint_map)
                print(f"   🎨 Inpainted {len(inpaint_map)} patches in {time.time() - t_inp0:.2f}s")
        elif existing_inpaint_layers and page_matched_layers:
            # In --mtp-only or --no-inpaint mode, preserve existing inpaint layers that match matched text layers
            for num, l in page_matched_layers:
                l_id = l.get("id")
                l_box = l.get("box", [])
                matched_inp = None
                for inp in existing_inpaint_layers:
                    if (l_id and inp.get("targetLayerId") == l_id) or (l_box and inp.get("box") == l_box):
                        matched_inp = copy.deepcopy(inp)
                        break
                if matched_inp:
                    inpaint_map[num] = matched_inp
                    l["patchUrl"] = None
                    l["inpaintModel"] = None
                    if matched_inp.get("patchRect"):
                        l["patchRect"] = matched_inp["patchRect"]
                    l["inpaintVisible"] = True
            total_inpaint_count += len(inpaint_map)

        # Pair [inpaint_layer_1, l_1, inpaint_layer_2, l_2, ...] in tsData and remove unmatched layers
        combined_ts_layers = []
        for num, l in page_matched_layers:
            if num in inpaint_map:
                combined_ts_layers.append(inpaint_map[num])
            combined_ts_layers.append(l)

        matched_only_text_layers = [l for _, l in page_matched_layers]
        matched_ocr_entries = [
            {"text": l.get("originalText") or l.get("text", ""), "box": l.get("box", [])}
            for _, l in page_matched_layers
        ]
        norm_page = normalize_page_stem(fname)
        stem_page = Path(fname).stem.lower()
        updated_ts_key = False
        for k in list(ts_data.keys()):
            if k == fname or Path(k).stem.lower() == stem_page or normalize_page_stem(k) == norm_page:
                ts_data[k] = combined_ts_layers
                updated_ts_key = True
        if not updated_ts_key:
            ts_data[fname] = combined_ts_layers

        updated_ocr_key = False
        for k in list(ocr_data.keys()):
            if k == fname or Path(k).stem.lower() == stem_page or normalize_page_stem(k) == norm_page:
                ocr_data[k] = matched_ocr_entries
                updated_ocr_key = True
        if not updated_ocr_key:
            ocr_data[fname] = matched_ocr_entries

        if "pages" in project_data and isinstance(project_data.get("pages"), list):
            for p_obj in project_data["pages"]:
                p_name = p_obj.get("fileName", "") or p_obj.get("name", "")
                if Path(p_name).stem.lower() == stem_page or normalize_page_stem(p_name) == norm_page:
                    p_obj["layers"] = matched_only_text_layers

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
                "type": "text",
                "number": num,
                "text": wrapped_text,
                "x": round(center_x),
                "y": round(center_y),
                "boxWidth": round(box_w),
                "boxHeight": round(box_h),
                "size": font_size,
                "fontSize": font_size,
                "fontType": l.get("fontType") or "normal",
                "fontFamily": font_family,
                "weight": "bold",
                "style": "normal",
                "color": "#000000",
                "rot": 0,
                "align": "center",
                "textAlign": "center",
                "lineHeight": 1.2,
                "letterSpacing": 0,
                "opacity": 1,
                "visible": True,
                "selected": False,
                "strokeWidth": 3,
                "strokeColor": "#FFFFFF",
                "strokePosition": "outside",
                "strokeOpacity": 1,
                "blendMode": "source-over",
            }
            l["targetLayerId"] = layer_obj["id"]
            page_text_layers.append(layer_obj)

        text_layers_data[fname] = page_text_layers
        if img_path.name != fname:
            text_layers_data[img_path.name] = page_text_layers
        print(f"   ✓ Prepared page {fname} ({time.time() - page_start:.2f}s, {len(inpaint_map)} patches, {len(page_text_layers)} texts)")

    # Ensure standard MangaToolPlus project structure (version, savedAt, currentMode, files, fontRegistry)
    if not project_data.get("version"):
        project_data["version"] = "1.0.0"
    project_data["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    project_data["currentMode"] = project_data.get("currentMode") or "typesetter"

    if not project_data.get("files"):
        project_data["files"] = all_files_info
    else:
        # Ensure all files in project_data["files"] have embedded dataUrl if available on disk
        for f_entry in project_data["files"]:
            if not f_entry.get("dataUrl") or "base64," not in str(f_entry.get("dataUrl", "")):
                fn = f_entry.get("name", "")
                cand_p = work_dir / fn
                if not cand_p.exists():
                    norm_fn = normalize_page_stem(fn)
                    matches = [c for c in image_files if normalize_page_stem(c.name) == norm_fn]
                    if matches:
                        cand_p = matches[0]
                if cand_p.exists() and cand_p.is_file():
                    try:
                        ext = cand_p.suffix.lower()
                        mime_map = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
                        mime_type = mime_map.get(ext, "image/jpeg")
                        with open(cand_p, "rb") as img_fb:
                            img_b64 = base64.b64encode(img_fb.read()).decode("utf-8")
                        f_entry["dataUrl"] = f"data:{mime_type};base64,{img_b64}"
                    except Exception:
                        pass

    font_registry = project_data.get("fontRegistry")
    if not isinstance(font_registry, dict):
        font_registry = {}
    font_registry["normal"] = font_family
    for role in ["scream", "thought", "narration", "sfx", "system"]:
        if not font_registry.get(role):
            font_registry[role] = font_family
    project_data["fontRegistry"] = font_registry

    project_data["tsData"] = ts_data
    project_data["ocrData"] = ocr_data
    project_data["textLayersData"] = text_layers_data
    if "originalTsData" not in project_data:
        project_data["originalTsData"] = source_ts_data
    if "originalOcrData" not in project_data:
        project_data["originalOcrData"] = source_ocr_data

    # Determine output .mtp filename and save to psd_out_dir & work_dir
    if selected_mtp:
        clean_stem = re.sub(r"_updated$", "", selected_mtp.stem, flags=re.IGNORECASE) or selected_mtp.stem
        mtp_filename = safe_local_filename(f"{clean_stem}.mtp")
        base_name = clean_stem
    else:
        mtp_filename = safe_local_filename(f"chapter_{chapter_num}.mtp" if chapter_num else "project.mtp")
        base_name = Path(mtp_filename).stem

    out_mtp_path = psd_out_dir / mtp_filename
    with open(out_mtp_path, "w", encoding="utf-8") as f_out:
        json.dump(project_data, f_out, ensure_ascii=False)

    out_mtp_file = work_dir / safe_local_filename(f"{base_name}_updated.mtp")
    with open(out_mtp_file, "w", encoding="utf-8") as f_upd:
        json.dump(project_data, f_upd, ensure_ascii=False)

    if selected_mtp and selected_mtp.exists():
        try:
            with open(selected_mtp, "w", encoding="utf-8") as f_orig:
                json.dump(project_data, f_orig, ensure_ascii=False)
        except Exception:
            pass

    print(f"\n📦 Saved Edited MangaToolPlus Project (.mtp): {out_mtp_path} (and {out_mtp_file.name})")

    print("\n" + "=" * 65)
    print("🎉 Edited MTP Generation Summary:")
    print(f"   Total Pages Processed:     {len(pages_to_process)}")
    print(f"   Total Matched Layers:      {total_matched_count}")
    print(f"   Total Unmatched Removed:   {total_unmatched_count}")
    print(f"   Total Inpaint Layers:      {total_inpaint_count}")
    print(f"   Generated MTP File:        {out_mtp_path.name}")
    print(f"   Total Elapsed Time:        {time.time() - start_time:.2f}s")
    print("=" * 65)

    if not out_mtp_path.exists():
        print("❌ Error: Edited .mtp file was not generated! Exiting with error.")
        sys.exit(1)

    if mtp_only:
        if args.upload_to_source and drive_service and out_mtp_path.exists():
            target_upload_folder_id = get_or_create_subfolder(drive_service, folder_id, folder_name=subfolder_name)
            upload_file_to_source_folder(drive_service, target_upload_folder_id, out_mtp_path, gas_url=args.gas_url, passcode=args.gas_passcode)
        if args.cleanup:
            shutil.rmtree(work_dir, ignore_errors=True)
        return

    # 7. Upload Edited .mtp file directly to Google Drive Subfolder (PSD)
    target_upload_folder_id = folder_id
    if drive_service:
        target_upload_folder_id = get_or_create_subfolder(drive_service, folder_id, folder_name=subfolder_name)
    if args.upload_to_source and drive_service and out_mtp_path.exists():
        print(f"\n☁️ [Google Drive Upload] Uploading edited .mtp ({out_mtp_path.name}) to Drive folder '{subfolder_name}' ({target_upload_folder_id})...")
        up_id = upload_file_to_source_folder(drive_service, target_upload_folder_id, out_mtp_path, gas_url=args.gas_url, passcode=args.gas_passcode)
        if up_id:
            print(f"   ✓ Uploaded edited .mtp to Google Drive subfolder '{subfolder_name}'!")

    # 8. Notify GAS that Export PSD/MTP is complete (always pass PSD folder ID so [Export PSD] link is attached)
    if not getattr(args, "no_notify", False):
        notify_gas_export_psd_completed(
            folder_id=folder_id,
            queue_id=args.queue_id,
            chapter=chapter_num,
            manga_name=manga_name,
            psd_count=1,
            psd_folder_id=target_upload_folder_id or folder_id,
            subfolder_name=subfolder_name,
            gas_url=args.gas_url,
            passcode=args.gas_passcode
        )
    else:
        print("\nℹ️ Skipping GAS notification (--no-notify specified).")

    # 9. Clean up local files if requested
    if args.cleanup:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
            print("✓ Local disk cleanup completed!")
        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")


def main():
    parser = argparse.ArgumentParser(description="MangaToolPlus Edited MTP Export & Upload Job")
    parser.add_argument("--folder-id", required=True, help="Google Drive Source Folder ID or URL")
    parser.add_argument("--subfolder-name", "--psd-subfolder", dest="subfolder_name", default="PSD", help="Subfolder name for storing edited .mtp file (default: PSD)")
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
    parser.add_argument("--upload-to-source", action="store_true", default=True, help="Upload edited .mtp to Drive folder")
    parser.add_argument("--cleanup", action="store_true", default=False, help="Clean up local files")
    parser.add_argument("--full", action="store_true", default=False, help="Process all chapter pages")
    parser.add_argument("--limit", type=int, default=3, help="Limit number of pages to process (for test)")
    parser.add_argument("--no-inpaint", action="store_true", default=False, help="Skip inpainting step")
    parser.add_argument("--no-notify", action="store_true", default=False, help="Skip notifying GAS on completion")
    parser.add_argument("--mtp-only", action="store_true", default=False, help="Only resync & update .mtp in Google Drive without re-inpainting")

    args = parser.parse_args()
    run_export_psd_pipeline(args)


if __name__ == "__main__":
    main()

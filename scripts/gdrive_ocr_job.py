"""
Google Drive Manga OCR Pipeline for GitHub Actions / Local Execution.

Features:
1. Downloads images from a specified Google Drive folder (e.g., Chapter 34).
2. Runs OCR (using MangaToolPlus OCR service / EasyOCR / PaddleOCR / Gemini).
3. Creates a subfolder (default: "เทส") in the target Google Drive folder.
4. Uploads OCR results (.json and summary .txt) into that Google Drive subfolder.
"""

import os
import sys
import argparse
import json
import time
import base64
from datetime import datetime, timezone
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if sys.stdout is not None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def get_drive_service(service_account_json=None):
    """Initializes Google Drive API service using a Service Account or OAuth."""
    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account

        # 1. From JSON file path or JSON string
        sa_raw = service_account_json or os.environ.get("GDRIVE_SERVICE_ACCOUNT_KEY")
        if sa_raw:
            scopes = ["https://www.googleapis.com/auth/drive"]
            if os.path.exists(sa_raw):
                creds = service_account.Credentials.from_service_account_file(sa_raw, scopes=scopes)
            else:
                # Assume raw JSON string from GitHub Secret
                info = json.loads(sa_raw)
                creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            return build("drive", "v3", credentials=creds)

        # 2. Check local secrets/credentials.json or token.json
        from app.services.auth_service import AuthService
        auth = AuthService()
        creds = auth.get_credentials()
        if creds:
            return build("drive", "v3", credentials=creds)

    except Exception as e:
        print(f"[Warn] Could not initialize authenticated Drive service: {e}")
    return None


def create_gdrive_folder(drive_service, parent_folder_id, folder_name="เทส"):
    """Creates a subfolder in Google Drive under parent_folder_id."""
    if not drive_service:
        print(f"[Error] Google Drive API credentials required to create folder '{folder_name}' in Google Drive.")
        print("[Tip] Please provide GDRIVE_SERVICE_ACCOUNT_KEY in GitHub Secrets or share the folder with your Service Account.")
        return None

    try:
        # Check if folder already exists
        query = f"'{parent_folder_id}' in parents and name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        existing = drive_service.files().list(q=query, fields="files(id, name)").execute().get("files", [])
        if existing:
            folder_id = existing[0]["id"]
            print(f"[Info] Found existing folder '{folder_name}' (ID: {folder_id})")
            return folder_id

        # Create new folder
        meta = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_folder_id],
        }
        folder = drive_service.files().create(body=meta, fields="id").execute()
        folder_id = folder.get("id")
        print(f"[Success] Created Google Drive folder '{folder_name}' (ID: {folder_id})")
        return folder_id
    except Exception as e:
        print(f"[Error] Failed to create folder in Google Drive: {e}")
        return None


def upload_file_to_gdrive(drive_service, parent_folder_id, file_path):
    """Uploads a local file to a Google Drive folder."""
    if not drive_service:
        return None
    try:
        from googleapiclient.http import MediaFileUpload
        p = Path(file_path)
        meta = {
            "name": p.name,
            "parents": [parent_folder_id],
        }
        media = MediaFileUpload(str(p), resumable=True)
        uploaded = drive_service.files().create(body=meta, media_body=media, fields="id").execute()
        print(f"[Success] Uploaded {p.name} to Google Drive (ID: {uploaded.get('id')})")
        return uploaded.get("id")
    except Exception as e:
        print(f"[Error] Failed to upload {file_path}: {e}")
        return None


def download_images(folder_url_or_id, output_dir):
    """Downloads images from Google Drive folder."""
    import gdown
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if "drive.google.com" in folder_url_or_id:
        url = folder_url_or_id
    else:
        url = f"https://drive.google.com/drive/folders/{folder_url_or_id}"

    print(f"[Info] Downloading images from: {url}")
    downloaded = gdown.download_folder(url, output=str(out_path), quiet=False)
    if not downloaded:
        # Check files already in folder
        downloaded = [str(f) for f in out_path.glob("*.*") if f.suffix.lower() in [".jpg", ".png", ".jpeg", ".webp"]]
    return sorted(downloaded)


def run_ocr_on_images(image_files, engine="paddle", lang="ch", ocr_server_url="http://127.0.0.1:8080"):
    """Runs OCR on the list of downloaded images."""
    from app.services.ocr_service import scan_with_ocr_server, scan_with_easyocr, scan_with_google
    import numpy as np
    from PIL import Image

    results = {}
    detect_model = str(PROJECT_ROOT / "models" / "best.pt")
    if not os.path.exists(detect_model):
        detect_model = None

    print(f"[Info] Running OCR with engine='{engine}', lang='{lang}', custom_text_model={detect_model}")

    for idx, img_path in enumerate(image_files):
        p = Path(img_path)
        if p.suffix.lower() not in [".jpg", ".jpeg", ".png", ".webp"]:
            continue

        print(f"[{idx+1}/{len(image_files)}] Processing {p.name}...")
        t0 = time.time()
        try:
            with open(img_path, "rb") as f:
                content = f.read()

            if engine == "paddle":
                res = scan_with_ocr_server(
                    image_content=content,
                    langs_list=[lang],
                    server_url=ocr_server_url,
                    detect_model_path=detect_model,
                )
            elif engine == "easyocr":
                with Image.open(img_path) as pil_img:
                    np_img = np.array(pil_img.convert("RGB"))
                res = scan_with_easyocr(np_img, [lang])
            elif engine == "google":
                res = scan_with_google(content)
            else:
                res = {"error": f"Unknown engine: {engine}"}

            duration = time.time() - t0
            lines = res.get("lines", [])
            print(f"  -> Done in {duration:.2f}s | {len(lines)} lines found")
            results[p.name] = {
                "file": p.name,
                "lines_count": len(lines),
                "duration_seconds": round(duration, 2),
                "lines": lines,
                "bubbles": res.get("bubbles", []),
            }
        except Exception as e:
            print(f"  -> [Error] Failed to process {p.name}: {e}")
            results[p.name] = {"file": p.name, "error": str(e)}

    return results


def image_to_data_url(image_path: Path):
    """Reads image file and returns (dataUrl, width, height)."""
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


def build_mtp_package(image_files, ocr_results, output_mtp_path):
    """
    Constructs a valid MangaToolPlus (.mtp) project package from processed images and OCR results.
    """
    print(f"\n[Info] Packaging {len(image_files)} pages into .mtp format: {Path(output_mtp_path).name}...")
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
        bubbles = res.get("bubbles", [])

        # 1. Base64 & metadata
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

        # 3. tsData (Typesetter editable layers)
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
                "box": b.get("box"),
                "polygon": b.get("polygon"),
                "confidence": b.get("confidence", 0.9)
            }
            for b in bubbles
        ]

    out_file = Path(output_mtp_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as fp:
        json.dump(project_data, fp, ensure_ascii=False)

    size_mb = out_file.stat().st_size / (1024 * 1024)
    print(f"[Success] Successfully exported .mtp project: {out_file} ({size_mb:.2f} MB)")
    return out_file


def main():
    parser = argparse.ArgumentParser(description="Manga Google Drive OCR Pipeline")
    parser.add_argument("--folder-id", default="1dkgOWrSqT6QoVoF4r2S6BieA8ratVpqj", help="Google Drive folder ID or URL")
    parser.add_argument("--output-dir", default="./downloaded_manga", help="Local directory to store downloaded images")
    parser.add_argument("--engine", default="paddle", choices=["paddle", "easyocr", "google"], help="OCR Engine")
    parser.add_argument("--lang", default="ch", help="OCR Language code (ch, japan, korean, en)")
    parser.add_argument("--subfolder-name", default="เทส", help="Subfolder name to create in Google Drive")
    parser.add_argument("--mtp-name", default="chapter.mtp", help="Output .mtp project filename")
    parser.add_argument("--service-account", default=None, help="Path to Google Service Account JSON file")
    parser.add_argument("--ocr-server-url", default="http://127.0.0.1:8080", help="PaddleOCR server endpoint")
    args = parser.parse_args()

    # 1. Download images
    images = download_images(args.folder_id, args.output_dir)
    print(f"[Info] Total images downloaded: {len(images)}")
    if not images:
        print("[Error] No images found to process.")
        return

    # 2. Run OCR
    ocr_results = run_ocr_on_images(images, engine=args.engine, lang=args.lang, ocr_server_url=args.ocr_server_url)

    # 3. Save local results
    out_dir = Path("./ocr_output")
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "ocr_results.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(ocr_results, f, ensure_ascii=False, indent=2)

    summary_path = out_dir / "summary.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"Manga OCR Summary - {args.folder_id}\n")
        f.write(f"Total Pages: {len(ocr_results)}\n")
        f.write("=" * 50 + "\n\n")
        for name, data in ocr_results.items():
            f.write(f"--- Page: {name} ({data.get('lines_count', 0)} lines) ---\n")
            for line in data.get("lines", []):
                f.write(f"{line.get('text', '')}\n")
            f.write("\n")

    print(f"[Info] Local OCR results saved to {json_path} and {summary_path}")

    # 4. Build .mtp project file
    mtp_filename = args.mtp_name if args.mtp_name.lower().endswith(".mtp") else f"{args.mtp_name}.mtp"
    mtp_path = out_dir / mtp_filename
    build_mtp_package(images, ocr_results, mtp_path)

    # 5. Connect to Google Drive & Create Folder "เทส"
    clean_folder_id = args.folder_id.split("/")[-1].split("?")[0]
    drive = get_drive_service(args.service_account)
    if drive:
        target_gd_folder_id = create_gdrive_folder(drive, clean_folder_id, folder_name=args.subfolder_name)
        if target_gd_folder_id:
            upload_file_to_gdrive(drive, target_gd_folder_id, json_path)
            upload_file_to_gdrive(drive, target_gd_folder_id, summary_path)
            upload_file_to_gdrive(drive, target_gd_folder_id, mtp_path)
            print(f"[Complete] Finished OCR, exported {mtp_filename}, and uploaded to Google Drive folder '{args.subfolder_name}'!")
    else:
        print("\n[Notice] เพื่อให้ GitHub Actions สามารถสร้างโฟลเดอร์ 'เทส' และอัปโหลดผลลัพธ์กลับขึ้น Google Drive ได้:")
        print("  1. ต้องมี Service Account จาก Google Cloud Console")
        print(f"  2. กด 'แชร์' (Share) โฟลเดอร์ Google Drive นี้ ({clean_folder_id}) ให้กับ Email ของ Service Account โดยตั้งสิทธิ์เป็น 'Editor'")
        print("  3. นำเนื้อหาไฟล์ Service Account JSON ไปใส่ใน GitHub Secrets ชื่อ: GDRIVE_SERVICE_ACCOUNT_KEY")


if __name__ == "__main__":
    main()

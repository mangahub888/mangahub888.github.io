#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tencent Comic (ac.qq.com) Frida Plaintext GZIP & JSON Extractor (Plan A)
------------------------------------------------------------------------
Hooks javax.crypto.Cipher in com.qq.ac.android to capture decrypted API
responses (GZIP -> JSON), and okhttp3 HTTP/2 headers to capture real-time
CDN image requests (cdn manhua.acimg.cn).

Usage:
    python tools/frida_plaintext_dump.py --no-spawn
    python tools/frida_plaintext_dump.py --once --test-dl
    python tools/frida_plaintext_dump.py --timeout 60
"""

import argparse
import gzip
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# Force UTF-8 on Windows terminal
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

APP_ID = "com.qq.ac.android"
REMOTE_BIN = "/data/local/tmp/fsd"
REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = Path(__file__).resolve().parent / "frida_plaintext_dump.js"
DEFAULT_OUT_DIR = REPO_ROOT / "scratch" / "plaintext_dumps"

ADB_CANDIDATES = [
    r"C:\LDPlayer\LDPlayer9\adb.exe",
    r"C:\LDPlayer\LDPlayer5\adb.exe",
    r"C:\LDPlayer\LDPlayer4\adb.exe",
    "adb",
]


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [PlanA] {msg}", flush=True)


def find_adb(explicit: str = None) -> str:
    if explicit:
        return explicit
    for cand in ADB_CANDIDATES:
        if cand == "adb":
            try:
                subprocess.run([cand, "version"], capture_output=True, timeout=10, check=False)
                return cand
            except Exception:
                continue
        if Path(cand).exists():
            return cand
    return "adb"


def adb(adb_path: str, serial: str, *args, check: bool = False, timeout: int = 60) -> str:
    cmd = [adb_path] + (["-s", serial] if serial else []) + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {res.stderr.strip() or res.stdout.strip()}")
    return res.stdout.strip()


def pick_serial(adb_path: str) -> str:
    out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=30).stdout
    serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
    if serials:
        log(f"Auto-selected ADB device: {serials[0]} ({len(serials)} device(s) online)")
        return serials[0]
    return ""


def ensure_server(adb_path: str, serial: str, server_path: str, port: int):
    ps = adb(adb_path, serial, "shell", "ps -A 2>/dev/null | grep fsd")
    if "fsd" in ps:
        log("Existing frida-server (fsd) already running on device")
        adb(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
        return

    out = adb(adb_path, serial, "shell", f"ls {REMOTE_BIN} 2>/dev/null")
    if not out:
        local_server = Path(server_path)
        if not local_server.exists():
            cand_server16 = REPO_ROOT / "tools" / "frida-server16"
            if cand_server16.exists():
                local_server = cand_server16
        if not local_server.exists():
            log(f"ERROR: Local frida-server not found at {server_path}")
            sys.exit(2)
        log(f"Pushing frida-server -> {REMOTE_BIN}")
        adb(adb_path, serial, "push", str(local_server), REMOTE_BIN, check=True, timeout=300)

    adb(adb_path, serial, "shell", f"chmod 755 {REMOTE_BIN}")
    adb(adb_path, serial, "shell", "pkill -f fsd 2>/dev/null; true")
    time.sleep(0.5)

    start_cmd = f"nohup {REMOTE_BIN} -l 127.0.0.1:{port} >/dev/null 2>&1 &"
    adb(adb_path, serial, "shell", f'su -c "{start_cmd}" 2>&1')
    time.sleep(1.5)

    ps_verify = adb(adb_path, serial, "shell", "ps -A 2>/dev/null | grep fsd")
    if "fsd" not in ps_verify:
        log("ERROR: frida-server failed to launch under su.")
        sys.exit(3)

    adb(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
    log(f"Frida server active & forwarded on 127.0.0.1:{port}")


def clean_image_url(url: str) -> str:
    """Converts AVIF CDN URL to standard High-Definition JPEG URL for seamless PIL processing."""
    clean = url.replace(r"\/", "/")
    # Remove ?tp=avif or convert tp to standard jpeg format
    clean = re.sub(r"\?tp=avif.*$", "", clean)
    return clean


def extract_image_urls(obj) -> list:
    """Recursively extracts comic image URLs (manhua.acimg.cn) from JSON structure."""
    urls = []

    def _walk(item):
        if isinstance(item, dict):
            if "picture" in item and isinstance(item["picture"], list):
                for pic in item["picture"]:
                    if isinstance(pic, dict) and "url" in pic:
                        u = clean_image_url(pic["url"])
                        if u and u not in urls:
                            urls.append(u)
                    elif isinstance(pic, str):
                        u = clean_image_url(pic)
                        if u not in urls:
                            urls.append(u)
            for k, v in item.items():
                _walk(v)
        elif isinstance(item, list):
            for elem in item:
                _walk(elem)
        elif isinstance(item, str):
            clean = clean_image_url(item)
            if "manhua.acimg.cn" in clean and clean.startswith("http"):
                if clean not in urls:
                    urls.append(clean)

    _walk(obj)
    return urls


def download_image_bytes(url: str, retries: int = 3) -> bytes:
    clean_u = clean_image_url(url)
    req = urllib.request.Request(
        clean_u,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://ac.qq.com/"
        }
    )
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                if len(data) > 0:
                    return data
        except Exception:
            time.sleep(0.5 * attempt)
    return None


def call_gas(action: str, payload: dict = None, retries: int = 3) -> dict:
    import base64
    gas_url = os.environ.get("GAS_URL", "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec")
    passcode = os.environ.get("PASSCODE", "10211032")
    body = {
        "passcode": passcode,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(gas_url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                return {"status": "error", "message": str(e)}
            time.sleep(2 * attempt)


def stitch_and_upload_chapter(urls: list, manga_name: str, chapter_title: str, manga_id: str = ""):
    """
    Continuous Vertical Slicing into standard 20 pages and uploading to Google Drive via GAS.
    Enforces project rules:
      - Work Link: [อัป Raw] https://drive.google.com/drive/folders/...
      - Upload Status: เสร็จแล้ว
      - Uploader Name: Apt
    """
    import base64
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from PIL import Image

    total_images = len(urls)
    log(f"✂️ Stitching & Uploading: {manga_name} | {chapter_title} ({total_images} raw pieces)...")

    # 1. Download slices concurrently
    downloaded_slices = [None] * total_images
    def _dl(item):
        idx, u = item
        return idx, download_image_bytes(u)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_dl, (i, urls[i])) for i in range(total_images)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_slices[i_idx] = i_bytes

    success_count = sum(1 for b in downloaded_slices if b is not None)
    log(f"   Downloaded {success_count}/{total_images} pieces successfully.")
    if success_count == 0:
        log("❌ No slices downloaded. Aborting stitch.")
        return False

    # 2. Determine standard width
    sample_idx = 14 if total_images >= 15 else total_images // 2
    sample_bytes = downloaded_slices[sample_idx] or downloaded_slices[0]
    sample_img = Image.open(io.BytesIO(sample_bytes))
    standard_width = sample_img.width
    log(f"   Standard width calibrated to: {standard_width}px")

    # 3. Stitch into 20 parts
    target_pages = min(20, total_images)
    pages_payloads = [None] * target_pages
    for part_idx in range(target_pages):
        part_num = part_idx + 1
        start_idx = round(part_idx * total_images / target_pages)
        end_idx = round((part_idx + 1) * total_images / target_pages)
        slice_bytes_list = downloaded_slices[start_idx:end_idx]

        processed_images = []
        total_height = 0
        for b in slice_bytes_list:
            if not b: continue
            try:
                pil_img = Image.open(io.BytesIO(b)).convert("RGB")
                if pil_img.width != standard_width:
                    scale = standard_width / pil_img.width
                    scaled_h = round(pil_img.height * scale)
                    pil_img = pil_img.resize((standard_width, scaled_h), Image.Resampling.LANCZOS)
                processed_images.append(pil_img)
                total_height += pil_img.height
            except Exception:
                pass

        if not processed_images:
            continue

        strip_canvas = Image.new("RGB", (standard_width, total_height), color=(255, 255, 255))
        curr_y = 0
        for p_img in processed_images:
            strip_canvas.paste(p_img, (0, curr_y))
            curr_y += p_img.height

        img_buf = io.BytesIO()
        strip_canvas.save(img_buf, format="JPEG", quality=90, optimize=True)
        b64_str = base64.b64encode(img_buf.getvalue()).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_str}"

        pages_payloads[part_idx] = {
            "mangaName": manga_name,
            "chapter": chapter_title,
            "partIndex": part_num,
            "totalParts": target_pages,
            "fileName": f"{part_num:03d}.jpg",
            "mimeType": "image/jpeg",
            "base64Data": data_url,
            "isLastPart": False,
            "clearFolder": False,
            "mangaId": manga_id,
            "skipQueue": True,
            "isTest": False,
            "uploadername": "Apt",
            "uploadstatus": "เสร็จแล้ว"
        }

    # 4. Upload to Drive
    log(f"   Uploading {target_pages} stitched parts to Google Drive...")
    # First part
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = (target_pages == 1)
    p1["skipQueue"] = (target_pages > 1)
    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        log(f"❌ Failed uploading part 1: {res_p1.get('message')}")
        return False

    folder_url = res_p1.get("data", {}).get("folderUrl") or ""

    # Middle parts
    for idx in range(1, target_pages - 1):
        pm = pages_payloads[idx]
        pm["folderUrl"] = folder_url
        res_m = call_gas("UPLOAD_CHAPTER_STITCHED_PART", pm)
        if res_m.get("status") != "success":
            log(f"⚠️ Part {idx+1} warning: {res_m.get('message')}")

    # Last part
    if target_pages > 1:
        p_last = pages_payloads[-1]
        p_last["folderUrl"] = folder_url
        p_last["isLastPart"] = True
        p_last["skipQueue"] = False
        res_last = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p_last)
        if res_last.get("status") != "success":
            log(f"⚠️ Last part warning: {res_last.get('message')}")

    log(f"✅ Upload Complete!")
    log(f"   🔗 Work Link: [อัป Raw] {folder_url}")
    log(f"   Uploader: Apt | Status: เสร็จแล้ว")
    return True


class PlaintextExtractor:
    def __init__(self, out_dir: Path, once: bool = False, test_dl: bool = False):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.once = once
        self.test_dl = test_dl
        self.captured_count = 0
        self.finished = False

        self.last_api_endpoint = ""
        self.last_comic_id = ""
        self.last_chapter_id = ""

        # Stream buffer for images
        self.stream_images = []
        self.lock = threading.Lock()
        self.last_image_ts = 0

    def save_chapter_images(self, urls: list, source_label: str, raw_json: dict = None):
        if not urls:
            return

        self.captured_count += 1
        ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")

        prefix = "chapter"
        if self.last_comic_id and self.last_chapter_id:
            prefix = f"chapter_{self.last_comic_id}_{self.last_chapter_id}"

        url_file = self.out_dir / f"{prefix}_{ts_str}_urls.txt"
        with open(url_file, "w", encoding="utf-8") as f:
            for u in urls:
                f.write(u + "\n")

        log(f"🎉 [{source_label}] CAPTURED CHAPTER: {len(urls)} pages!")
        log(f"   💾 Saved URLs ({len(urls)} items) -> {url_file}")

        if raw_json is not None:
            json_file = self.out_dir / f"{prefix}_{ts_str}.json"
            with open(json_file, "w", encoding="utf-8") as f:
                json.dump(raw_json, f, ensure_ascii=False, indent=2)
            log(f"   💾 Saved JSON -> {json_file}")

        # Preview first 3 pages
        for i, u in enumerate(urls[:3]):
            log(f"   Page {i+1:02d}: {u}")
        if len(urls) > 3:
            log(f"   ... ({len(urls)-3} more pages)")

        # Test download verification
        if self.test_dl and len(urls) > 0:
            log(f"   🧪 Verifying download of page 1...")
            test_download_image(urls[0])

        if self.once:
            log("🎯 Reached target chapter capture (--once). Exiting...")
            self.finished = True

    def flush_stream_if_settled(self):
        with self.lock:
            now = time.time()
            if self.stream_images and (now - self.last_image_ts > 3.0):
                urls = list(self.stream_images)
                self.stream_images.clear()
                self.save_chapter_images(urls, source_label="HTTP/2 Wire")

    def handle_message(self, message: dict, data: bytes):
        if message.get("type") != "send":
            return

        payload = message.get("payload", {})
        kind = payload.get("kind")

        if kind == "h2_path":
            method = payload.get("method", "GET")
            path = payload.get("path", "")
            auth = payload.get("authority", "")
            self.last_api_endpoint = path
            m = re.search(r"comic_id/(\d+)(?:/.*?chapter_id/(\d+))?", path)
            if m:
                if m.group(1): self.last_comic_id = m.group(1)
                if m.group(2): self.last_chapter_id = m.group(2)
            log(f"[API Route] {method} https://{auth}{path}")

        elif kind == "image_url":
            raw_url = payload.get("url")
            if raw_url:
                url = clean_image_url(raw_url)
                with self.lock:
                    if url not in self.stream_images:
                        self.stream_images.append(url)
                        self.last_image_ts = time.time()
                        log(f"[IMG #{len(self.stream_images)}] {url}")

        elif kind == "plain_gzip":
            direction = payload.get("dir", "out")
            endpoint = payload.get("endpoint") or self.last_api_endpoint

            raw_gzip = None
            if data is not None and len(data) > 0:
                raw_gzip = bytes(data)
            elif "head" in payload and len(payload["head"]) > 0:
                raw_gzip = bytes.fromhex(payload["head"])

            if not raw_gzip or not raw_gzip.startswith(b"\x1f\x8b"):
                return

            try:
                decompressed = gzip.decompress(raw_gzip)
            except Exception as e:
                return

            try:
                text = decompressed.decode("utf-8")
                parsed_json = json.loads(text)
            except Exception:
                return

            urls = extract_image_urls(parsed_json)
            if urls:
                self.save_chapter_images(urls, source_label="Cipher GZIP Decrypt", raw_json=parsed_json)
            else:
                log(f"💎 Decompressed JSON ({direction})! Size: {len(decompressed):,} bytes, Endpoint: {endpoint}")

        elif kind == "info":
            log(f"[Frida] {payload.get('msg')}")

        elif kind == "error":
            log(f"[Frida ERR] {payload.get('where')}: {payload.get('error')}")


def main():
    parser = argparse.ArgumentParser(description="Tencent Comic Plaintext Dump (Plan A)")
    parser.add_argument("--adb", default=None, help="Path to adb.exe")
    parser.add_argument("--serial", default="", help="ADB device serial (e.g. emulator-5554)")
    parser.add_argument("--connect", default="", help="ADB connect address (e.g. 127.0.0.1:5555)")
    parser.add_argument("--app", default=APP_ID, help="Target application package")
    parser.add_argument("--server", default=str(REPO_ROOT / "tools" / "frida-server16"))
    parser.add_argument("--port", type=int, default=27042, help="Frida server port")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output directory for JSON/URLs")
    parser.add_argument("--no-spawn", action="store_true", default=True, help="Attach to running process")
    parser.add_argument("--spawn", action="store_true", help="Force spawn instead of attach")
    parser.add_argument("--timeout", type=float, default=0, help="Stop after N seconds (0 = forever)")
    parser.add_argument("--once", action="store_true", help="Stop immediately after capturing 1 chapter")
    parser.add_argument("--test-dl", action="store_true", default=True, help="Verify downloading first image")
    parser.add_argument("--stitch", default="", help="Path to .txt file containing image URLs to stitch and upload")
    parser.add_argument("--manga-name", default="Tencent Manga", help="Manga name for stitch and upload")
    parser.add_argument("--chapter", default="Chapter", help="Chapter name for stitch and upload")
    args = parser.parse_args()

    # Mode: Direct stitch & upload from existing file
    if args.stitch:
        stitch_file = Path(args.stitch)
        if not stitch_file.exists():
            log(f"ERROR: Stitch file not found: {stitch_file}")
            sys.exit(1)
        urls = [line.strip() for line in stitch_file.read_text(encoding="utf-8").splitlines() if line.strip()]
        log(f"Loaded {len(urls)} URLs from {stitch_file}")
        stitch_and_upload_chapter(urls, manga_name=args.manga_name, chapter_title=args.chapter)
        return

    try:
        import frida
    except ImportError:
        log("ERROR: frida not installed. Run: pip install frida==16.7.19")
        sys.exit(1)

    adb_path = find_adb(args.adb)
    log(f"Using ADB: {adb_path}")

    if args.connect:
        subprocess.run([adb_path, "connect", args.connect], capture_output=True, text=True)

    serial = args.serial or pick_serial(adb_path)
    if not serial:
        log("ERROR: No ADB device found. Ensure LDPlayer is running.")
        sys.exit(1)

    ensure_server(adb_path, serial, args.server, args.port)

    device_manager = frida.get_device_manager()
    device = device_manager.add_remote_device(f"127.0.0.1:{args.port}")
    log(f"Connected to Frida {frida.__version__} via remote 127.0.0.1:{args.port}")

    pid_str = adb(adb_path, serial, "shell", f"pidof {args.app}").strip()
    if not pid_str:
        log(f"App {args.app} is not running. Launching SplashActivity...")
        adb(adb_path, serial, "shell", f"am start -n {args.app}/.splash.SplashActivity")
        time.sleep(3.0)
        pid_str = adb(adb_path, serial, "shell", f"pidof {args.app}").strip()

    pid = int(pid_str.split()[0]) if (pid_str and pid_str.split()[0].isdigit()) else None

    if args.spawn and not args.no_spawn:
        log(f"Spawning {args.app}...")
        pid = device.spawn([args.app])
        session = device.attach(pid)
    else:
        if pid:
            log(f"Attaching to running process {args.app} (pid={pid})...")
            session = device.attach(pid)
        else:
            log(f"Attaching by package name {args.app}...")
            session = device.attach(args.app)

    script_code = SCRIPT_PATH.read_text(encoding="utf-8")
    script = session.create_script(script_code)

    extractor = PlaintextExtractor(
        out_dir=Path(args.out_dir),
        once=args.once,
        test_dl=args.test_dl
    )

    script.on("message", extractor.handle_message)
    script.load()
    log("Instrumentation script loaded successfully!")

    if args.spawn and not args.no_spawn and pid:
        device.resume(pid)
        log("App resumed.")

    log("Listening for decrypted chapter payloads & images... (Open or swipe chapters in Tencent Comic)")
    deadline = time.time() + args.timeout if args.timeout > 0 else None

    try:
        while not extractor.finished:
            extractor.flush_stream_if_settled()
            if deadline and time.time() > deadline:
                log(f"Timeout reached ({args.timeout}s). Stopping...")
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("User interrupted (Ctrl+C). Stopping...")
    finally:
        # Flush any remaining images before exit
        extractor.flush_stream_if_settled()
        try:
            script.unload()
        except Exception:
            pass
        log(f"Done. Captured {extractor.captured_count} chapter(s). Files saved to {args.out_dir}")


if __name__ == "__main__":
    main()

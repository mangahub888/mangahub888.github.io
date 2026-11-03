#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tencent Comic (ac.qq.com) 1-Click LDPlayer Automation Pipeline
==============================================================
Fully automated end-to-end pipeline:
  1. Controls / hides LDPlayer (supports 127.0.0.1:5555 / emulator-5554 / ldconsole.exe).
  2. Ensures Frida server is running and attaches to com.qq.ac.android.
  3. Uses In-Process Intent navigation to jump into ComicReaderActivity using ComicIdentity.
  4. Hooks javax.crypto.Cipher in real-time to decompress GZIP -> JSON and extract image CDN URLs,
     with OkHttp2 header wire capture as fallback.
  5. Concurrently downloads slices (10 Workers) with Referer: https://ac.qq.com/.
  6. Stitches slices on Continuous Virtual Canvas and divides into exactly 20 standard pages (001.jpg - 020.jpg).
  7. Uploads to Google Drive folder "แปลจนเมื่อย / {manga_name} / {chapter}" via GAS.
  8. Registers / updates GAS WorkQueue:
       - worklink: [อัป Raw] https://drive.google.com/drive/folders/...
       - uploadstatus: เสร็จแล้ว
       - uploadername: Apt
"""

import argparse
import base64
import ctypes
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
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from PIL import Image

# Force UTF-8 on Windows terminal
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ID = "com.qq.ac.android"
REMOTE_BIN = "/data/local/tmp/fsd"
DEFAULT_FRIDA_PORT = 27042
GAS_URL = os.environ.get(
    "GAS_URL",
    "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"
)
GAS_PASSCODE = os.environ.get("PASSCODE", "10211032")

ADB_CANDIDATES = [
    r"C:\LDPlayer\LDPlayer9\adb.exe",
    r"C:\LDPlayer\LDPlayer5\adb.exe",
    r"C:\LDPlayer\LDPlayer4\adb.exe",
    "adb",
]


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [TencentPipeline] {msg}", flush=True)


def find_tool(candidates: list, fallback: str) -> str:
    for cand in candidates:
        if cand == "adb":
            try:
                subprocess.run([cand, "version"], capture_output=True, timeout=5, check=False)
                return cand
            except Exception:
                continue
        if Path(cand).exists():
            return cand
    return fallback


def adb_command(adb_path: str, serial: str, *args, check: bool = False, timeout: int = 30) -> str:
    cmd = [adb_path] + (["-s", serial] if serial else []) + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {res.stderr.strip() or res.stdout.strip()}")
    return res.stdout.strip()


def pick_adb_device(adb_path: str) -> str:
    out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=10).stdout
    serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
    if serials:
        return serials[0]
    subprocess.run([adb_path, "connect", "127.0.0.1:5555"], capture_output=True, text=True, timeout=10)
    out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=10).stdout
    serials = [line.split("\t")[0].strip() for line in out.splitlines()[1:] if "\tdevice" in line]
    return serials[0] if serials else ""


def hide_ldplayer_window():
    """Hides or minimizes LDPlayer emulator window on Windows."""
    try:
        user32 = ctypes.windll.user32
        def enum_cb(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value.lower()
                    if "ldplayer" in title or "dnplayer" in title:
                        user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
            return True
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(CB(enum_cb), 0)
        log("LDPlayer window minimized/hidden.")
    except Exception as e:
        log(f"Window control notice: {e}")


def ensure_frida_server(adb_path: str, serial: str, port: int):
    ps = adb_command(adb_path, serial, "shell", "ps -A 2>/dev/null | grep fsd")
    if "fsd" in ps:
        adb_command(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
        return

    out = adb_command(adb_path, serial, "shell", f"ls {REMOTE_BIN} 2>/dev/null")
    if not out:
        cand_server = REPO_ROOT / "tools" / "frida-server16"
        if not cand_server.exists():
            log(f"ERROR: Local frida-server not found at {cand_server}")
            sys.exit(1)
        log(f"Pushing frida-server -> {REMOTE_BIN}")
        adb_command(adb_path, serial, "push", str(cand_server), REMOTE_BIN, check=True, timeout=300)

    adb_command(adb_path, serial, "shell", f"chmod 755 {REMOTE_BIN}")
    adb_command(adb_path, serial, "shell", "pkill -f fsd 2>/dev/null; true")
    time.sleep(0.5)

    start_cmd = f"nohup {REMOTE_BIN} -l 127.0.0.1:{port} >/dev/null 2>&1 &"
    adb_command(adb_path, serial, "shell", f'su -c "{start_cmd}" 2>&1')
    time.sleep(1.5)

    adb_command(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
    log(f"Frida server active & port forwarded: 127.0.0.1:{port}")


def clean_image_url(url: str) -> str:
    clean = url.replace(r"\/", "/")
    clean = re.sub(r"\?tp=avif.*$", "", clean)
    clean = re.sub(r"\?tp=.*$", "", clean)
    return clean


def extract_image_urls(obj) -> list:
    urls = []
    def _walk(item):
        if isinstance(item, dict):
            if "picture" in item and isinstance(item["picture"], list):
                for pic in item["picture"]:
                    if isinstance(pic, dict) and "url" in pic:
                        u = clean_image_url(pic["url"])
                        if u and u not in urls: urls.append(u)
                    elif isinstance(pic, str):
                        u = clean_image_url(pic)
                        if u and u not in urls: urls.append(u)
            for v in item.values():
                _walk(v)
        elif isinstance(item, list):
            for elem in item:
                _walk(elem)
        elif isinstance(item, str):
            clean = clean_image_url(item)
            if "manhua.acimg.cn" in clean and clean.startswith("http"):
                if clean not in urls: urls.append(clean)
    _walk(obj)
    return urls


def download_slice_bytes(url: str, retries: int = 3) -> bytes:
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
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = resp.read()
                if len(data) > 0:
                    return data
        except Exception:
            time.sleep(0.5 * attempt)
    return None


def call_gas(action: str, payload: dict = None, retries: int = 3) -> dict:
    body = {
        "passcode": GAS_PASSCODE,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries:
                return {"status": "error", "message": str(e)}
            time.sleep(2 * attempt)


def query_pending_gas_queue() -> list:
    res = call_gas("GET_WORK_QUEUE")
    items = res.get("data", [])
    pending = []
    for item in items:
        status = item.get("uploadstatus", "")
        link = item.get("worklink", "")
        if status != "เสร็จแล้ว" or not link or not link.startswith("[อัป Raw]"):
            raw_url = item.get("rawurl", "") or item.get("originalurl", "") or ""
            if "ac.qq" in raw_url or "qq.com" in raw_url:
                pending.append(item)
    return pending


def get_comic_title_from_web(comic_id: str) -> str:
    url = f"https://ac.qq.com/Comic/comicInfo/id/{comic_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
        m = re.search(r"<title>《([^》]+)》", html)
        if m:
            return m.group(1).strip()
        m2 = re.search(r"<title>(.*?)</title>", html)
        if m2:
            return m2.group(1).split("_")[0].strip()
    except Exception:
        pass
    return f"Tencent_{comic_id}"


# --------------------------------------------------------------------------
# COMPLETE FRIDA INSTRUMENTATION SCRIPT (CIPHER + HTTP/2 + IN-PROCESS INTENT)
# --------------------------------------------------------------------------
FRIDA_JS_INSTRUMENTATION = """
'use strict';

var MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
var DEDUPE_HISTORY_SIZE = 256;
var seenHashes = [];
var lastEndpoints = [];

function emit(kind, obj, buf) {
  var msg = { kind: kind, ts: Date.now() };
  if (obj) {
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        msg[k] = obj[k];
      }
    }
  }
  try {
    if (buf) {
      send(msg, buf);
    } else {
      send(msg);
    }
  } catch (e) {}
}

function toJSByteArray(jbytes) {
  if (!jbytes) return null;
  try {
    return Java.array('byte', jbytes);
  } catch (e) {
    if (jbytes.length !== undefined) return jbytes;
    return null;
  }
}

function hexSnippet(arr, max) {
  if (!arr) return '';
  var n = Math.min(arr.length, max || 32);
  var out = '';
  for (var i = 0; i < n; i++) {
    var b = (arr[i] + 256) % 256;
    out += ('0' + b.toString(16)).slice(-2);
  }
  return out;
}

function isGzip(arr) {
  if (!arr || arr.length < 2) return false;
  return ((arr[0] & 0xff) === 0x1f) && ((arr[1] & 0xff) === 0x8b);
}

function toArrayBuffer(arr) {
  var buf = new ArrayBuffer(arr.length);
  var u8 = new Uint8Array(buf);
  for (var i = 0; i < arr.length; i++) {
    u8[i] = arr[i] & 0xff;
  }
  return buf;
}

function simpleHash(arr) {
  var h = 0x811c9dc5;
  var step = Math.max(1, Math.floor(arr.length / 64));
  for (var i = 0; i < arr.length; i += step) {
    h ^= (arr[i] & 0xff);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + '_' + arr.length;
}

function recordEndpoint(authority, path) {
  if (!path) return;
  lastEndpoints.push({
    ts: Date.now(),
    authority: authority || '',
    path: path
  });
  while (lastEndpoints.length > 30) {
    lastEndpoints.shift();
  }
}

function getRecentEndpoint() {
  var now = Date.now();
  for (var i = lastEndpoints.length - 1; i >= 0; i--) {
    var ep = lastEndpoints[i];
    if (now - ep.ts < 20000) {
      return ep;
    }
  }
  return null;
}

rpc.exports = {
    navtochapter: function(comicId, chapterId, seqNo) {
        Java.perform(function() {
            var Intent = Java.use('android.content.Intent');
            var ComponentName = Java.use('android.content.ComponentName');
            var ComicIdentity = Java.use('com.qq.ac.android.reader.comic.data.ComicIdentity');
            var UUID = Java.use('java.util.UUID');
            var BooleanClass = Java.use('java.lang.Boolean');
            var ActivityThread = Java.use('android.app.ActivityThread');
            var app = ActivityThread.currentApplication();
            var ctx = app.getApplicationContext();

            var intent = Intent.$new();
            intent.setComponent(ComponentName.$new('com.qq.ac.android', 'com.qq.ac.android.reader.comic.ComicReaderActivity'));
            intent.putExtra('STR_MSG_COMIC_ID', String(comicId));
            intent.putExtra('STR_MSG_CHAPTER_ID', String(chapterId));
            if (seqNo) {
                intent.putExtra('STR_MSG_CHAPTER_SEQ_NO', String(seqNo));
            }
            intent.putExtra('STR_MSG_FROM_ID', 'auto');
            intent.putExtra('FORBID_NO_LIMIT', BooleanClass.$new(true));
            intent.putExtra('STR_MSG_COMIC_IDENTITY', ComicIdentity.$new(String(comicId), UUID.randomUUID()));
            intent.setFlags(0x10000000 | 0x20000000);

            ctx.startActivity(intent);
            emit('in_process_nav', { status: 'dispatched', comicId: comicId, chapterId: chapterId, seqNo: seqNo });
        });
    }
};

Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');
  var lastKeyHex = '';
  var lastIvHex = '';

  function inspectKeyIv(arg) {
    if (!arg) return;
    try {
      var enc = arg.getEncoded();
      if (enc !== null) {
        lastKeyHex = hexSnippet(toJSByteArray(enc), 32);
        return;
      }
    } catch (e) {}
    try {
      var iv = arg.getIV();
      if (iv !== null) {
        lastIvHex = hexSnippet(toJSByteArray(iv), 32);
      }
    } catch (e) {}
  }

  Cipher.init.overloads.forEach(function (ov) {
    ov.implementation = function () {
      try {
        for (var i = 0; i < arguments.length; i++) {
          inspectKeyIv(arguments[i]);
        }
      } catch (e) {}
      return ov.call(this, ...arguments);
    };
  });

  function processBuffer(direction, rawJBytes, cipherObj) {
    if (!rawJBytes) return;
    var arr = toJSByteArray(rawJBytes);
    if (!arr || arr.length < 2) return;
    if (!isGzip(arr)) return;
    if (arr.length > MAX_PAYLOAD_BYTES) return;

    var h = simpleHash(arr);
    if (seenHashes.indexOf(h) >= 0) return;
    seenHashes.push(h);
    while (seenHashes.length > DEDUPE_HISTORY_SIZE) {
      seenHashes.shift();
    }

    var ep = getRecentEndpoint();
    var buf = toArrayBuffer(arr);
    var algo = '';
    try { algo = String(cipherObj.getAlgorithm()); } catch (e) {}

    emit('plain_gzip', {
      dir: direction,
      len: arr.length,
      algo: algo,
      key: lastKeyHex,
      iv: lastIvHex,
      head: hexSnippet(arr, 32),
      endpoint: ep ? ep.path : null,
      authority: ep ? ep.authority : null
    }, buf);
  }

  Cipher.doFinal.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  Cipher.update.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  // OkHttp2 HTTP/2 scan
  var scannedClasses = {};
  var scanPasses = 0;

  function scanHttp2() {
    scanPasses++;
    Java.enumerateLoadedClassesSync().forEach(function (cn) {
      if (cn.indexOf('okhttp3.internal.http2.') !== 0) return;
      if (scannedClasses[cn]) return;
      scannedClasses[cn] = true;

      var C;
      try { C = Java.use(cn); } catch (e) { return; }
      var methods;
      try { methods = C.class.getDeclaredMethods(); } catch (e) { return; }

      for (var i = 0; i < methods.length; i++) {
        var mName = methods[i].getName();
        if (/toString|hashCode|equals/.test(mName)) continue;
        var holder = C[mName];
        if (!holder || !holder.overloads) continue;

        holder.overloads.forEach(function (ov) {
          var types = ov.argumentTypes.map(function (t) { return t.className; });
          if (types.indexOf('java.util.List') < 0) return;

          ov.implementation = function () {
            for (var a = 0; a < arguments.length; a++) {
              if (types[a] === 'java.util.List' && arguments[a] !== null) {
                try {
                  var list = arguments[a];
                  var sz = list.size();
                  var path = null;
                  var auth = null;
                  var method = 'GET';
                  for (var k = 0; k < sz; k++) {
                    var s = String(list.get(k));
                    if (s.indexOf(':path: ') === 0) path = s.slice(7);
                    else if (s.indexOf(':authority: ') === 0) auth = s.slice(12);
                    else if (s.indexOf(':method: ') === 0) method = s.slice(9);
                  }
                  if (path) {
                    if (auth === 'manhua.acimg.cn' || path.indexOf('/manhua_detail/') === 0) {
                      var imgUrl = 'https://manhua.acimg.cn' + path;
                      emit('image_url', { url: imgUrl, path: path });
                    } else {
                      recordEndpoint(auth, path);
                      emit('h2_path', { method: method, path: path, authority: auth });
                    }
                  }
                } catch (e) {}
              }
            }
            return ov.call(this, ...arguments);
          };
        });
      }
    });
    if (scanPasses >= 30) {
      clearInterval(scanTimer);
    }
  }

  scanHttp2();
  var scanTimer = setInterval(scanHttp2, 2000);

  emit('info', { msg: 'Cipher GZIP decrypt & OkHttp2 hooks active' });
});
"""


class ChapterCaptureSession:
    def __init__(self, target_comic_id: str, target_chapter_id: str):
        self.target_comic_id = str(target_comic_id)
        self.target_chapter_id = str(target_chapter_id)
        self.captured_urls = []
        self.lock = threading.Lock()
        self.last_image_ts = 0
        self.captured_event = threading.Event()

    def on_message(self, message: dict, data: bytes):
        payload = message.get("payload", {})
        kind = payload.get("kind") or payload.get("type")

        if kind == "in_process_nav":
            log(f"🚀 In-Process Intent Dispatched -> Comic {payload.get('comicId')} Ch {payload.get('chapterId')}")

        elif kind == "plain_gzip":
            raw_gzip = None
            if data is not None and len(data) > 0:
                raw_gzip = bytes(data)
            elif "head" in payload and len(payload["head"]) > 0:
                raw_gzip = bytes.fromhex(payload["head"])

            if not raw_gzip or not raw_gzip.startswith(b"\x1f\x8b"):
                return

            try:
                decomp = gzip.decompress(raw_gzip)
                text = decomp.decode("utf-8")
                parsed_json = json.loads(text)
                extracted = extract_image_urls(parsed_json)
                if extracted and len(extracted) > 0:
                    with self.lock:
                        for u in extracted:
                            if u not in self.captured_urls:
                                self.captured_urls.append(u)
                        self.last_image_ts = time.time()
                        log(f"💎 Captured {len(self.captured_urls)} CDN images via Cipher Decrypt JSON!")
                        self.captured_event.set()
            except Exception:
                pass

        elif kind == "image_url":
            raw_url = payload.get("url")
            if raw_url:
                clean = clean_image_url(raw_url)
                with self.lock:
                    if clean not in self.captured_urls:
                        self.captured_urls.append(clean)
                        self.last_image_ts = time.time()
                        log(f"🖼️ [HTTP/2 #{len(self.captured_urls)}] {clean}")
                        if len(self.captured_urls) >= 5:
                            self.captured_event.set()

        elif kind == "h2_path":
            path = payload.get("path", "")
            if "Chapter" in path:
                log(f"📡 API Route: {path}")


def process_and_upload_chapter(
    urls: list,
    manga_name: str,
    chapter_title: str,
    manga_id: str = ""
) -> bool:
    """
    Continuous Virtual Canvas Vertical Slicing into standard 20 pages (001.jpg - 020.jpg)
    and uploading to Google Drive via GAS.
    """
    total_images = len(urls)
    log(f"✂️ Slicing & Uploading: '{manga_name}' | '{chapter_title}' ({total_images} raw pieces)...")

    # 1. Download pieces concurrently (10 Workers)
    downloaded_pieces = [None] * total_images
    def _dl(item):
        idx, u = item
        return idx, download_slice_bytes(u)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_dl, (i, urls[i])) for i in range(total_images)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_pieces[i_idx] = i_bytes

    success_count = sum(1 for b in downloaded_pieces if b is not None)
    log(f"   Downloaded {success_count}/{total_images} pieces successfully.")
    if success_count == 0:
        log("❌ No slices downloaded. Aborting stitch.")
        return False

    # 2. Determine standard width
    sample_idx = 14 if total_images >= 15 else total_images // 2
    sample_bytes = downloaded_pieces[sample_idx] or downloaded_pieces[0]
    sample_img = Image.open(io.BytesIO(sample_bytes))
    standard_width = sample_img.width
    log(f"   Standard width calibrated to: {standard_width}px")

    # 3. Virtual Canvas Vertical Slicing into exactly 20 standard pages
    target_pages = 20
    pages_payloads = [None] * target_pages

    for part_idx in range(target_pages):
        part_num = part_idx + 1
        start_idx = round(part_idx * total_images / target_pages)
        end_idx = round((part_idx + 1) * total_images / target_pages)
        if start_idx == end_idx:
            end_idx = min(total_images, start_idx + 1)

        slice_bytes_list = downloaded_pieces[start_idx:end_idx]

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
            processed_images.append(Image.new("RGB", (standard_width, 100), color=(255, 255, 255)))
            total_height = 100

        strip_canvas = Image.new("RGB", (standard_width, total_height), color=(255, 255, 255))
        curr_y = 0
        for p_img in processed_images:
            strip_canvas.paste(p_img, (0, curr_y))
            curr_y += p_img.height

        img_buf = io.BytesIO()
        strip_canvas.save(img_buf, format="JPEG", quality=95, optimize=True)
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

    # 4. Upload to Google Drive via GAS
    log(f"   Uploading {target_pages} standard pages (001.jpg - 020.jpg) to Google Drive...")
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = False
    p1["skipQueue"] = True
    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        log(f"❌ Failed uploading part 1: {res_p1.get('message')}")
        return False

    folder_url = res_p1.get("data", {}).get("folderUrl") or ""
    log(f"   📁 Drive Folder: {folder_url}")

    # Middle parts (2 to 19)
    for idx in range(1, target_pages - 1):
        pm = pages_payloads[idx]
        pm["folderUrl"] = folder_url
        res_m = call_gas("UPLOAD_CHAPTER_STITCHED_PART", pm)
        if res_m.get("status") != "success":
            log(f"⚠️ Part {idx+1} warning: {res_m.get('message')}")

    # Last part (20)
    p_last = pages_payloads[-1]
    p_last["folderUrl"] = folder_url
    p_last["isLastPart"] = True
    p_last["skipQueue"] = False
    p_last["uploadername"] = "Apt"
    p_last["uploadstatus"] = "เสร็จแล้ว"
    p_last["worklink"] = f"[อัป Raw] {folder_url}"
    p_last["note"] = f"Tencent 1-Click LDPlayer Concat 20 หน้า ลง แปลจนเมื่อย"

    res_last = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p_last)
    if res_last.get("status") != "success":
        log(f"⚠️ Last part notice: {res_last.get('message')}")

    log("✅ Upload & WorkQueue Registration Complete!")
    log(f"   🔗 Work Link: [อัป Raw] {folder_url}")
    log(f"   👤 Uploader: Apt | Status: เสร็จแล้ว")
    return True


def execute_pipeline_for_chapter(
    adb_path: str,
    serial: str,
    script,
    comic_id: str,
    chapter_id: str,
    chapter_name: str,
    manga_name: str,
    manga_id: str = "",
    timeout: float = 25.0
) -> bool:
    cap_session = ChapterCaptureSession(comic_id, chapter_id)
    script.on("message", cap_session.on_message)

    seq_no = re.search(r"(\d+)", chapter_name)
    seq_str = seq_no.group(1) if seq_no else "1"

    log(f"🎯 Triggering In-Process Navigation: Comic {comic_id} | Chapter {chapter_id} (Seq {seq_str})...")
    script.exports_sync.navtochapter(comic_id, chapter_id, seq_str)

    # Wait for decrypted JSON or HTTP/2 images, with light background swipe assistance
    log("⏳ Waiting for decrypted chapter stream & image URLs...")
    start_t = time.time()
    last_swipe_t = start_t + 2.0

    while time.time() - start_t < timeout:
        if len(cap_session.captured_urls) >= 5:
            now = time.time()
            if now - cap_session.last_image_ts > 2.5:
                break
        elif time.time() > last_swipe_t:
            # Trigger page scroll in reader if lazy load requires scroll
            adb_command(adb_path, serial, "shell", "input swipe 450 1200 450 400 120")
            last_swipe_t = time.time() + 2.0

        time.sleep(0.5)

    urls = list(cap_session.captured_urls)
    if not urls:
        # Fallback: check if urls were saved in scratch
        cand_txt = REPO_ROOT / "scratch" / "plaintext_dumps" / f"chapter_{comic_id}_{chapter_id}_urls.txt"
        if cand_txt.exists():
            urls = [line.strip() for line in cand_txt.read_text(encoding="utf-8").splitlines() if line.strip()]

    if not urls:
        log("❌ No images captured for chapter within timeout.")
        return False

    log(f"🎉 Successfully captured {len(urls)} CDN URLs for {manga_name} {chapter_name}!")
    save_dir = REPO_ROOT / "scratch" / "plaintext_dumps"
    save_dir.mkdir(parents=True, exist_ok=True)
    txt_path = save_dir / f"chapter_{comic_id}_{chapter_id}_urls.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for u in urls:
            f.write(u + "\n")
    log(f"   💾 Saved URL list -> {txt_path}")

    # Stitch, Slice 20 pages, Upload to Drive, Register in GAS WorkQueue
    return process_and_upload_chapter(
        urls=urls,
        manga_name=manga_name,
        chapter_title=chapter_name,
        manga_id=manga_id
    )


def main():
    parser = argparse.ArgumentParser(description="Tencent Comic LDPlayer 1-Click Automation Pipeline")
    parser.add_argument("--comic-id", default="", help="Tencent Comic ID (e.g. 657583, 656779)")
    parser.add_argument("--chapter-id", default="", help="Tencent Chapter ID (e.g. 139650, 144245)")
    parser.add_argument("--chapter", default="", help="Chapter title or episode number (e.g. 22 or ตอนที่ 22)")
    parser.add_argument("--manga-name", default="", help="Manga title")
    parser.add_argument("--manga-id", default="", help="Manga ID in GAS WorkQueue")
    parser.add_argument("--all-pending", action="store_true", help="Fetch pending items from GAS WorkQueue")
    parser.add_argument("--hide", action="store_true", help="Minimize/hide LDPlayer emulator window")
    parser.add_argument("--adb", default=None, help="Explicit path to adb.exe")
    parser.add_argument("--port", type=int, default=DEFAULT_FRIDA_PORT, help="Frida server port")
    parser.add_argument("--timeout", type=float, default=25.0, help="Capture timeout per chapter in seconds")
    args = parser.parse_args()

    log("=================================================================")
    log("🚀 Tencent Comic 1-Click LDPlayer Pipeline Initializing...")
    log("=================================================================")

    if args.hide:
        hide_ldplayer_window()

    adb_path = find_tool(ADB_CANDIDATES, "adb")
    log(f"Using ADB: {adb_path}")
    serial = pick_adb_device(adb_path)
    if not serial:
        log("ERROR: No ADB device found. Ensure LDPlayer is running.")
        sys.exit(1)
    log(f"Connected to device: {serial}")

    ensure_frida_server(adb_path, serial, args.port)

    pid_str = adb_command(adb_path, serial, "shell", f"pidof {APP_ID}").strip()
    if not pid_str:
        log(f"App {APP_ID} not running. Launching SplashActivity...")
        adb_command(adb_path, serial, "shell", f"am start -n {APP_ID}/.splash.SplashActivity")
        time.sleep(4.0)
        pid_str = adb_command(adb_path, serial, "shell", f"pidof {APP_ID}").strip()

    if not pid_str:
        log("ERROR: Unable to start or find com.qq.ac.android process.")
        sys.exit(1)

    pid = int(pid_str.split()[0])
    log(f"Target process active: {APP_ID} (PID={pid})")

    import frida
    device_manager = frida.get_device_manager()
    frida_device = device_manager.add_remote_device(f"127.0.0.1:{args.port}")
    session = frida_device.attach(pid)
    log(f"Frida {frida.__version__} attached to PID {pid}.")

    script = session.create_script(FRIDA_JS_INSTRUMENTATION)
    script.load()
    time.sleep(1.0)
    log("Instrumentation script loaded.")

    if args.all_pending:
        log("🔍 Fetching pending Tencent tasks from GAS WorkQueue...")
        pending_items = query_pending_gas_queue()
        log(f"Found {len(pending_items)} pending task(s).")
        for item in pending_items:
            m_id = item.get("mangaid", "")
            m_name = item.get("manganame", "")
            ch_num = item.get("chapter", "")
            raw_url = item.get("rawurl", "") or item.get("originalurl", "")
            m_cid = re.search(r"id/(\d+)", raw_url)
            cid = m_cid.group(1) if m_cid else ""
            if not cid:
                continue
            log(f"▶️ Processing pending: {m_name} Ch {ch_num} (Comic {cid})...")
            # Can be executed if chapter_id is matched
    else:
        comic_id = args.comic_id or "657583"
        chapter_id = args.chapter_id or "139650"
        chapter_name = args.chapter or "22"
        manga_name = args.manga_name or get_comic_title_from_web(comic_id)

        log(f"🎯 Target Chapter: '{manga_name}' | Chapter '{chapter_name}'")
        log(f"   Comic ID: {comic_id} | Chapter ID: {chapter_id}")

        success = execute_pipeline_for_chapter(
            adb_path=adb_path,
            serial=serial,
            script=script,
            comic_id=comic_id,
            chapter_id=chapter_id,
            chapter_name=chapter_name,
            manga_name=manga_name,
            manga_id=args.manga_id,
            timeout=args.timeout
        )

        if success:
            log("🎉 Pipeline execution succeeded 100%!")
        else:
            log("❌ Pipeline execution encountered errors.")

    try:
        script.unload()
        session.detach()
    except Exception:
        pass


if __name__ == "__main__":
    main()

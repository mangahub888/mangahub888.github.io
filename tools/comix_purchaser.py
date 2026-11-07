#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comix.to (Multi-Group Scanner) Auto-Downloader & Pipeline (ไม่ต้องล็อกอิน)
รองรับ:
1. การเลือกค่ายแปล (Group Scanner เช่น CrowScans) จากหน้าตั้งค่ามังงะ (ScanGroup) หรือ CLI (--group)
2. การดึงลิงก์ภาพจากทั้ง 2 วิธี:
   - วิธีที่ 1 (DOM / Reader Area): เปิดหน้า Reader ด้วย Playwright Chrome แล้วตั้งค่า localStorage preload='all'
     เพื่อให้ <div class="reader-area"> สร้าง <img class="rpage-page__img" src="..."> ครบทุกหน้าทันที แล้วดึงจาก HTML Element โดยตรง
   - วิธีที่ 2 (Fast HTTP): ดึงรายการตอนของค่ายแปลและลิงก์ภาพความเร็วสูงโดยไม่ต้องเปิดเบราว์เซอร์
3. การดาวน์โหลดภาพแบบคู่ขนาน 12 Workers
4. การตัดเย็บแบบ Continuous Vertical Slicing ออกเป็น 20 หน้ามาตรฐานพอดีเป๊ะ (001.jpg ถึง 020.jpg)
5. การอัปโหลดแบบ Smart Staged Upload 5 Workers ขึ้น Google Drive (แปลจนเมื่อย)
6. การลงบันทึกใน WorkQueue ([อัป Raw] https://..., เสร็จแล้ว, Apt)
7. การอัปเดตสถานะใน Mangas และ RawTracker (COMPLETE_RAW_TRACKER_CHAPTER)
"""

import sys
import os
import re
import io
import math
import json
import time
import struct
import base64
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

GAS_URL = os.environ.get("GAS_URL", "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec")
PASSCODE = os.environ.get("PASSCODE", "10211032")
TARGET_TOTAL_PAGES = 20
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

COMIX_SIG_PREFIX = "c38"
ZJ_HEX = "fa856d9ed6e5a03a37f888c4dcd0cd0f1c8be6a6a072ac6bbd3ce5cbabef3f12fa94a0655d5e2ee4741c295e6727b7cff376650807a7c93168c2b6cc3dc4c83fc47474c907b8b741cfd2873070da62abba357d008183f28a1a42a4ec0ad663aad99653107642f6681404f8def22efb312dd6f6fb3eaa0e4403c721b23e6b0135306b08a089c4d5703950bb623d6cb99c42154aa4935e52851dd0d6f97cc5f1eade76172e28e3a8977812ece851790f93b9a9ea464c0368281205dcf2b17a86dc1d7f36d45b4cd6f96dfa881cf84a50c3ba204a52b34c2e506da83a407eed53b7c1327d16a98c6aa9f6cc6b4cc2e72db63450aed07996385e822366245f0eef2382cd572c5f84087d5d8376224de365dff8608515b968a8770d2df49a204a7db29c36ca3b8dee7f14871b2a9100c9681225179e04664d1c84541bec669b0e572eba27eb0bc992e99baf8a104aabdabad5416946f3325ab5e6539460f95202b37b861fc79f7acaf3eeef1c406565422add146eed7e60fc39065e0c70e311974de1445665a8f5462e3f0abe8d995c3cd08e8a90e69f48c30c4b87562513d8f57959e1a9ab68dfdabd037d09b1bcf4bcfabbf53132ba5c900bffc197e6338558da39a21158275b392a12c804f70ba789ee531e6439915ad0b109ccaf2754de5aa9a383992221c0e4be7dbb052e9d5f175a22c8ab712a740b18b93d41040f84335f50358477ebe561e98023004cc2d650dad1015a7cedb00d1aa03f55efb42d7bb18972110e9120890e35674fd98d07bb024d0b0c0bdff4528d4e6ec9f96a23fc4579b535c26fbc58974f0dd839ee880e429abca3601421cb442d31787a6d3e8e4d2f8fe897f929b22d54056f8b1cea842a4d73f3b3e509099a4383b1088d793ab3b3a39f7b1e18e639848e3101cc609e4a9cc7642f0bfae458a6a386b4162e5db1f6f57430a0c62e50a7d2a9755eaa2dbe3421800ab78a2f5ef15e4a4048a4cd22e7102125e87d5cfe61bb8a20c446622494012fc77fbfcb7e7f23a5cb6fed56eb5f06f53986abe8babbf717f988d457499dc359cfe34b81ff33365259b413a516ef6ba7f1fa2a8f9ded6c02e2d43ab43f1e76654964795b2d6366744859a9ccdecd9ca092d4007fb951bd87ec130ba7415d08d91ad99f97575aa34871d918782591ecfbee947d900e2154bd3e3972870b20ff8ba94c5cdeb9ee6f6a152911f541c59a9eddfad7cbfe076b84978eb24c0b13a071f2b3b52f7c5d2b0d2b95b8ebcc3cd3ef4259d935ac02f5c9bac992a0c797e320979459a21de0e802d8b25234cd15c3af3d9d4449bd34f72fee946debdff284ce6c86930fdc07584c9d2b0dc1e36d767ab72938d6636a413f2248c35d55154bfb73d1ff3af94ff90b2038ef31c00298a09961ac3f43ff107eaf7963a9f7fcfa2007fe13e773ce1eda12bcc8fa1fd5f83259e03a315f9925c7dd23e8620ff2c38584ed8f7efa1474710e018f4a5069280ed1b1fff53296d6a9cfe843467fa0b47f50791203744be3f0faa26218a898"
ZJ = bytes.fromhex(ZJ_HEX)

SHA256_K = [
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
    3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
    3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
    666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
    2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
    1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
]


def _rotr(x, n):
    return ((x >> n) | ((x << (32 - n)) & 0xFFFFFFFF)) & 0xFFFFFFFF


def _sha256_continue(state_words, msg_bytes, prev_len=64):
    P = list(state_words)
    total_len = prev_len + len(msg_bytes)
    pad_len = len(msg_bytes) + 1
    while pad_len % 64 != 56:
        pad_len += 1
    buf = bytearray(pad_len + 8)
    buf[:len(msg_bytes)] = msg_bytes
    buf[len(msg_bytes)] = 0x80
    struct.pack_into(">Q", buf, pad_len, total_len * 8)

    for offset in range(0, len(buf), 64):
        w = list(struct.unpack(">16I", buf[offset:offset + 64])) + [0] * 48
        for i in range(16, 64):
            s0 = _rotr(w[i - 15], 7) ^ _rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
            s1 = _rotr(w[i - 2], 17) ^ _rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & 0xFFFFFFFF
        a, b, c, d, e, f, g, h = P
        for i in range(64):
            S1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)
            ch = (e & f) ^ ((~e & 0xFFFFFFFF) & g)
            temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) & 0xFFFFFFFF
            S0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)
            maj = (a & b) ^ (a & c) ^ (b & c)
            temp2 = (S0 + maj) & 0xFFFFFFFF
            h, g, f, e, d, c, b, a = g, f, e, (d + temp1) & 0xFFFFFFFF, c, b, a, (temp1 + temp2) & 0xFFFFFFFF
        P = [(P[idx] + val) & 0xFFFFFFFF for idx, val in enumerate([a, b, c, d, e, f, g, h])]
    return struct.pack(">8I", *P)


def _sign_comix_request(path_and_query):
    inner_state = struct.unpack(">8I", ZJ[0:32])
    outer_state = struct.unpack(">8I", ZJ[32:64])
    inner_hash = _sha256_continue(inner_state, path_and_query.encode('utf-8'), 64)
    outer_hash = _sha256_continue(outer_state, inner_hash, 64)
    b64 = base64.urlsafe_b64encode(outer_hash).decode('ascii').rstrip('=')
    return f"{COMIX_SIG_PREFIX}." + b64[:16]


def _decrypt_comix_response(e_str):
    padded = e_str + "=" * ((4 - len(e_str) % 4) % 4)
    raw = base64.urlsafe_b64decode(padded)
    offset = ((raw[0] << 8) | raw[1]) % 1024
    key_1024 = ZJ[64:1088]
    rotated_key = key_1024[offset:] + key_1024[:offset]
    payload = bytearray(raw[2:])
    for i in range(len(payload)):
        payload[i] ^= rotated_key[i % 1024]
    return json.loads(payload.decode('utf-8'))


def call_comix_api(path, params=None):
    p = dict(params or {})
    if (path.startswith("/manga/") and path.endswith("/chapters")) or path.startswith("/chapters/"):
        p["v"] = "0"
        p["w"] = "0"
    sorted_keys = sorted(k for k in p.keys() if k != "_")
    qs_parts = [f"{k}={p[k]}" for k in sorted_keys]
    qs = "&".join(qs_parts)
    canonical = f"{path}?{qs}" if qs else path
    p["_"] = _sign_comix_request(canonical)
    full_qs = urllib.parse.urlencode(p)
    url = f"https://comix.to/api/v1{path}?{full_qs}"
    req = urllib.request.Request(url, headers={
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Rt": "0",
        "Referer": "https://comix.to/"
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        x_enc = resp.headers.get("x-enc")
        body = json.loads(resp.read().decode('utf-8'))
        if x_enc == "2" and isinstance(body, dict) and "e" in body:
            dec = _decrypt_comix_response(body["e"])
            if isinstance(dec, dict) and dec.get("status") == "ok" and "result" in dec:
                return dec["result"]
            return dec
        if isinstance(body, dict) and body.get("status") == "ok" and "result" in body:
            return body["result"]
        return body


def call_gas(action, payload=None, retries=3):
    body = {
        "passcode": PASSCODE,
        "action": action,
        "payload": payload or {}
    }
    data = json.dumps(body).encode('utf-8')
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            if attempt == retries:
                return {"status": "error", "message": str(e)}
            time.sleep(2 * attempt)


def fetch_comix_title_metadata(url):
    """
    ดึงข้อมูลเรื่องและรายชื่อค่ายแปล (Scanlation Groups) จากหน้า Title ของ comix.to
    """
    m = re.search(r"comix\.to/title/([a-z0-9]+)(?:-([^/?#]+))?", url, re.I)
    if not m:
        return {"success": False, "error": f"Invalid comix.to URL: {url}"}
    hid = m.group(1)
    slug = m.group(2) or ""
    title_url = f"https://comix.to/title/{hid}-{slug}" if slug else f"https://comix.to/title/{hid}"

    req = urllib.request.Request(title_url, headers={"User-Agent": DEFAULT_USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode('utf-8', errors='ignore')

    detail = None
    groups = []
    init_m = re.search(r'<script[^>]*id="initial-data"[^>]*>([\s\S]*?)</script>', html, re.I)
    if init_m:
        try:
            init_obj = json.loads(init_m.group(1))
            for q in init_obj.get("queries", []):
                qk = q.get("queryKey", [])
                if len(qk) >= 3 and qk[0] == "manga" and qk[1] == "detail":
                    detail = q.get("state", {}).get("data")
                elif len(qk) >= 3 and qk[0] == "manga" and qk[1] == "groups":
                    groups = q.get("state", {}).get("data") or []
        except Exception:
            pass

    if not groups:
        try:
            g_res = call_comix_api(f"/manga/{hid}/groups")
            groups = g_res.get("items", g_res) if isinstance(g_res, dict) else (g_res or [])
        except Exception:
            pass

    return {
        "success": True,
        "hid": hid,
        "slug": detail.get("slug", slug) if detail else slug,
        "title": detail.get("title", slug) if detail else slug,
        "latestChapter": detail.get("latest_chapter", 0) if detail else 0,
        "groups": groups,
    }


def fetch_comix_group_chapters(hid, scan_group="", page_limit=3):
    """
    ดึงรายการตอนของเรื่องตามค่ายแปลที่ระบุ (เช่น CrowScans)
    """
    meta = fetch_comix_title_metadata(f"https://comix.to/title/{hid}")
    groups = meta.get("groups", []) if meta.get("success") else []
    group_id = ""
    matched_group_name = ""

    if scan_group:
        target = scan_group.strip().lower()
        for g in groups:
            gname = str(g.get("name", "")).strip()
            if gname.lower() == target or target in gname.lower() or str(g.get("id")) == target:
                group_id = str(g.get("id"))
                matched_group_name = gname
                break

    chapters = []
    for p in range(1, page_limit + 1):
        params = {"page": p, "limit": 100}
        if group_id:
            params["group_id"] = group_id
        res = call_comix_api(f"/manga/{hid}/chapters", params)
        items = res.get("items", []) if isinstance(res, dict) else []
        if not items:
            break
        for ch in items:
            ch_group = (ch.get("scanlation_group") or {}).get("name") or matched_group_name or "Unknown"
            if scan_group and not group_id:
                if scan_group.strip().lower() not in ch_group.lower():
                    continue
            chapters.append({
                "chapter_id": ch.get("chapter_id") or ch.get("id"),
                "number": float(ch.get("number", 0)),
                "name": ch.get("name") or "",
                "group_name": ch_group,
                "group_id": ch.get("scanlation_group_id") or group_id,
            })
        if len(items) < 100:
            break

    return {
        "meta": meta,
        "matchedGroupName": matched_group_name or scan_group,
        "groupId": group_id,
        "chapters": chapters,
    }


def extract_comix_images_via_dom(chapter_url):
    """
    ดึงลิงก์รูปภาพจาก HTML Element (<div class="reader-area"> -> <img class="rpage-page__img">)
    โดยเปิดเบราว์เซอร์ Chrome Headless และตั้งค่า localStorage preload='all' ให้แสดงผลครบทุกหน้าทันที
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:
            browser = p.chromium.launch(headless=True)

        context = browser.new_context(
            user_agent=DEFAULT_USER_AGENT,
            viewport={"width": 1280, "height": 900}
        )
        context.add_init_script("""
            try {
                const cfg = JSON.stringify({ state: { readingDirection: "ttb", pageLayout: "single", preload: "all" }, version: 0 });
                localStorage.setItem("reader.webtoon.v3", cfg);
                localStorage.setItem("reader.default.v3", cfg);
            } catch (e) {}
        """)
        page = context.new_page()

        page.goto(chapter_url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_selector("img.rpage-page__img", state="attached", timeout=20000)
        page.wait_for_timeout(1500)

        title = page.title()
        img_urls = page.eval_on_selector_all(
            "img.rpage-page__img",
            "els => els.map(e => e.getAttribute('src') || e.src).filter(Boolean)"
        )
        browser.close()

    deduped = []
    for u in img_urls:
        if u and u not in deduped:
            deduped.append(u)
    return title, deduped


def fetch_comix_chapter_info(url, scan_group="", chapter_num=None, use_dom=False):
    """
    รับได้ทั้งลิงก์หน้าเรื่อง (เช่น https://comix.to/title/z0l20-god-level-assassin-im-the-shadow)
    หรือลิงก์หน้าตอน (เช่น https://comix.to/title/z0l20-god-level-assassin-im-the-shadow/9003650-chapter-111)
    พร้อมเลือกค่ายแปล (เช่น CrowScans)
    """
    chap_match = re.search(r"comix\.to/title/([a-z0-9]+)(?:-([^/?#]+))?/(\d+)-chapter-([0-9.]+)", url, re.I)
    hid = None
    slug = ""
    chapter_id = None
    detected_num = chapter_num
    matched_group = scan_group

    if chap_match:
        hid = chap_match.group(1)
        slug = chap_match.group(2) or ""
        chapter_id = int(chap_match.group(3))
        detected_num = float(chap_match.group(4))
        chapter_url = url
        meta = fetch_comix_title_metadata(url)
    else:
        t_match = re.search(r"comix\.to/title/([a-z0-9]+)(?:-([^/?#]+))?", url, re.I)
        if not t_match:
            return {"success": False, "error": f"Invalid comix.to URL: {url}"}
        hid = t_match.group(1)
        slug = t_match.group(2) or ""
        grp_data = fetch_comix_group_chapters(hid, scan_group=scan_group, page_limit=3)
        meta = grp_data["meta"]
        slug = meta.get("slug") or slug
        ch_list = grp_data["chapters"]
        if not ch_list:
            return {
                "success": False,
                "error": f"ไม่พบตอนสำหรับค่าย '{scan_group}' ในเรื่อง {meta.get('title')}",
                "availableGroups": meta.get("groups", [])
            }
        chosen = ch_list[0]
        if chapter_num is not None:
            for c in ch_list:
                if float(c["number"]) == float(chapter_num):
                    chosen = c
                    break
        chapter_id = chosen["chapter_id"]
        detected_num = chosen["number"]
        matched_group = chosen["group_name"]
        num_str = str(int(detected_num)) if float(detected_num).is_integer() else str(detected_num)
        chapter_url = f"https://comix.to/title/{hid}-{slug}/{chapter_id}-chapter-{num_str}"

    images = []
    if use_dom:
        try:
            print(f"🌐 [DOM Reader Area] กำลังดึง <img class='rpage-page__img'> จากหน้า Reader: {chapter_url}")
            _, images = extract_comix_images_via_dom(chapter_url)
        except Exception as dom_err:
            print(f"⚠️ DOM extraction fallback to direct fetch: {dom_err}")

    if not images:
        res_obj = call_comix_api(f"/chapters/{chapter_id}")
        if not isinstance(res_obj, dict):
            res_obj = {}
        if not matched_group and res_obj.get("scanlation_group"):
            matched_group = res_obj["scanlation_group"].get("name") or ""
        if detected_num is None and res_obj.get("number") is not None:
            detected_num = float(res_obj.get("number"))
        pages_items = (res_obj.get("pages") or {}).get("items") or res_obj.get("images") or []
        for im in pages_items:
            u = im if isinstance(im, str) else im.get("url")
            if u:
                images.append(u)

    num_label = int(detected_num) if detected_num is not None and float(detected_num).is_integer() else detected_num
    return {
        "success": len(images) > 0,
        "hid": hid,
        "mangaName": meta.get("title") or slug,
        "chapterId": chapter_id,
        "chapterNumber": detected_num,
        "chapter": f"Chapter {num_label}",
        "title": f"{meta.get('title') or slug} - Chapter {num_label}",
        "scanGroup": matched_group,
        "availableGroups": meta.get("groups", []),
        "chapterUrl": chapter_url,
        "isLocked": False,
        "images": images,
        "imagesCount": len(images),
    }


def download_comix_image(url, retries=3):
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read()
        except Exception:
            if attempt == retries:
                return None
            time.sleep(1 * attempt)
    return None


def stitch_comix_pages_in_memory(downloaded_slices):
    valid_slices = [Image.open(io.BytesIO(b)).convert("RGB") for b in downloaded_slices if b]
    if not valid_slices:
        return []

    sample_idx = 14 if len(valid_slices) >= 15 else len(valid_slices) // 2
    standard_width = valid_slices[sample_idx].width

    class SliceInfo:
        def __init__(self, img, y_top, y_bottom, scale):
            self.img = img
            self.y_top = y_top
            self.y_bottom = y_bottom
            self.scale = scale

    running_y = 0
    slices = []
    for img in valid_slices:
        scale = standard_width / img.width
        scaled_h = round(img.height * scale)
        slices.append(SliceInfo(img, running_y, running_y + scaled_h, scale))
        running_y += scaled_h

    total_chapter_height = running_y
    target_parts = TARGET_TOTAL_PAGES
    page_target_height = math.ceil(total_chapter_height / target_parts)

    pages = []
    for part_idx in range(target_parts):
        part_num = part_idx + 1
        y_start = part_idx * page_target_height
        y_end = min((part_idx + 1) * page_target_height, total_chapter_height)
        page_h = y_end - y_start
        if page_h <= 0:
            continue

        canvas = Image.new("RGB", (standard_width, page_h), (255, 255, 255))
        for s in slices:
            if s.y_bottom <= y_start or s.y_top >= y_end:
                continue
            y_overlap_start = max(s.y_top, y_start)
            y_overlap_end = min(s.y_bottom, y_end)
            draw_h = y_overlap_end - y_overlap_start
            if draw_h <= 0:
                continue

            slice_top_offset = y_overlap_start - s.y_top
            sy = round(slice_top_offset / s.scale)
            sh = round(draw_h / s.scale)
            sy = max(0, min(s.img.height - 1, sy))
            sh = max(1, min(s.img.height - sy, sh))

            cropped = s.img.crop((0, sy, s.img.width, sy + sh))
            if cropped.width == standard_width and cropped.height == draw_h:
                resized = cropped
            else:
                resized = cropped.resize((standard_width, draw_h), Image.Resampling.BILINEAR)
            dy = y_overlap_start - y_start
            canvas.paste(resized, (0, dy))

        buf = io.BytesIO()
        canvas.save(buf, format="JPEG", quality=85)
        pages.append((f"{part_num:03d}.jpg", buf.getvalue(), page_h))

    return pages


def process_single_comix_chapter(task):
    manga_id = task.get("mangaId")
    manga_name = task.get("mangaName")
    chapter_title = task.get("chapterTitle")
    chapter_num = task.get("chapterNum")
    chapter_url = task.get("chapterUrl")
    scan_group = task.get("scanGroup") or ""
    use_dom = bool(task.get("useDom"))

    print(f"\n🌐 [Comix.to Pipeline] เริ่มต้นประมวลผล: {manga_name} {chapter_title} (ค่ายแปล: {scan_group or 'ทุกค่าย'})")
    print(f"🔗 ลิงก์ตอน: {chapter_url}")

    res = fetch_comix_chapter_info(chapter_url, scan_group=scan_group, chapter_num=chapter_num, use_dom=use_dom)
    if not res.get("success") or res.get("imagesCount", 0) == 0:
        print(f"❌ ไม่สามารถดึงภาพของตอน {chapter_title} ได้: {res.get('error')}")
        return False

    raw_images = res.get("images", [])
    total_slices = len(raw_images)
    print(f"✓ พบรูปภาพทั้งหมด {total_slices} ภาพ (ค่ายแปล: {res.get('scanGroup')})")

    print(f"2. กำลังดาวน์โหลดภาพ {total_slices} ภาพ แบบคู่ขนาน (12 Workers)...")
    t_dl = time.time()
    downloaded_slices = [None] * total_slices

    def _dl_worker(item_tuple):
        idx, u = item_tuple
        return idx, download_comix_image(u)

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(_dl_worker, (i, raw_images[i])) for i in range(total_slices)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_slices[i_idx] = i_bytes

    success_slices = sum(1 for b in downloaded_slices if b is not None)
    print(f"✓ ดาวน์โหลดสำเร็จ {success_slices}/{total_slices} ภาพ (ใช้เวลา {time.time() - t_dl:.1f} วินาที)")
    if success_slices == 0:
        print("❌ ดาวน์โหลดภาพล้มเหลวทั้งหมด")
        return False

    print(f"3. กำลังตัดเย็บและเรนเดอร์ภาพ 20 หน้ามาตรฐานแบบ Continuous Vertical Slicing...")
    t_stitch = time.time()
    stitched_pages = stitch_comix_pages_in_memory(downloaded_slices)
    total_parts = len(stitched_pages)
    if total_parts == 0:
        print("❌ เกิดข้อผิดพลาดในการตัดเย็บภาพ")
        return False

    print(f"✓ ตัดเย็บครบทั้ง {total_parts} หน้าเสร็จสิ้นใน {time.time() - t_stitch:.1f} วินาที!")

    pages_payloads = [None] * total_parts
    for idx, (p_name, img_bytes, h) in enumerate(stitched_pages):
        part_num = idx + 1
        b64_str = base64.b64encode(img_bytes).decode('utf-8')
        data_url = f"data:image/jpeg;base64,{b64_str}"
        pages_payloads[idx] = {
            "mangaName": manga_name,
            "chapter": chapter_title,
            "partIndex": part_num,
            "totalParts": total_parts,
            "fileName": p_name,
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

    t_up = time.time()
    print(f"4. [Smart Upload Phase A] อัปโหลด 001.jpg เพื่อสร้าง/เตรียมโฟลเดอร์ Google Drive...")
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = (total_parts == 1)
    p1["skipQueue"] = (total_parts > 1)

    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        print(f"❌ ผิดพลาดในการอัปโหลด Phase A: {res_p1.get('message')}")
        return False

    last_folder_url = res_p1.get("data", {}).get("folderUrl") or ""
    print(f"   ✓ Phase A สำเร็จ! โฟลเดอร์ Drive: {last_folder_url}")

    if total_parts > 2:
        print(f"   [Smart Upload Phase B] อัปโหลดคู่ขนานหน้าที่ 002.jpg - {total_parts - 1:03d}.jpg (5 Workers)...")

        def _upload_worker(payload):
            payload["worklink"] = f"[อัป Raw] {last_folder_url}"
            payload["skipQueue"] = True
            payload["isLastPart"] = False
            for attempt in range(1, 4):
                try:
                    res_u = call_gas("UPLOAD_CHAPTER_STITCHED_PART", payload)
                    if res_u.get("status") == "success":
                        return payload["partIndex"], True, ""
                    time.sleep(1 * attempt)
                except Exception as ex:
                    if attempt == 3:
                        return payload["partIndex"], False, str(ex)
                    time.sleep(1 * attempt)
            return payload["partIndex"], False, "Unknown error"

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(_upload_worker, pages_payloads[i]) for i in range(1, total_parts - 1)]
            for fut in as_completed(futures):
                p_idx, ok, err_msg = fut.result()
                if ok:
                    print(f"      ✓ หน้า {p_idx:02d}/{total_parts} อัปโหลดสำเร็จ")
                else:
                    print(f"      ❌ หน้า {p_idx:02d}/{total_parts} ผิดพลาด: {err_msg}")

    if total_parts > 1:
        last_idx = total_parts - 1
        p_last = pages_payloads[last_idx]
        print(f"   [Smart Upload Phase C] อัปโหลดหน้าสุดท้าย {p_last['fileName']} และลงคิวงาน WorkQueue...")
        p_last["worklink"] = f"[อัป Raw] {last_folder_url}"
        p_last["isLastPart"] = True
        p_last["skipQueue"] = False
        p_last["uploadername"] = "Apt"
        p_last["uploadstatus"] = "เสร็จแล้ว"

        res_last = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p_last)
        if res_last.get("status") != "success":
            print(f"❌ ผิดพลาดในการอัปโหลด Phase C: {res_last.get('message')}")
            return False
        up_last_data = res_last.get("data", {})
        last_folder_url = up_last_data.get("folderUrl") or last_folder_url
        print(f"   ✓ Phase C สำเร็จ! ลงคิวงาน WorkQueue เรียบร้อย")

    print(f"\n🎉 อัปโหลด {manga_name} {chapter_title} ครบทั้ง {total_parts} หน้า สำเร็จใน {time.time() - t_up:.1f} วินาที!")
    print(f"📂 Google Drive: {last_folder_url}\n")

    print(f"5. บันทึกสถานะตอน {chapter_num} ลงฐานข้อมูล Mangas & RawTracker...")
    comp_res = call_gas("COMPLETE_RAW_TRACKER_CHAPTER", {
        "mangaId": manga_id,
        "chapterNum": chapter_num
    })
    print(f"✓ บันทึกสถานะเรียบร้อย: {comp_res.get('message')}")
    return True


def get_pending_comix_tasks():
    print("\n🔍 ตรวจสอบรายการมังงะ Comix.to จาก RawTracker & Mangas...")
    res = call_gas("GET_RAW_TRACKER_LIST")
    if res.get("status") != "success":
        print(f"❌ เกิดข้อผิดพลาดในการดึง RawTracker list: {res}")
        return []

    m_res = call_gas("GET_MANGA_LIST")
    m_map = {}
    if m_res.get("status") == "success":
        for m in m_res.get("data", []):
            m_map[str(m.get("mangaid"))] = m

    trackers = res.get("data", [])
    comix_trackers = [t for t in trackers if "comix.to" in str(t.get("url", "")).lower()]
    print(f"✓ พบมังงะ Comix.to ทั้งหมด {len(comix_trackers)} เรื่องในระบบ")

    pending_tasks = []
    for t in comix_trackers:
        url = str(t.get("url", ""))
        manga_name = t.get("manganame")
        manga_id = str(t.get("mangaid"))
        m_obj = m_map.get(manga_id, {})
        scan_group = str(m_obj.get("scangroup") or m_obj.get("ScanGroup") or "").strip()

        manga_last_chap = float(m_obj.get("lastchapter") or 0) if m_obj else 0.0
        rt_curr_chap = float(t.get("currentchapter") or 0) if t.get("currentchapter") else 0.0
        current_chap = rt_curr_chap if rt_curr_chap > 0 else manga_last_chap

        hid_m = re.search(r"comix\.to/title/([a-z0-9]+)(?:-([^/?#]+))?", url, re.I)
        if not hid_m:
            continue
        hid = hid_m.group(1)
        slug = hid_m.group(2) or ""

        try:
            grp_data = fetch_comix_group_chapters(hid, scan_group=scan_group, page_limit=2)
            ch_list = grp_data.get("chapters", [])
            slug = grp_data.get("meta", {}).get("slug") or slug
        except Exception as ex:
            print(f"   ⚠️ ดึงรายการตอนของ {manga_name} ไม่สำเร็จ: {ex}")
            continue

        new_chaps = {}
        for ch in ch_list:
            c_num = float(ch["number"])
            if c_num > current_chap and c_num not in new_chaps:
                new_chaps[c_num] = ch

        for c_num in sorted(new_chaps.keys()):
            ch = new_chaps[c_num]
            num_str = str(int(c_num)) if c_num.is_integer() else str(c_num)
            chap_url = f"https://comix.to/title/{hid}-{slug}/{ch['chapter_id']}-chapter-{num_str}"
            pending_tasks.append({
                "trackerId": t.get("trackerid"),
                "mangaId": manga_id,
                "mangaName": manga_name,
                "chapterTitle": f"Chapter {num_str}",
                "chapterNum": c_num,
                "chapterUrl": chap_url,
                "scanGroup": ch.get("group_name") or scan_group,
                "connector": "comix",
            })
            print(f"      ➔ เข้าคิวตอนใหม่: {manga_name} Chapter {num_str} (ค่าย: {ch.get('group_name') or scan_group})")

    return pending_tasks


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    group_arg = ""
    chap_arg = None
    use_dom_flag = "--dom" in sys.argv

    for idx, a in enumerate(sys.argv[1:]):
        if a.startswith("--group="):
            group_arg = a.split("=", 1)[1]
        elif a == "--group" and idx + 2 < len(sys.argv):
            group_arg = sys.argv[idx + 2]
        elif a.startswith("--chapter="):
            chap_arg = float(a.split("=", 1)[1])

    if "--scan" in sys.argv:
        tasks = get_pending_comix_tasks()
        print(f"\n✨ พบตอน Comix.to ที่รอประมวลผลทั้งหมด: {len(tasks)} ตอน")
        sys.exit(0)

    target_url = args[0] if args else "https://comix.to/title/z0l20-god-level-assassin-im-the-shadow"

    if "--info-only" in sys.argv:
        print(f"🚀 กำลังตรวจสอบข้อมูลเรื่อง/ตอนจาก Comix.to: {target_url} (Group: {group_arg}, DOM={use_dom_flag})")
        res = fetch_comix_chapter_info(target_url, scan_group=group_arg, chapter_num=chap_arg, use_dom=use_dom_flag)
        print("\n--- ผลลัพธ์ ---")
        print(f"Success: {res.get('success')}")
        print(f"MangaName: {res.get('mangaName')}")
        print(f"Available Groups: {[g.get('name') for g in res.get('availableGroups', [])]}")
        print(f"Selected Group: {res.get('scanGroup')}")
        print(f"Chapter: {res.get('chapter')} (URL: {res.get('chapterUrl')})")
        print(f"Images Count: {res.get('imagesCount')} ภาพ")
        if res.get("images"):
            print(f"Sample Image 1: {res['images'][0]}")
        sys.exit(0)

    info = fetch_comix_chapter_info(target_url, scan_group=group_arg, chapter_num=chap_arg, use_dom=use_dom_flag)
    if not info.get("success"):
        print(f"❌ ดึงข้อมูลไม่สำเร็จ: {info.get('error')}")
        sys.exit(1)

    m_res = call_gas("GET_MANGA_LIST")
    m_list = m_res.get("data", []) if m_res.get("status") == "success" else []
    matched_manga = None
    for m in m_list:
        if info.get("hid") and info["hid"] in str(m.get("originalurl", "")).lower():
            matched_manga = m
            break
        if "god-level-assassin" in str(m.get("slug", "")).lower() and info.get("hid") == "z0l20":
            matched_manga = m
            break

    m_name = matched_manga.get("manganame") if matched_manga else info.get("mangaName")
    m_id = str(matched_manga.get("mangaid")) if matched_manga else "0"

    task = {
        "mangaId": m_id,
        "mangaName": m_name,
        "chapterTitle": info.get("chapter"),
        "chapterNum": info.get("chapterNumber"),
        "chapterUrl": info.get("chapterUrl"),
        "scanGroup": info.get("scanGroup"),
        "useDom": use_dom_flag,
        "connector": "comix",
    }
    ok = process_single_comix_chapter(task)
    print(f"\n🏁 ประมวลผลเสร็จสิ้น: {'สำเร็จ' if ok else 'ล้มเหลว'}")

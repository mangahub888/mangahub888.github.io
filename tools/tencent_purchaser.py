#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tencent Comic (ac.qq.com / qq) Auto-Purchaser & Pipeline (3rd Branch)
รองรับ:
1. การดึงคิวตอนใหม่จาก RawTracker (connector: 'tencent' หรือ 'qq')
2. การตรวจ App-Only (ตอนที่ชื่อลงท้ายด้วย APP หรือ isAppChapter == 1) -> ตั้งค่าได้ด้วย TENCENT_INCLUDE_APP_ONLY (ค่าเริ่มต้น 1 = ไม่ข้าม, 0 = ข้าม)
3. การดึงและถอดรหัส DATA + nonce จากหน้าเว็บ ac.qq.com (รองรับ Playwright / HTTP requests พร้อม session state)
4. การดึงชิ้นภาพจาก manhua.acimg.cn แบบขนาน 10 Workers
5. การตัดเย็บแบบ Continuous Vertical Slicing ออกเป็น 20 หน้ามาตรฐานพอดีเป๊ะ (001.jpg ถึง 020.jpg)
6. การอัปโหลดแบบ Smart Staged Upload ขึ้น Google Drive
7. การลงบันทึกใน WorkQueue ตามกฎเหล็ก ([อัป Raw] https://..., เสร็จแล้ว, Apt)
8. การอัปเดตสถานะใน Mangas และ RawTracker (COMPLETE_RAW_TRACKER_CHAPTER)
9. ระบบพัก 5 นาที (300s) ระหว่างตอน
"""

import sys
import os
import re
import io
import json
import time
import base64
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

GAS_URL = os.environ.get("GAS_URL", "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec")
PASSCODE = os.environ.get("PASSCODE", "10211032")
TARGET_TOTAL_PAGES = 20
# App-only handling: "1" (default) = process App-only chapters, "0" = skip them
INCLUDE_APP_ONLY = os.environ.get("TENCENT_INCLUDE_APP_ONLY", "1").strip().lower() in ("1", "true", "yes")
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

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

def get_tencent_cookie():
    """ดึง Cookie Session จาก Env หรือไฟล์ tencent_app_session.json"""
    cookie = os.environ.get("TENCENT_COOKIE", "").strip()
    if cookie:
        return cookie

    session_file = os.path.join(os.path.dirname(__file__), "tencent_app_session.json")
    if os.path.exists(session_file):
        try:
            with open(session_file, "r", encoding="utf-8") as f:
                sdata = json.load(f)
                headers = sdata.get("headers", {})
                if headers.get("Cookie"):
                    return headers["Cookie"]
                cookies = sdata.get("cookies", {})
                if cookies:
                    return "; ".join([f"{k}={v}" for k, v in cookies.items() if v])
        except Exception as e:
            print(f"⚠️ ไม่สามารถอ่าน tencent_app_session.json: {e}")

    return ""

def is_app_only(title, is_app_chapter_flag=0):
    if str(is_app_chapter_flag).strip().lower() in ("1", "true", "yes"):
        return True
    if re.search(r'APP$', (title or "").strip(), re.IGNORECASE):
        return True
    return False

def get_pending_tencent_tasks():
    """ดึงรายการตอนที่ค้างอยู่จาก RawTracker สำหรับ Tencent (qq/tencent)"""
    tasks = []
    try:
        res = call_gas("GET_RAW_TRACKER_PENDING_CHAPTERS", {})
        if res.get("status") == "success" and res.get("data"):
            all_tasks = res["data"].get("tasks", [])
            for t in all_tasks:
                conn = str(t.get("connector", "")).lower()
                src = str(t.get("sourceUrl", "")).lower()
                if conn in ["tencent", "qq"] or "ac.qq.com" in src:
                    t["connector"] = "tencent"
                    tasks.append(t)
    except Exception as e:
        print(f"⚠️ ดึงคิวงาน Tencent จาก GAS ไม่สำเร็จ: {e}")
    return tasks

def download_image(url, retries=3):
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://ac.qq.com/"
    }
    cookie = get_tencent_cookie()
    if cookie:
        headers["Cookie"] = cookie

    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                if len(data) > 0:
                    return data
        except Exception:
            time.sleep(0.5 * attempt)
    return None

def process_single_tencent_chapter(task):
    """
    ประมวลผล 1 ตอนของ Tencent Comic:
    1. ตรวจสอบ App-Only
    2. ดึงหน้าเว็บ/ถอดรหัส DATA
    3. ดาวน์โหลดภาพจาก manhua.acimg.cn
    4. เย็บ 20 หน้า (001-020)
    5. อัปโหลดขึ้น Drive & ลงคิวงาน WorkQueue
    6. อัปเดตสถานะตอนใน RawTracker
    """
    manga_name = task.get("mangaName") or "มังงะเทนเซ็นต์"
    chapter_title = task.get("chapterTitle") or f"第{task.get('chapterNum')}话"
    comic_id = task.get("comicId")
    cid = task.get("cid") or task.get("topicId")
    manga_id = str(task.get("mangaId") or "")
    chapter_num = task.get("chapterNum")
    source_url = task.get("sourceUrl")

    # ถ้าไม่มี cid แต่มี sourceUrl เช่น https://ac.qq.com/ComicView/index/id/657728/cid/146921
    if not cid and source_url:
        m_cid = re.search(r'/cid/(\d+)', source_url)
        if m_cid:
            cid = m_cid.group(1)
        m_id = re.search(r'/id/(\d+)', source_url)
        if m_id and not comic_id:
            comic_id = m_id.group(1)

    print(f"\n=======================================================")
    print(f"📖 กำลังประมวลผล Tencent: {manga_name} | {chapter_title} (ComicID: {comic_id}, CID: {cid})")
    print(f"=======================================================")
    if is_app_only(chapter_title, task.get("isAppChapter", 0)):
        # Configurable via env TENCENT_INCLUDE_APP_ONLY (default "1" = do NOT skip, per USER
        # request 2026-11-02: "no skip app-only ... download all chapter that needed").
        #   "0" -> skip: no purchase, no download.
        #   "1" -> process. NOTE: a dedicated App-API fetcher is not implemented yet
        #          (see tools/fetch_tencent_app.py); this path still uses the ac.qq.com page +
        #          session cookie, which may fail for App-only chapters. Failure is reported, never faked.
        if not INCLUDE_APP_ONLY:
            print(f"   ⏭️ App-only (ข้าม): {manga_name} | {chapter_title} -> ไม่ซื้อ ไม่ดาวน์โหลด (TENCENT_INCLUDE_APP_ONLY=0)")
            return False
        print(f"   ℹ️ App-only: {manga_name} | {chapter_title} -> ไม่ข้าม ดำเนินการดึงต่อด้วย Session (App API fetcher ยังไม่พร้อม)")

    view_url = f"https://ac.qq.com/ComicView/index/id/{comic_id}/cid/{cid}" if comic_id and cid else source_url
    if not view_url:
        print("❌ ไม่พบ URL สำหรับดึงข้อมูลตอน Tencent")
        return False

    print(1, f"กำลังดึงหน้าเว็บต้นฉบับ: {view_url}")
    html = ""
    
    # พยายามใช้ Playwright ก่อนหากมี session state
    playwright_success = False
    try:
        from playwright.sync_api import sync_playwright
        storage_state_path = os.path.join(os.path.dirname(__file__), "storageState.json")
        if not os.path.exists(storage_state_path):
            storage_state_path = "storageState.json"

        with sync_playwright() as p:
            try:
                from browser_utils import set_browser_window_bottom_most
            except Exception:
                try:
                    from tools.browser_utils import set_browser_window_bottom_most
                except Exception:
                    def set_browser_window_bottom_most(t=""): pass

            try:
                browser = p.chromium.launch(channel="chrome", headless=False)
            except Exception:
                browser = p.chromium.launch(headless=False)
            set_browser_window_bottom_most("tencent")

            ctx_kwargs = {}
            if os.path.exists(storage_state_path):
                ctx_kwargs['storage_state'] = storage_state_path
            context = browser.new_context(**ctx_kwargs)
            page = context.new_page()
            page.goto(view_url, timeout=30000)
            set_browser_window_bottom_most("tencent")
            page.wait_for_timeout(3000)

            # ตรวจสอบปุ่มจ่ายเงิน / 立即支付
            try:
                pay_btn = page.locator("text=立即支付")
                if pay_btn.is_visible(timeout=3000):
                    print("   [INFO] ตรวจพบปุ่มชำระเงิน/VIP -> กำลังกด '立即支付' เพื่อปลดล็อคตอน...")
                    pay_btn.click()
                    page.wait_for_timeout(3000)
            except Exception:
                pass

            html = page.content()
            browser.close()
            playwright_success = True
    except Exception as pw_err:
        print(f"   ⚠️ Playwright ไม่สามารถใช้งานได้ ({pw_err}), ใช้ HTTP requests แทน...")

    if not playwright_success:
        headers = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Referer": "https://ac.qq.com/"
        }
        cookie = get_tencent_cookie()
        if cookie:
            headers["Cookie"] = cookie

        try:
            req = urllib.request.Request(view_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
        except Exception as e:
            print(f"❌ ไม่สามารถดึงหน้าเว็บผ่าน HTTP requests ได้: {e}")
            return False

    # ถอดรหัส DATA
    data_m = re.search(r'var\s+DATA\s*=\s*[\x27\x22]([^\x27\x22]+)[\x27\x22]', html)
    if not data_m:
        print("❌ ไม่พบตัวแปร DATA ในหน้าตอน Tencent (อาจต้องล็อกอิน WeChat ผ่าน storageState.json)")
        return False

    raw_data = data_m.group(1)
    try:
        dec = base64.b64decode(raw_data[3:] + '===', validate=False)
        text = dec.decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"❌ ถอดรหัส base64 DATA ไม่สำเร็จ: {e}")
        return False

    urls = re.findall(r'(https://[^\s\"\'\\]+)', text)
    seen_urls = []
    for u in urls:
        clean_u = u.replace('\\/', '/')
        if 'manhua.acimg.cn' in clean_u and clean_u not in seen_urls:
            seen_urls.append(clean_u)

    total_images = len(seen_urls)
    print(f"✓ พบรูปภาพทั้งหมด {total_images} ชิ้นจาก manhua.acimg.cn")
    if total_images <= 1:
        print("❌ จำนวนรูปภาพน้อยเกินไป ไม่สมบูรณ์ ข้าม")
        return False

    # ดาวน์โหลดภาพแบบคู่ขนาน (10 Workers)
    print(f"2. กำลังดาวน์โหลดชิ้นส่วนภาพ {total_images} ชิ้น แบบคู่ขนาน (10 Workers)...")
    downloaded_slices = [None] * total_images

    def _dl_worker(item_tuple):
        idx, u = item_tuple
        return idx, download_image(u)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_dl_worker, (i, seen_urls[i])) for i in range(total_images)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_slices[i_idx] = i_bytes

    success_slices = sum(1 for b in downloaded_slices if b is not None)
    print(f"✓ ดาวน์โหลดสำเร็จ {success_slices}/{total_images} ชิ้น")

    # วัดความกว้างมาตรฐานจากหน้าย่อยที่ 15 หรือตรงกลาง
    sample_idx = 14 if total_images >= 15 else total_images // 2
    sample_bytes = downloaded_slices[sample_idx] or downloaded_slices[0]
    if not sample_bytes:
        print("❌ ไม่สามารถดาวน์โหลดชิ้นส่วนใดๆ เพื่อวัดขนาดได้ ข้าม")
        return False

    sample_img = Image.open(io.BytesIO(sample_bytes))
    standard_width = sample_img.width
    print(f"✓ ความกว้างมาตรฐานคือ {standard_width}px")

    # เย็บเป็น 20 หน้ามาตรฐาน
    total_parts = min(TARGET_TOTAL_PAGES, total_images)
    print(f"3. กำลังเย็บประกอบภาพล่วงหน้าทั้ง {total_parts} หน้า (001.jpg - {total_parts:03d}.jpg)...")

    pages_payloads = [None] * total_parts
    for part_idx in range(total_parts):
        part_num = part_idx + 1
        start_idx = round(part_idx * total_images / total_parts)
        end_idx = round((part_idx + 1) * total_images / total_parts)
        slice_bytes_list = downloaded_slices[start_idx:end_idx]

        processed_images = []
        total_height = 0

        for b in slice_bytes_list:
            if not b:
                continue
            pil_img = Image.open(io.BytesIO(b)).convert("RGB")
            if pil_img.width != standard_width:
                scale = standard_width / pil_img.width
                scaled_h = round(pil_img.height * scale)
                pil_img = pil_img.resize((standard_width, scaled_h), Image.Resampling.LANCZOS)
            processed_images.append(pil_img)
            total_height += pil_img.height

        if not processed_images:
            continue

        strip_canvas = Image.new("RGB", (standard_width, total_height), color=(255, 255, 255))
        current_y = 0
        for p_img in processed_images:
            strip_canvas.paste(p_img, (0, current_y))
            current_y += p_img.height

        img_buf = io.BytesIO()
        strip_canvas.save(img_buf, format="JPEG", quality=90, optimize=True)
        img_bytes = img_buf.getvalue()
        b64_str = base64.b64encode(img_bytes).decode('utf-8')
        data_url = f"data:image/jpeg;base64,{b64_str}"

        pages_payloads[part_idx] = {
            "mangaName": manga_name,
            "chapter": chapter_title,
            "partIndex": part_num,
            "totalParts": total_parts,
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

    # อัปโหลดขึ้น Google Drive แบบ Smart Staged Upload
    last_folder_url = ""
    print("4. [Smart Upload] กำลังอัปโหลดภาพขึ้น Google Drive...")
    
    # Phase A: หน้าแรก
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = (total_parts == 1)
    p1["skipQueue"] = (total_parts > 1)

    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        print(f"❌ ผิดพลาดในการอัปโหลดหน้า 1: {res_p1.get('message')}")
        return False

    up_data = res_p1.get("data", {})
    last_folder_url = up_data.get("folderUrl") or ""
    print(f"   ✓ โฟลเดอร์ Drive: {last_folder_url}")

    # Phase B: หน้ากลางๆ (ถ้ามีมากกว่า 2 หน้า)
    if total_parts > 2:
        def _upload_worker(payload):
            payload["worklink"] = f"[อัป Raw] {last_folder_url}"
            payload["skipQueue"] = True
            payload["isLastPart"] = False
            for attempt in range(1, 4):
                try:
                    res = call_gas("UPLOAD_CHAPTER_STITCHED_PART", payload)
                    if res.get("status") == "success":
                        return payload["partIndex"], True, ""
                    time.sleep(1 * attempt)
                except Exception as ex:
                    if attempt == 3:
                        return payload["partIndex"], False, str(ex)
                    time.sleep(1 * attempt)
            return payload["partIndex"], False, "Unknown error"

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(_upload_worker, pages_payloads[i]) for i in range(1, total_parts - 1)]
            for fut in as_completed(futures):
                p_idx, ok, err_msg = fut.result()
                if ok:
                    print(f"      ✓ หน้า {p_idx:02d}/{total_parts} อัปโหลดสำเร็จ")
                else:
                    print(f"      ❌ หน้า {p_idx:02d}/{total_parts} ผิดพลาด: {err_msg}")

    # Phase C: หน้าสุดท้าย + ลงคิวงาน WorkQueue
    if total_parts > 1:
        p_last = pages_payloads[total_parts - 1]
        p_last["worklink"] = f"[อัป Raw] {last_folder_url}"
        p_last["isLastPart"] = True
        p_last["skipQueue"] = False
        p_last["uploadername"] = "Apt"
        p_last["uploadstatus"] = "เสร็จแล้ว"

        res_last = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p_last)
        if res_last.get("status") != "success":
            print(f"❌ ผิดพลาดในการอัปโหลดหน้าสุดท้าย: {res_last.get('message')}")
            return False

    print(f"🎉 อัปโหลด Tencent {manga_name} {chapter_title} ครบ {total_parts} หน้าสำเร็จ!")
    print(f"📂 Google Drive: {last_folder_url}")

    # บันทึกสถานะลง RawTracker
    comp_res = call_gas("COMPLETE_RAW_TRACKER_CHAPTER", {
        "mangaId": manga_id,
        "chapterNum": chapter_num
    })
    print(f"✓ บันทึกสถานะเรียบร้อย: {comp_res.get('message')}")
    return True

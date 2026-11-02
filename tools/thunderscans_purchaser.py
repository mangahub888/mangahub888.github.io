#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ThunderScans (en-thunderscans.com) Auto-Purchaser & Pipeline
รองรับ:
1. การดึง Cookie Session (Google Login / WordPress Cookie) จาก GAS หรือ Environment
2. การตรวจสอบสถานะการล็อคของตอน (Coin-Locked & buyChapter)
3. การสั่งซื้อและปลดล็อคตอนอัตโนมัติผ่าน AJAX Endpoint (/wp-admin/admin-ajax.php)
4. การดึงชิ้นภาพแบบขนาน 10 Workers
5. การตัดเย็บแบบ Continuous Vertical Slicing ออกเป็น 20 หน้ามาตรฐานพอดีเป๊ะ (001.jpg ถึง 020.jpg)
6. การอัปโหลดแบบ Smart Staged Upload 4 Workers ขึ้น Google Drive
7. การลงบันทึกใน WorkQueue ตามกฎเหล็ก ([อัป Raw] https://..., เสร็จแล้ว, Apt)
8. การอัปเดตสถานะใน Mangas และ RawTracker (COMPLETE_RAW_TRACKER_CHAPTER)
"""

import sys
import os
import re
import io
import math
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
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

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

def get_thunderscans_cookie():
    """ดึง Cookie Session จาก Env หรือ GAS"""
    cookie = os.environ.get("THUNDERSCANS_COOKIE", "").strip()
    if cookie:
        return cookie

    try:
        res = call_gas("GET_THUNDERSCANS_SESSION")
        if res.get("status") == "success" and res.get("data", {}).get("cookie"):
            return res["data"]["cookie"].strip()
    except Exception as e:
        print(f"⚠️ ไม่สามารถดึง Cookie จาก GAS: {e}")

    return ""

def fetch_chapter_info(chapter_url, cookie=""):
    """
    ดึงข้อมูลตอน ตรวจสอบว่าล็อคหรือไม่ และดึง URL รูปภาพ
    """
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://en-thunderscans.com/"
    }
    if cookie:
        headers["Cookie"] = cookie

    req = urllib.request.Request(chapter_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return {"success": False, "error": f"Failed to fetch page: {e}"}

    # 1. Title
    title = ""
    h1_match = re.search(r'<h1[^>]*class=["\'][^"\']*(?:entry-title|lock-title)[^"\']*["\'][^>]*>([\s\S]*?)<\/h1>', html, re.I) or \
               re.search(r'<h1[^>]*>([\s\S]*?)<\/h1>', html, re.I)
    if h1_match:
        title = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip()
    if not title:
        t_match = re.search(r'<title>([\s\S]*?)<\/title>', html, re.I)
        if t_match:
            title = t_match.group(1).replace("- Thunderscans", "").replace("– Thunderscans", "").strip()

    # 2. Check ts_reader for unlocked images
    images = []
    ts_match = re.search(r'ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;', html)
    post_id = None
    if ts_match:
        try:
            ts_data = json.loads(ts_match.group(1))
            post_id = ts_data.get("post_id")
            sources = ts_data.get("sources", [])
            if sources and isinstance(sources, list) and "images" in sources[0]:
                images = sources[0]["images"]
        except Exception as e:
            print(f"⚠️ Failed to parse ts_reader JSON: {e}")

    # 3. Lock detection & buy info
    is_locked = len(images) == 0
    nonce = None
    coin_price = None

    if is_locked:
        m_btn = re.search(r'buyChapter\((\d+)\)', html)
        if m_btn:
            post_id = m_btn.group(1)
        if not post_id:
            m_pid = re.search(r'data-id=["\'](\d+)["\']', html)
            if m_pid:
                post_id = m_pid.group(1)

        m_nonce = re.search(r'nonce:\s*["\']([a-f0-9]+)["\']', html)
        if m_nonce:
            nonce = m_nonce.group(1)

        m_coin = re.search(r'<span[^>]*class=["\']coin-amount["\'][^>]*>(\d+)<\/span>', html)
        if m_coin:
            coin_price = int(m_coin.group(1))

    return {
        "success": True,
        "title": title,
        "chapterUrl": chapter_url,
        "isLocked": is_locked,
        "postId": post_id,
        "nonce": nonce,
        "coinPrice": coin_price,
        "images": images,
        "imagesCount": len(images)
    }

def purchase_chapter_thunderscans(chapter_url, cookie=""):
    """
    ตรวจสอบตอน หากติดล็อคจะทำการสั่งซื้อผ่าน AJAX อัตโนมัติ แล้วดึงรูปภาพ
    """
    if not cookie:
        cookie = get_thunderscans_cookie()

    if not cookie:
        return {
            "success": False,
            "error": "ไม่พบ Cookie Session ของ ThunderScans (กรุณาบันทึก Cookie ในหน้าตั้งค่า หรือตั้ง env THUNDERSCANS_COOKIE)"
        }

    info = fetch_chapter_info(chapter_url, cookie)
    if not info.get("success"):
        return info

    if not info.get("isLocked"):
        print(f"✓ ตอน {info.get('title')} ปลดล็อคอยู่แล้ว (พบรูปภาพ {info.get('imagesCount')} ภาพ)")
        return info

    post_id = info.get("postId")
    nonce = info.get("nonce")
    coin_price = info.get("coinPrice") or 50

    print(f"🔒 ตรวจพบตอนติด Lock: {info.get('title')}")
    print(f"   ℹ️ PostID: {post_id}, ราคา: {coin_price} Coins, Nonce: {nonce}")

    if not post_id or not nonce:
        return {
            "success": False,
            "error": f"ไม่สามารถสกัด PostID ({post_id}) หรือ Nonce ({nonce}) สำหรับสั่งซื้อได้"
        }

    # สั่งซื้อผ่าน AJAX
    ajax_url = "https://en-thunderscans.com/wp-admin/admin-ajax.php"
    post_data = urllib.parse.urlencode({
        "action": "buy_chapter",
        "id": post_id,
        "nonce": nonce
    }).encode('utf-8')

    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": chapter_url,
        "Cookie": cookie,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }

    req = urllib.request.Request(ajax_url, data=post_data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp_body = resp.read().decode('utf-8', errors='ignore')
            resp_json = json.loads(resp_body)
    except Exception as e:
        return {"success": False, "error": f"เกิดข้อผิดพลาดในการส่งคำสั่งซื้อ: {e}"}

    if not resp_json.get("success"):
        err_msg = resp_json.get("data", {}).get("message") or "คำสั่งซื้อถูกปฏิเสธ"
        print(f"❌ สั่งซื้อไม่สำเร็จ: {err_msg}")
        return {
            "success": False,
            "error": err_msg,
            "data": resp_json
        }

    print(f"🎉 สั่งซื้อตอนสำเร็จ: {resp_json.get('data', {}).get('message')}")

    # ดึงข้อมูลตอนอีกครั้งหลังจากซื้อเสร็จ
    time.sleep(1)
    unlocked_info = fetch_chapter_info(chapter_url, cookie)
    if unlocked_info.get("isLocked") or unlocked_info.get("imagesCount", 0) == 0:
        print("⚠️ รีโหลดหน้าแล้วยังไม่พบ ts_reader กำลังลองอีกครั้งใน 2 วินาที...")
        time.sleep(2)
        unlocked_info = fetch_chapter_info(chapter_url, cookie)

    return unlocked_info

def download_thunder_image(url, retries=3):
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://en-thunderscans.com/"
    }
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.read()
        except Exception:
            if attempt == retries:
                return None
            time.sleep(1 * attempt)
    return None

def stitch_thunderscans_pages_in_memory(downloaded_slices):
    """
    อัลกอริทึม Continuous Vertical Slicing:
    ประกอบภาพทั้งหมดในแนวตั้งอย่างต่อเนื่อง แล้วตัดแบ่งออกเป็น 20 หน้ามาตรฐานพอดีเป๊ะ (001.jpg ถึง 020.jpg)
    """
    valid_slices = [Image.open(io.BytesIO(b)).convert("RGB") for b in downloaded_slices if b]
    if not valid_slices:
        return []

    # วัดความกว้างมาตรฐานจากชิ้นที่ 15 หรือกลางเรื่อง
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

def process_single_thunderscans_chapter(task):
    """
    ประมวลผล 1 ตอนของ ThunderScans แบบครบวงจร ด้วย 10x Smart Parallel Architecture:
    1. ปลดล็อค/ซื้อตอนอัตโนมัติ
    2. โหลดภาพคู่ขนาน 12 Workers
    3. ตัดเย็บแนวตั้งต่อเนื่อง 20 หน้ามาตรฐานแบบ High-Speed In-Memory
    4. Smart Staged Upload 5 Workers ขึ้น Google Drive
    5. ลงคิวงาน WorkQueue
    6. อัปเดตสถานะฐานข้อมูล
    """
    manga_id = task.get("mangaId")
    manga_name = task.get("mangaName")
    chapter_title = task.get("chapterTitle")
    chapter_num = task.get("chapterNum")
    chapter_url = task.get("chapterUrl")

    print(f"\n⚡ [ThunderScans 10x Speedup] เริ่มต้นประมวลผล: {manga_name} {chapter_title}")
    print(f"🔗 ลิงก์ตอน: {chapter_url}")

    # 1. ปลดล็อค/ซื้อตอนอัตโนมัติ
    t_start = time.time()
    res = purchase_chapter_thunderscans(chapter_url)
    if not res.get("success") or res.get("isLocked") or res.get("imagesCount", 0) == 0:
        print(f"❌ ไม่สามารถดึงภาพหรือปลดล็อคตอน {chapter_title} ได้: {res.get('error')}")
        return False

    raw_images = res.get("images", [])
    total_slices = len(raw_images)
    print(f"✓ พบรูปภาพทั้งหมด {total_slices} ภาพ (หัวข้อ: {res.get('title')})")

    # 2. ดาวน์โหลดชิ้นส่วนภาพแบบคู่ขนาน (12 Workers)
    print(f"2. กำลังดาวน์โหลดภาพ {total_slices} ภาพ แบบคู่ขนาน (12 Workers)...")
    t_dl = time.time()
    downloaded_slices = [None] * total_slices

    def _dl_worker(item_tuple):
        idx, u = item_tuple
        return idx, download_thunder_image(u)

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

    # 3. Continuous Vertical Slicing & Pre-stitching All 20 Pages
    print(f"3. กำลังตัดเย็บและเรนเดอร์ภาพ 20 หน้ามาตรฐานแบบ Continuous Vertical Slicing...")
    t_stitch = time.time()
    stitched_pages = stitch_thunderscans_pages_in_memory(downloaded_slices)
    total_parts = len(stitched_pages)
    if total_parts == 0:
        print("❌ เกิดข้อผิดพลาดในการตัดเย็บภาพ")
        return False

    print(f"✓ ตัดเย็บครบทั้ง {total_parts} หน้าเสร็จสิ้นใน {time.time() - t_stitch:.1f} วินาที!")

    # เตรียม payloads
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

    # 4. Smart Staged Uploading
    t_up = time.time()
    last_folder_url = ""

    # Phase A: หน้า 1
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

    # Phase B: หน้า 2 ถึง 19 (5 Workers Concurrent Upload)
    if total_parts > 2:
        print(f"   [Smart Upload Phase B] อัปโหลดคู่ขนานหน้าที่ 002.jpg - {total_parts - 1:03d}.jpg (5 Workers)...")

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

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(_upload_worker, pages_payloads[i]) for i in range(1, total_parts - 1)]
            for fut in as_completed(futures):
                p_idx, ok, err_msg = fut.result()
                if ok:
                    print(f"      ✓ หน้า {p_idx:02d}/{total_parts} อัปโหลดสำเร็จ")
                else:
                    print(f"      ❌ หน้า {p_idx:02d}/{total_parts} ผิดพลาด: {err_msg}")

    # Phase C: หน้าสุดท้าย
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

    # 5. บันทึกความสมบูรณ์ลงฐานข้อมูล
    print(f"5. บันทึกสถานะตอน {chapter_num} ลงฐานข้อมูล Mangas & RawTracker...")
    comp_res = call_gas("COMPLETE_RAW_TRACKER_CHAPTER", {
        "mangaId": manga_id,
        "chapterNum": chapter_num
    })
    print(f"✓ บันทึกสถานะเรียบร้อย: {comp_res.get('message')}")
    return True

def get_pending_thunderscans_tasks():
    """
    ตรวจสอบรายการมังงะ ThunderScans ใน RawTracker ที่มีตอนใหม่ และสกัดตอนที่ต้องทำ
    """
    print("\n🔍 ตรวจสอบรายการมังงะ ThunderScans จาก RawTracker & Mangas...")
    res = call_gas("GET_RAW_TRACKER_LIST")
    if res.get("status") != "success":
        print(f"❌ เกิดข้อผิดพลาดในการดึง RawTracker list: {res}")
        return []

    # ดึง Manga List เพื่อนำ lastchapter มาใช้เปรียบเทียบในกรณีที่ currentchapter ใน RawTracker ยังว่างอยู่
    m_res = call_gas("GET_MANGA_LIST")
    m_map = {}
    if m_res.get("status") == "success":
        m_list = m_res.get("data", [])
        m_map = {str(m.get("mangaid")): m for m in m_list}

    trackers = res.get("data", [])
    thunder_trackers = [t for t in trackers if "en-thunderscans.com" in str(t.get("url", "")).lower()]
    print(f"✓ พบมังงะ ThunderScans ทั้งหมด {len(thunder_trackers)} เรื่องในระบบ")

    pending_tasks = []
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": "https://en-thunderscans.com/"
    }

    for t in thunder_trackers:
        status = str(t.get("status", ""))
        url = t.get("url", "")
        manga_name = t.get("manganame")
        manga_id = str(t.get("mangaid"))
        
        m_obj = m_map.get(manga_id, {})
        manga_last_chap = float(m_obj.get("lastchapter") or 0) if m_obj else 0.0
        rt_curr_chap = float(t.get("currentchapter") or 0) if t.get("currentchapter") else 0.0
        current_chap = rt_curr_chap if rt_curr_chap > 0 else manga_last_chap
        last_raw_count = float(t.get("lastrawcount") or 0)

        # ตรวจสอบว่ามีตอนใหม่หรือไม่
        if "มีตอนใหม่" not in status and last_raw_count <= current_chap:
            continue

        print(f"   📌 ตรวจพบเรื่องที่มีตอนใหม่: {manga_name} (ตอนปัจจุบัน: {current_chap}, ตอนล่าสุด: {last_raw_count})")
        # สกัด slug จาก url เช่น https://en-thunderscans.com/comics/the-clans-failure-is-a-former-continental-champion/
        slug_match = re.search(r'\/comics\/([^\/]+)', url)
        if not slug_match:
            continue
        slug = slug_match.group(1)

        # ดึงหน้ารวมตอน
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                series_html = resp.read().decode('utf-8', errors='ignore')
        except Exception as ex:
            print(f"      ⚠️ ไม่สามารถดึงหน้าเรื่อง {manga_name} ได้: {ex}")
            continue

        # สกัดตอนทั้งหมด
        # รองรับทั้ง data-num และ ลิงก์ตรง
        found_chaps = []
        # Pattern 1: data-num="64"
        for m in re.finditer(r'<li[^>]*data-num=["\']([^"\']+)["\'][^>]*>', series_html):
            c_num_str = m.group(1).strip()
            try:
                c_num = float(c_num_str)
                if c_num > current_chap:
                    # สร้าง chapter URL มาตรฐาน
                    chap_url = f"https://en-thunderscans.com/{slug}-chapter-{c_num_str}/"
                    found_chaps.append((c_num, chap_url))
            except ValueError:
                pass

        # จัดเรียงจากตอนน้อยไปมาก
        found_chaps = sorted(list(set(found_chaps)), key=lambda x: x[0])
        for c_num, c_url in found_chaps:
            pending_tasks.append({
                "trackerId": t.get("trackerid"),
                "mangaId": manga_id,
                "mangaName": manga_name,
                "chapterTitle": f"Chapter {int(c_num) if c_num.is_integer() else c_num}",
                "chapterNum": c_num,
                "chapterUrl": c_url,
                "connector": "thunderscans"
            })
            print(f"      ➔ เข้าคิวตอนใหม่: {manga_name} Chapter {c_num}")

    return pending_tasks

def countdown_sleep(seconds=300):
    """
    นับถอยหลังพัก 5 นาที (300 วินาที) ระหว่างตอนสำหรับ ThunderScans (รองรับทั้ง Terminal และ GitHub Actions CI/CD)
    """
    mins_total = seconds // 60
    print(f"\n☕ จบตอนแล้ว! พัก {mins_total} นาที ({seconds} วินาที) เพื่อความปลอดภัยตามมาตรฐาน 24/7 Pipeline...", flush=True)

    # ถ้าเป็น CI/CD เช่น GitHub Actions (ไม่มี interactive TTY)
    if not sys.stdout.isatty():
        step = 60
        remaining = seconds
        while remaining > 0:
            mins = remaining // 60
            secs = remaining % 60
            print(f"   ⏳ [ThunderScans Cooldown] นับถอยหลังพัก: [{mins:02d}:{secs:02d}] ...", flush=True)
            sleep_time = min(step, remaining)
            time.sleep(sleep_time)
            remaining -= sleep_time
        print("   ✓ ครบเวลาพักแล้ว! เริ่มประมวลผลตอนถัดไปทันที...\n", flush=True)
        return

    # ถ้าเป็น Local Terminal
    for remaining in range(seconds, 0, -1):
        mins = remaining // 60
        secs = remaining % 60
        print(f"\r   ⏳ [ThunderScans Cooldown] นับถอยหลัง: [{mins:02d}:{secs:02d}] ... (กด Ctrl+C เพื่อข้ามการพัก)", end="", flush=True)
        try:
            time.sleep(1)
        except KeyboardInterrupt:
            print("\n   ⏩ ข้ามการพัก เริ่มตอนต่อไปทันที!", flush=True)
            return
    print(f"\n   ✓ ครบเวลาพัก {mins_total} นาทีแล้ว! เริ่มประมวลผลตอนถัดไปทันที...\n", flush=True)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--scan":
        tasks = get_pending_thunderscans_tasks()
        print(f"\n✨ พบตอน ThunderScans ที่รอประมวลผลทั้งหมด: {len(tasks)} ตอน")
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == "--run-all":
        tasks = get_pending_thunderscans_tasks()
        max_ch = int(os.environ.get("MAX_CHAPTERS", "0"))
        if max_ch > 0 and len(tasks) > max_ch:
            print(f"⚙️ จำกัดการรันสูงสุด {max_ch} ตอน (จากทั้งหมด {len(tasks)} ตอน)")
            tasks = tasks[:max_ch]

        print(f"\n🚀 เริ่มต้นประมวลผลตอน ThunderScans ทั้งหมด {len(tasks)} ตอน...")
        cooldown = int(os.environ.get("THUNDERSCANS_COOLDOWN_SECONDS", os.environ.get("COOLDOWN_SECONDS", "300")))
        for idx, task in enumerate(tasks):
            print(f"\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
            print(f"คิวงาน ThunderScans [{idx+1}/{len(tasks)}]: {task.get('mangaName')} {task.get('chapterTitle')}")
            print(f"<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")
            ok = process_single_thunderscans_chapter(task)
            if idx < len(tasks) - 1:
                if ok:
                    countdown_sleep(cooldown)
                else:
                    print("   ⏩ ข้ามการพักสำหรับตอนที่ไม่สำเร็จ เริ่มตอนถัดไปทันที...")
        sys.exit(0)

    target_url = sys.argv[1] if len(sys.argv) > 1 else "https://en-thunderscans.com/the-clans-failure-is-a-former-continental-champion-chapter-64/"
    if "--info-only" in sys.argv:
        print(f"🚀 กำลังตรวจสอบข้อมูลตอน: {target_url}")
        res = purchase_chapter_thunderscans(target_url)
        print("\n--- ผลลัพธ์ ---")
        print(f"Success: {res.get('success')}")
        print(f"Title: {res.get('title')}")
        print(f"IsLocked: {res.get('isLocked')}")
        print(f"Images: {res.get('imagesCount')} ภาพ")
        if res.get("images"):
            print(f"Sample Image 1: {res['images'][0]}")
        sys.exit(0)

    print(f"🚀 เริ่มต้นประมวลผลตอนเดี่ยว: {target_url}")
    # สกัดข้อมูลชื่อเรื่องและเลขตอน
    m_res = call_gas("GET_MANGA_LIST")
    m_list = m_res.get("data", []) if m_res.get("status") == "success" else []
    
    # ดึงหัวข้อตอน
    info = purchase_chapter_thunderscans(target_url)
    if not info.get("success"):
        print(f"❌ ดึงข้อมูลไม่สำเร็จ: {info.get('error')}")
        sys.exit(1)

    c_title = info.get("title", "")
    num_match = re.search(r'chapter[- ](\d+(?:\.\d+)?)', target_url, re.I) or re.search(r'Chapter\s*(\d+(?:\.\d+)?)', c_title, re.I)
    c_num = float(num_match.group(1)) if num_match else 1.0

    # Match manga
    matched_manga = None
    slug_match = re.search(r'en-thunderscans\.com\/(?:comics\/)?([^\/]+)-chapter', target_url)
    slug = slug_match.group(1) if slug_match else ""
    for m in m_list:
        if slug and slug in str(m.get("originalurl", "")):
            matched_manga = m
            break

    m_name = matched_manga.get("manganame") if matched_manga else c_title
    m_id = str(matched_manga.get("mangaid")) if matched_manga else "0"

    task = {
        "mangaId": m_id,
        "mangaName": m_name,
        "chapterTitle": f"Chapter {int(c_num) if c_num.is_integer() else c_num}",
        "chapterNum": c_num,
        "chapterUrl": target_url,
        "connector": "thunderscans"
    }

    ok = process_single_thunderscans_chapter(task)
    print(f"\n🏁 ประมวลผลเสร็จสิ้น: {'สำเร็จ' if ok else 'ล้มเหลว'}")

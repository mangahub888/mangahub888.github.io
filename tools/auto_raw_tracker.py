import sys
import os
import time
import re
import io
import base64
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GAS_URL = os.environ.get("GAS_URL", "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec")
PASSCODE = os.environ.get("PASSCODE", "10211032")
TARGET_TOTAL_PAGES = 20
COOLDOWN_SECONDS = int(os.environ.get("COOLDOWN_SECONDS", "300"))  # พัก 5 นาทีระหว่างตอน (หรือปรับแต่งได้)

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
            print(f"   [call_gas attempt {attempt}/{retries}] Error: {e}")
            if attempt == retries:
                raise
            time.sleep(2 * attempt)

def download_image(item, retries=3):
    """
    ดาวน์โหลดภาพจาก KuaiKan CDN โดยตรวจสอบโครงสร้างโดเมน {subdomain}.kkmh.com/image/... แบบไดนามิก
    คงค่า Query Token ?sign=...&t=... ไว้สำหรับ fallback เมื่อ f2 คืนค่า 404
    """
    raw_url = item if isinstance(item, str) else (item.get("rawUrl") or item.get("url"))
    clean_url = item if isinstance(item, str) else (item.get("url") or item.get("rawUrl"))

    candidates = []
    if clean_url:
        candidates.append(clean_url)
    if raw_url and raw_url != clean_url and raw_url not in candidates:
        candidates.append(raw_url)

    match = re.match(r"^https?://([a-zA-Z0-9-]+)\.kkmh\.com/image/(.+)$", raw_url or clean_url or "")
    if match:
        subdomain = match.group(1).lower()
        full_path = match.group(2)
        clean_path = re.sub(r"-t\.w\d+.*$", "", full_path)
        clean_path = re.sub(r"-w\d+.*$", "", clean_path).split("?")[0]
        query = ("?" + full_path.split("?", 1)[1]) if "?" in full_path else ""

        fallback_subdomains = ["f2", "tn1", "tn2", "tn1-f2", "tn2-f2"]
        for sub in fallback_subdomains:
            if sub != subdomain:
                if query:
                    cand_signed = f"https://{sub}.kkmh.com/image/{clean_path}.webp-t.w1280.jpg.h{query}"
                    if cand_signed not in candidates:
                        candidates.append(cand_signed)
                cand_clean = f"https://{sub}.kkmh.com/image/{clean_path}.webp"
                if cand_clean not in candidates:
                    candidates.append(cand_clean)

    for cand in candidates:
        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(
                    cand,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": "https://www.kuaikanmanhua.com/"
                    }
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = resp.read()
                    if len(data) > 0:
                        return data
            except Exception:
                time.sleep(0.3 * attempt)

    print(f"   [download_image] ข้ามชิ้นส่วนที่ไม่สามารถโหลดได้จาก CDN ทั้งหมด: {clean_url}")
    return None

def countdown_sleep(seconds):
    """
    นับถอยหลังพักระหว่างตอน (รองรับทั้ง Terminal และ GitHub Actions CI/CD)
    """
    print(f"\n☕ จบตอนแล้ว! พัก {seconds // 60} นาที เพื่อความปลอดภัยของบัญชี VIP...")
    
    # ถ้าเป็น CI/CD เช่น GitHub Actions (ไม่มี interactive TTY)
    if not sys.stdout.isatty():
        step = 60
        remaining = seconds
        while remaining > 0:
            mins = remaining // 60
            secs = remaining % 60
            print(f"   ⏳ นับถอยหลังพัก: {mins:02d}:{secs:02d} ...", flush=True)
            sleep_time = min(step, remaining)
            time.sleep(sleep_time)
            remaining -= sleep_time
        print("   ✓ ครบเวลาพักแล้ว เริ่มทำตอนถัดไปทันที!\n", flush=True)
        return

    # ถ้าเป็น Local Terminal
    for remaining in range(seconds, 0, -1):
        mins = remaining // 60
        secs = remaining % 60
        print(f"\r   ⏳ นับถอยหลัง: {mins:02d}:{secs:02d} ... (กด Ctrl+C เพื่อข้ามการพัก)", end="", flush=True)
        try:
            time.sleep(1)
        except KeyboardInterrupt:
            print("\n   ⏩ ข้ามการพัก 5 นาที เริ่มตอนต่อไปทันที!")
            return
    print("\n   ✓ ครบเวลาพัก 5 นาทีแล้ว เริ่มตอนถัดไปทันที!\n")

def process_single_chapter(task):
    """
    ประมวลผล 1 ตอน: ดึงภาพ -> เย็บ 20 หน้า (001-020) -> อัปโหลดขึ้น Drive -> ลงคิวงาน WorkQueue
    """
    manga_name = task.get("mangaName") or "มังงะ"
    chapter_title = task.get("chapterTitle") or f"第{task.get('chapterNum')}话"
    comic_id = task.get("comicId")
    manga_id = str(task.get("mangaId") or "")
    chapter_num = task.get("chapterNum")

    print(f"\n=======================================================")
    print(f"📖 กำลังประมวลผล: {manga_name} | {chapter_title} (ComicID: {comic_id})")
    print(f"=======================================================")

    # 1. ดึงข้อมูลภาพของ ComicID (ปิด API autoPurchase เพื่อใช้ Playwright Headless โดยตรง)
    print(f"1. ดึงข้อมูลภาพของ ComicID {comic_id}...")
    res = call_gas("TEST_KUAIKAN_CHAPTER", {
        "comicId": comic_id,
        "topicId": task.get("topicId") or "",
        "autoPurchase": False
    })

    status = res.get("status")
    data = res.get("data") if isinstance(res.get("data"), dict) else {}

    # หากตอนยังติดล็อค ให้ใช้ KuaiKan Auto-Purchaser (Playwright Headless) ปลดล็อคโดยตรงทันที
    if status != "success" or not data or data.get("isLocked") or data.get("imagesCount", 0) <= 1:
        print(f"\n🔒 ตรวจพบตอนติด Lock (ComicID: {comic_id}) -> กำลังปลดล็อคด้วย KuaiKan Auto-Purchaser (Playwright Headless)...")
        try:
            from kuaikan_playwright_purchaser import purchase_chapter_playwright
            pw_res = purchase_chapter_playwright(comic_id=comic_id, topic_id=task.get("topicId") or "", headless=True)
            if pw_res.get("success") and pw_res.get("imagesCount", 0) > 1:
                print(f"   🎉 Playwright ซื้อและปลดล็อคตอน {chapter_title} สำเร็จ! ({pw_res.get('imagesCount')} ภาพ)")
                res = call_gas("TEST_KUAIKAN_CHAPTER", {"comicId": comic_id, "autoPurchase": False})
                data = res.get("data") if isinstance(res.get("data"), dict) else res
            elif pw_res.get("outOfCoins"):
                print(f"\n🚨 [KUAIKAN OUT OF COINS] ซื้อตอนไม่สำเร็จเนื่องจากเหรียญหมด!")
                return False
            else:
                pw_msg = pw_res.get("message") or "Playwright purchase failed"
                print(f"❌ ไม่สามารถปลดล็อคตอนด้วย Playwright: {pw_msg}")
                return False
        except Exception as pw_err:
            print(f"❌ Playwright Purchaser error: {pw_err}")
            return False

    if data.get("isLocked") or data.get("imagesCount", 0) <= 1:
        print(f"❌ ตอนยังคงติดล็อคหรือไม่พบภาพที่สมบูรณ์ (ComicID: {comic_id})")
        return False

    urls = data.get("imageDetails") or data.get("allImages") or data.get("sampleImages") or []
    total_images = len(urls)
    thai_name = data.get("thaiTitle") or data.get("mangaName") or manga_name

    cid_str = f"c{comic_id}"
    valid_urls = []
    for item in urls:
        u = item if isinstance(item, str) else (item.get("rawUrl") or item.get("url") or "")
        if cid_str in u:
            valid_urls.append(item)

    if len(valid_urls) < total_images:
        print(f"⚠️ ตรวจพบภาพที่ไม่ตรงกับ ComicID {comic_id} ({len(valid_urls)}/{total_images}) คัดแยกออก")
        urls = valid_urls
        total_images = len(urls)

    print(f"✓ พบทั้งหมด {total_images} ชิ้นภาพ (เรื่องไทย: {thai_name}, ตอน: {data.get('title')})")
    if total_images <= 1:
        print(f"❌ ไม่พบรูปภาพที่สมบูรณ์สำหรับ ComicID {comic_id} ข้าม")
        return False

    print(f"2. กำลังดาวน์โหลดชิ้นส่วนภาพ {total_images} ชิ้น แบบคู่ขนาน (10 Workers)...")
    t_start_dl = time.time()
    downloaded_slices = [None] * total_images

    def _dl_worker(item_tuple):
        idx, u = item_tuple
        return idx, download_image(u)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(_dl_worker, (i, urls[i])) for i in range(total_images)]
        for fut in as_completed(futures):
            i_idx, i_bytes = fut.result()
            downloaded_slices[i_idx] = i_bytes

    success_slices = sum(1 for b in downloaded_slices if b is not None)
    print(f"✓ ดาวน์โหลดสำเร็จ {success_slices}/{total_images} ชิ้น (ใช้เวลา {time.time() - t_start_dl:.1f} วินาที)")

    sample_idx = 14 if total_images >= 15 else total_images // 2
    sample_bytes = downloaded_slices[sample_idx] or downloaded_slices[0]
    if not sample_bytes:
        for b in downloaded_slices:
            if b:
                sample_bytes = b
                break
    if not sample_bytes:
        print("❌ ไม่สามารถดาวน์โหลดชิ้นส่วนใดๆ เพื่อวัดขนาดความกว้างมาตรฐานได้ ข้าม")
        return False
    sample_img = Image.open(io.BytesIO(sample_bytes))
    standard_width = sample_img.width
    print(f"✓ ความกว้างมาตรฐานคือ {standard_width}px (จากหน้าย่อย #{sample_idx + 1})")

    total_parts = min(TARGET_TOTAL_PAGES, total_images)
    print(f"3. กำลังเย็บประกอบภาพล่วงหน้าทั้ง {total_parts} หน้า (001.jpg - {total_parts:03d}.jpg)...")
    t_start_stitch = time.time()

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
            "mangaName": thai_name,
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

    print(f"✓ เย็บประกอบภาพครบทั้ง {total_parts} หน้าเสร็จสิ้น (ใช้เวลา {time.time() - t_start_stitch:.1f} วินาที)")

    t_start_up = time.time()
    last_folder_url = ""

    print(f"4. [Smart Upload Phase A] อัปโหลด 001.jpg เพื่อสร้าง/เตรียมโฟลเดอร์ Google Drive...")
    p1 = pages_payloads[0]
    p1["clearFolder"] = True
    p1["isLastPart"] = (total_parts == 1)
    p1["skipQueue"] = (total_parts > 1)

    res_p1 = call_gas("UPLOAD_CHAPTER_STITCHED_PART", p1)
    if res_p1.get("status") != "success":
        print(f"❌ ผิดพลาดในการอัปโหลด Phase A (หน้า 1): {res_p1.get('message')}")
        return False

    up_data = res_p1.get("data", {})
    last_folder_url = up_data.get("folderUrl") or ""
    print(f"   ✓ Phase A สำเร็จ! โฟลเดอร์ Drive: {last_folder_url}")

    if total_parts > 2:
        print(f"   [Smart Upload Phase B] อัปโหลดคู่ขนานหน้าที่ 002.jpg - {total_parts - 1:03d}.jpg (4 Workers)...")

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

    print(f"\n🎉 อัปโหลด {manga_name} {chapter_title} ครบทั้ง {total_parts} หน้า สำเร็จใน {time.time() - t_start_up:.1f} วินาที!")
    print(f"📂 Google Drive: {last_folder_url}\n")
    print(f"3. บันทึกสถานะตอน {chapter_num} ลงฐานข้อมูล Mangas & RawTracker...")
    comp_res = call_gas("COMPLETE_RAW_TRACKER_CHAPTER", {
        "mangaId": manga_id,
        "chapterNum": chapter_num
    })
    print(f"✓ บันทึกสถานะเรียบร้อย: {comp_res.get('message')}")
    return True

def main():
    target_tracker_id = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "--all" else None
    print("=================================================================")
    print("🚀 Auto Raw Pipeline: ติดตามต้นฉบับอัปเดต -> โหลด -> เย็บ -> อัป -> ลงคิวงาน")
    print(f"⏱️ กฎความปลอดภัย: จบ 1 ตอน พัก {COOLDOWN_SECONDS // 60} นาที ก่อนเริ่มตอนต่อไป")
    print("=================================================================")

    if not target_tracker_id:
        print("\n🔍 0. ตรวจสอบสถานะตอนใหม่ล่าสุดจากเว็บต้นทาง (CHECK_ALL_RAW_TRACKERS)...")
        try:
            check_res = call_gas("CHECK_ALL_RAW_TRACKERS", {"notifyTelegram": False})
            if check_res and check_res.get("status") == "success":
                new_up = check_res.get("data", {}).get("newUpdates", [])
                print(f"   ✓ ตรวจสอบเว็บต้นทางเสร็จสิ้น (พบตอนใหม่เพิ่ม: {len(new_up)} เรื่อง)")
            else:
                print("   ⚠️ ตรวจสอบเว็บต้นทางไม่สำเร็จ ข้ามไปยังคิวงานเดิม...")
        except Exception as e:
            print(f"   ⚠️ ตรวจสอบเว็บต้นทางผิดพลาด ({e}) ข้ามไปยังคิวงานเดิม...")

    print("\n1. กำลังสแกนรายการตอนใหม่ทั้งหมดจาก RawTracker (KuaiKan, ThunderScans & Tencent Comic)...")
    tasks = []
    res = call_gas("GET_RAW_TRACKER_PENDING_CHAPTERS", {"trackerId": target_tracker_id})
    if res.get("status") == "success" and res.get("data"):
        tasks.extend(res["data"].get("tasks", []))

    # ดึงคิวตอนใหม่จาก ThunderScans (en-thunderscans.com)
    try:
        from thunderscans_purchaser import get_pending_thunderscans_tasks, process_single_thunderscans_chapter
        thunder_tasks = get_pending_thunderscans_tasks()
        if thunder_tasks:
            if target_tracker_id:
                thunder_tasks = [t for t in thunder_tasks if str(t.get("trackerId")) == str(target_tracker_id)]
            tasks.extend(thunder_tasks)
    except Exception as th_err:
        print(f"   ⚠️ ไม่สามารถดึงคิวงาน ThunderScans: {th_err}")

    # ดึงคิวตอนใหม่จาก Tencent Comic (ac.qq.com / qq)
    try:
        from tencent_purchaser import get_pending_tencent_tasks, process_single_tencent_chapter
        tencent_tasks = get_pending_tencent_tasks()
        if tencent_tasks:
            if target_tracker_id:
                tencent_tasks = [t for t in tencent_tasks if str(t.get("trackerId")) == str(target_tracker_id)]
            tasks.extend(tencent_tasks)
    except Exception as tc_err:
        print(f"   ⚠️ ไม่สามารถดึงคิวงาน Tencent Comic: {tc_err}")

    # ดึงคิวตอนใหม่จาก Comix.to (Multi-Group Scanner เช่น CrowScans)
    try:
        from comix_purchaser import get_pending_comix_tasks, process_single_comix_chapter
        comix_tasks = get_pending_comix_tasks()
        if comix_tasks:
            if target_tracker_id:
                comix_tasks = [t for t in comix_tasks if str(t.get("trackerId")) == str(target_tracker_id)]
            tasks.extend(comix_tasks)
    except Exception as cx_err:
        print(f"   ⚠️ ไม่สามารถดึงคิวงาน Comix.to: {cx_err}")

    max_chapters = int(os.environ.get("MAX_CHAPTERS", "0"))
    if max_chapters > 0 and len(tasks) > max_chapters:
        print(f"⚙️ จำกัดการรันสูงสุด {max_chapters} ตอน (จากทั้งหมด {len(tasks)} ตอน)")
        tasks = tasks[:max_chapters]

    total_tasks = len(tasks)
    print(f"✓ พบตอนใหม่ที่รออัป raw ทั้งหมด {total_tasks} ตอน:")
    for idx, t in enumerate(tasks):
        conn_tag = f"[{t.get('connector', 'kuaikan').upper()}]"
        print(f"   [{idx + 1:02d}/{total_tasks}] {conn_tag} {t.get('mangaName')} | {t.get('chapterTitle')}")

    if not tasks:
        print("\n✨ ไม่มีตอนใหม่ที่ค้างอยู่ ระบบเป็นปัจจุบันครบทั้งหมดแล้วครับ!")
        return

    completed_count = 0
    for idx, task in enumerate(tasks):
        conn = task.get("connector", "kuaikan")
        print(f"\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
        print(f"คิวงานที่ [{idx + 1}/{total_tasks}] ({conn.upper()}): {task.get('mangaName')} {task.get('chapterTitle')}")
        print(f"<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")

        if conn == "thunderscans":
            success = process_single_thunderscans_chapter(task)
        elif conn == "comix":
            success = process_single_comix_chapter(task)
        elif conn in ["tencent", "qq"]:
            success = process_single_tencent_chapter(task)
        else:
            success = process_single_chapter(task)
        if success:
            completed_count += 1

        if idx < total_tasks - 1:
            if success:
                cd_sec = int(os.environ.get("THUNDERSCANS_COOLDOWN_SECONDS", str(COOLDOWN_SECONDS))) if conn in ["thunderscans", "tencent", "qq"] else COOLDOWN_SECONDS
                countdown_sleep(cd_sec)
            else:
                print("   ⏩ ข้ามการพักสำหรับตอนที่ไม่สำเร็จ เริ่มตอนถัดไปทันที...")

    print("\n=================================================================")
    print(f"🏁 ทำงานเสร็จสิ้นทั้งหมด {completed_count}/{total_tasks} ตอนเรียบร้อยแล้ว!")
    print("=================================================================")

if __name__ == "__main__":
    main()

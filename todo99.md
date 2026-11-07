# TODO 99 — Tencent LDPlayer Pipeline: Download Timeout, Badge/Recovery & 1-Click Bug Hunt Fix (2026-11-07)

## 1. ปัญหาเดิม

Pipeline ดาวน์โหลดสำเร็จแล้ว แต่กลับ **ลบไฟล์ทิ้ง → ดาวน์โหลดซ้ำวนลูป → รายงาน ❌ failed**

**Root cause:**
`trigger_native_offline_download()` เดิม poll เฉพาะ `check_offline_image_info_list()` ที่ต้องได้ URL ≥ 5 รายการภายใน budget แค่ **35 วินาที**
แต่ในความเป็นจริง:
- รายการดาวน์โหลดขึ้นใน DownloadManager ทันที แต่ `_image_info_list` จะเริ่มมีข้อมูลเมื่อ **Engine ดาวน์โหลดเสร็จเท่านั้น**
- ⇒ ครบ 35s แล้วยังว่าง → timeout → คืน `[]`
- ⇒ `execute_pipeline_for_chapter()` เข้า recovery **Pencil → Select All → Delete** ซึ่งลบไฟล์ที่ดาวน์โหลดดีอยู่แล้วทิ้ง
- ⇒ retry → timeout อีกครั้ง → ❌ ยกเลิก

## 2. สิ่งที่แก้แล้วทั้งหมด (Phase 1 + Phase 2 Bug Hunt)

- [x] **Constants ใหม่** (`tools/tencent_ldplayer_pipeline.py`): `DOWNLOAD_POLL_INTERVAL = 2.0`, `DEFAULT_DOWNLOAD_POLL_WINDOW = 90.0`, `DOWNLOAD_HARD_TIMEOUT = 240.0`
- [x] **`check_offline_chapter_dir()`**: ตรวจโฟลเดอร์ออฟไลน์บนอุปกรณ์ (exists / จำนวนไฟล์ / มี `_image_info_list`)
- [x] **`check_download_manager_chapter_status()`**:
  - ใช้ structured XML (`ET.fromstring`) ตรวจแถวใน `DownloadManagerActivity` รายแถวโดยไม่ทะลุไปโดนแถวข้างเคียง
  - แก้บั๊กเดิมที่ใส่ `"%"` ใน `progress_words` โดยไม่แยก `"100%"` และแก้ปัญหาการจับคู่ `alt_seq` ข้ามตอนเมื่อมีตอนนำ (Prologue / Seq != Ch)
  - พิสูจน์แล้วในรอบทดสอบจริง: จับสถานะ `✅ DownloadManagerActivity shows target chapter completed ('已完成'). Pulling slices...` ได้สด ๆ
- [x] **Rewrite wait-loop** ใน `trigger_native_offline_download()`:
  - ออกได้เมื่อ URL ≥ 5 และ **stable ติดกัน 2 polls**
  - ถ้า DM = completed → grace 6s แล้วดึง slices
  - ถ้าโฟลเดอร์ settled (ไม่เปลี่ยน 8s) + มี URL → ถือว่าเสร็จ
  - soft timeout ที่ 90s (แค่ warn) → poll ต่อถึง hard ceiling 240s
- [x] **(a) อุดช่องว่าง `execute_pipeline_for_chapter()`**:
  - ตรวจ `dm_state == "completed"` ทั้งก่อน Retry #1 และ re-check `dm_state_retry == "completed"` ก่อน Retry #2
  - ห้ามเรียก `recover_download_via_pencil_delete_all()` เด็ดขาดเมื่อสถานะเป็น `"completed"` (รอไฟล์ 15s ถ้ายังอ่านไม่ได้ให้ `return False` เพื่อเก็บไฟล์ไว้รอบหน้า)
- [x] **(b) & (c) แก้ปัญหา Badge ⬇️ ค้าง, Dummy-Select ติด Captcha (`VerifyCodePage`), และการจับคู่ CID**:
  - **`clear_device_offline_cache()`**: นอกจากลบโฟลเดอร์ `/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}` แล้ว ยังเปิด `DownloadManagerActivity` ล้างรายการของเรื่องนั้นทันทีหลังจบตอน ทำให้ **Badge ⬇️ หายไปพร้อมโฟลเดอร์** ไม่ค้างในรอบถัดไป
  - **`recover_download_via_pencil_delete_all()`**: เปิด `DownloadManagerActivity` ตรง ๆ ด้วย Intent (`-f 0x14008000 --es STR_MSG_COMIC_ID {comic_id}`) แทนการกดเลือก Dummy Chapter ตอนที่ 1 ซึ่งเคยทำให้เด้งหน้า `VerifyCodePage` (จิ๊กซอว์安全验证) ขวางการทำงาน
  - **Confirmation Dialog & `handle_screen_dialogs()`**: แก้พิกัดปุ่ม `是的` (`positive_btn`) และป้องกัน `handle_screen_dialogs()` ไม่ให้เข้าใจผิดว่าปุ่ม `negative_btn` ("再想想") ของหน้าต่างยืนยันดาวน์โหลดเป็นหน้าต่างซิงค์ประวัติอ่าน
  - **CID-first Mapping ใน `--all-pending`**: ให้จับคู่ตอนจาก `item_cid` (Ground Truth จาก `RawTracker_Pending`) ก่อน `ch_num` และรองรับเลขตอนแบบมี 0 นำหน้า (`'035' == '35'`) เพื่อไม่ให้เรื่องที่มีตอนนำ (Prologue) เลื่อนเลขตอนผิดไป 1 ตอน
- [x] Swipe-reader fallback ยัง **ปิดถาวร** ตามคำสั่งเดิม
- [x] `python -m py_compile tools/tencent_ldplayer_pipeline.py` ผ่าน 100%

## 3. ผลทดสอบจริง (Live End-to-End Verification)

| รายการ | ผล |
| --- | --- |
| ไม่มีแคช — comic 657528 ch 34 (Seq 35, CID 153929) | ✅ PASS — Native Offline Download completed in 7.6s (97 canonical slices), 97/97, 20 pages → Drive |
| `--all-pending --comic-id 657528` — ch 36 (Seq 37, CID 154419) | ✅ PASS — เห็น `DownloadManagerActivity shows target chapter completed ('已完成')` สด ๆ (56.8s, 80 slices), 20 pages → Drive (`1-ORdZFe8RJi5zlWCn7VmcxcY-zeegQ7o`), ล้างแคช + ล้าง Badge ⬇️ สำเร็จ (`🧹 [Device-Cache Cleanup]`) |
| `--comic-id 657528 --chapter 35 --chapter-id 153950` (Seq 36, CID 153950) | ✅ PASS — Native Offline Download completed in 7.8s (92 canonical slices), 92/92, 20 pages → Drive (`17Nagp5SUO-Gf5l4UrsSmYfBqHL9Sn-V5`) |
| `--all-pending --comic-id 657981` — ch 9 (Seq 10, CID 156773) (`ซัมมอนเนอร์ภัยพิบัติฯ`) | ✅ PASS — Native Offline Download completed in 7.0s (90 canonical slices), 20 pages → Drive (`1JsxSwYAK_d6d0JLh1OcXhJmHgwTDnSXA`), ซิงค์ RawTracker + ล้างแคชและ Badge ⬇️ สำเร็จ |
| `--all-pending --comic-id 657755` — ch 15 (Seq 16, CID 152777) (`มหาสงครามสัตว์อสูรฯ`) | ✅ PASS — สลับเรื่องข้าม Comic (`657981` → `657755`) ด้วย `opendlselect` (finish activity เดิม) สำเร็จในครั้งเดียว! ดาวน์โหลดเสร็จใน 6.9s (37 canonical slices), 20 pages → Drive (`1E_JUPZ74lbTCeNgExk1MrHG3Iyycjl6j`), ซิงค์ RawTracker + ล้างแคชและ Badge ⬇️ สำเร็จ |
| Check `--all-pending` หลังรัน `657528`, `657981`, `657755` | ✅ ทั้ง 3 เรื่อง (4 ตอน) ออกจากคิว `RawTracker_Pending` เรียบร้อย 100% |
| Log | `test_output/all_pending_test.log`, `test_output/multi_comic_657981_test.log`, `test_output/tencent_1click_latest.log` |

## 4. สถานะรายการที่เคยค้าง (Section 4 เดิม — แก้ครบแล้ว)

- [x] **(a) อุดช่องว่าง L2320–2341** — เพิ่ม guard `if dm_state == "completed" or dm_state_retry == "completed":` ก่อน Retry #2 เรียบร้อย
- [x] **(b) เห็น `dm=completed` จริงสด ๆ** — ยืนยันใน `test_output/all_pending_test.log`, `multi_comic_657981_test.log`, และ `tencent_1click_latest.log` (`✅ DownloadManagerActivity shows target chapter completed ('已完成'). Pulling slices...`)
- [x] **(c) Badge ⬇️ ค้าง** — แก้ใน `clear_device_offline_cache()` ให้ล้างคิวใน `DownloadManagerActivity` ด้วยหลังจบแต่ละตอน + เปิด `DownloadManagerActivity` ตรงด้วย Intent โดยไม่ต้องกด Dummy Chapter
- [x] **(d) ทดสอบ `--all-pending` กับ Comic 657528, 657981, 657755** — ทดสอบครบ 4 ตอนจาก 3 เรื่อง อัปโหลดขึ้น Drive และซิงค์ RawTracker สำเร็จ 100%

## 5. รายงานการตรวจหาและแก้ไขบั๊ก 1-Click LDPlayer เพิ่มเติม (Bug Hunt Phase 2 — แก้ครบ 12 จุด)

1. **[CRITICAL] แก้บั๊กสลับเรื่องข้าม Comic แล้วหน้า `DownloadChapterSelectActivity` ค้างเรื่องเดิม**:
   - สาเหตุ: `DownloadChapterSelectActivity` ของแอป Tencent อ่าน `STR_MSG_COMIC_ID` เฉพาะใน `onCreate()` เท่านั้น (ไม่อ่านใน `onNewIntent()`) ทำให้เวลาสลับจากเรื่อง A ไปเรื่อง B จะค้างหน้าเลือกตอนของเรื่อง A
   - การแก้ไข:
     - ใน Frida `opendlselect(comicId)` สั่ง `.finish()` ปิด `DownloadChapterSelectActivity` / `DownloadManagerActivity` ตัวเก่าใน `ActivityThread.mActivities` ก่อนสั่ง `startActivity(intent)` เสมอ
     - ใช้ flag `-f 0x14008000` (`FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TOP | FLAG_ACTIVITY_CLEAR_TASK`) ในทุกคำสั่ง `am start`
     - ตรวจสอบจำนวนตอนรวมบนหน้าจอ (`共{N}话`) เทียบกับ `expected_total_chapters` จาก TOC ถ้าไม่ตรงให้บังคับรีโหลดผ่าน `DownloadManagerActivity` → `添加更多集数`
2. **[CRITICAL] แก้บั๊ก `find_chapter_seq_coords()` กดผิดตอนเมื่อมีตอนนำ (Prologue)**:
   - เมื่อระบุ `target_seq` (`seq_no`) แล้วแต่ตอนนั้นยังอยู่นอกหน้าจอ (ต้องเลื่อนหาก่อน) ห้าม fallback ไปกด `alt_seq` (`chapter_num`) ที่อยู่บนหน้าจอเด็ดขาด ป้องกันการกดผิดตอนเลื่อนไป 1 ตอน
3. **[HIGH] แก้บั๊ก Regex ดึงสารบัญ (`fetch_tencent_chapter_list`) กับชื่อตอนภาษาจีนติดเลข (`001觉醒`) และคำว่า `序`**:
   - ใน Python 3 ตัวอักษรจีนถือเป็น `\w` ทำให้ `\b` ใน `r"^(?:第)?\s*(\d+(?:\.\d+)?)\b"` จับ `'001觉醒'` ไม่ติด → แก้เป็น `(?!\d)` และแปลงเลขศูนย์นำหน้า (`'001'` → `'1'`, `'020'` → `'20'`)
   - แก้การตรวจตอนนำไม่ให้คำทั่วไปที่มีคำว่า `序` เช่น `'秩序'` หรือ `'程序'` ถูกตีความเป็นตอนที่ `0`
4. **[HIGH] เพิ่มระบบเปิด LDPlayer อัตโนมัติ (`pick_adb_device`)**:
   - เมื่อดับเบิลคลิกไฟล์ `.bat` ขณะที่ยังไม่ได้เปิด LDPlayer ระบบจะรัน `C:\LDPlayer\LDPlayer9\ldconsole.exe launch --index 0` และรอจน `sys.boot_completed == 1` ให้เองอัตโนมัติ
5. **[HIGH] แก้ลำดับการกดหน้าต่างยืนยัน / ซื้อตอน (`购买下载` → `确认购买` → `确定下载`) และ Teen Mode (`青少年守护模式`)**:
   - ใช้ลูปตรวจจับ Dialog 3 รอบหลังกดดาวน์โหลด รองรับทั้งกรณีที่หน้าจ่ายตั๋ว/เหรียญ (`确认购买`) เด้งก่อนหรือหลังหน้ายืนยันขนาดไฟล์ (`确定下载` / `是的`) รวมถึงปิดหน้าต่าง `青少年守护模式` (`我知道了`) อัตโนมัติ
   - เพิ่ม Fast-Fail 16 วินาทีในลูป Poll หากติดหน้า `V会员` paywall ที่ซื้อด้วยตั๋วไม่ได้ หรือค้างอยู่หน้า `DownloadChapterSelectActivity` จะหยุดทันทีโดยไม่รอเก้อ 240 วินาที
6. **[MEDIUM] ปรับปรุงการเลื่อนหาตอน (`search_and_tap_target_chapter`) และการดึงพิกัดปุ่ม (`find_node_center_by_id_or_text`)**:
   - เพิ่มจำนวนครั้งการเลื่อนหาตอนจาก `8` เป็น `18` รอบ รองรับเรื่องที่มีหลายร้อยตอน และสลับทิศทาง (`正序`/`倒序`) อัตโนมัติเมื่อเลื่อนสุดขอบจอ
   - สร้างฟังก์ชัน `find_node_center_by_id_or_text()` ดึงพิกัดปุ่มจาก XML Tree โดยตรง ไม่พึ่งลำดับ attribute ใน regex
7. **[LOW] เพิ่ม UTF-8 Encoding ใน `.bat` และบันทึก Log อัตโนมัติ**:
   - เพิ่ม `chcp 65001 >nul`, `set PYTHONUTF8=1`, `set PYTHONIOENCODING=utf-8` ใน `RUN_TENCENT_1CLICK_ALL_PENDING.bat`, `RUN_TENCENT_PIPELINE.bat`, และ `RUN_ADB_DUMPER.bat`
   - ทุกข้อความจาก `log()` จะถูกบันทึกลง `test_output/tencent_1click_latest.log` อัตโนมัติแม้ไม่ได้ redirect output

## 6. รายการค้างในระบบทั้งหมดล่าสุด

หลังจากรันทดสอบและอัปโหลดจริงสำเร็จไปแล้ว 3 เรื่อง (`657528`, `657981`, `657755`) คิวที่เหลือใน `RawTracker_Pending` ปัจจุบันเหลืออีกเพียง 3 เรื่อง (3 ตอน):
1. `เทพสงครามคืนบัลลังก์` (Comic ID: `657151`) — Ch 47 (CID `152986`, Seq `48`)
2. `ยอดอัจฉริยะอหังการ์` (Comic ID: `657666`) — Ch 20 (CID `149068`, Seq `21`)
3. `ราชันย์แห่งยมโลก: ข้านี่แหละคือห้วงอเวจี!` (Comic ID: `657781`) — Ch 16 (CID `154306`, Seq `17`)

สามารถรันทั้งหมดได้ทันทีด้วยการดับเบิลคลิก `RUN_TENCENT_1CLICK_ALL_PENDING.bat` (มี log บันทึกให้อัตโนมัติที่ `test_output\tencent_1click_latest.log` และเปิด LDPlayer เองหากยังไม่เปิด)

## 7. ตัวเปิด

| ไฟล์ | คำสั่งภายใน | หมายเหตุ |
| --- | --- | --- |
| `RUN_TENCENT_1CLICK_ALL_PENDING.bat` | `python tools\tencent_ldplayer_pipeline.py --all-pending` | ตั้งค่า UTF-8 อัตโนมัติ, เปิด LDPlayer อัตโนมัติถ้ายังไม่เปิด, บันทึก log อัตโนมัติลง `test_output\tencent_1click_latest.log`, cooldown 20s |
| `RUN_TENCENT_PIPELINE.bat <args>` | ส่ง args ต่อตรง ๆ หรือเปิดเมนู | ตั้งค่า UTF-8 อัตโนมัติ, เปิด LDPlayer อัตโนมัติ |

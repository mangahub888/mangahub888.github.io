# TODO 99 — Tencent LDPlayer Pipeline: Download Timeout & Badge/Recovery Fix (2026-11-07)

## 1. ปัญหาเดิม

Pipeline ดาวน์โหลดสำเร็จแล้ว แต่กลับ **ลบไฟล์ทิ้ง → ดาวน์โหลดซ้ำวนลูป → รายงาน ❌ failed**

**Root cause:**
`trigger_native_offline_download()` เดิม poll เฉพาะ `check_offline_image_info_list()` ที่ต้องได้ URL ≥ 5 รายการภายใน budget แค่ **35 วินาที**
แต่ในความเป็นจริง:
- รายการดาวน์โหลดขึ้นใน DownloadManager ทันที แต่ `_image_info_list` จะเริ่มมีข้อมูลเมื่อ **Engine ดาวน์โหลดเสร็จเท่านั้น**
- ⇒ ครบ 35s แล้วยังว่าง → timeout → คืน `[]`
- ⇒ `execute_pipeline_for_chapter()` เข้า recovery **Pencil → Select All → Delete** ซึ่งลบไฟล์ที่ดาวน์โหลดดีอยู่แล้วทิ้ง
- ⇒ retry → timeout อีกครั้ง → ❌ ยกเลิก

## 2. สิ่งที่แก้แล้วทั้งหมด

- [x] **Constants ใหม่** (`tools/tencent_ldplayer_pipeline.py` L342–344): `DOWNLOAD_POLL_INTERVAL = 2.0`, `DEFAULT_DOWNLOAD_POLL_WINDOW = 90.0`, `DOWNLOAD_HARD_TIMEOUT = 240.0`
- [x] **`check_offline_chapter_dir()`** (L302): ตรวจโฟลเดอร์ออฟไลน์บนอุปกรณ์ (exists / จำนวนไฟล์ / มี `_image_info_list`)
- [x] **`check_download_manager_chapter_status()`** (L347):
  - ใช้ structured XML (`ET.fromstring`) ตรวจแถวใน `DownloadManagerActivity` รายแถวโดยไม่ทะลุไปโดนแถวข้างเคียง
  - แก้บั๊กเดิมที่ใส่ `"%"` ใน `progress_words` โดยไม่แยก `"100%"` และแก้ปัญหาการจับคู่ `alt_seq` ข้ามตอนเมื่อมีตอนนำ (Prologue / Seq != Ch)
  - พิสูจน์แล้วในรอบทดสอบจริง: จับสถานะ `✅ DownloadManagerActivity shows target chapter completed ('已完成'). Pulling slices...` ได้สด ๆ (`80/80已完成`)
- [x] **Rewrite wait-loop** ใน `trigger_native_offline_download()`:
  - ออกได้เมื่อ URL ≥ 5 และ **stable ติดกัน 2 polls**
  - ถ้า DM = completed → grace 6s แล้วดึง slices
  - ถ้าโฟลเดอร์ settled (ไม่เปลี่ยน 8s) + มี URL → ถือว่าเสร็จ
  - soft timeout ที่ 90s (แค่ warn) → poll ต่อถึง hard ceiling 240s
- [x] **(a) อุดช่องว่าง L2320–2341 (`execute_pipeline_for_chapter()`)**:
  - ตรวจ `dm_state == "completed"` ทั้งก่อน Retry #1 และ re-check `dm_state_retry == "completed"` ก่อน Retry #2
  - ห้ามเรียก `recover_download_via_pencil_delete_all()` เด็ดขาดเมื่อสถานะเป็น `"completed"` (รอไฟล์ 15s ถ้ายังอ่านไม่ได้ให้ `return False` เพื่อเก็บไฟล์ไว้รอบหน้า)
- [x] **(b) & (c) แก้ปัญหา Badge ⬇️ ค้าง, Dummy-Select ติด Captcha (`VerifyCodePage`), และการจับคู่ CID**:
  - **`clear_device_offline_cache()`** (L2490): นอกจากลบโฟลเดอร์ `/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}` แล้ว ยังเปิด `DownloadManagerActivity` ล้างรายการของเรื่องนั้นทันทีหลังจบตอน ทำให้ **Badge ⬇️ หายไปพร้อมโฟลเดอร์** ไม่ค้างในรอบถัดไป
  - **`recover_download_via_pencil_delete_all()`**: เปิด `DownloadManagerActivity` ตรง ๆ ด้วย Intent (`--es STR_MSG_COMIC_ID {comic_id}`) แทนการกดเลือก Dummy Chapter ตอนที่ 1 ซึ่งเคยทำให้เด้งหน้า `VerifyCodePage` (จิ๊กซอว์安全验证) ขวางการทำงาน
  - **Confirmation Dialog & `handle_screen_dialogs()`**: แก้พิกัดปุ่ม `是的` (`positive_btn` ที่ `(557, 943)`) และป้องกัน `handle_screen_dialogs()` ไม่ให้เข้าใจผิดว่าปุ่ม `negative_btn` ("再想想") ของหน้าต่างยืนยันดาวน์โหลดเป็นหน้าต่างซิงค์ประวัติอ่าน
  - **CID-first Mapping ใน `--all-pending`**: ให้จับคู่ตอนจาก `item_cid` (Ground Truth จาก `RawTracker_Pending`) ก่อน `ch_num` และรองรับเลขตอนแบบมี 0 นำหน้า (`'035' == '35'`) เพื่อไม่ให้เรื่องที่มีตอนนำ (Prologue) เลื่อนเลขตอนผิดไป 1 ตอน
- [x] Swipe-reader fallback ยัง **ปิดถาวร** ตามคำสั่งเดิม
- [x] `python -m py_compile tools/tencent_ldplayer_pipeline.py` ผ่าน 100%

## 3. ผลทดสอบ

| รายการ | ผล |
| --- | --- |
| ไม่มีแคช — comic 657528 ch 34 (Seq 35, CID 153929) | ✅ PASS — Native Offline Download completed in 7.6s (97 canonical slices), 97/97, 20 pages → Drive |
| `--all-pending --comic-id 657528` — ch 36 (Seq 37, CID 154419) | ✅ PASS — เห็น `DownloadManagerActivity shows target chapter completed ('已完成')` สด ๆ (56.8s, 80 slices), 20 pages → Drive (`1-ORdZFe8RJi5zlWCn7VmcxcY-zeegQ7o`), ล้างแคช + ล้าง Badge ⬇️ สำเร็จ (`🧹 [Device-Cache Cleanup]`) |
| `--comic-id 657528 --chapter 35 --chapter-id 153950` (Seq 36, CID 153950) | ✅ PASS — Native Offline Download completed in 7.8s (92 canonical slices), 92/92, 20 pages → Drive (`17Nagp5SUO-Gf5l4UrsSmYfBqHL9Sn-V5`) |
| Check `--all-pending --comic-id 657528` หลังรัน | ✅ `Found 0 pending task(s). ✨ No pending Tencent tasks found. WorkQueue is up to date!` |
| Log | `test_output/all_pending_test.log` |

## 4. สถานะรายการที่เคยค้าง (Section 4 เดิม — แก้ครบแล้ว)

- [x] **(a) อุดช่องว่าง L2320–2341** — เพิ่ม guard `if dm_state == "completed" or dm_state_retry == "completed":` ก่อน Retry #2 เรียบร้อย
- [x] **(b) เห็น `dm=completed` จริงสด ๆ** — ยืนยันใน `test_output/all_pending_test.log` L103 (`✅ DownloadManagerActivity shows target chapter completed ('已完成'). Pulling slices...`)
- [x] **(c) Badge ⬇️ ค้าง** — แก้ใน `clear_device_offline_cache()` ให้ล้างคิวใน `DownloadManagerActivity` ด้วยหลังจบแต่ละตอน + เปิด `DownloadManagerActivity` ตรงด้วย Intent โดยไม่ต้องกด Dummy Chapter
- [x] **(d) ทดสอบ `--all-pending` กับ Comic 657528** — ทดสอบครบทั้ง Ch 35 (CID 153950) และ Ch 36 (CID 154419) อัปโหลดขึ้น Drive และซิงค์ RawTracker สำเร็จ จนคิวของ 657528 เหลือ 0 ตอน

## 5. รายการค้างในระบบทั้งหมด (จาก `--dry-run` ล่าสุด)

หลังจาก Comic 657528 เสร็จครบทุกตอนแล้ว คิวที่เหลือใน `RawTracker_Pending` ทั้งระบบมีอีก 5 เรื่อง (5 ตอน):
1. `เทพสงครามคืนบัลลังก์` (Comic ID: `657151`) — Ch 47
2. `ยอดอัจฉริยะอหังการ์` (Comic ID: `657666`) — Ch 20
3. `ราชันย์แห่งยมโลก: ข้านี่แหละคือห้วงอเวจี!` (Comic ID: `657781`) — Ch 16
4. `มหาสงครามสัตว์อสูร: เปิดเกมมาข้าก็คว้าพรสวรรค์ระดับ SSS!` (Comic ID: `657755`) — Ch 15
5. `ซัมมอนเนอร์ภัยพิบัติ: ขอบัญชาการอภิมหาบอสล้างโลก!` (Comic ID: `657981`) — Ch 9

สามารถรันทั้งหมดได้ด้วย:
```bat
RUN_TENCENT_1CLICK_ALL_PENDING.bat > test_output\all_pending_YYYYMMDD.log 2>&1
```

## 6. ตัวเปิด

| ไฟล์ | คำสั่งภายใน | หมายเหตุ |
| --- | --- | --- |
| `RUN_TENCENT_1CLICK_ALL_PENDING.bat` | `python tools\tencent_ldplayer_pipeline.py --all-pending` | ทำงานทุกตอนที่ค้าง, ไม่มี log ของตัวเอง → ต้อง redirect เอง, cooldown 20s, **ไม่** เปิด/ปิด LDPlayer |
| `RUN_TENCENT_PIPELINE.bat <args>` | ส่ง args ต่อตรง ๆ | ข้ามเมนู ใช้เมื่อต้องการกำหนดเอง |

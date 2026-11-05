# 📋 MangaHub Project Handover & Next Tasks
> **บันทึกสถานะงานและการส่งมอบโปรเจกต์ (สำหรับย้ายเครื่องทำงานต่อ / Machine Transition)**  
> *วันที่อัปเดต: 5 พฤศจิกายน 2569 (2026-11-05)*

---

## 1. สรุปภาพรวมงานที่ทำเสร็จสมบูรณ์แล้ว (Completed Milestones)

### 🏆 ระบบ AI Auto OCR Pipeline, Auto-Chaining Queue & QC ดึงคำ Default สำเร็จสมบูรณ์ 100% (5 พ.ย. 2569)

#### 1. รายละเอียดระบบที่ติดตั้งและขึ้นระบบจริง:
1. **ระบบ AI Auto OCR บน GitHub Actions (`.github/workflows/gdrive_ocr.yml` & `tools/gdrive_ocr_job.py`)**:
   - เชื่อมต่อ Google Drive สกัดภาพและดึงคำอัตโนมัติด้วย Manga OCR + EasyOCR แปลงเป็นไฟล์โปรเจกต์ MangaToolPlus (`.mtp`)
   - อัปโหลดไฟล์ `.mtp` กลับไปยัง Google Drive โฟลเดอร์ต้นทาง และแจ้ง GAS ให้ผูกลิงก์ `[mtp]` ลงในช่อง `worklink` ของ WorkQueue อัตโนมัติ
   - เพิ่มการทำความสะอาดชื่อไฟล์ (`sanitize_filename`) ป้องกันอักขระต้องห้ามของ NTFS/GitHub Artifacts (เช่น `:`, `"`, `<`, `>`, `|`, `*`, `?`)
   - สั่งเคลียร์ Workspace Runner (`rm -rf`) ทุกครั้งหลังรันเสร็จ เพื่อความสะอาดและปลอดภัย
2. **ระบบ Auto-Chaining Queue (รันลูกโซ่อัตโนมัติ)**:
   - ปรับปรุง `completeMangaOcr` ใน GAS ให้สั่งยิงคิวถัดไป (`triggerNextPendingMangaOcr`) ทันทีที่ตอนก่อนหน้าเสร็จสมบูรณ์
   - ส่งผลให้ระบบประมวลผลต่อเนื่องอัตโนมัติ (Self-advancing queue) รันผ่านไปแล้วกว่า 38 ตอนต่อเนื่องโดยไม่ต้องกดเอง
3. **Banner สถานะ Real-Time บนหน้าคิวงาน (`AutoOcrStatusBanner.tsx`)**:
   - แสดงสถานะการรันสดจาก GitHub Actions API สถิติคิวงาน (เสร็จแล้ว, กำลังทำ, รอเริ่ม, ข้าม) ลิงก์ดู Log สด และปุ่มสั่งรันด้วยมือ
   - Auto-Refresh หน้าตารางคิวงานทันทีเมื่องานใน GitHub Actions รันเสร็จสิ้น
4. **แยกขั้นตอน 2. ดึงคำออโต้ ออกจาก 3. QC ดึงคำ (`QueueView.tsx`)**:
   - เพิ่มคอลัมน์ `2. ดึงคำออโต้` แยกออกจาก `3. QC ดึงคำ` อย่างชัดเจน
   - กฎ Kikkuk: ถ้า Kikkuk QC ดึงคำเสร็จแล้ว $ightarrow$ ดึงคำออโต้ตั้งเป็น `skip`
   - กฎ Pratchaya: ถ้าผู้แปลเป็น Pratchaya $ightarrow$ ข้ามทั้งดึงคำออโต้และ QC ดึงคำ (`skip`) ทันที
5. **ระบบคิดเงินค่าจ้าง (Expenses & Financials)**:
   - ตรวจสอบและยืนยันการคิดเงินค่าตอบแทน: เงินค่าจ้างดึงคำ (10 บาท/ตอน) **คิดอยู่ที่ขั้นตอน `3. QC ดึงคำ` (`extractorname` / `extractstatus`) 100%**
   - ขั้นตอน `2. ดึงคำออโต้` ทำงานโดย AI บอท GitHub Actions จึงไม่มีค่าใช้จ่าย/ไม่มีค่าจ้าง
   - ปรับปรุง Label ในหน้ารายจ่าย (`ExpensesView.tsx`) และหน้าแรก (`DashboardView.tsx`) ให้แสดงเป็น `"QC ดึงคำ"` ทั้งหมด
6. **ตั้งค่า Default QC ดึงคำ เป็น "Kikkuk" ทั้งระบบ**:
   - รัน Batch Update บน Google Sheet WorkQueue อัปเดตข้อมูลเก่าที่ช่อง `extractorname` ยังว่างอยู่ 554 แถว ให้เป็น `"Kikkuk"` ครบถ้วน (ปัจจุบันมี 2,159 แถวเป็น Kikkuk)
   - ปรับ Backend (`addQueue`, `getWorkQueue`) และ Frontend (`AddQueueModal`, `EditQueueModal`, `QueueView`) ให้มีค่าเริ่มต้นเป็น `"Kikkuk"` เสมอ

---

### 🏆 แก้ไขปัญหา "กดตรวจสอบทั้งหมด แต่ยังเป็น NaN ในหน้าติดตามต้นฉบับอัปเดต (Raw Tracker)" สำเร็จสมบูรณ์ 100% (4 พ.ย. 2569)

#### 1. สาเหตุของปัญหา (Root Causes Analysis):
1. **การแปลงตัวเลขแบบเปราะบาง (Fragile String-to-Number Parsing)**:
   - ฟังก์ชันคำนวณในหน้า `RawTrackerView.tsx` (`handleCheckSingle`, `getTrackerUrgency`, และ metrics comparison) ใช้ `parseFloat(String(item.currentChapter))` หรือ `Number(item.currentChapter)` โดยตรง
   - เมื่อข้อมูลตอนที่บันทึกไว้ในระบบมีตัวอักษรภาษาไทย/อังกฤษ/จีน (เช่น `"ตอนที่ 120"`, `"Chapter 73"`, `"第277话"`, `"共366篇正文"`) หรือมีค่าสตริง `"NaN"`:
     - `parseFloat("ตอนที่ 120")` จะหยุดอ่านตั้งแต่ตัวอักษรแรกที่มิใช่ตัวเลข และคืนค่าเป็น `NaN`
     - ส่งผลให้ `diff` (ผลต่างจำนวนตอนใหม่) และตัวเลขที่แสดงในการ์ด/ตารางแสดงผลเป็น `NaN` ทันที
2. **การคำนวณ `totalPendingChapters` ล้มเหลวจาก `Math.max(1, u.diff)`**:
   - หากมีรายการมังงะแม้แต่เรื่องเดียวที่ `u.diff` เป็น `NaN`, คำสั่ง `Math.max(1, NaN)` ใน JavaScript จะได้ผลลัพธ์เป็น `NaN` ทันที
   - ส่งผลให้ผลรวมตอนใหม่ค้างทั้งระบบ (`totalPendingChapters`) กลายเป็น `NaN` และตัวเลขบนปุ่ม `⚡ อัป raw & ลงคิวงานอัตโนมัติ` แสดงเป็น `NaN`
3. **การแสดงผลสตริง `"NaN"` บน UI โดยไม่มี Fallback**:
   - ใน Card View และ Table View มีการแสดง `{item.lastrawcount || "-"}` และ `{item.currentChapter || "-"}`
   - เนื่องจาก `"NaN"` ใน JavaScript เป็นสตริงที่ไม่ว่างเปล่า (Truthy) จึงไม่ผ่าน Fallback `|| "-"` ทำให้หน้าจอแสดงคำว่า `NaN` ตรงตัว
   - Badge แสดงผลมีโค้ด `มีตอนใหม่ (+${u.diff} ตอน)` ซึ่งเมื่อ `u.diff` เป็น `NaN` จะกลายเป็น `มีตอนใหม่ (+NaN ตอน)`

#### 2. สิ่งที่ดำเนินการแก้ไข (Comprehensive Fixes Applied):
1. **สร้างชุดฟังก์ชัน Utility กลางป้องกัน NaN (`frontend/src/lib/utils.ts`)**:
   - `parseChapterNumber(val)`: สกัดตัวเลขตอนจากทุกรูปแบบข้อความ (รวมถึง `"ตอนที่ 120"`, `"Chapter 73"`, `"共366篇正文"`, `"第277话"`) พร้อมการันตี 100% ว่าไม่มีทางคืนค่า `NaN` (คืนค่า `0` เมื่อเป็น `null/undefined/NaN/"NaN"`)
   - `formatChapterDisplay(val, fallback)`: แปลงค่าเลขตอนสำหรับแสดงผลบน UI อย่างปลอดภัย หากเป็น `"NaN"` หรือค่าผิดปกติ จะคืนค่า fallback (เช่น `"-"` หรือ `"0"`) อย่างสวยงาม
   - `sanitizeTrackerStatus(status, safeDiff)`: ทำความสะอาดข้อความสถานะ ป้องกันไม่ให้มี `(+NaN ตอน)` หลุดออกไปแสดงผลบนตารางและ Badge
2. **ปรับปรุง `frontend/src/components/views/RawTrackerView.tsx`**:
   - ฟังก์ชัน `handleCheckAll`: ครอบการอ่าน `res.newUpdatesCount` ด้วย `parseChapterNumber` ป้องกัน Toast แสดง `NaN เรื่อง`
   - ฟังก์ชัน `handleCheckSingle`: สกัดเลขตอนด้วย `parseChapterNumber` ทั้งระบบในระบบ, ต้นฉบับเดิม และต้นฉบับใหม่ พร้อมคำนวณ `diff` และปัดเศษทศนิยมอย่างปลอดภัย
   - ฟังก์ชัน `getTrackerUrgency`: คำนวณ `currentChap`, `rawChap`, และ `diff` อย่างรัดกุม รองรับ regex extraction เมื่อมีข้อความสถานะ `มีตอนใหม่ (+... ตอน)`
   - ฟังก์ชัน `totalPendingChapters`: ป้องกัน `Math.max(1, NaN)` ด้วยการกรอง `diffVal` ให้เป็นตัวเลขจริงเสมอ
   - Card View & Table View: ปรับเปลี่ยนการแสดงผล `lastrawcount`, `currentChapter`, และ `diff` ให้เรียกผ่าน `formatChapterDisplay` และ `sanitizeTrackerStatus` ทุกจุด
3. **ปรับปรุง Backend Google Apps Script (`backend/Code.js`)**:
   - ใน `scrapeRawUrl`: ป้องกัน `chapterCount` ไม่ให้คืนค่า `NaN`
   - ใน `checkAllRawTrackers`: ตรวจสอบและแปลง `newCount`, `systemChap` ด้วย regex extraction และป้องกัน `diff` ไม่ให้เป็น `NaN`
   - ใน `getRawTrackerList`: ทำความสะอาดข้อมูลเก่าที่มีสตริง `NaN` ในชีต `RawTracker` ให้อัตโนมัติ แปลงเป็น `"เป็นปัจจุบัน"`
4. **ปรับปรุง `frontend/src/components/modals/AutoRawPipelineModal.tsx`**:
   - แปลง `t.chapterNum` ด้วย `parseChapterNumber` เมื่อดึงรายการตอนใหม่

#### 3. ผลการทดสอบและตรวจสอบ (Verification):
- รัน Unit Test ครอบคลุมทุก Edge Cases (`"120"`, `"ตอนที่ 120"`, `"Chapter 73"`, `"共366篇正文"`, `"第277话"`, `"NaN"`, `NaN`, `null`, `undefined`, `มีตอนใหม่ (+NaN ตอน)`) ผลลัพธ์ผ่าน 100%
- คอมไพล์โปรเจกต์ Frontend (`npm run build`) ผ่านสมบูรณ์ ไร้ข้อผิดพลาด TypeScript/Vite (`built in 3.56s`)

---

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: ตัดระบบสไลด์หน้าจออ่าน (Swipe Fallback) ทิ้ง 100% ตามคำสั่ง USER เหลือเพียง "Native Offline Download / Export" วิธีเดียวเพียวๆ (4 พ.ย. 2569)

#### 1. สาเหตุและที่มาของการแก้ไข:
- **USER Mandate**: *"ผมว่าแปลกๆ ละ มันยังใช้การสไลด์อยู่เลย มันต้องเหลือ export วิธีเดียวสิ"*
- **Root Cause**: เดิมใน `tools/tencent_ldplayer_pipeline.py` เมื่อ `trigger_native_offline_download` เกิด timeout ระบบจะกระโดดเข้าไปทำงานในบล็อกสำรอง (Fallback) ที่เรียก `ComicReaderActivity` แล้วสั่ง `input swipe 450 1350 450 250 70` จำนวน 28 ครั้ง
- **การแก้ไขขั้นเด็ดขาด**:
  1. ลบโค้ดส่วน Reader Navigation และลูป `input swipe` จำนวน 28 ครั้งทั้งหมดออกจาก `execute_pipeline_for_chapter` แบบถอนรากถอนโคน
  2. ลบ `navtochapter` RPC ออกจาก Frida script เหลือเพียง `opendlselect` สำหรับหน้าดาวน์โหลดออฟไลน์เท่านั้น
  3. ปรับปรุง `opendlselect` ให้ใส่ Intent Flags `FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK | FLAG_ACTIVITY_CLEAR_TOP` (`0x10000000 | 0x00008000 | 0x04000000`) เพื่อบังคับให้แอนดรอยด์เคลียร์หน้ามังงะเรื่องเก่าทิ้งและเปิดเรื่องใหม่เสมอ ไม่เกิดปัญหาค้างหน้าเดิม
  4. เพิ่มการส่ง `seq_no` ควบคู่กับ `chapter_num` เพื่อให้ `find_chapter_seq_coords` ค้นหาปุ่มตอนบน `DownloadChapterSelectActivity` ได้แม่นยำ 100% แม้เป็นเรื่องที่มีตอนพิเศษ/บทนำคั่น
  5. บันทึกไฟล์อัตโนมัติลงใน Windows Disk:
     - 20 หน้ามาตรฐาน (`001.jpg` – `020.jpg`) สร้างชั่วคราวเพื่ออัปโหลด
  6. **Auto-Cleanup บนเครื่องคอมพิวเตอร์หลังอัปโหลดเสร็จ (ตามคำสั่ง USER)**:
     - ทันทีที่การอัปโหลดไฟล์ภาพเข้า Google Drive และบันทึกคิว GAS WorkQueue สำเร็จ ระบบจะลบโฟลเดอร์ภาพชั่วคราว (`downloads\{clean_manga}_{clean_ch}\` และ `downloads\offline_raw\{comic_id}_{chapter_id}\`) บนคอมพิวเตอร์ทิ้งอัตโนมัติทันที 100% ไม่เปลืองพื้นที่ฮาร์ดดิสก์
  7. หากการดาวน์โหลดออฟไลน์ไม่สำเร็จ จะไม่มีการย้อนกลับไปเลื่อนหน้าจออ่านเด็ดขาด แต่จะรายงานข้อผิดพลาดและข้ามไปอย่างปลอดภัย

#### 2. ผลการทดสอบ Live Verification บน Comic 657044 (ข้าขอท้าผนึกสวรรค์ / 我欲封天) ตอนที่ 55:
- สั่งรัน: `python tools/tencent_ldplayer_pipeline.py --comic-id 657044 --chapter 55`
- ผลลัพธ์:
  - สกัดไฟล์ `_image_info_list` และชิ้นส่วนภาพดิบ 52 ชิ้นจาก Native Offline Engine สำเร็จใน 3 วินาที (Zero Swipes!)
  - เย็บ Canvas 1200 x 94916 px และซอยเป็น 20 หน้ามาตรฐาน
  - อัปโหลดเข้า Google Drive: `https://drive.google.com/drive/folders/1Fvgf78kU1W8Fw987LlKfZOhcru0Od8cN`
  - บันทึก WorkQueue สำเร็จ: `[อัป Raw] https://drive.google.com/drive/folders/1Fvgf78kU1W8Fw987LlKfZOhcru0Od8cN`, Uploader: `Apt`, Status: `เสร็จแล้ว`
  - อัปเดต RawTracker & Mangas ตอนที่ 55 สำเร็จสมบูรณ์ 100%
  - เคลียร์โฟลเดอร์ภาพบนคอมพิวเตอร์เรียบร้อยสะอาดหมดจด (Cleaned up: `我欲封天_55` และ `offline_raw`)

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: ระบบสั่งดาวน์โหลดออฟไลน์แท้จริง (Native Offline Download 100%) แทนที่การเลื่อนหน้าจออ่าน (Swipe) ไร้ความเสี่ยงหน้าขาด + ความเร็วสูงขึ้น 5 เท่า (4 พ.ย. 2569)

#### 1. วิเคราะห์ปัญหาเดิมและแนวทางแก้ไขตามคำสั่ง USER:
- **ปัญหาของวิธีเดิม**: การเปิดหน้าอ่าน (`ComicReaderActivity`) แล้วสั่งเลื่อนหน้าจอลงเรื่อยๆ (`input swipe ...`) ช้า ไม่เสถียร เสี่ยงต่อการติดหน้าต่าง Popup และมีความเสี่ยงสูงที่ RecyclerView/Glide จะโหลดชิ้นส่วนภาพไม่ครบ 100% หากเลื่อนเร็วเกินไป
- **แนวทางใหม่ (Native Offline Download)**:
  - สั่งให้แอป Tencent Comic ทำการ "ดาวน์โหลดออฟไลน์" (Native Download / 缓存 / 离线下载) ของตอนเป้าหมายโดยตรง
  - เปิด Activity หน้าเลือกดาวน์โหลด (`DownloadChapterSelectActivity`) ผ่าน Frida In-Process Intent
  - ตรวจหาเลขตอนเป้าหมาย รองรับทั้งการเรียงลำดับปกติและแบบกลับด้าน (`倒序`), ติ๊กเลือกตอน, กดปุ่ม `下载所选` (Download Selected), และกดตกลง `是的` (Confirm)
  - ตัวแอป Engine ของ Tencent จะดึงชิ้นส่วนภาพทั้งหมด 100% พร้อมบันทึกไฟล์ Ground Truth `_image_info_list` ลงที่:
    `/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/_image_info_list` โดยอัตโนมัติภายใน 2-8 วินาที โดยไม่ต้องเลื่อนหน้าจออ่านแม้แต่ครั้งเดียว (Zero Swipe)!

#### 2. สิ่งที่พัฒนาและปรับปรุงใน `tools/tencent_ldplayer_pipeline.py`:
1. **Frida RPC Handler `opendlselect`**:
   - เพิ่ม RPC function `opendlselect(comicId)` เรียก `startActivity` ไปยัง `com.qq.ac.android.view.activity.DownloadChapterSelectActivity` พร้อมใส่ Extra `STR_MSG_COMIC_ID` และ `STR_MSG_FROM = 1`
2. **ฟังก์ชันค้นหาพิกัดและทิศทาง `find_chapter_seq_coords`**:
   - วิเคราะห์ Hierarchy XML ของหน้า `DownloadChapterSelectActivity` เพื่อดึงพิกัดกึ่งกลาง (Center X, Y) ของเลขตอนที่ต้องการใน `com.qq.ac.android:id/seq`
   - ตรวจจับสถานะการเรียงลำดับ (正序 / 倒序) และคำนวณทิศทางการเลื่อน ListView อัตโนมัติหากตอนนั้นยังไม่อยู่ในหน้าจอ
3. **ฟังก์ชัน `trigger_native_offline_download`**:
   - ทำงานเป็น Pipeline ดึงภาพออฟไลน์อัตโนมัติ: ล้างหน้าต่างเดิม -> เปิดหน้าดาวน์โหลด -> เลือกตอน -> กดดาวน์โหลด -> กดยืนยันไดอะล็อก -> Polling รอไฟล์ `_image_info_list` (สำเร็จใน ~5-8 วินาที)
4. **อัปเกรด `execute_pipeline_for_chapter`**:
   - กำหนดให้ Native Offline Download เป็นกลไกหลักอันดับ 1 แทนที่การ swipe
   - เมื่อได้ไฟล์ `_image_info_list` จะนำ URLs ที่เรียงตาม `localIndex` ไปดาวน์โหลดภาพ 1200px JFIF คู่ขนาน 10 Workers, เย็บต่อบน Continuous Virtual Canvas, ซอยเป็น 20 หน้ามาตรฐาน, และอัปโหลด Drive ทันที

#### 3. ผลการทดสอบ Live Verification บน LDPlayer:
- **ทดสอบตอนที่ 123 ของเรื่อง 《异狱暴君：我的影子能无限进化》 (Comic ID: `656737`, CID: `155600`, Manga ID: `24`)**:
  - สั่งเปิด `DownloadChapterSelectActivity` และค้นพบตอน 123 ที่พิกัด `(741, 1267)`
  - กดเลือกตอนและกด `下载所选` -> ยืนยันไดอะล็อก `是的`
  - ตรวจพบไฟล์ `_image_info_list` และภาพดิบ 56 ชิ้น (12.6 MB) สร้างเสร็จในเวลาเพียง **7 วินาที** โดยไม่มีการ Swipe เลยแม้แต่ครั้งเดียว
  - สกัด 56 Slices เรียงตาม `localIndex: 0..55` สมบูรณ์ 100%
  - ประกอบ Continuous Canvas: กว้าง 1200px x สูง 102,616px
  - สไลซ์เป็น 20 หน้ามาตรฐาน (`001.jpg` – `020.jpg`) คุณภาพ 95
  - อัปโหลดเข้า Google Drive โฟลเดอร์: `https://drive.google.com/drive/folders/1F2fZq4gs_dY-8Zy3ybxOnwK1oF2sSQx1`
  - บันทึกลง GAS WorkQueue (`[อัป Raw] https://drive.google.com/drive/folders/1F2fZq4gs_dY-8Zy3ybxOnwK1oF2sSQx1`, Uploader: `Apt`, Status: `เสร็จแล้ว`)
  - อัปเดต RawTracker & Mangas ตอนที่ 123 สำเร็จสมบูรณ์

---

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: กำหนด Default Mode เป็น "ดูดงานค้างทั้งหมด QQ เท่านั้น" 1-Click Zero Friction (4 พ.ย. 2569)

#### 1. ปรับปรุง `RUN_TENCENT_PIPELINE.bat`:
- **ตั้งค่าเมนู [1] เป็น Default**: ปรับเปลี่ยนโครงสร้างเมนูให้ตัวเลือกที่ 1 คือ `[1] Download All Pending QQ / Tencent Jobs (Default - Press Enter)`
- **กด Enter ผ่านได้ทันที (Zero Friction Flow)**:
  - เมนูหลัก: หากกด Enter โดยไม่พิมพ์อะไร ระบบจะเลือกข้อ `[1]` อัตโนมัติ (`set MENU_CHOICE=1`)
  - หน้ากรอง Comic ID: หากกด Enter จะถือว่าเลือกมังงะ Tencent/QQ ทั้งหมดในระบบ (`FILTER_COMIC=""`)
  - หน้าสอบถาม Hide LDPlayer: หากกด Enter จะเลือก `N` (ค่าเริ่มต้นมาตรฐาน)
  - ผู้ใช้สามารถกด `Enter -> Enter -> Enter` เพื่อเริ่มดาวน์โหลดงานค้างทั้งหมดของ Tencent ได้ทันที
- **จัดเรียงเมนูใหม่ตามลำดับความสำคัญ**:
  - `[1] Download All Pending QQ / Tencent Jobs (Default - Press Enter)`
  - `[2] Download Specific Chapter(s) (e.g. 22 or 22-25)`
  - `[3] View Pending Jobs Summary / Dry-Run (Check QQ Pending List)`
  - `[4] Run Default Test Chapter (Wu Shen Chong Sheng, Ch 22)`
  - `[5] Custom Command Line Arguments`
  - `[6] Exit`
- **ระบบ Clean Sanitization**: ตัด Whitespace อัตโนมัติ (`%VAR: =%`) ป้องกันการพิมพ์เว้นวรรคผิดพลาด และใช้ Pure ASCII เพื่อความปลอดภัยสูงสุดกับ `cmd.exe`

#### 2. เสริมความปลอดภัยและการกรองเฉพาะ QQ ใน `tools/tencent_ldplayer_pipeline.py`:
- **Strict Isolation (คัดกรองเฉพาะ Tencent/QQ เท่านั้น 100%)**:
  - ปรับปรุงฟังก์ชัน `query_pending_gas_queue()` ทั้ง 3 ส่วน (WorkQueue, RawTracker Pending API, และ RawTracker List)
  - เพิ่มเงื่อนไขตัดสิทธิ์ (Negative Filter) แพลตฟอร์มอื่นทั้งหมดอย่างเข้มงวด: ตรวจสอบและข้าม (Skip) รายการที่มีโดเมนหรือ Connector ของ `kuaikanmanhua.com`, `kuaikan`, `thunderscans`, `colamanga`, หรือ `baozimh` ทันที
  - ตรวจสอบเฉพาะ URL ที่มี `ac.qq.com` หรือ `qq.com` หรือ Connector ที่เป็น `tencent` หรือ `qq` เท่านั้น
- **Default CLI Behavior**:
  - หากรันสคริปต์ `python tools/tencent_ldplayer_pipeline.py` โดยไม่ระบุเลขตอน (`--chapters` / `--chapter`), ไฟล์ (`--urls-file` / `--info-file`), หรือ `--dry-run` ระบบจะเปิดโหมด `--all-pending` ให้โดยอัตโนมัติ พร้อมแจ้งเตือนใน Console Log

---

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: ระบบตรวจจับคิวตอนใหม่อัตโนมัติจาก RawTracker & WorkQueue สำหรับ Tencent Comic (ตรวจพบครบ 14 เรื่อง 37 ตอน) (4 พ.ย. 2569)

#### 1. วินิจฉัยสาเหตุที่โหมด `--all-pending` รายงานว่า "ไม่พบงาน":
1. **คิวใน WorkQueue ยังไม่ถูกสร้าง**: ในตาราง WorkQueue จะมีแถวงานก็ต่อเมื่อมีแอดมินหรือผู้ใช้กดปุ่ม "+ ลงคิวงาน" สำหรับตอนนั้นๆ หากเป็นตอนใหม่ที่ระบบเพิ่งตรวจพบจากหน้า "ติดตามต้นฉบับ" (RawTracker) จะยังไม่มีรายการใน WorkQueue
2. **`WorkQueue` เก็บเฉพาะ `mangaid`**: ไม่มีฟิลด์ `rawurl` อยู่ในแถว WorkQueue ทำให้สคริปต์เดิมไม่สามารถตรวจสอบได้ว่ารายการนั้นเป็นการ์ตูนของ Tencent หรือไม่ หากไม่ได้แมป `mangaid` กับตาราง Mangas
3. **ตรวจสอบ WorkLink ไม่ยืดหยุ่น**: สคริปต์เดิมใช้ `link.startswith("[อัป Raw]")` แต่ในกรณีที่มีขั้นตอนอื่นนำหน้า (เช่น `[ดึงคำ]` หรือ `[แปล]`) ลิงก์ `[อัป Raw]` จะอยู่บรรทัดถัดไป
4. **GAS `GET_RAW_TRACKER_PENDING_CHAPTERS` รองรับเฉพาะ KuaiKan**: ใน `backend/Code.js` ฟังก์ชันเดิมมีเงื่อนไข `if (isKuaikan)` เท่านั้น ทำให้เมื่อเรียกด้วย Tencent จะได้ผลลัพธ์เป็นอาร์เรย์ว่าง `[]` เสมอ
5. **ไม่เคยอ่าน `GET_RAW_TRACKER_LIST` โดยตรง**: ข้อมูลตอนใหม่ของทั้ง 14 เรื่องถูกคำนวณและแสดงผลอยู่ใน `GET_RAW_TRACKER_LIST` (โดยเทียบ `lastrawcount > currentChapter`) แต่สคริปต์เดิมไม่ได้ดึงเอนด์พอยต์นี้มาประมวลผล

#### 2. สิ่งที่พัฒนาและปรับปรุง:
1. **ยกระดับฟังก์ชัน `query_pending_gas_queue()` ใน `tools/tencent_ldplayer_pipeline.py`**:
   - **ดึง `GET_MANGA_LIST` ล่วงหน้า**: เพื่อสร้าง Map เชื่อมโยง `mangaid` -> `originalurl` และชื่อเรื่องอย่างแม่นยำ
   - **ตรวจสอบ `WorkQueue` อย่างถูกต้อง**: รองรับลิงก์หลายบรรทัด (`[อัป Raw]` อยู่ที่บรรทัดใดก็ได้) และตรวจสถานะ `uploadstatus != 'เสร็จแล้ว'`
   - **ดึง `GET_RAW_TRACKER_PENDING_CHAPTERS`**: รองรับงานที่ส่งมาจากระบบ Pending API
   - **ดึง `GET_RAW_TRACKER_LIST` โดยตรง**: สแกนหาการ์ตูน Tencent (`ac.qq.com` หรือ `qq.com`) ที่มีสถานะมีตอนใหม่ หรือ `lastrawcount > currentChapter`
   - **คำนวณช่วงตอนที่ต้องดูดให้อัตโนมัติ**: สร้าง Task ย่อยสำหรับตอนที่ `int(currentChapter) + 1` จนถึง `int(lastrawcount)`
   - **Deduplication**: ป้องกันตอนซ้ำซ้อนระหว่าง WorkQueue และ RawTracker ด้วย `(comic_id, chapter)` key
2. **เพิ่มระบบ Dry-Run และ Filter ใน `tencent_ldplayer_pipeline.py`**:
   - เพิ่ม CLI Flag `--dry-run`: ตรวจสอบและแสดงรายการตอนใหม่ทั้งหมดที่รอประมวลผล จัดกลุ่มตามเรื่อง โดยไม่ต้องเปิด LDPlayer หรือรัน Frida
   - เพิ่มการกรองตอนค้างด้วย `--comic-id`, `--manga-id`, และ `--manga-name` เมื่อใช้งานร่วมกับ `--all-pending`
   - เพิ่มการเรียก `COMPLETE_RAW_TRACKER_CHAPTER` อัตโนมัติหลังอัปโหลดเสร็จสิ้น เพื่ออัปเดต `currentChapter` และ `status` ใน RawTracker & Mangas ทันที
3. **ปรับปรุง `backend/Code.js`**:
   - เพิ่มการรองรับ Tencent (`ac.qq.com` / `qq.com`) และ Connector ทั่วไปในฟังก์ชัน `getRawTrackerPendingChapters()`
4. **อัปเกรด `RUN_TENCENT_PIPELINE.bat`**:
   - เมนูตัวเลือก [2] เปลี่ยนเป็น `Download All Pending Jobs from RawTracker & WorkQueue (--all-pending)` พร้อมถาม Filter Comic ID
   - เพิ่มเมนูตัวเลือก [3] `View Pending Jobs Summary / Dry-Run (--dry-run)`

#### 3. ผลการทดสอบ Live Verification (`--dry-run`):
- ตรวจพบตอนใหม่ที่รอดูดครบถ้วน 100% ตรงตามภาพหน้าจอของ MangaHub:
  - **รวมมังงะ Tencent ทั้งสิ้น: 14 เรื่อง**
  - **รวมตอนใหม่ที่ต้องดูดทั้งหมด: 37 ตอน**
    1. ทรราชวิวัฒนาการได้ไร้ขีดจำกัดแห่งแดนทมิฬ (Comic ID: `656737`): 3 ตอน (Ch 121, 122, 123)
    2. ข้าขอท้าผนึกสวรรค์ (Comic ID: `657044`): 2 ตอน (Ch 54, 55)
    3. เกิดใหม่ในแดนวีรบุรุษริมวารี ข้านี่แหละอู่ต้าหลางที่แข็งแกร่งที่สุด! (Comic ID: `656856`): 3 ตอน (Ch 104, 105, 106)
    4. เทพสงครามคืนบัลลังก์ (Comic ID: `657151`): 1 ตอน (Ch 46)
    5. มหาปรจารย์ระดับเทพแห่งนคร (Comic ID: `657544`): 2 ตอน (Ch 30, 31)
    6. พลิกอักษรเปลี่ยนสกิลบงการโลกจนยับเยิน (Comic ID: `657528`): 2 ตอน (Ch 33, 34)
    7. นักรบระดับ SSS ขอหวนคืนมาเป็นราชา (Comic ID: `657529`): 2 ตอน (Ch 32, 33)
    8. พี่ชายของผมคือหมาบ้า (Comic ID: `657728`): 5 ตอน (Ch 38, 39, 40, 41, 42)
    9. ยุคเปลี่ยนอาชีพ: ผู้หลอมรวม เปิดฉากฟิวชั่นกองทัพอันเดด! (Comic ID: 657631): 3 ตอน (Ch 27, 28, 29)
    10. สกิลไร้คูลดาวน์? งั้นข้าขอจุติเป็นภัยพิบัติอันเดด! (Comic ID: `657540`): 5 ตอน (Ch 15, 16, 17, 18, 19)
    11. ยอดอัจฉริยะอหังการ์ (Comic ID: `657666`): 2 ตอน (Ch 18, 19)
    12. ราชันย์แห่งยมโลก: ข้านี่แหละคือห้วงอเวจี! (Comic ID: `657781`): 3 ตอน (Ch 13, 14, 15)
    13. กำเนิดใหม่ไซอิ๋ว: มหาปราชญ์กระดูกขาวไร้เทียมทาน! (Comic ID: `657368`): 2 ตอน (Ch 26, 27)
    14. มหาสงครามสัตว์อสูร: เปิดเกมมาข้าก็คว้าพรสวรรค์ระดับ SSS! (Comic ID: `657755`): 2 ตอน (Ch 13, 14)

---

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: ระบบสกัดลำดับภาพแท้จริงจาก Offline `_image_info_list` (แก้ปัญหา Sequence ID สลับตำแหน่ง 22 จุด) และ Live Verification ตอนที่ 278 (4 พ.ย. 2569)

#### 1. ค้นพบสาเหตุที่แท้จริง: ทำไมการเรียงด้วย Sequence ID ในชื่อไฟล์จึง "ไม่ได้ผล"
- **การทดลองและวิเคราะห์เชิงลึก**:
  - เมื่อนำลำดับ Sequence ID ใน URL ของ Tencent CDN (เช่น `_136483372.jpg` ถึง `_136483440.jpg`) มาเทียบกับลำดับการอ่านจริง พบว่ามี **Inversion (ตำแหน่งสลับกัน) สูงถึง 22 จุด!**
  - Tencent มีการอัปโหลดไฟล์ชิ้นส่วนภาพขึ้น CDN แบบคู่ขนานและกระจายเซิร์ฟเวอร์ ทำให้ตัวเลข Sequence ท้ายชื่อไฟล์ไม่ตรงกับลำดับบน-ลง-ล่างของการ์ตูน (เช่น ป้ายชื่อตอนด้านบนกลับได้ Sequence ID สูงกว่าเนื้อหาตอนกลาง ส่งผลให้ภาพหัวตอนกระโดดไปอยู่หน้า 3)
  - ดังนั้น **การใช้ Regex เรียงตาม Sequence ID จึงทำให้หน้าการ์ตูนเรียงสลับไปมาอย่างหลีกเลี่ยงไม่ได้**

#### 2. ทางออกที่ถูกต้อง 100%: การใช้ `_image_info_list` เป็น Canonical Ground Truth
- **โครงสร้างไฟล์ `_image_info_list`**:
  - เก็บอยู่ใน LDPlayer พาธ `/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/_image_info_list`
  - ข้อมูลถูกเข้ารหัส Base64 โดยไบต์ 0–15 คือ binary salt/checksum และตั้งแต่ไบต์ 16 เป็นต้นไปคือ JSON UTF-8
  - ฟิลด์ที่สำคัญที่สุดคือ **`localIndex` (0, 1, 2, ..., N-1)** ซึ่งเป็นลำดับการอ่านจริงจากบนลงล่าง 100% ตรงตามที่คอมไพเลอร์และเอนจินของ Tencent Comic App ใช้งาน
- **สกัดและดึงภาพความละเอียดสูงโดยตรงจาก Tencent CDN**:
  - ถอดรหัส JSON และดึง `current_img_url` เรียงลำดับอย่างเคร่งครัดตาม `localIndex`
  - ตัดพารามิเตอร์ `?tp=sharp` ออก และเติม `/1200` ทำให้สามารถดาวน์โหลดภาพดิบ JPEG มาตรฐาน (1200px JFIF) ตรงจาก Tencent CDN ด้วยความเร็วสูงโดยไม่ต้องพึ่งพาตัวถอดรหัส SharpP พิเศษ

#### 3. ปรับปรุง Pipeline ใน `tools/tencent_ldplayer_pipeline.py`
- **เพิ่มฟังก์ชัน `extract_urls_from_image_info_list`**: ถอดรหัสและแยก URL ชิ้นส่วนภาพเรียงตาม `localIndex` อย่างแม่นยำ
- **เพิ่มฟังก์ชัน `check_offline_image_info_list`**: ตรวจจับไฟล์ `_image_info_list` จาก LDPlayer อัตโนมัติ หากมีตอนที่ดาวน์โหลดออฟไลน์ไว้ จะดึงมาใช้เป็นลำดับหลักอันดับแรกทันที
- **เพิ่ม CLI Flag `--info-file` และ `--folder-url`**: รองรับการนำเข้าไฟล์ `_image_info_list` แบบ Standalone เพื่อตัดต่อและอัปโหลดได้ทันที
- **Continuous Virtual Canvas & 20 Standard Pages Uniform Slicing**:
  - นำชิ้นส่วนทั้ง 69 ชิ้นมาประกอบบนผืนผ้าใบเสมือนจริงขนาดกว้าง 1200px สูง 162,523px
  - สไลซ์ตัดตามแนวดิ่งอย่างแม่นยำเท่ากันเป็น 20 หน้ามาตรฐาน (`001.jpg` - `020.jpg`, Quality 95)

#### 4. ผลการทดสอบ Live Test ตอนที่ 278 ของเรื่อง 《命轮之主！当异变降临人间》 (Comic ID: 655278)
- **ข้อมูลการทำงาน**:
  - Comic ID: `655278` | CID: `156072` (ลำดับใน TOC: 287, ชื่อตอน: `第278话 真正的诡异者`)
  - Manga ID: `14` (ชื่อเรื่องในระบบ: `เจ้ากงล้อแห่งโชคชะตา`)
  - ดาวน์โหลดชิ้นส่วนครบถ้วน 69/69 ชิ้นตาม `localIndex: 0..68` (0 Inversions)
  - ผืนผ้าใบต่อเนื่อง: ขนาด 1200 x 162,523 px
  - สไลซ์เป็น 20 หน้ามาตรฐาน (`001.jpg` - `020.jpg`) ตรวจสอบหน้า 1 มีป้ายหัวตอนชัดเจน และหน้า 20 มีเครดิตท้ายตอนถูกต้องสมบูรณ์
- **ผลการอัปโหลด Google Drive & GAS WorkQueue**:
  - Google Drive Folder: `https://drive.google.com/drive/folders/1tbMRIDxnvGqh35k1SS7aF5vLwkN6ZdO2` (`แปลจนเมื่อย / 命轮之主！当异变降临人间 / 278`)
  - อัปโหลดครบทั้ง 20 ไฟล์ (001.jpg ถึง 020.jpg)
  - WorkQueue Registration สำเร็จสมบูรณ์:
    - **Queue ID**: `1793798032848`
    - **Manga ID**: `14` | **Chapter**: `278`
    - **Uploader Name**: `Apt`
    - **Upload Status**: `เสร็จแล้ว`
    - **Work Link**: `[อัป Raw] https://drive.google.com/drive/folders/1tbMRIDxnvGqh35k1SS7aF5vLwkN6ZdO2`
    - **Note**: `Tencent 1-Click LDPlayer Concat 20 หน้า ลง แปลจนเมื่อย`
    - **Translator**: `ภูมิ` (ดึงจาก Locked Translator ในระบบอัตโนมัติ)

---

### 🏆 ไฮไลท์ความสำเร็จก่อนหน้า: ระบบ Batch & Multi-Chapter LDPlayer Pipeline สำหรับ Tencent Comic พร้อม Full Scroll และ VIP Auto-Purchase (4 พ.ย. 2569)

#### 1. ระบบดึง Chapter List / TOC & Auto Chapter-to-CID Mapping อัตโนมัติ
- **Dynamic TOC Extraction (`fetch_tencent_chapter_list`)**:
  - ดึงข้อมูลสารบัญตอนทั้งหมดจากหน้าเว็บ `https://ac.qq.com/Comic/comicInfo/id/{comic_id}`
  - สกัดบล็อก `<ol class="chapter-page-all">` คัดแยก `cid`, ชื่อตอน และเลขตอน `chapter_num`
  - รองรับทั้งการ์ตูนที่มีเลขตอนแบบมาตรฐาน (เช่น `第22话`) และการ์ตูนที่ไม่มีคำว่า "第/话" โดยแมปตามลำดับ Sequence Index
- **Intelligent Chapter Resolution (`find_chapter_by_spec` & `parse_chapter_spec`)**:
  - ผู้ใช้ไม่ต้องหา `cid` ด้วยมืออีกต่อไป ระบุเพียงเลขตอน (เช่น `22`) ระบบจะแมปเข้ากับ CID ที่แท้จริง (เช่น `139696`) อัตโนมัติ 100%
  - รองรับการป้อนรูปแบบช่วงตอน: `--chapters 22-25` -> ทำงานต่อเนื่องตอนที่ 22, 23, 24, 25
  - รองรับการป้อนรายการตอน: `--chapters 22,23,24` หรือตอนเดี่ยว `--chapters 22`

#### 2. กลไก Full Reader Scroll to Bottom แก้ปัญหาภาพไม่ครบ (41-49 Raw Slices)
- **การค้นพบและแก้ไขจุดบกพร่อง**:
  - ในตัวอ่านแอป Tencent (`ComicReaderActivity`), รูปภาพจะถูกโหลดแบบ Lazy-loading ผ่าน RecyclerView / Glide
  - หากไม่มีการเลื่อนหน้าจอลงจนสุด แอปจะโหลดภาพเฉพาะส่วนบนของหน้าจอ (~5-8 ชิ้น) ทำให้เมื่อนำไปสไลซ์เป็น 20 หน้ามาตรฐาน เนื้อหาจึงขาดช่วงท้ายไป
  - **พัฒนา Continuous Swiping Routine**: รันคำสั่งจำลองการเลื่อนหน้าจอจากบนลงล่างอย่างนุ่มนวลและต่อเนื่อง ตรวจจับเงื่อนไขสิ้นสุดตอน (เมื่อไม่มีภาพใหม่เข้ามาเป็นเวลา 3.5 วินาที) สามารถดึงชิ้นส่วนภาพความละเอียดสูงได้ครบถ้วนทั้งตอน **41-49 ชิ้นเต็มๆ 100%** ก่อนนำไปตัดเย็บบน Virtual Canvas เป็น 20 หน้ามาตรฐาน

#### 3. ระบบ Auto VIP Point Purchaser (ปลดล็อกตอน VIP อัตโนมัติ)
- ตรวจจับ Popup ชำระเงินเหรียญ/ตั๋วอ่าน (`com.qq.ac.android:id/read_pay_layout` หรือปุ่ม `one_btn` "确认购买")
- เมื่อเข้าสู่ตอน VIP ที่ต้องใช้เหรียญ ระบบจะตรวจจับและคลิกปุ่ม "确认购买" ตัดยอดเหรียญ/Point ในบัญชีอัตโนมัติ (เช่น 79 点券) ปลดล็อกเนื้อหาและดำเนินการดึงภาพต่อเนื่องโดยไม่ติดขัด

#### 4. ปรับปรุง 1-Click Batch Launcher (`RUN_TENCENT_PIPELINE.bat`)
- พัฒนา Interactive Console Menu เมื่อดับเบิ้ลคลิก:
  - `[1] Download Specific Chapter(s) (e.g. 22 or 22-25)`
  - `[2] Download All Pending Jobs from WorkQueue (--all-pending)`
  - `[3] Run Default Test Chapter (Wu Shen Chong Sheng, Ch 22)`
  - `[4] Custom Command Line Arguments`
  - `[5] Exit`
- รองรับการส่ง Flag `--hide` สั่งซ่อนหน้าต่าง LDPlayer ลง Minimize ไปทำงานเบื้องหลัง
- รองรับการส่งพารามิเตอร์ CLI ตรง (`%*`) ข้ามเมนูทันทีเมื่อรันผ่านสคริปต์หรือเทอร์มินัล

---

### 🏆 ไฮไลท์ความสำเร็จก่อนหน้า: ระบบรวมสถิติทุกแพลตฟอร์มข้ามเว็บ, ยอดขายรายตอน 7 ตอนล่าสุด, Badge เตือนตอนไม่เท่ากัน และเชื่อมต่อ Chaply Episode Sales API (4 พ.ย. 2569)

#### 1. ระบบรวมมังงะเรื่องเดียวกันข้ามแพลตฟอร์ม (+ กันในแถวเดียว)
- **Title Normalization Matching (`normalizeMangaTitle`)**: รวมชื่อมังงะเรื่องเดียวกันจาก ReadRealm, Kairew และ Chaply โดยตัดคำสร้อยภาษาอังกฤษ, อักขระพิเศษ และเชื่อมโยงชื่อเรื่องที่มีความแปรผัน (เช่น *อาจารย์ ศิษย์บ้าขอกบฏนะขอรับ*)
- **ผลการรวมแถว**: ยุบรวมข้อมูลมังงะดิบจาก 382 รายการ เหลือ **243 เรื่องเฉพาะ (Unique Titles)** ในโหมด `🌟 รวมทุกแพลตฟอร์ม`
- **การรวมตัวเลขสถิติ (+ กันอย่างสมบูรณ์)**:
  - **ยอดขายรวม (Total Sales)**: รวมยอดขายสะสมจากทุกแพลตฟอร์มที่เรื่องนั้นลงจำหน่าย (ReadRealm + Kairew + Chaply)
  - **ยอดวิวรวม (Total Views)**: รวมยอดการรับชมจากทุกแพลตฟอร์ม
  - **อัตราการเติบโต 7 วัน และ 30 วัน**: รวม Delta รายได้ และคำนวณ Growth Percentage ข้ามแพลตฟอร์มอย่างแม่นยำ
  - **สถานะอัปเดต / วันที่ไม่เคลื่อนไหว**: อ้างอิงตามวันที่อัปเดตล่าสุดของแพลตฟอร์มที่ใหม่ที่สุด

#### 2. Badge แสดงสถานะแพลตฟอร์ม `[Readrealm/][Kairewx][Chaplyx]`
- แสดง Badge สถานะพร้อมกันทั้ง 3 แพลตฟอร์มในคอลัมน์ "แพลตฟอร์ม":
  - หากมีลงในเว็บ: แถบสีประจำเว็บ พร้อมเครื่องหมายขีดถูกสีเขียว `/` (เช่น `Readrealm /`, `Kairew /`, `Chaply /`) พร้อม Tooltip แสดงยอดขายและยอดวิวของเว็บนั้น
  - หากไม่มีลงในเว็บ: แถบสีเทาเข้มโปร่งแสง พร้อมเครื่องหมายกากบาทสีแดง `x` (เช่น `Chaply x`)

#### 3. คอลัมน์ยอดขายรายตอน 7 ตอนล่าสุด หารเฉลี่ย
- **แทนที่คอลัมน์ยอดวิวรวมเดิม**: ปรับเปลี่ยนเป็น **"ยอดขายรายตอน 7 ตอนล่าสุด / หารเฉลี่ย / ตอน"**
- **การแสดงผล**:
  - ตัวเลขหลัก: ยอดขายเฉลี่ยต่อตอนของ 7 ตอนล่าสุด (`฿.../ตอน` สีทองเด่นชัด Font Mono ตัวหนา) คำนวณจาก `sales_7_chapters / min(7, chapters_count)`
  - ตัวเลขย่อยด้านล่าง: ยอดขายรวม 7 ตอนล่าสุด (`รวม ฿...`) ควบคู่กับยอดวิว (`• วิว ...`)
- **การเรียงลำดับ (Sorting)**: รองรับการจัดอันดับตารางตาม `avg_sales_7_chapters` (ยอดขายเฉลี่ย 7 ตอนล่าสุด) และ `sales_7_chapters` (ยอดขายรวม 7 ตอนล่าสุด)

#### 4. ระบบตรวจจับและ Badge สีแดงเตือนตอนแต่ละเว็บไม่เท่ากัน
- **ตรวจจับความคลาดเคลื่อนของจำนวนตอนข้ามเว็บ (Cross-Platform Mismatch Detection)**:
  - หากมังงะที่ลงมากกว่า 1 เว็บมีจำนวนตอนไม่เท่ากัน (เช่น ReadRealm 211 ตอน vs Kairew 212 ตอน):
    - แสดง **Badge สีแดงเด่นชัด `⚠️ {ตอนสูงสุด} ตอน`** (`bg-rose-500/20 text-rose-300 border-rose-500/50`)
    - แสดงป้ายกำกับแยกย่อยระบุจำนวนตอนของแต่ละเว็บด้านล่าง (เช่น `RR:211`, `KW:212`) ช่วยให้ทีมงานตรวจสอบและอัปเดตตอนได้ทันที
  - หากจำนวนตอนเท่ากันทุกเว็บ: แสดง Badge สีมาตรฐานพร้อมข้อความสีเขียว `✓ เท่ากันทุกเว็บ`
- **ปุ่มตัวกรองด่วน**: เพิ่มปุ่มกรอง **`⚠️ ตอนไม่เท่ากัน (53)`** บนแถบตัวกรองสถานะด้านบน เพื่อคลิกดูเฉพาะเรื่องที่มีปัญหาตอนไม่ตรงกันได้ในคลิกเดียว

#### 5. วิศวกรรมย้อนรอยและเชื่อมต่อ API รายได้รายตอนของ Chaply
- **ค้นพบ Writer Internal Endpoint**: ผ่านการเข้าถึงหน้าจัดการตอน `/writer/contents/{comic_id}/edit` -> แท็บ `จัดการตอน`
  ```http
  GET https://api.chaply.net/api/writer/content-episodes/group/{comic_id}?pageIndex=0&pageSize=100&includeSales=true
  ```
- **ข้อมูลที่ดึงได้สำเร็จ**:
  - `total_revenue`: รายได้รายตอนของทุกตอน
  - `total_purchases`: จำนวนครั้งที่ผู้ใช้อ่าน/ซื้อตอน
  - `total_views`: ยอดวิวรายตอน
  - `price` และ `isFree`: ราคาเหรียญและสถานะตอนฟรี
- **อัปเดตระบบ Pipeline (`tools/chaply_growth_tracker.py`)**:
  - ดึงข้อมูลยอดขายและคำนวณยอดขาย 7 ตอนล่าสุดของการ์ตูนทั้ง 67 เรื่องบน Chaply (ยอดสะสมพอร์ต Chaply รวม ฿8,270.91)
  - ผนวกรวมเข้าสู่ `multi_platform_growth_latest.json` และซิงค์เข้า Frontend

---

### 🏆 ไฮไลท์ความสำเร็จก่อนหน้า: ระบบ Tencent Comic 1-Click Master Pipeline & Frida Automation (3 พ.ย. 2569)

#### 1. ระบบ 1-Click Master Pipeline (`tools/tencent_ldplayer_pipeline.py` & `RUN_TENCENT_PIPELINE.bat`)
- **เชื่อมต่อ LDPlayer อัตโนมัติ (Auto-Detection)**:
  - ค้นหาพาธ LDPlayer (`LDPlayer9`, `LDPlayer5`, `LDPlayer4`) และ ADB Port `127.0.0.1:5555` / `emulator-5554` อัตโนมัติ
  - รองรับ Flag `--hide` ควบคุมหน้าต่างผ่าน Win32 API / `ldconsole.exe` สั่งซ่อนหน้าต่าง Emulator ไปทำงานเบื้องหลัง (Background Mode) 100% ไม่กวนสายตาหรือการใช้งานเครื่อง
- **In-Process Intent Navigation (Zero Screen Clicks)**:
  - สั่งเปิดหน้าอ่านตอนมังงะผ่าน Frida In-Process Intent สู่ Activity `com.qq.ac.android.reader.comic.ComicReaderActivity` ร่วมกับคลาส `ComicIdentity` โดยตรงในระดับ Process
  - ทำงานรวดเร็ว เสถียรสูง และไม่ต้องพึ่งพาการสแกนพิกัดหน้าจอหรือจำลองคลิก (Zero UI Clicking)
- **Plaintext JSON Interception (100% SSL Pinning Bypass)**:
  - Hook ฟังก์ชัน `javax.crypto.Cipher.doFinal` และ `update` เพื่อดักจับ Decrypted Byte Stream ที่ขึ้นต้นด้วย Magic Bytes `0x1f, 0x8b` (GZIP Stream) ทันทีที่แอปทำการถอดรหัสเสร็จ
  - คลายการบีบอัด GZIP ในหน่วยความจำสู่ Plaintext JSON Payload โดยตรง
  - สกัด CDN Image URLs จาก `picture[].url` ได้ครบทุกหน้า 100% ก้าวข้ามข้อจำกัดเรื่อง SSL Pinning, Token Expiry และ Signature Hash (`sig`)
  - มีระบบสำรองดักจับผ่าน OkHttp2 Header Sniffing เสริมความทนทาน
- **Parallel Image Downloader (10 Workers)**:
  - ดาวน์โหลดรูปภาพความละเอียดสูงคู่ขนาน 10 Threads จาก CDN `manhua.acimg.cn`
  - แนบ Headers มาตรฐาน (`Referer: https://ac.qq.com/`) ป้องกันการถูกปฏิเสธการเชื่อมต่อ (403 Forbidden)
- **Continuous Virtual Canvas Stitcher & 20-Page Standard Slicer**:
  - เชื่อมต่อชิ้นส่วนภาพแนวตั้งต่อเนื่องบน Virtual Canvas ไร้รอยต่อ
  - สไลซ์และคำนวณสัดส่วนออกมาเป็น **20 หน้ามาตรฐานพอดีเป๊ะ (`001.jpg` ถึง `020.jpg`)**
  - เข้ารหัสไฟล์ฟอร์แมต `image/jpeg` (Quality 95) มาตรฐานเดียวกับระบบ ThunderScans และ KuaiKan
- **ระบบ Auto-Upload Google Drive & WorkQueue**:
  - อัปโหลดขึ้น Google Drive ไปยังโฟลเดอร์ปลายทาง `แปลจนเมื่อย / {ชื่อเรื่อง} / {เลขตอน}`
  - ลงทะเบียนและอัปเดตคิวงาน WorkQueue บน Google Apps Script อัตโนมัติ:
    * 🔗 **Work Link (`worklink`)**: `[อัป Raw] https://drive.google.com/drive/folders/...`
    * **Upload Status (`uploadstatus`)**: `เสร็จแล้ว`
    * **Uploader Name (`uploadername`)**: `Apt`
- **1-Click Batch Launcher (`RUN_TENCENT_PIPELINE.bat`)**:
  - สคริปต์ Pure ASCII Windows Batch ช่วยให้ผู้ใช้สามารถดับเบิ้ลคลิกเพื่อรัน Pipeline บนเครื่อง Windows ได้ทันที พร้อมส่งต่อพารามิเตอร์ทั้งหมด

#### 2. ผลการทดสอบสดบนระบบจริง (Live End-to-End Verification)
- **มังงะทดสอบ**: เรื่อง **武神重生 (Wu Shen Chong Sheng / Rebirth of the Martial God)**
- **ตอนที่ทดสอบ**: ตอนที่ 22 (ID: `139650` จาก Comic ID: `632731`)
- **Google Drive Output Folder**:  
  🔗 [https://drive.google.com/drive/folders/1RthqL5hiaPkC2BOMRnGWK7wuBcgxEH2D](https://drive.google.com/drive/folders/1RthqL5hiaPkC2BOMRnGWK7wuBcgxEH2D)
- **ผลลัพธ์**:
  - สกัด URL ภาพจาก CDN ครบถ้วน
  - ดาวน์โหลดและเย็บสไลซ์เป็น 20 หน้ามาตรฐาน `001.jpg` - `020.jpg` ครบ 100%
  - อัปโหลดขึ้น Google Drive โฟลเดอร์ `แปลจนเมื่อย / 武神重生 / 22`
  - ลงบันทึกคิวงาน WorkQueue อัตโนมัติ (`uploadstatus: เสร็จแล้ว`, `uploadername: Apt`)

#### 3. Plan A: Frida Plaintext Dump (`tools/frida_plaintext_dump.js` & `tools/frida_plaintext_dump.py`)
- เครื่องมือ Core Instrumentation ดักจับ Decrypted GZIP Stream จาก `javax.crypto.Cipher` และ HTTP/2 Header Frame
- สรุปโครงสร้าง JSON ของ Tencent และแปลงโครงสร้างภาพออกมาเป็น Array URL
- รองรับโหมด `--stitch` สั่งเย็บภาพและอัปโหลดเข้า Drive อัตโนมัติ

#### 4. ระบบ Web Pipeline (Zero-LDPlayer)
- ตัวเชื่อมต่อสกัดภาพผ่าน Web Reader `ac.qq.com` โดยใช้กลไก Deobfuscation ถอดรหัสตัวแปร `DATA` + `nonce`
- ไม่จำเป็นต้องเปิด Emulator เหมาะสำหรับการรัน Headless บน GitHub Actions / CI สำหรับตอนฟรีหรือตอนที่เปิดให้อ่านบน Web

#### 5. ชุดเครื่องมือวิจัยและวินิจฉัยทางเทคนิค (Reverse Engineering Suite)
- `tools/test_intent_nav.py`: เครื่องมือทดสอบการยิง In-Process Intent ข้าม Activity ในแอป Android
- `tools/frida_crypto_capture.js` & `tools/frida_decrypt_capture.py`: สคริปต์วิเคราะห์ Key/IV และโครงสร้าง Payload
- `tools/analyze_pcap.py`, `tools/batch_strings.py`, `tools/inspect_image_cache.py`, `tools/list_disk_cache.py`: เครื่องมือตรวจสอบ Cache และฐานข้อมูล SQLite ของแอป

---

### A. กฎเหล็กโครงสร้างการทำงาน Multi-Agent (`AGENTS.md` & `GEMINI.md`)
- ยึดตามลำดับสายการบังคับบัญชา: `[USER] ➔ [👑 หัวหน้าหลัก (Main Lead)] ➔ [🎖️ หัวหน้าทีม (Team Leads)] ➔ [👷 ลูกทีม / Specialists]`
- **Zero Direct Execution & Zero Manual Polling**: หัวหน้าหลักต้องไม่เขียนโค้ด Dev, ไม่รัน Build/Deploy และไม่ Polling shell log เอง ทุกงานเทคนิคต้องส่งต่อผ่าน Sub-Agent (`invoke_subagent`) เท่านั้น

---

### B. ระบบเย็บภาพ 20 หน้ามาตรฐานแบบ Continuous Vertical Slicing & Auto-Purchaser (ThunderScans & KuaiKan)
- **ThunderScans (en-thunder) & KuaiKan Manhua**:
  - รองรับการดาวน์โหลดคู่ขนานระดับสูง (10-12 Workers) เร็วขึ้น 10 เท่า (~48-55 วินาที/ตอน จากเดิม 15-20 นาที)
  - ตัดภาพแนวตั้งต่อเนื่องบน Virtual Canvas ได้ **20 หน้ามาตรฐานพอดีเป๊ะ (`001.jpg` ถึง `020.jpg`)** ไร้รอยต่อ ปลอดภัยจากขีดจำกัดความสูงของไฟล์ภาพ
  - บังคับฟอร์แมตภาพทุกตัวเชื่อมต่อเป็น `.jpg` (MIME `image/jpeg`, Quality 95) เสมอ 100%
  - **KuaiKan Playwright Auto-Purchaser บน GitHub Actions**: ดักจับ Modal ซื้อตอนอัตโนมัติพร้อมรับส่วนลด VIP 8.5 อัตโนมัติ (99 KK Coins -> 84 KK Coins, 149 KK Coins -> 127 KK Coins)
  - **KuaiKan Regex & Topic 27677**: ปรับปรุง Regular Expression ใน `tools/auto_raw_tracker.py` และ `tools/kuaikan_playwright_purchaser.py` ให้รองรับชื่อตอนที่มีแต่ตัวเลขนำหน้าโดยไม่มีคำว่า "话" หรือ "集" สามารถดึงตอน 4-5 ขึ้น Drive ได้สำเร็จ
  - บังคับใช้ระบบล็อกคิวงานเดี่ยวบน GitHub Actions ผ่าน Concurrency Group `raw-pipeline-master-queue` พร้อมพัก Cooldown 5 นาที (300 วินาที) อย่างปลอดภัย

---

### C. ระบบ Real-Time GitHub Actions Monitoring บนเว็บแอป
- จัดทำ Component `GitHubActionsHeaderBadge.tsx` แสดงผลบน Header ของเว็บแบบ Live:
  - ไฟกะพริบสีฟ้าเมื่อมี Workflow กำลังทำงาน พร้อมนับจำนวน Running Workflows
  - ไฟเขียวเมื่อสถานะปกติ / Idle
- จัดทำ Warning Banner ใน `QueueView.tsx` แจ้งเตือนทีมงานแบบ Real-time เมื่อมีบอท Raw กำลังรันอยู่ เพื่อป้องกันการทำงานซ้ำซ้อน

---

### D. ตารางสรุปค่าใช้จ่ายค้างจ่ายรายคน (ExpensesView Per-Person Summary Table)
- พัฒนาโหมดการแสดงผลใหม่ในหน้า **"ค่าใช้จ่าย (ExpensesView.tsx)"**:
  - สวิตช์สลับมุมมอง: `📊 ตารางสรุปรายคน (Per-Person Summary)` vs `📋 รายตอน (Chapter List)`
  - สรุปยอดค้างจ่ายของทีมงานทุกคนตามช่วงวันที่ที่เลือก (`claimStartDate` ถึง `claimEndDate`)
  - คอลัมน์แสดงผลละเอียด:
    - รายชื่อทีมงาน & บทบาท (Staff & Roles)
    - งานอัปโหลด Raw (จำนวนตอน / ยอดเงิน ฿)
    - งานสกัดคำ Extract (จำนวนตอน / ยอดเงิน ฿)
    - งานแปล Translate (จำนวนตอน / ยอดเงิน ฿)
    - งานลงคำ Typeset (จำนวนตอน / ยอดเงิน ฿)
    - จำนวนตอนรวม (Total Chapters)
    - ยอดเงินค้างเบิกสุทธิ (Unclaimed Amount ฿)
  - ปุ่มฟังก์ชันในแต่ละแถว:
    - ปุ่ม **"👤 เลือกคนนี้"**: ดึงชื่อทีมงานเข้าฟอร์มเบิกเงินทันที
    - ปุ่ม **Expand/Collapse**: กดกางดูรายละเอียดรายตอนย่อยของทีมงานคนนั้นได้ทันทีโดยไม่ต้องสลับหน้า
  - แถวสรุปยอดรวมสุทธิ (Grand Total Footer) ด้านล่างตาราง

---

### E. ยื่นและตรวจสอบใบเบิกเงินค่าตอบแทนทีมงานรอบเดือนตุลาคม 2569 (October 2026 Payout Claims)
ระบบได้บันทึกใบเบิกเงินเข้าสู่ชีต `PayoutClaims` และล็อก `queueitemids` ป้องกันการเบิกซ้ำเรียบร้อย 100%:
1. **คุณ Kikkuk (`CLM-1793611402032`):**
   - งานทั้งหมด 496 ตอน, ยอดสุทธิ **฿5,605**
   - แยกประเภท: Raw QQ 114 ตอน @ 10฿ + Other 177 ตอน @ 5฿ = ฿2,025 | Extract 204 ตอน @ 10฿ = ฿2,040 | Typeset 1 ตอน @ 40฿ = ฿40 | Support ซัพพอร์ต = ฿1,500
   - ผูกล็อกรหัสงาน 483 tasks ใน `queueitemids`
2. **คุณ Pratchaya (`CLM-1793612928261`):**
   - งานทั้งหมด 46 ตอน, ยอดสุทธิ **฿4,480**
   - แยกประเภท: Translate 44 ตอน @ 100฿ = ฿4,400 | Typeset จีน 2 ตอน @ 40฿ = ฿80
   - ผูกล็อกรหัสงาน 46 tasks ใน `queueitemids`
3. **คุณ Tilly (`CLM-1793613196814`):**
   - งานทั้งหมด 227 ตอน, ยอดสุทธิ **฿10,395**
   - แยกประเภท: Typeset จีน 191 ตอน @ 45฿ = ฿8,595 | Typeset เกาหลี 36 ตอน @ 50฿ = ฿1,800
   - ผูกล็อกรหัสงาน 229 tasks ใน `queueitemids`

---

### F. ระบบเลือกและคำนวณเรทงานลงคำ (Typeset Rate: 🇨🇳 จีน 45฿ / 🇰🇷 เกาหลี 50฿)
- เพิ่ม Dropdown เลือกประเภทงานลงคำ (`จีน (45 บาท/ตอน)` หรือ `เกาหลี (50 บาท/ตอน)`) ใน:
  - `AddQueueModal.tsx` (เพิ่มคิวงานใหม่)
  - `UpdateQueueModal.tsx` (แก้ไขข้อมูลคิวงานแบบเต็ม)
  - `StepUpdateModal.tsx` (อัปเดตขั้นตอนงานลงคำแบบด่วน)
- อัปเดต `backend/Code.js`:
  - ตรวจสอบและเพิ่มคอลัมน์ `TypesetType` ในชีต `WorkQueue` อัตโนมัติ (`ensureSheetHeaders`)
  - บันทึกและอัปเดตฟิลด์ `typesettype` ผ่าน API `addQueue`, `updateFullQueueItem`, `updateQueueStep`
- กฎการคิดเงินใน `ExpensesView.tsx`:
  - **ตั้งแต่วันที่ 1 พฤศจิกายน 2569 เป็นต้นไป**: บังคับใช้เรทมาตรฐานเท่ากันทุกคน (จีน 45฿, เกาหลี 50฿)
  - **ก่อนวันที่ 1 พฤศจิกายน 2569 (ประวัติศาสตร์)**: คงเรทเดิมตามข้อตกลง (คุณ Tilly เรท 45฿, ทีมงานท่านอื่นเรท 40฿)
- เพิ่ม Badge ป้ายกำกับสีฟ้าอ่อน `"เกาหลี"` ในคอลัมน์ผู้ลงคำบนตาราง `QueueView.tsx` เพื่อให้เห็นชัดเจน

---

### G. การแก้ไข UI Dashboard
- ปรับปรุงข้อความในการ์ดสถานะคิวงาน `DashboardView.tsx`:
  - เปลี่ยนจาก `"รออัพลงเว็ป"` เป็น **`"ลงคำเสร็จแล้ว รออัพลงเว็ป"`** ให้ตรงตามกระบวนการทำงานจริง

---

## 2. ข้อมูล Configuration & Deployment ปัจจุบัน
- **GitHub Repository:** `mangahub888/mangahub888.github.io` (Branch: `main`)
- **Live URL:** [https://mangahub888.github.io/](https://mangahub888.github.io/)
- **Google Apps Script Production Deployment ID:**  
  `AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw` (Active Version: **`@62`**)
- **Google Drive Root Folder:** `1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_` (`แปลจนเมื่อย`)
- **LDPlayer Port:** `127.0.0.1:5555` / `emulator-5554`
- **Frida Client/Server Version:** `16.7.19` (Android x86_64 server binary at `/data/local/tmp/fsd`)

---

## 3. แผนงานสำหรับวันพรุ่งนี้และระยะถัดไป (Next Tasks for Tomorrow)

### 📌 Task 1: Batch & Multi-Chapter Automation สำหรับ Tencent Pipeline (✅ เสร็จสมบูรณ์แล้ว)
- [x] ต่อยอด `tools/tencent_ldplayer_pipeline.py` ให้รองรับ `--chapters 22-25` หรือ `--all-pending`
- [x] Dynamic TOC Extraction จาก `https://ac.qq.com/Comic/comicInfo/id/{comic_id}` และจับคู่เลขตอนสู่ CID อัตโนมัติ
- [x] In-Process Intent navigation ข้ามตอนโดยไม่ต้องรีสตาร์ตแอป พร้อมระบบ Cool-down ระหว่างตอน
- [x] Continuous Reader Scroll to Bottom เก็บชิ้นส่วนภาพครบ 100% (41-49 ชิ้น)
- [x] Auto VIP Point Purchase ปลดล็อกตอนเหรียญอัตโนมัติ
- [x] Interactive 1-Click Launcher ใน `RUN_TENCENT_PIPELINE.bat`

### 📌 Task 1.1: ปรับปรุงระบบ Deselect Default Chapters ในหน้า DownloadChapterSelectActivity บน LDPlayer (⭐ สำคัญมาก - ทำต่อพรุ่งนี้)
> *รายละเอียดการวิเคราะห์ปัญหาและแนวทางแก้ไขฉบับเต็ม บันทึกไว้ใน [ldplayer.md](file:///d:/manga_backend/ldplayer.md)*
- **ปัญหา**: เมื่อเปิดหน้า `DownloadChapterSelectActivity` แอป Tencent มักจะเลือกตอนเริ่มต้นค้างไว้ (เช่น ตอน 1-20) เมื่อจะเลือกตอนเป้าหมาย (เช่น ตอน 39) สคริปต์ต้องกดยกเลิกตอนเริ่มต้นออกก่อน แต่การกดยกเลิกบางครั้งทำไม่สำเร็จ ทำให้โหลดทั้งตอนเดิม + ตอนเป้าหมายรวม 21 ตอน
- **แนวทางแก้ไขสำหรับพรุ่งนี้**:
  1. เพิ่ม UI Verification Loop ตรวจสอบปุ่ม "全选 / 取消全选" ให้มั่นใจว่าจำนวนตอนที่เลือกเคลียร์เป็น 0 ก่อนกดเลือกตอนเป้าหมาย
  2. ใส่ Guard Check บนปุ่ม `下载所选(N)` ต้องเป็น `下载所选(1)` เท่านั้น หากยังเป็น `(21)` ให้วนลูปจัดการใหม่ก่อนกดดาวน์โหลด
  3. วิจัย Frida Hook เมธอด `DownloadManager` ภายในแอป เพื่อสั่งดาวน์โหลดระบุ Chapter ID โดยตรง ไม่ต้องพึ่งพา UI Checkbox

### 📌 Task 2: GitHub Actions Web Runner (`tencent_web_purchaser.yml`)
- นำระบบ Web Pipeline (Zero-LDPlayer) จาก `tools/tencent_purchaser.py` ขึ้นทำงานบน GitHub Actions
- กำหนด Cron Schedule ตรวจจับตอนใหม่ทุกชั่วโมง และรองรับ `workflow_dispatch` สำหรับสั่งทำงานแบบ Manual
- บังคับใช้ Concurrency Group `raw-pipeline-master-queue` เพื่อไม่ชนกับ KuaiKan และ ThunderScans

### 📌 Task 3: In-App VIP Coin Purchaser Hook (Frida Payment Automation)
- พัฒนา Frida Hook สั่งซื้อตอนที่มีค่าใช้จ่าย (VIP Chapters) ในแอป Tencent Comic บน LDPlayer อัตโนมัติ
- ดักจับปุ่ม/เมธอดซื้อตอนและตัดคูปอง/เหรียญในบัญชีอัตโนมัติ เพื่อรองรับตอนที่ยังติดสถานะจ่ายเงิน

### 📌 Task 4: ปุ่มดึงรายจ่ายที่จ่ายแล้วเข้าหน้างบประมาณและบัญชี (BudgetView.tsx)
- **Backend (`backend/Code.js`)**:
  - สร้าง API Action `SYNC_PAID_CLAIMS_TO_BUDGET` ดึงใบเบิกสถานะ `Paid` จาก `PayoutClaims` เข้าสู่ `BudgetTransactions`
  - ป้องกันการบันทึกรายการซ้ำซ้อนอย่างเข้มงวดด้วยการตรวจสอบ `claimid` กับคอลัมน์ `Reference`
- **Frontend (`frontend/src/components/views/BudgetView.tsx`)**:
  - เพิ่มปุ่ม `"⚡ ซิงค์ค่าจ้างที่จ่ายแล้ว"` ที่ Header Actions
  - พัฒนา Preview & Confirmation Modal แสดงยอดรวมและรายการที่จะนำเข้า พร้อม Badge แสดงสถานะ `"พร้อมนำเข้า"` / `"บันทึกแล้ว"`

---

## 4. คำสั่งสำหรับ AI บนเครื่องใหม่ (Ready-to-Use Prompt for Next Machine)

ผู้ใช้สามารถ Copy ข้อความในกรอบด้านล่างนี้ไปวางในกล่องแชทของ Antigravity บนเครื่องใหม่ เพื่อให้ AI เริ่มงานต่อได้ทันที:

```markdown
สวัสดีครับ ผมย้ายมาทำงานต่อบนเครื่องใหม่ โปรเจกต์ MangaHub (mangahub888.github.io)
กรุณาอ่านและปฏิบัติตามกฎใน AGENTS.md, GEMINI.md และศึกษาความคืบหน้าล่าสุดใน HANDOVER.md

งานที่ต้องดำเนินการต่อในวันนี้:
1. ต่อยอดระบบ Tencent Comic Automation:
   - เพิ่มระบบ Batch / Multi-Chapter Processing ใน tools/tencent_ldplayer_pipeline.py ให้รองรับการดึงหลายตอนต่อเนื่อง
   - ตั้งค่า Workflow tencent_web_purchaser.yml บน GitHub Actions สำหรับรันระบบ Web Pipeline (Zero-LDPlayer) อัตโนมัติ
2. พัฒนาระบบบัญชีหน้างบประมาณ (BudgetView.tsx):
   - สร้าง Backend API 'SYNC_PAID_CLAIMS_TO_BUDGET' ใน backend/Code.js ซิงค์ใบเบิกที่จ่ายแล้วเข้า BudgetTransactions
   - สร้าง Preview Modal ใน BudgetView.tsx และทดสอบ Flow การทำงาน
```

---
*บันทึกโดย: Antigravity Multi-Agent Automation System (Git Release & Documentation Specialist)*

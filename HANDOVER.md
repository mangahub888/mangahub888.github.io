# 📋 MangaHub Project Handover & Next Tasks
> **บันทึกสถานะงานและการส่งมอบโปรเจกต์ (สำหรับย้ายเครื่องทำงานต่อ / Machine Transition)**  
> *วันที่อัปเดต: 4 พฤศจิกายน 2569 (2026-11-04)*

---

## 1. สรุปภาพรวมงานที่ทำเสร็จสมบูรณ์แล้ว (Completed Milestones)

### 🏆 ไฮไลท์ความสำเร็จล่าสุด: ระบบรวมสถิติทุกแพลตฟอร์มข้ามเว็บ, ยอดขายรายตอน 7 ตอนล่าสุด, Badge เตือนตอนไม่เท่ากัน และเชื่อมต่อ Chaply Episode Sales API (4 พ.ย. 2569)

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

### 📌 Task 1: Batch & Multi-Chapter Automation สำหรับ Tencent Pipeline
- ต่อยอด `tools/tencent_ldplayer_pipeline.py` ให้รองรับการสั่งรันแบบหลายตอนพร้อมกัน:
  - รองรับ Parameter `--chapters 22-25` หรือ `--all-unreleased` (อ่านเลขตอนล่าสุดจากชีต WorkQueue แล้วดึงเฉพาะตอนใหม่ที่ยังไม่มีในระบบ)
  - ควบคุมการสลับตอนผ่าน In-Process Intent โดยอัตโนมัติทีละตอนพร้อมระบบ Cool-down ป้องกันเซิร์ฟเวอร์ Tencent ระงับบัญชี

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

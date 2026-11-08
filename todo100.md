# TODO 100 — ReadRealm Growth Tracker: การ์ตูน 29 ตอนแต่บันทึกได้ 28 ตอน (มหาปรมาจารย์ระดับเทพแห่งนคร)

## 1. ข้อมูลปัญหา (Problem Statement)

- **ผู้ใช้แจ้งปัญหา**: หน้าเว็บสาธารณะของการ์ตูนมีตอนที่ 29 แล้ว แต่ในระบบ Growth Tracker / Multi-Platform Tracker บันทึกเจอแค่ตอนที่ 28
- **ลิงก์ Action Run**: [GitHub Actions Run #42391467850](https://github.com/mangahub888/mangahub888.github.io/actions/runs/42391467850/job/128459765114)
- **ลิงก์เรื่อง**: [มหาปรมาจารย์ระดับเทพแห่งนคร City God Level Grandmaster (ReadRealm)](https://readrealm.co/comic/NG8Qg2kxDyqvOz7Kdeo9)
- **Comic ID**: `NG8Qg2kxDyqvOz7Kdeo9`
- **สถานะในระบบปัจจุบัน**:
  - `tools/data/readrealm_growth_latest.json`: `chapters_count: 28`
  - `tools/data/multi_platform_growth_latest.json`: `chapters_count: 28` (ReadRealm) vs `29` (Kairew ID: 5076) vs `29` (Chaply ID: cmu5lttk91ygj6kdgu18gt0i5)
  - `tools/data/readrealm_history.json`: บันทึก snapshot วันที่ 2026-11-04, 2026-11-06, 2026-11-07 เป็น `chapters_count: 28`

---

## 2. ผลการตรวจสอบข้อมูลเชิงลึก (Deep Technical Investigation)

### 2.1 ตรวจสอบ API ฝั่ง Writer (`api-writer.readrealm.co`)
- ในสคริปต์ `tools/readrealm_growth_tracker.py` (ฟังก์ชัน `fetch_writer_comics` บรรทัดที่ 456–498) ดึงข้อมูลผ่าน:
  ```http
  GET https://api-writer.readrealm.co/writer/comics/getComicsList?comic_subject=&comic_status=&comic_category=&comic_rating=&comic_publish=&per_page=20&page=1
  ```
- การคำนวณจำนวนตอนในบรรทัดที่ 476:
  ```python
  ch_count = int(item.get("comic_chapter_publish_count") or item.get("comic_total_chapter") or 0)
  ```
- **สิ่งที่ค้นพบ**: API `getComicsList` ของ ReadRealm ฝั่ง Writer ส่งค่า `comic_chapter_publish_count: 28` กลับมาจริง
- จากการสแกนการ์ตูนทั้งหมดในระบบ:
  - บัญชี `lionking` (แปลจนเมื่อย): มีการ์ตูน **61 เรื่อง** ที่ `comic_chapter_publish_count` น้อยกว่าจำนวนตอนจริงในสารบัญอยู่ **-1 ตอนพอดี**
  - บัญชี `adieu` (แปลแล้วแปลอีก): มีการ์ตูน **48 เรื่อง** ที่มีปัญหาเดียวกัน
  - **รวมมากกว่า 109 เรื่อง** ที่ระบบ API Writer ของ ReadRealm มีบั๊ก Denormalized Counter ค้างหรือนับแบบ zero-based ทำให้ค่าสรุปในหน้ารายชื่อการ์ตูนขาดไป 1 ตอนเสมอ

### 2.2 ตรวจสอบ API สารบัญรายตอน (`api-writer` vs `api.readrealm.co`)
1. **Writer Chapter API (`getChaptersList`)**:
   - Endpoint: `https://api-writer.readrealm.co/writer/comics/chapters/getChaptersList?comic_ID=NG8Qg2kxDyqvOz7Kdeo9&page=1&per_page=200&sort_column=asc`
   - ใน `tools/data/readrealm_stats_lionking.json` พบว่าตอนที่ 29 มีอยู่จริง:
     - ID ตอน: `d9yzLJPM2RDVmMa7kxQq`
     - ชื่อตอน: `"29"`
     - ราคา: 1.8 เหรียญ
     - วันที่เผยแพร่: `2026-10-23`
     - ยอดวิว: 191 วิว | ยอดขาย: ฿225.0
     - แบ่งเป็น: ฟรี 15 ตอน (ตอนที่ 01–15) + ติดเหรียญ 14 ตอน (ตอนที่ 16–29) รวม 29 ตอนสมบูรณ์ 100%
2. **Public Reader API (`getListChaptersSectionPage`)**:
   - เราทดสอบ Reverse Engineer หน้าเว็บ `https://readrealm.co/comic/NG8Qg2kxDyqvOz7Kdeo9` พบว่าหน้าบ้านเรียก API สาธารณะ:
     ```http
     GET https://api.readrealm.co/reader/book/getListChaptersSectionPage?book_type=comic&book_id=NG8Qg2kxDyqvOz7Kdeo9&start_index=1&sort=asc
     ```
   - **ไม่ต้องใช้ Token / Authorization ใด ๆ** (เพียงส่ง Header `Origin: https://readrealm.co` และ `Referer`)
   - API ส่งคืน `data` ครบ **29 ตอน** และระบุตอนสุดท้ายชัดเจน:
     ```json
     {
       "book_chapter_ID": "d9yzLJPM2RDVmMa7kxQq",
       "book_chapter_title": "29",
       "book_chapter_price": "1.8",
       "book_chapter_publish": "15 วันที่แล้ว"
     }
     ```

---

## 3. สรุปสาเหตุของปัญหา (Root Causes)

1. **บั๊ก Denormalized Counter ของ ReadRealm Backend**:
   - ฟิลด์ `comic_chapter_publish_count` บนตาราง `comics` ของ ReadRealm ไม่ได้ถูกบวกเพิ่ม (increment) เมื่อตอนที่ 29 ถูกเผยแพร่ หรือมีบั๊ก `COUNT(*) - 1` ใน SQL Query ของ Backend ReadRealm ฝั่ง Writer
2. **ความแตกต่างของสถาปัตยกรรม Tracker**:
   - `tools/readrealm_tracker.py` (Full Deep Tracker) ดึง `getChaptersList` รายตอน จึงรู้ว่ามี 29 ตอน
   - แต่ `tools/readrealm_growth_tracker.py` (Fast 6-Hour Growth Pipeline) ถูกออกแบบมาให้รันเร็ว (ดึง 236 เรื่องจบใน 7-10 วินาทีบน GitHub Actions) จึงดึงเฉพาะ `getComicsList` แล้วหยิบค่า `comic_chapter_publish_count` ทันที ทำให้ได้เลข 28 ติดมา
3. **การขาดการกระทบยอดข้ามแพลตฟอร์ม (Cross-Platform Discrepancy Reconciliation)**:
   - ในระบบ Multi-Platform Tracker มีข้อมูลของเรื่องนี้บน Kairew (`29 ตอน`) และ Chaply (`29 ตอน`) อยู่แล้ว แต่ระบบยังไม่มีกลไกตรวจจับว่า "ถ้า ReadRealm มีตอนน้อยกว่าแพลตฟอร์มอื่น ให้ re-check ด้วย Chapter API"

---

## 4. แผนการและแนวทางแก้ไข (Action Plan & Solutions)

- [x] **Phase 1: Immediate Data Correction (แก้ไขข้อมูลทันที) [เสร็จสมบูรณ์ 100%]**
  - อัปเดต `chapters_count` ของ `NG8Qg2kxDyqvOz7Kdeo9` ใน:
    - `tools/data/readrealm_growth_latest.json`
    - `tools/data/multi_platform_growth_latest.json`
    - `frontend/src/data/readrealm_growth_latest.json`
    - `frontend/src/data/multi_platform_growth_latest.json`
    - `frontend/public/data/readrealm_growth_latest.json`
    - `frontend/public/data/multi_platform_growth_latest.json`
    - `tools/data/readrealm_history.json` (ทุก snapshot)
    - `tools/data/readrealm_stats_lionking.json`
    จาก `28` เป็น `29` ให้สอดคล้องกับหน้าเว็บจริง
- [x] **Phase 2: Fallback to Chapter Cache in `readrealm_growth_tracker.py` & `readrealm_tracker.py` [เสร็จสมบูรณ์ 100%]**
  - เพิ่มฟังก์ชัน `get_known_cached_chapter_counts()` โหลดแคชจาก snapshot ล่าสุด, history, และ raw stats
  - ใช้ตรรกะ `ch_count = max(api_ch_count, cached_ch_count)` ป้องกันไม่ให้บั๊ก `-1` ของ ReadRealm Writer API เขียนทับจำนวนตอนจริงที่ระบบเคยตรวจพบ
  - เสริมการป้องกันใน `readrealm_tracker.py` ให้คำนึงถึง cached chapter map เช่นเดียวกัน
- [x] **Phase 3: Smart Public API Chapter Resolver for Discrepant Comics [เสร็จสมบูรณ์ 100%]**
  - เพิ่มฟังก์ชัน `fetch_public_readrealm_chapters(cid)` ดึงจำนวนตอนจริงจาก Public Reader API (`https://api.readrealm.co/reader/book/getListChaptersSectionPage`) โดยไม่ต้องล็อกอิน
  - ใน `tools/multi_platform_tracker.py` เพิ่มระบบ Cross-Platform Discrepancy Reconciliation ตรวจจับเปรียบเทียบชื่อเรื่องกับ Kairew และ Chaply แบบอัตโนมัติ หากพบผลต่างจะเรียก Public API มาแก้ไขทันที (ตรวจพบและแก้ไขมังงะ ReadRealm ที่มีปัญหา -1 ตอนไปทั้งหมด 51 เรื่องอย่างแม่นยำ)
  - ข้อมูลที่ถูกแก้ไขจะบันทึกกลับลงไฟล์ snapshot และส่งต่อไปยัง Frontend อัตโนมัติ

---

## 4. ปัญหาการจับคู่ข้ามแพลตฟอร์ม (Cross-Platform Matching) เรื่อง "จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต" (เสร็จสมบูรณ์ 100%)

- [x] **สืบค้นข้อมูลใน ReadRealm Data**:
  - ชื่อเรื่องบน ReadRealm: `"ผู้ชายแสนดีเช่นข้า ไฉนต้องกลับกลายเป็นจอมวายร้าย"`
  - Comic ID: `GpeQDXZlx2jvx5n0JWoR`
  - บัญชี: `แปลจนเมื่อย` (lionking account)
  - จำนวนตอน: **158 ตอน** (ตรวจสอบ Public Reader API ยืนยัน 158 ตอน)
  - ยอดวิวรวม: **219,361 วิว** | ยอดขายรวม: **฿39,000.00**
- [x] **วิเคราะห์สาเหตุที่ระบบไม่ Match ข้ามแพลตฟอร์ม**:
  - Kairew (389) และ Chaply (cmu8mjor52dc36kdg6vlj2zw2) ใช้ชื่อ "จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต" แต่ ReadRealm ใช้ชื่อ "ผู้ชายแสนดีเช่นข้า ไฉนต้องกลับกลายเป็นจอมวายร้าย" คำไม่ตรงกันทำให้ normalization หลุด
- [x] **สร้างไฟล์ Mapping Registry และเชื่อมโยงข้อมูล**:
  - เพิ่ม `tools/data/comic_cross_platform_mapping.json` (และ frontend data)
  - ปรับปรุง `tools/multi_platform_tracker.py` ให้ใส่ canonical title และ key ให้กับทุกแพลตฟอร์ม
  - ปรับปรุง `tools/group_matching_comics.py` เชื่อมโยงครบทั้ง 3 แพลตฟอร์ม (RR + KW + CH)
  - ปรับปรุง `frontend/src/components/views/FinancialsView.tsx` รองรับ title aliases และแสดงผลทั้ง 3 แพลตฟอร์ม
- [x] **ทดสอบและคอมมิต**:
  - รัน `group_matching_comics.py` และ `multi_platform_tracker.py --consolidate-only` ผลลัพธ์สมบูรณ์ 100%
  - รัน `npm run build` ผ่าน 100%


---

## 5. ปัญหาจำนวนตอน Chaply ถูกจำกัดที่ 100 ตอน (เรื่อง "นักฆ่าระดับเทพ ข้าคือเงามืด" และอื่นๆ) (เสร็จสมบูรณ์ 100%)

- [x] **การสืบค้นและระบุสาเหตุ (Root Cause Analysis)**:
  - ผู้ใช้แจ้ง: เรื่อง "🔥 นักฆ่าระดับเทพ ข้าคือเงามืด" (`cmvscqbse140ot5i8vfzbibtm`) Chaply ลง 154 ตอน แต่ในระบบแสดง 100 ตอน
  - ตรวจสอบ `tools/chaply_growth_tracker.py`: บรรทัดดึง `content-episodes` ดึงด้วย `pageSize=100&pageIndex=0` หน้าเดียว
  - บรรทัดที่ 250 เดิมมีโค้ด `if len(ep_items) > 0: eps = len(ep_items)` ทำให้ `eps` ถูกเขียนทับด้วย 100 แทนที่จะเป็น 154
  - ยอดขายของตอนที่ 101–154 ตกหล่น และมีมังงะอีก 8 เรื่อง (รวมเป็น 9 เรื่อง) ที่ถูกแคปไว้ที่ 100 ตอนพอดี
- [x] **การปรับปรุง Engine Chaply Growth Tracker**:
  - ปรับปรุง `tools/chaply_growth_tracker.py` เพิ่ม `pageSize=500` และลูป Pagination แบบ `while True` (รองรับสูงสุด 10,000 ตอน)
  - คำนวณ `eps = max(eps, total_items_from_api, len(all_ep_items), max_index)` ไม่ให้ถูกแคปอีกต่อไป
  - คำนวณยอดขายสะสมและยอดวิว 7 ตอนล่าสุดจากทุกหน้าครบถ้วน
  - บันทึก `chaply_all_comics.json` ทุกรอบ
- [x] **การปรับปรุง Cross-Platform Grouping & Consolidate**:
  - ปรับปรุง `tools/group_matching_comics.py` ให้อ่านจาก `chaply_growth_latest.json` เพื่อดึงยอดขายจริงและตอนที่ถูกต้องของ Chaply
  - อัปเดตข้อมูลมังงะ 9 เรื่องที่เคยติด 100 ตอน:
    - `cmvscqbse140ot5i8vfzbibtm` (นักฆ่าระดับเทพ): **154 ตอน** (ยอดขาย ฿6.48)
    - `cmu8mjor52dc36kdg6vlj2zw2` (จอมมารแสนดีเช่นข้า): **150 ตอน** (ยอดขาย ฿16.20)
    - `cmuua0knr0dggt5h971a8fsib` (หลังจากโดนดาวโรงเรียนทิ้ง): **130 ตอน** (ยอดขาย ฿137.70)
    - `cmvezsehy25w0t5eupwauchpa` (อิสระทางทรัพย์): **130 ตอน** (ยอดขาย ฿42.12)
    - `cmw4jffvx2x4vt5i7sjfydn7d` (ผู้ฝึกกระบี่เต็มเวลา): **126 ตอน** (ยอดขาย ฿4.86)
    - `cmujtou700ea2t5iqi3fhllox` (ฉันกลายเป็นอัจฉริยะ): **124 ตอน** (ยอดขาย ฿184.68)
    - `cmuzqktr60f70t5kkpqz1btwu` (ทรราชวิวัฒนาการ): **120 ตอน** (ยอดขาย ฿171.72)
    - `cmw34uhdn2l07t5i45r53h94c` (ก่อกำเนิดราชันย์อสูร): **114 ตอน** (ยอดขาย ฿123.12)
    - `cmujt3jjs0ebkt5iohzuzr2fq` (เกิดใหม่ในแดนวีรบุรุษ): **102 ตอน** (ยอดขาย ฿1.62)
- [x] **การทดสอบและ Build Frontend**:
  - รัน `group_matching_comics.py` และ `multi_platform_tracker.py --consolidate-only` สำเร็จ 100%
  - รัน `npm run build` ใน `frontend/` ผ่าน 100%

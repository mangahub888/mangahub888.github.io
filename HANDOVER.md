# 📋 MangaHub Project Handover & Next Tasks
> **บันทึกสถานะงานและการส่งมอบโปรเจกต์ (สำหรับย้ายเครื่องทำงานต่อ / Machine Transition)**  
> *วันที่อัปเดต: 2 พฤศจิกายน 2569 (2026-11-02)*

---

## 1. สรุปภาพรวมงานที่ทำเสร็จสมบูรณ์แล้วในเซสชันนี้ (Completed Milestones)

### A. ระบบ 1-Click Session Refresh & Pipeline Trigger (เพิ่มใหม่ล่าสุด)
- **1-Click Session Refresh Tool (`tools/quick_refresh_session.py` & `REFRESH_TENCENT_SESSION.bat`)**:
  - รองรับการเชื่อมต่อ ADB (`127.0.0.1:5555`) กับ LDPlayer อัตโนมัติ
  - ดึงข้อมูล cookies, uin, skey และ device info จากแอป `com.qq.ac.android`
  - อัปเดตไฟล์ `tools/tencent_app_session.json` และแสดงผล Cookie string สำหรับคัดลอกใส่ GitHub Secret (`TENCENT_COOKIE`) ทันที
  - ผู้ใช้งาน Windows สามารถดับเบิ้ลคลิกไฟล์ `REFRESH_TENCENT_SESSION.bat` ที่โฟลเดอร์หลักเพื่อรีเฟรชได้ทันที
- **Auto Raw Tracker Pipeline Trigger**:
  - สั่งรัน Workflow บน GitHub Actions สำเร็จผ่าน GitHub CLI (`gh workflow run auto_raw_tracker.yml`, Run ID: `41454394118`).

---

### A. กฎเหล็กโครงสร้างการทำงาน Multi-Agent (`AGENTS.md` & `GEMINI.md`)
- ยึดตามลำดับสายการบังคับบัญชา: `[USER] ➔ [👑 หัวหน้าหลัก (Main Lead)] ➔ [🎖️ หัวหน้าทีม (Team Leads)] ➔ [👷 ลูกทีม / Specialists]`
- **Zero Direct Execution & Zero Manual Polling**: หัวหน้าหลักต้องไม่เขียนโค้ด Dev, ไม่รัน Build/Deploy และไม่ Polling shell log เอง ทุกงานเทคนิคต้องส่งต่อผ่าน Sub-Agent (`invoke_subagent`) เท่านั้น

---

### B. ระบบเย็บภาพ 20 หน้ามาตรฐานแบบ Continuous Vertical Slicing & Auto-Purchaser
- **ThunderScans (en-thunder) & KuaiKan Manhua**:
  - รองรับการดาวน์โหลดคู่ขนานระดับสูง (10-12 Workers) เร็วขึ้น 10 เท่า (~48-55 วินาที/ตอน จากเดิม 15-20 นาที)
  - ตัดภาพแนวตั้งต่อเนื่องบน Virtual Canvas ได้ **20 หน้ามาตรฐานพอดีเป๊ะ (`001.jpg` ถึง `020.jpg`)** ไร้รอยต่อ ปลอดภัยจากขีดจำกัดความสูงของไฟล์ภาพ
  - บังคับฟอร์แมตภาพทุกตัวเชื่อมต่อเป็น `.jpg` (MIME `image/jpeg`) เสมอ 100%
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

### H. ประวัติ Git Commits ล่าสุดในเซสชันนี้
- `d589a0f`: feat(expenses): set standard typeset rates to Chinese 45 THB and Korean 50 THB from Nov 2026 onwards
- `39761c5`: feat(typeset): add typeset rate type (Chinese/Korean) selector to StepUpdateModal
- `c8cb602`: feat(payout): add UPDATE_PAYOUT_CLAIM endpoint and update Kikkuk October claim amount
- `faf0b7d`: fix(dashboard): update status description to 'ลงคำเสร็จแล้ว รออัพลงเว็ป'
- `c26f307`: feat(expenses): support Chinese and Korean typeset rates with Nov 2026 threshold and queue badges
- `ce29c76`: feat(typeset): add typeset type (Chinese/Korean rate) support to queue modals and backend
- `88b2ba4`: fix(kuaikan): enhance chapter title regex to support numeric prefix titles without 话/集
- `3648536`: feat: display unclaimed completed work as per-person summary table with chapter expanders
- `df0c56f`: feat: show real-time GitHub Actions status in header badge and work queue view
- `6221f6d`: fix: strictly filter monthly overview and day 0 backlog to translate and typeset only

---

## 2. ข้อมูล Configuration & Deployment ปัจจุบัน
- **GitHub Repository:** `mangahub888/mangahub888.github.io` (Branch: `main`)
- **Live URL:** [https://mangahub888.github.io/](https://mangahub888.github.io/)
- **Google Apps Script Production Deployment ID:**  
  `AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw` (Active Version: **`@62`**)
- **Google Drive Root Folder:** `1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_` (`แปลจนเมื่อย`)

---

## 3. แผนงานที่ต้องทำต่อทันที: ปุ่มดึงรายจ่ายที่จ่ายแล้วเข้าหน้างบประมาณและบัญชี (BudgetView)

### 🎯 เป้าหมายของฟีเจอร์ (Feature Objective)
ในหน้างบประมาณและบัญชี (`frontend/src/components/views/BudgetView.tsx`) ให้เพิ่มปุ่มอำนวยความสะดวกสำหรับผู้ดูแลระบบ เพื่อกด **"ดึงรายจ่ายค่าตอบแทนทีมงานที่จ่ายแล้ว" (Sync Paid Payout Claims)** ของแต่ละเดือน เข้าสู่ตารางบัญชีรายรับ-รายจ่าย (`BudgetTransactions`) โดยอัตโนมัติ เพื่อไม่ต้องมานั่งคีย์ยอดค่าจ้างซ้ำซ้อนทีละคน

---

### 🏗️ โครงสร้างข้อมูลและการเชื่อมโยง (Data Mapping Architecture)

| ชีตต้นทาง (`PayoutClaims`) | เงื่อนไขการดึงข้อมูล | ชีตปลายทาง (`BudgetTransactions`) | ค่าที่ต้องบันทึก (Mapped Value) |
| :--- | :--- | :--- | :--- |
| `status` | ต้องเป็น `'Paid'` | - | กรองเฉพาะใบเบิกที่จ่ายเงินแล้ว |
| `paidat` / `enddate` | อยู่ในเดือน/ปีที่เลือก | `Date` | วันที่จ่ายเงิน (`paidat`) ในรูปแบบ `YYYY-MM-DD` (หากไม่มีให้ใช้ `enddate` หรือ `createdat`) |
| - | รายจ่าย | `Type` | `'Expense'` |
| `totalamount` | ยอดเงินสุทธิ | `Amount` | จำนวนเงินค่าจ้าง (Number/Float) |
| - | หมวดหมู่ | `Category` | `'ค่าตอบแทนทีมงาน'` |
| `claimid` | รหัสใบเบิก (เช่น `CLM-1793611402032`) | `Reference` | ใช้ `claimid` เป็นตัวอ้างอิงและ **ป้องกันการลงบัญชีซ้ำ (Deduplication Key)** |
| `staffname`, `totalepisodes`, `startdate`, `enddate` | ข้อมูลประกอบ | `Note` | เช่น `ค่าจ้างทีมงาน คุณ ${staffname} ประจำวันที่ ${startdate} - ${enddate} (${totalepisodes} ตอน)` |

---

### 🛡️ กฎเหล็กการป้องกันข้อมูลซ้ำซ้อน (Deduplication Rules)
1. **Reference Check**: ทุกครั้งที่จะดึงรายการ ต้องตรวจสอบคอลัมน์ `Reference` ในชีต `BudgetTransactions` ก่อนเสมอ
2. หากพบว่ามีรายการใดที่มี `Reference == claimid` อยู่แล้ว ให้ **ข้ามรายการนั้นทันที** และนับเป็น `skippedCount`
3. บันทึกเฉพาะใบเบิกที่มีสถานะ `Paid` และยังไม่เคยถูกบันทึกลงใน `BudgetTransactions` เท่านั้น

---

### 📐 ขั้นตอนการพัฒนาโดยละเอียด (Step-by-Step Implementation Plan)

#### ขั้นตอนที่ 1: เพิ่มฟังก์ชัน API ใน Backend (`backend/Code.js`)
1. เพิ่ม Action ใน `doPost(e)`:
   ```javascript
   case 'SYNC_PAID_CLAIMS_TO_BUDGET':
     result = syncPaidClaimsToBudget(payload);
     break;
   ```
2. สร้างฟังก์ชัน `syncPaidClaimsToBudget(payload)`:
   - รับพารามิเตอร์ `{ month, year }` (หรือ `month = 'all'`)
   - ดึงข้อมูลจากชีต `PayoutClaims` (`getPayoutClaims()`)
   - กรองเฉพาะรายการที่ `status === 'Paid'` และวันที่ตรงกับเงื่อนไขเดือน/ปี
   - ดึงข้อมูลจากชีต `BudgetTransactions` รวบรวม `reference` ทั้งหมดที่มีอยู่ในระบบ
   - วนลูปสร้างแถวใหม่สำหรับใบเบิกที่ยังไม่มีในชีต `BudgetTransactions`:
     ```javascript
     const newTxId = 'TX-' + Utilities.getUuid().substring(0, 8);
     const dateStr = claim.paidat ? Utilities.formatDate(new Date(claim.paidat), 'GMT+7', 'yyyy-MM-dd') : (claim.enddate || Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd'));
     sheet.appendRow([
       newTxId,
       dateStr,
       'Expense',
       parseFloat(claim.totalamount) || 0,
       'ค่าตอบแทนทีมงาน',
       claim.claimid,
       'ค่าจ้างทีมงาน คุณ ' + (claim.staffname || '') + ' (' + (claim.totalepisodes || 0) + ' ตอน) รอบวันที่ ' + (claim.startdate || '') + ' ถึง ' + (claim.enddate || '')
     ]);
     ```
   - สั่ง `invalidateCache('budget_transactions')`
   - ส่งผลลัพธ์กลับ: `{ success: true, addedCount, skippedCount, transactions: getBudgetTransactions() }`
3. Deploy GAS Version ใหม่ผ่าน `clasp push` -> `clasp version` -> `clasp deploy`

---

#### ขั้นตอนที่ 2: เพิ่ม UI ใน Frontend (`frontend/src/components/views/BudgetView.tsx`)
1. **ตำแหน่งปุ่ม:**
   - เพิ่มปุ่ม `"📥 ดึงรายจ่ายค่าจ้าง (จ่ายแล้ว)"` หรือ `"⚡ ซิงค์ค่าจ้างที่จ่ายแล้ว"` ที่แถบหัวหน้า (Header Actions) ข้างปุ่ม "จัดการรายชื่อผู้รับเงิน" และ "เพิ่มรายการ" หรือในแถบตัวกรองช่วงเวลา
2. **Preview & Confirmation Modal:**
   - เมื่อกดปุ่ม ให้เปิด Modal ตรวจสอบรายการล่วงหน้า โดยแสดง:
     - รายการใบเบิกสถานะ `Paid` ในเดือนที่เลือก
     - แสดงแถบสถานะแต่ละรายการ:
       - 🟢 **พร้อมนำเข้า (Ready to Sync)**: ยังไม่มีในชีตบัญชี
       - ⚪ **นำเข้าแล้ว (Already Synced)**: มีในชีตบัญชีแล้ว (แสดง Badge "บันทึกแล้ว")
     - แสดงยอดรวมสุทธิที่จะนำเข้า
     - ปุ่มยืนยัน `"ยืนยันนำเข้ารายการ (X รายการ)"` พร้อม Loading State ขณะกำลังบันทึก
3. **การอัปเดตสถานะและแจ้งเตือน:**
   - เมื่อทำงานสำเร็จ ให้แสดง `toast.success('นำเข้ารายจ่ายสำเร็จ X รายการ (ข้ามรายการที่เคยนำเข้าแล้ว Y รายการ)')`
   - เรียก `onTransactionsChange(res.transactions)` เพื่อให้ตารางรายรับ-รายจ่ายและกราฟสรุปยอดกำไรสุทธิอัปเดตทันทีแบบ Reactive

---

## 4. คำสั่งสำหรับ AI บนเครื่องใหม่ (Ready-to-Use Prompt for Next Machine)

ผู้ใช้สามารถ Copy ข้อความในกรอบด้านล่างนี้ไปวางในกล่องแชทของ Antigravity บนเครื่องใหม่ เพื่อให้ AI เริ่มงานต่อได้ทันที:

```markdown
สวัสดีครับ ผมย้ายมาทำงานต่อบนเครื่องใหม่ โปรเจกต์ MangaHub (mangahub888.github.io)
กรุณาอ่านและปฏิบัติตามกฎใน AGENTS.md, GEMINI.md และศึกษาความคืบหน้าล่าสุดใน HANDOVER.md

งานที่ต้องทำต่อไปในเซสชันนี้คือ:
"พัฒนาปุ่มดึงรายจ่ายที่บันทึกว่าจ่ายแล้วของแต่ละเดือนในหน้างบประมาณและบัญชี (BudgetView.tsx)"
ตามแผนงานข้อ 3 ใน HANDOVER.md:
1. สร้าง Backend API 'SYNC_PAID_CLAIMS_TO_BUDGET' ใน backend/Code.js ที่ดึงใบเบิกสถานะ 'Paid' ใน PayoutClaims เข้าสู่ BudgetTransactions โดยป้องกันการบันทึกซ้ำผ่าน Reference (claimid)
2. Deploy Google Apps Script และอัปเดตเวอร์ชัน
3. พัฒนาปุ่มและ Preview Modal ใน frontend/src/components/views/BudgetView.tsx ให้เลือกดูรายการและยืนยันการนำเข้าค่าใช้จ่ายของเดือนที่เลือกได้
4. ตรวจสอบ Typecheck, Build Frontend, Commit และ Push ขึ้น GitHub
```

---
*บันทึกโดย: Antigravity Multi-Agent Automation System*

---

### H. การบูรณาการตัวเชื่อมต่อ Tencent Comic (ac.qq.com) เข้าสู่ Auto Raw Pipeline
- **เชื่อมต่อและตรวจสอบสมบูรณ์**:
  - รองรับการดึงข้อมูลและรายการตอนจาก https://ac.qq.com/Comic/comicInfo/id/{comic_id}
  - ตรวจสอบและกรองตอนเฉพาะ App (re.search(r'APP$', title, re.IGNORECASE) หรือ is_app_chapter == 1) อัตโนมัติ
  - ถอดรหัส URL ภาพจากตัวแปร DATA และ nonce รวมถึงดาวน์โหลดตรงจาก CDN manhua.acimg.cn
  - เย็บประกอบภาพแนวตั้งต่อเนื่องและสไลซ์ออกเป็น 20 หน้ามาตรฐานพอดี (001.jpg ถึง 020.jpg, image/jpeg)
  - อัปโหลดขึ้น Google Drive ไปยังโฟลเดอร์ แปลจนเมื่อย / {ชื่อเรื่อง} / {เลขตอน}
  - ลงทะเบียนคิวงาน WorkQueue ด้วยมาตรฐาน:
    - worklink: [อัป Raw] https://drive.google.com/drive/folders/...
    - uploadstatus: เสร็จแล้ว
    - uploadername: Apt
- บันทึกการเปลี่ยนแปลงและอัปเดต git push ขึ้น origin main เรียบร้อยแล้ว

---

### I. 🔐 Tencent App Intercept (Frida) — ส่งมอบงานวันที่ 2026-11-02

> **อ่านต่อที่ [`docs/HANDOVER_TENCENT_FRIDA.md`](./docs/HANDOVER_TENCENT_FRIDA.md)** (แผน A + C พร้อม checklist)

สรุปสั้น:
- ✅ ดัก API ของแอป `com.qq.ac.android` ได้แล้ว (HTTP/2 headers + URL ภาพ `manhua.acimg.cn`) โดย**ไม่ต้องปลด SSL pinning**
- ✅ replay request จาก PC ได้ 200 OK (token ไม่ผูกเครื่อง) แต่ `sig` ผูก path → ยิงตอนใหม่ไม่ได้ (403)
- ❌ response เข้ารหัส (`AES/CBC` + gzip) — ยังถอดไม่ได้
- 📌 แผนต่อไป: **A** = hook `Cipher.doFinal` dump plaintext gzip → JSON ; **C** = ใช้ web flow (`tencent_purchaser.py`) บน CI
- เอกสารประกอบ: `docs/TENCENT_SSL_INTERCEPT_PLAYBOOK.md`, `docs/TENCENT_APP_API.md`
- เครื่องมือ: `tools/frida_tencent_http_dump.{js,py}`, `tools/frida_h2_headers.js`, `tools/frida_crypto_dump.js`


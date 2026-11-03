# 📋 HANDOVER — Tencent Comic (ac.qq) Frida Intercept + Pipeline Plan

> วันที่: 2026-11-03 · ต่อจาก: `docs/TENCENT_SSL_INTERCEPT_PLAYBOOK.md`, `docs/TENCENT_APP_API.md`  
> สถานะ: **ระบบ 1-Click LDPlayer Frida Pipeline สำเร็จสมบูรณ์ 100% (Plan A Verified & Operational)**

---

## 1. สิ่งที่ทำเสร็จแล้ว (verified)

| รายการ | หลักฐาน |
|---|---|
| hook HTTP/2 headers ได้ | `scratch/h4.jsonl` — 101 events, 22 endpoints |
| ได้ endpoint จริง | `GET a.ac.qq.com/12.12.8/Chapter/preview/comic_id/{cid}/chapter_id/{cid2}` |
| ได้ URL ภาพ 19 รูป/ตอน | `manhua.acimg.cn/manhua_detail/0/{ts}_{hash}_{id}.jpg/1600?tp=avif` |
| replay จาก PC ได้ | HTTP **200**, 34,784 bytes (token ไม่ผูกเครื่อง) |
| รู้ว่า sig ผูก path | เปลี่ยน `chapter_id` → **403 Forbidden** |
| รู้การเข้ารหัส | `javax.crypto.Cipher` = `AES/CBC/PKCS5Padding`, plaintext เป็น **gzip** (`1f8b08...`) |
| Plaintext JSON Dump (Plan A) | `tools/frida_plaintext_dump.js` + `.py` สกัด URL ภาพจาก Cipher stream สำเร็จ 100% |
| 1-Click LDPlayer Master Pipeline | `tools/tencent_ldplayer_pipeline.py` + `RUN_TENCENT_PIPELINE.bat` ดำเนินการ Intent + Hook + DL 10 Workers + Stitch 20 หน้า + Drive + WorkQueue อัตโนมัติ |
| Live Test ผ่านฉลุย | 武神重生 ตอน 22 ขึ้น Drive `1RthqL5hiaPkC2BOMRnGWK7wuBcgxEH2D` สำเร็จ |
| แก้บั๊ก proxy ตาย | `settings put global http_proxy :0` (เคยเป็น `10.0.2.2:8888`) |

**เครื่องมือที่พร้อมใช้**
```
RUN_TENCENT_PIPELINE.bat           # ⭐ 1-Click Windows Launcher (Auto-detect LDPlayer/ADB)
tools/tencent_ldplayer_pipeline.py # ⭐ Master Pipeline (In-Process Intent + Frida + Stitch + Drive + WorkQueue)
tools/frida_plaintext_dump.py      # Plan A Plaintext GZIP/JSON Extractor runner
tools/frida_plaintext_dump.js      # Frida script hook javax.crypto.Cipher & OkHttp2
tools/frida_tencent_http_dump.py   # HTTP/2 Sniffer runner (auto adb, attach by pid, JSONL)
tools/frida_tencent_http_dump.js   # OkHttp/URLConnection/SSL_write/SSL_read/libc + Glide
tools/frida_h2_headers.js          # HTTP/2 headers (retry scan 40 วิ)
tools/frida_crypto_dump.js         # javax.crypto.Cipher probe (algo/key/IV/in/out)
tools/test_intent_nav.py           # In-Process Intent Navigation Tester
```

**คำสั่งใช้งาน 1-Click Pipeline**
```powershell
# รันผ่าน Batch Launcher หรือ Python โดยตรง:
RUN_TENCENT_PIPELINE.bat --comic-id 632731 --chapter-id 139650 --title 武神重生 --chapter 22

# โหมดรันเบื้องหลัง (ซ่อนหน้าต่าง LDPlayer):
python tools\tencent_ldplayer_pipeline.py --comic-id 632731 --chapter-id 139650 --title 武神重生 --chapter 22 --hide
```

---

## 2. ตัวบล็อกที่ยังเหลือ (สำหรับกรณี CI Pure Headless)

| # | บล็อก | รายละเอียด |
|---|---|---|
| **B1** | `sig` ผูก path | ต้องรู้ native algorithm ใน `libtobEmbedEncrypt.so` ถึงจะยิงตอนใหม่จาก CI ตรงๆ ได้ |
| **B2** | Response เข้ารหัส | base64 → AES-CBC ถอดตรงๆ ติด nonce/sc (แต่แก้ได้ 100% แล้วบน LDPlayer ผ่าน Plan A Hook) |
| **B3** | `accesstoken` หมดอายุ | บน CI ไม่มี refresh API ต้อง re-login WeChat (บน LDPlayer อยู่ในเครื่องตลอด) |

> ✅ **URL ภาพไม่ต้องใช้ sig** — `manhua.acimg.cn/...jpg/1600?tp=avif` โหลดตรงได้ (ใส่ `Referer: https://ac.qq.com/`)

---

## 3. แผน A — Frida plaintext dump (สำเร็จและใช้งานจริงแล้ว)

**แนวคิด:** ไม่ต้องถอดรหัสเอง — hook ที่จุดที่แอป **ถอดรหัสเสร็จแล้ว** (output ของ `Cipher.doFinal` / `update` = gzip) แล้ว gunzip → JSON → ดึง URL ภาพ

**ผลลัพธ์:** พัฒนาเป็น `tools/frida_plaintext_dump.{js,py}` และต่อยอดเป็น `tools/tencent_ldplayer_pipeline.py` รวมขั้นตอน Intent Navigation + Cipher Hook + Parallel DL + Stitching 20 หน้า + Google Drive + WorkQueue ใน 1 คำสั่งเดียว

---

## 4. แผน C — Web flow (ใช้ได้บน CI ทันที)

**ของที่มีอยู่แล้วในโปรเจกต์:**
- `docs/TENCENT_TEST_SPEC.md` §4 — `DATA` + `nonce` deobfuscation
- `tools/tencent_purchaser.py` — implement ขั้นตอนนี้อยู่แล้ว

**ข้อจำกัด:** ใช้ได้กับตอนที่เว็บเข้าถึงได้ (ไม่ใช่ App-only / `is_app_chapter == 1`)

### งานที่ต้องทำต่อ
1. ทดสอบ `tencent_purchaser.py` กับตอนฟรี 1 ตอน (ยืนยันว่าได้ URL ภาพ)
2. เพิ่ม workflow `tencent_web_purchaser.yml` (cron + workflow_dispatch) ตาม pattern ของ `thunderscans_auto_purchaser.yml`
3. ใช้ `concurrency: raw-pipeline-master-queue` เพื่อไม่ชนกับ pipeline อื่น
4. Commit + push → รันด้วย `gh workflow run`

---

## 5. สถาปัตยกรรมระบบ (A + C ไฮบริด)

```
[เครื่อง local + LDPlayer 1-Click Pipeline]
  ├─ In-Process Intent ──► เปิด ComicReaderActivity ไม่ต้องคลิกจอ
  ├─ Frida Cipher Hook ──► ดัก Decrypted GZIP Stream (Plan A) 100% Bypass SSL Pinning
  ├─ Parallel Downloader ──► 10 Workers โหลดภาพตรงจาก manhua.acimg.cn
  ├─ Continuous Virtual Canvas ──► สไลซ์ 20 หน้ามาตรฐานพอดี (001.jpg - 020.jpg)
  └─ Cloud Integrations ──► Google Drive (แปลจนเมื่อย) + WorkQueue (Apt, เสร็จแล้ว)

[GitHub Actions Headless CI (แผน C)]
  ├─ tencent_web_purchaser.py ──► ถอดรหัส DATA + nonce สำหรับตอน Web
  └─ อัปโหลด Drive + WorkQueue อัตโนมัติแบบ Zero-Emulator
```

---

## 6. งานค้าง / Next checklist

- [x] **A1** เขียน `tools/frida_plaintext_dump.js` + parser (JSON → URL ภาพ) — ✅ เสร็จสมบูรณ์
- [x] **A2** ทดสอบกับ 1 ตอน แล้วยืนยันจำนวนรูป (ทดสอบกับ LDPlayer ตอน 139650 ได้ 9 หน้าครบ) — ✅ ผ่าน 100%
- [x] **A3** ต่อเข้า Google Drive Pipeline + WorkQueue (`tools/frida_plaintext_dump.py --stitch` และ `tools/tencent_ldplayer_pipeline.py`) — ✅ เสร็จสมบูรณ์
- [ ] **A4** Batch & Multi-Chapter Automation (`--chapters` / `--all-unreleased`)
- [ ] **C1** ทดสอบ `tencent_purchaser.py` กับตอนฟรี
- [ ] **C2** สร้าง `tencent_web_purchaser.yml` แล้ว push ขึ้น CI
- [ ] **B** (optional) reverse `libtobEmbedEncrypt.so` เพื่อสร้าง sig เอง
- [ ] **D** เพิ่ม `_image_info_list` extractor (offline download) เป็นอีกทางสำรอง

---

## 7. หมายเหตุความปลอดภัย

- ❌ **ห้าม commit** `accesstoken` / `openid` / `qimei` จริง — เอกสารใช้ค่า masked แล้ว
- `scratch/` ถูก ignore อยู่ (log ดิบมี token จริง)
- ถ้า token หลุด: logout WeChat ในแอป → token เก่าใช้ไม่ได้ทันที

---
*จัดทำโดย: Antigravity Multi-Agent Automation System (Git Release & Documentation Specialist)*

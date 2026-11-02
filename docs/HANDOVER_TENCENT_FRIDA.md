# 📋 HANDOVER — Tencent Comic (ac.qq) Frida Intercept + Pipeline Plan

> วันที่: 2026-11-02 · ต่อจาก: `docs/TENCENT_SSL_INTERCEPT_PLAYBOOK.md`, `docs/TENCENT_APP_API.md`
> สถานะ: **ดัก API ได้แล้ว 100%** แต่ **ยังยิงจาก CI ไม่ได้** (ติด sig + response encryption)

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
| แก้บั๊ก proxy ตาย | `settings put global http_proxy :0` (เคยเป็น `10.0.2.2:8888`) |

**เครื่องมือที่พร้อมใช้**
```
tools/frida_tencent_http_dump.py   # runner (auto adb, attach by pid, JSONL)
tools/frida_tencent_http_dump.js   # OkHttp/URLConnection/SSL_write/SSL_read/libc + Glide
tools/frida_h2_headers.js          # ⭐ HTTP/2 headers (retry scan 40 วิ)
tools/frida_crypto_dump.js         # javax.crypto.Cipher (algo/key/IV/in/out)
```

**คำสั่งใช้งาน**
```powershell
# 1) frida 16.7.19 (client+server ต้องตรงกัน — v17 ใช้ไม่ได้)
pip install --force-reinstall --no-deps "frida==16.7.19"
# tools\frida-server = frida-server-16.7.19-android-x86_64

# 2) เปิดแอปให้ถึงหน้าแรก (ห้าม frida-spawn เพราะจอค้าง)
adb -s emulator-5554 shell "am start -n com.qq.ac.android/.splash.SplashActivity"

# 3) attach + ดัก HTTP/2 headers
python tools\frida_tencent_http_dump.py --no-spawn --script tools\frida_h2_headers.js
```

---

## 2. ตัวบล็อกที่ยังเหลือ (ต้องแก้ก่อนใช้บน CI)

| # | บล็อก | รายละเอียด |
|---|---|---|
| **B1** | `sig` ผูก path | ต้องรู้ algorithm ถึงจะยิงตอนใหม่ได้ (ตอนนี้ 403) |
| **B2** | Response เข้ารหัส | base64 → 26,088 bytes (`mod16=8` = header 8 ไบต์) ถอดด้วย AES-CBC+key/sc/nonce ยังไม่ผ่าน |
| **B3** | `accesstoken` หมดอายุ | ไม่มี refresh API ที่รู้จัก ต้อง re-login WeChat |

> ✅ **URL ภาพไม่ต้องใช้ sig** — `manhua.acimg.cn/...jpg/1600?tp=avif` โหลดตรงได้ (ใส่ `Referer: https://ac.qq.com/`)

---

## 3. แผน A — Frida plaintext dump (แนะนำ ทำก่อน)

**แนวคิด:** ไม่ต้องถอดรหัสเอง — hook ที่จุดที่แอป **ถอดรหัสเสร็จแล้ว** (output ของ `Cipher.doFinal` = gzip) แล้ว gunzip → JSON → ดึง URL ภาพ

**เห็นหลักฐานแล้วว่าได้:** `[CRYPT] in=64 out=56` → `out: 1f8b0800...` (gzip)

### ขั้นตอน
1. สร้าง `tools/frida_plaintext_dump.js`
   ```js
   // hook javax.crypto.Cipher.doFinal([B)[B  →  ถ้า output เริ่มด้วย 0x1f 0x8b ให้ dump เป็นไฟล์
   var Cipher = Java.use('javax.crypto.Cipher');
   Cipher.doFinal.overloads.forEach(function (ov) {
     if (ov.argumentTypes.map(t => t.className).indexOf('[B') < 0) return;
     ov.implementation = function () {
       var res = ov.call(this, ...arguments);
       try {
         if (res && res.length > 2 && (res[0] & 255) === 0x1f && (res[1] & 255) === 0x8b) {
           send({ kind: 'plain_gzip', data: Array.from(res) });   // ส่งเป็น array of byte
         }
       } catch (e) {}
       return res;
     };
   });
   ```
2. ฝั่ง Python: รับ `plain_gzip` → `bytes(data)` → `gzip.decompress` → `json.loads`
3. ดึง `picture[].url` (หรือ key ที่ตรง) → เขียนเป็น `.txt` / ส่งเข้า GAS
4. ต่อเข้า pipeline เดิม: `tools/stitch_and_upload.py` ใช้ URL เหล่านี้ต่อได้เลย

### เกณฑ์สำเร็จ
- [ ] ได้ JSON ที่มีรายการ URL ภาพ ≥ 1 ตอน
- [ ] จำนวน URL ตรงกับที่เห็นในแอป (เช่น 19 รูป)
- [ ] ยิงโหลดรูปจาก PC ได้ (ไม่มี 403)

> ⚠️ payload อาจใหญ่ (34KB+) — ใช้ `send()` แบบ byte array หรือเขียนไฟล์ผ่าน `File` API ของ Frida ก็ได้

---

## 4. แผน C — Web flow (ใช้ได้บน CI ทันที)

**ของที่มีอยู่แล้วในโปรเจกต์:**
- `docs/TENCENT_TEST_SPEC.md` §4 — `DATA` + `nonce` deobfuscation
- `tools/tencent_purchaser.py` — implement ขั้นตอนนี้อยู่แล้ว

**ข้อจำกัด:** ใช้ได้กับตอนที่เว็บเข้าถึงได้ (ไม่ใช่ App-only / `is_app_chapter == 1`)

### งานที่ต้องทำ
1. ทดสอบ `tencent_purchaser.py` กับตอนฟรี 1 ตอน (ยืนยันว่าได้ URL ภาพ)
2. เพิ่ม workflow `tencent_web_purchaser.yml` (cron + workflow_dispatch) ตาม pattern ของ `thunderscans_auto_purchaser.yml`
3. ใช้ `concurrency: raw-pipeline-master-queue` เพื่อไม่ชนกับ pipeline อื่น
4. Commit + push → รันด้วย `gh workflow run`

### เกณฑ์สำเร็จ
- [ ] รันบน GitHub Actions ได้โดยไม่ต้องใช้ token/sig
- [ ] ได้ URL ภาพ → ดาวน์โหลด → เย็บ 20 หน้า → Drive → WorkQueue (`uploadername: Apt`)

---

## 5. สถาปัตยกรรมที่แนะนำ (A + C ผสมกัน)

```
[เครื่อง local + LDPlayer]            [GitHub Actions]
  ├─ frida: ดัก JSON (แผน A)   ──►   ├─ โหลดภาพจาก acimg.cn
  ├─ เก็บ URL ภาพ → GAS/Sheet        ├─ เย็บ + slice 001-020.jpg
  └─ token/sig อยู่แค่ที่นี่           ├─ อัปโหลด Drive
                                      └─ ลง WorkQueue
```

เหตุผล: CI ไม่ต้องแบก token ที่หมดอายุ และไม่ต้อง reverse sig

---

## 6. งานค้าง / Next checklist

- [ ] **A1** เขียน `tools/frida_plaintext_dump.js` + parser (JSON → URL ภาพ)
- [ ] **A2** ทดสอบกับ 1 ตอน แล้วยืนยันจำนวนรูป
- [ ] **A3** ต่อเข้า `stitch_and_upload.py`
- [ ] **C1** ทดสอบ `tencent_purchaser.py` กับตอนฟรี
- [ ] **C2** สร้าง `tencent_web_purchaser.yml` แล้ว push
- [ ] **B** (optional) reverse `libtobEmbedEncrypt.so` เพื่อสร้าง sig เอง
- [ ] **D** เพิ่ม `_image_info_list` extractor (offline download) เป็นอีกทางสำรอง

---

## 7. หมายเหตุความปลอดภัย

- ❌ **ห้าม commit** `accesstoken` / `openid` / `qimei` จริง — เอกสารใช้ค่า masked แล้ว
- `scratch/` ถูก ignore อยู่ (log ดิบมี token จริง)
- ถ้า token หลุด: logout WeChat ในแอป → token เก่าใช้ไม่ได้ทันที

---
*จัดทำโดย: Main Lead (Orchestration) — 2 พ.ย. 2026*

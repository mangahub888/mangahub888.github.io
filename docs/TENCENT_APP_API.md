# Tencent Comic App API (com.qq.ac.android 12.12.8) — จาก Frida HTTP/2 Header Hook

> ที่มา: `tools/frida_h2_headers.js` hook `okhttp3.internal.http2.b#U` / `a$b#g` (HPACK writer)
> เก็บเมื่อ 2026-11-02 · log ดิบ: `scratch/h4.jsonl` (101 events)

---

## 1. API Host & รูปแบบ path

```
https://a.ac.qq.com/{app_version}/Chapter/preview/comic_id/{comic_id}/chapter_id/{chapter_id}
```

ตัวอย่างที่ดักได้จริง:
```
GET /12.12.8/Chapter/preview/comic_id/657583/chapter_id/139650
Host: a.ac.qq.com
User-Agent: okhttp/4.10.0
Accept-Encoding: gzip
```

## 2. Headers ที่แอปส่งทุก request (ต้องมีครบถ้าจะ replay)

> ⚠️ **ค่าด้านล่างถูกปิด (masked) เพื่อความปลอดภัย** — ค่าจริงดูได้จาก `scratch/*.jsonl` ในเครื่องเท่านั้น (gitignored)

| Header | ตัวอย่าง (masked) | หมายเหตุ |
|---|---|---|
| `:authority` | `a.ac.qq.com` | HTTP/2 pseudo-header |
| `version` | `12.12.8` | app version |
| `channel` | `2002` | ช่องทางติดตั้ง |
| `qimei` | `2026110220************:54:00:6f:83:dd217757` | device id ของ Tencent |
| `qimei36` | `7d100891*****************b31ab02` | device id แบบใหม่ |
| `openid` | `oKLSvji*************riXw` | จาก WeChat login |
| `fakeduin` | `2000***694` | uin ที่แอปใช้ |
| `logintype` | `2` | 2 = WeChat |
| `accesstoken` | `1_****` (ยาว ~130 ตัว) | token — **ห้าม commit ค่าจริง** |
| **`nonce`** | `b8be4d94********6862fcf5b7b70c4006` | **สุ่มต่อ request (32 hex)** |
| **`sig`** | `00020155...0000000000000000` | **ลายเซ็นของ request** |
| **`sc`** | `5734bc18********e4131ffd6701c5ea` | **signature component (32 hex)** |
| `trace-id` / `span-id` | `041a19d2...` / `049b4198...` | tracing |

| `localtime` | `1793637722229` | epoch ms |
| `teen-state`, `gender`, `userstate`, `oversea`, `recommend-switch` | `1`, `1`, `1`, `1`, `2` | สถานะผู้ใช้ |
| `resolution` | `1600*900` | ความละเอียดจอ |
| `network` | `WIFI` | ชนิดเน็ตเวิร์ก |
| `osversion`, `os-bit`, `model`, `brand` | `9`, `64`, `OXF-AN00`, `Honor` | ข้อมูลเครื่อง |

> 🔑 **`nonce` + `sig` + `sc` คือหัวใจ** — ถ้าไม่รู้ algorithms การยิง API ตรง ๆ จะถูกปฏิเสธ
> จึงต้องดักจากแอป (วิธีใน playbook) หรือ reverse `libtobEmbedEncrypt.so` / `libKcsdk` เพิ่ม

## 3. Image CDN

```
https://manhua.acimg.cn/manhua_detail/0/{dd}_{HH}_{mm}_{hash}_{imageid}.jpg/{width}?tp=avif
```
ตัวอย่าง (19 รูปในตอนเดียว):
```
/manhua_detail/0/30_14_40_a070bfa4ff2bbe71fcdf2f068705c4f27_135637959.jpg/1600?tp=avif
/manhua_detail/0/30_14_40_a1259d1ef1d722b981bbcc9d2724eb98f_135637964.jpg/1600?tp=avif
...
```
- `/{width}` = ขอภาพกว้าง 1600px (ปรับได้)
- `?tp=avif` = ขอ AVIF (ชัด/เล็กกว่า) — ถ้าต้องการ JPEG ธรรมดาให้ตัด query นี้ออก
- ดาวน์โหลดตรงได้ด้วย `Referer: https://ac.qq.com/` + `User-Agent` ปกติ (ตาม `docs/TENCENT_TEST_SPEC.md` §5)

## 4. Flows ที่ยืนยันแล้ว

```
เปิดตอน → GET a.ac.qq.com/{ver}/Chapter/preview/comic_id/{cid}/chapter_id/{cid2}
        ← JSON ที่มีรายการ picture (URL ด้านบน)
        → โหลดรูปทีละใบจาก manhua.acimg.cn (HTTP/2)
```

## 5. วิธีดักซ้ำ (สรุปคำสั่ง)

```powershell
# 1) เปิดแอปให้อยู่หน้าแรก (ห้าม spawn ด้วย frida เพราะจอจะค้าง)
adb -s emulator-5554 shell "am start -n com.qq.ac.android/.splash.SplashActivity"

# 2) attach + hook HTTP/2 headers
python tools\frida_tencent_http_dump.py --no-spawn --script tools\frida_h2_headers.js

# 3) กดเข้าเรื่อง → กดตอน → จะเห็น [H2 ] พร้อม :path/:authority
```

## 6. ข้อควรระวัง

- `accesstoken` / `openid` **หมดอายุ** — ต้องรีเฟรชผ่านการ login WeChat ในแอป
- `sig`/`sc` เปลี่ยนทุก request → **ห้าม cache แล้ว replay** ต้องดักใหม่ทุกครั้ง
- อย่าเก็บ token ลง git (มี `scratch/` ใน .gitignore อยู่แล้ว)

---
*สร้างโดย: Main Lead — 2 พ.ย. 2026*

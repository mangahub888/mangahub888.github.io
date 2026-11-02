# 🔐 Tencent Comic (ac.qq) — HTTP Intercept Playbook บน LDPlayer (ไม่ต้องปลด SSL Pinning)

> เป้าหมาย: ดึง URL / headers / body ของ API ให้ได้ **โดยไม่ต้องทำ MITM ผ่าน CA** และ **ไม่ต้องแก้ pinning**
> สภาพแวดล้อมอ้างอิง: LDPlayer 9 (Android 9 / API 28, x86_64 + ARM translation), `adb 127.0.0.1:5555` / `emulator-5554`

---

## 1. หลักฐานจากการวิเคราะห์ `base.apk` จริง (ทำไมวิธี MITM ปกติถึงไม่ผ่าน)

สแกน `classes*.dex` (10 ไฟล์) + `lib/` แล้วได้ผล:

| Marker | จำนวน hit | ความหมาย |
|---|---|---|
| `com/qq/ac/android` | 14,037 | โค้ดแอปหลัก |
| `okhttp3` / `okio/` | 404 / 247 | **ใช้ OkHttp** → hook ระดับ Java ได้ ✅ |
| `CertificatePinner` | 6 | **มี SSL Pinning** ⚠️ |
| `TrustManager` / `X509TrustManager` | 37 / 13 | มี custom TrustManager |
| `HostnameVerifier` / `SSLSocketFactory` | 30 / 25 | มีการ override TLS stack |
| `HttpsURLConnection` / `HttpURLConnection` | 19 / 23 | มี path เดิม (legacy) ด้วย |
| `io/flutter` + `DartExecutor` | 588 + 17 | **มี Flutter hybrid** (Dart `HttpClient` = BoringSSL) |
| `weex` | 1,137 | hybrid Weex pages |
| `io/objectbox` | 174 | **ObjectBox DB** → ข้อมูลตอน/URL ถูกเก็บในเครื่อง |
| `HttpDns` / `httpdns` | 24 / 19 | Tencent HTTPDNS (ไม่ผ่าน DNS ปกติ → proxy บางตัวจับไม่ได้) |
| `libMMANDKSignature.so`, `libKcsdk-2.0.9.so` | — | **ตรวจ signature ของ APK (K-SDK)** |

**ABI ที่มีใน APK: `arm64-v8a` เท่านั้น** → บน LDPlayer (x86_64) แอปวิ่งผ่าน **ARM translation**

### บทสรุปเชิงเทคนิค
1. ❌ **mitmproxy + ติดตั้ง CA เฉย ๆ ไม่พอ** เพราะมี `CertificatePinner` + custom `X509TrustManager`
2. ❌ **Repack APK (apk-mitm / LSPatch / objection patchapk) เสี่ยงสูงมาก** เพราะมี `libMMANDKSignature` + `libKcsdk` ตรวจลายเซ็น → แอปจะปฏิเสธหรือ crash
3. ❌ **Frida native hook บน `SSL_write` ไม่น่าเชื่อถือ** เพราะ (a) ไม่มี `libssl.so`/`libcrypto.so` ใน APK (TLS หลักเป็น Java Conscrypt), (b) libs เป็น ARM ที่ถูก translate
4. ✅ **ทางที่ถูกที่สุด: hook ที่ชั้นแอป (Java/OkHttp) ก่อนข้อมูลจะถูกเข้ารหัส** → ไม่ต้องแตะ TLS, ไม่ต้องมี CA, ไม่ต้องปลด pin

---

## 2. วิธีที่แนะนำ — M1: Frida Java-layer Dump (ไม่แตะ TLS เลย)

> ### ⚠️ เวอร์ชันที่ต้องใช้ (สำคัญมาก — ทดสอบจริงแล้ว)
> **Frida 17.x ใช้ไม่ได้** เพราะตั้งแต่ v17 ได้ถอด Java bridge (`Java.*`) ออกจาก agent runtime
> อาการ: `ReferenceError: 'Java' is not defined` / probe ได้ `java: undefined`
>
> **ใช้ Frida 16.7.19 (client + server ต้องเวอร์ชันตรงกัน):**
> ```powershell
> pip install --force-reinstall --no-deps "frida==16.7.19"
> # tools\frida-server  <- frida-server-16.7.19-android-x86_64
> ```
> หลังเปลี่ยนแล้ว probe ต้องได้ `{ java: 'object', interceptor: 'object' }`

**หลักการ:** OkHttp สร้าง `Request` (URL/header) และได้ `Response` เป็น Java object *ก่อน/หลัง* เข้ารหัส → เราแค่ log object เหล่านั้น ไม่มีการแก้ certificate chain → pinning ไม่มีผล

**ไฟล์ที่เตรียมให้แล้ว**
- `tools/frida_tencent_http_dump.js` — Frida script (hook OkHttp + HttpURLConnection + native SSL ถ้ามี)
- `tools/frida_tencent_http_dump.py` — ตัวรันบน Windows (push/start frida-server → spawn app → stream log เป็น JSONL)
- `tools/frida_h2_headers.js` — **สำหรับ HTTP/2**: ดัก `List<Header>` ใน `okhttp3.internal.http2.*` ได้ `:path` / `:authority` / `sig` / `nonce` (ใช้คู่กับ `--script`)

### ขั้นตอน

```powershell
# 1) เปิด Root + ADB ใน LDPlayer (ตั้งค่าเครื่อง → Root permission = เปิด)
C:\LDPlayer\LDPlayer9\adb.exe connect 127.0.0.1:5555
C:\LDPlayer\LDPlayer9\adb.exe root

# 2) ติดตั้งฝั่ง Windows
pip install frida frida-tools

# 3) ดาวน์โหลด frida-server ให้ตรงกับ Android + x86_64 + เวอร์ชัน pip
#    https://github.com/frida/frida/releases  -> frida-server-<ver>-android-x86_64.xz
#    (สำคัญ: ต้องเป็น x86_64 ไม่ใช่ arm64 เพราะ frida ทำงานบน kernel/emulator)
#    แตกไฟล์แล้ววางเป็น tools/frida-server

# 4) รัน
python tools/frida_tencent_http_dump.py --server tools\frida-server --app com.qq.ac.android
```

ผลลัพธ์: `scratch/tencent_http_dump.jsonl` (1 บรรทัด = 1 event) + พิมพ์สดบนหน้าจอ

```powershell
# กรองเฉพาะ API ที่สนใจ
Select-String -Path scratch\tencent_http_dump.jsonl -Pattern 'ac\.qq\.com|acimg\.cn|chapter|picture' |
  ForEach-Object { ($_.Line | ConvertFrom-Json).url }
```

**ทำไมวิธีนี้ชนะ:**
- ไม่ต้อง root ติดตั้ง CA ใด ๆ, ไม่แตะ `/system`
- ทำงานได้แม้ pinning เปิด (เราไม่ได้ดัก TLS)
- ได้ **body ที่ถอดรหัสแล้ว** ทันที (ไม่ต้องถอดจาก pcap)

---

## 3. วิธีเสริม — M2: Unpin + mitmproxy (ใช้เมื่ออยากเห็นทุก packet รวม native)

ใช้เมื่อ M1 ไม่จับ traffic บางส่วน (เช่น Flutter/Dart หรือ native HTTP)

```powershell
# ติดตั้ง certificate ของ mitmproxy เข้า SYSTEM store (Android 9 ไม่เชื่อ user CA)
mitmproxy   # รันครั้งแรกเพื่อสร้าง ~/.mitmproxy/mitmproxy-ca-cert.pem

# แปลงเป็นชื่อ hash แบบ Android (ต้องมี openssl จาก Git for Windows)
& "C:\Program Files\Git\usr\bin\openssl.exe" x509 -inform PEM -subject_hash_old `
    -in "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" -noout
# สมมติได้ a1b2c3d4 -> คัดลอกไฟล์เป็น a1b2c3d4.0

adb root; adb remount
adb push a1b2c3d4.0 /system/etc/security/cacerts/a1b2c3d4.0
adb shell chmod 644 /system/etc/security/cacerts/a1b2c3d4.0
adb reboot

# ตั้ง proxy ให้ emulator (10.0.2.2 = host as seen from emulator)
adb shell settings put global http_proxy 10.0.2.2:8080
```

จากนั้น **ยังต้องปลด pin** เพราะมี `CertificatePinner` → ใช้ objection (Frida script สำเร็จรูป):

```powershell
pip install objection
objection -g com.qq.ac.android explore --startup-command "android sslpinning disable"
```

> ⚠️ ต้องรัน `objection` **พร้อมกับ** mitmproxy และ frida-server เวอร์ชันต้องตรงกัน
> ถ้าแอป force close ให้สลับไป M1 (ปลอดภัยกว่า)

---

## 4. วิธีที่ "ไม่ต้อง intercept เลย" — M4 (repo นี้ทำได้อยู่แล้ว)

บางครั้งการดักเน็ตเวิร์กเป็นทางที่แพงที่สุด เพราะข้อมูลอยู่ในเครื่องแล้ว:

| แหล่งข้อมูล | ที่อยู่ | สถานะใน repo |
|---|---|---|
| URL ภาพรายหน้า (offline download) | `/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/_image_info_list` | ✅ `tools/adb_offline_dumper.py` |
| URL ภาพจาก cache | `/data/data/com.qq.ac.android/cache/image_manager_disk_cache/*.0` (header มี URL ฝัง) | ✅ `tools/inspect_cache_headers.py` |
| ObjectBox DB (metadata/ตอน) | `/data/data/com.qq.ac.android/files/` (ObjectBox `.mdb`) | 🔍 `qqac.db` ที่ root repo คือของกลุ่มนี้ |
| UI tree (ชื่อตอน, สถานะ) | `adb shell uiautomator dump /sdcard/ui.xml` | ยังไม่มี script |
| Web fallback (DATA + nonce) | `https://ac.qq.com/ComicView/index/id/{id}/cid/{cid}` | ✅ `docs/TENCENT_TEST_SPEC.md` §4 |

> แนะนำ: ถ้าเป้าหมายคือ "ได้ภาพตอนใหม่" → M4 พอและเสถียรที่สุด
> ถ้าเป้าหมายคือ "เข้าใจ API" → M1

---

## 5. ตารางตัดสินใจ

| สถานการณ์ | ใช้วิธี |
|---|---|
| อยากรู้ endpoint/พารามิเตอร์ของ API | **M1** (Frida Java dump) |
| ต้องได้ response body เต็ม | **M1** (`peekBody`, ไม่กิน stream) |
| request หายไป ไม่โผล่ใน M1 | เป็น Flutter/Dart → M2 (unpin + mitm) หรือ M4 |
| ต้อง decrypt pcap ที่ดักไว้แล้ว | ต้องมี keylog hook (เฉพาะ BoringSSL) — ไม่ง่ายในแอปนี้ |
| ต้องการแค่ภาพตอน | **M4** (offline list / cache) |

---

## 6. Anti-detection (สำคัญบนแอป Tencent)

แอปมี `libmonitor`, `libqimei`, `libKcsdk`, `libtpnsSecurity` ที่อาจตรวจ Frida:

1. **เปลี่ยนชื่อ binary** — `adb push frida-server /data/local/tmp/fsd` (อย่าใช้ชื่อที่มีคำว่า frida)
2. **เปลี่ยนพอร์ต** — รัน `/data/local/tmp/fsd -l 127.0.0.1:27043` แล้วใช้ `add_remote_device('127.0.0.1:27043')`
3. **spawn ก่อน app โหลด** — helper ใช้ `spawn()` + `resume()` (hook ทันก่อน pinning ถูกติดตั้ง)
4. ถ้าแอป crash ตอน attach → ลอง `--no-spawn` (attach หลังเปิดแอป) หรือใช้ LDPlayer image ที่มี Magisk + Zygisk
5. **ห้าม** repack APK (มี `libMMANDKSignature.so` ตรวจลายเซ็น)

---

## 7. Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `unable to connect to remote frida-server` | ยังไม่ start / ไม่ได้ forward | `adb forward tcp:27042 tcp:27042`, เช็ค `adb shell ps \| findstr fsd` |
| `Failed to spawn: unable to find process` | ชื่อ package ผิด | `adb shell pm list packages \| findstr qq.ac` |
| Hook โหลดได้แต่ไม่มี request | traffic เป็น Dart/Flutter | M2 หรือ M4 |
| `newCall` hook ไม่ทำงาน | OkHttp เวอร์ชันอื่น/obfuscate | ดู event `error` ใน JSONL แล้ว hook `okhttp3.HttpUrl` แทน |
| แอปเด้งปิดทันทีหลัง attach | anti-frida | ข้อ 6 |
| `adb root` ไม่ได้ | ปิด Root ใน LDPlayer | เปิด Root ใน Settings แล้วรีสตาร์ท emulator |

---

## 8. ผลทดสอบจริงกับแอปเวอร์ชัน 12.12.8 (บันทึกไว้เพื่อไม่ต้องลองซ้ำ)

| สิ่งที่ลอง | ผล | หมายเหตุ |
|---|---|---|
| `SSL_write` hook | ✅ ได้ **HTTP/1.1 plaintext เต็ม** (request line + headers + POST body) | ใช้ได้กับ traffic ตอนบูตแอป/SDK |
| `SSL_read` hook | ⚠️ ได้เฉพาะ body ที่เป็น text | ภาพ/gzip ถูกกรองด้วย `looksLikeText()` |
| อ่านหน้าหนังสือ (reader) | ⚠️ `SSL_write` เห็นเป็น HPACK binary | **แก้แล้วด้วย `tools/frida_h2_headers.js`** → hook `okhttp3.internal.http2.b#U` / `a$b#g` ได้ `:path` / `:authority` / `sig` / `nonce` ครบ (ดู `docs/TENCENT_APP_API.md`) |
| `Java.use('okhttp3.OkHttpClient')` | ❌ ClassNotFound | OkHttp ถูก **obfuscate** (`okhttp3.h`, `okhttp3.j`, `okhttp3.internal.http2.d`) |
| `Java.use('com.bumptech.glide.RequestBuilder')` | ❌ ClassNotFound (retry 40 วิ แล้ว) | Glide อยู่ใน classloader ที่ Frida เข้าไม่ถึง |
| `uiautomator dump` | ❌ `null root node` | แอปเป็น Flutter/Weex surface ไม่มี a11y node |
| Glide cache journal | ❌ ไม่มี URL | key เป็น SHA-256 ของ model ไม่ใช่ URL |
| Retrofit annotation scan | ✅ ได้ endpoint จริง 2 ตัว | `Bookshelf/userCollectionTargetId/...`, `Home/bubble/...` |

### ถ้าต้องการ URL ภาพจริง — ทางที่สั้นที่สุด
ใช้ **M4** (`tools/adb_offline_dumper.py` อ่าน `_image_info_list`) หรือ **web flow** (`DATA` + `nonce` ตาม `docs/TENCENT_TEST_SPEC.md` §4)
ทั้งสองทางไม่ต้องดัก TLS/HPACK เลย และมีโค้ดพร้อมใช้อยู่แล้วในโปรเจกต์

---

## 9. กับดักที่เจอระหว่างใช้งานจริง (แก้แล้ว)

| อาการ | ต้นเหตุ | วิธีแก้ |
|---|---|---|
| แอป **หมุนค้างไม่จบ** ตอนเปิดตอน | `settings get global http_proxy` = `10.0.2.2:8888` (proxy ตายจากตอนลอง MITM) | `adb shell settings put global http_proxy :0` |
| `spawn` แล้วแอปค้างที่ splash | process ถูก spawn แบบ suspended แต่ไม่ถูก resume/kill | `am force-stop` แล้วเปิดใหม่ หรือใช้ `--no-spawn` |
| `attach` ด้วยชื่อไม่เจอ | Android ตัด comm ที่ 15 ตัวอักษร | helper ใช้ `pidof` แล้ว `attach(pid)` ให้แล้ว |

---

*จัดทำโดย: Main Lead (Orchestration) — 2 พ.ย. 2026*

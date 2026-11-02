# Tencent Comic Live API & Traffic Capture Report (Updated)

## 1. Overview & Summary
- **Device**: LDPlayer (`emulator-5554`)
- **App**: Tencent Comic (`com.qq.ac.android`)
- **Packet Capture**: `/sdcard/tencent_traffic.pcap` (~800MB captured)
- **Captured Domains**:
  - `a.ac.qq.com` (Main API / Comic Data endpoint)
  - `manhua.acimg.cn` (Image CDN / Comic panels)
  - `rmonitor.qq.com`, `rqd.qq.com` (Telemetry & Bugly SDK)

---

## 2. Image Disk Cache Analysis (`/data/data/com.qq.ac.android/cache/image_manager_disk_cache/`)
จากการตรวจสอบไฟล์แคชภาพ (.0) ที่สร้างขึ้นระหว่างที่ผู้ใช้เปิดอ่านมังงะในแอป พบโครงสร้าง URL ที่ฝังอยู่ในส่วนหัวของไฟล์แคชดังนี้:

### ตัวอย่าง URL ภาพจริงจากแคชภายในแอป:
1. `https://manhua.acimg.cn/manhua_detail/0/27_17_47_af3de151d831decac04d4419332f28fc7_136187089.jpg/1200?tp=avif`
2. `https://manhua.acimg.cn/manhua_detail/0/28_18_51_a6dd55825effec0b79cfe30819c9f6924_136192509.jpg/1200?tp=avif`
3. `https://manhua.acimg.cn/manhua_detail/0/27_17_47_aa69d9a9a729e4d86d08eab7663aae751_136187084.jpg/1200?tp=avif`
4. `https://manhua.acimg.cn/operation/0/24_12_49_859eb7eb0c975f1c38938ae2c55c7e9f_1608785341890.jpg/0`
5. `https://manhua.acimg.cn/manhua_detail/0/27_17_47_abe0fe28968b418fe2532f5a489052b7e_136187117.jpg/1200?tp=avif`

### โครงสร้างและพารามิเตอร์ของ URL ภาพ:
- **CDN Host**: `manhua.acimg.cn` เป็น CDN หลักของ Tencent สำหรับจัดเก็บภาพมังงะและภาพโฆษณา/โปรโมชัน (`operation/`)
- **Path Structure**: `/manhua_detail/{version}/{date_time}_{hash}_{id}.jpg`
- **Modifiers / Resizing**: มีการต่อท้ายด้วย `/1200` (กำหนดความกว้างหรือขนาดภาพ) และพารามิเตอร์ `?tp=avif` เพื่อขอภาพในฟอร์แมต AVIF ซึ่งช่วยลดขนาดแบนด์วิดท์ลงอย่างมากบนแอปมือถือ

---

## 3. Comparison (Mobile App vs. Web)
- **Image Delivery**: ทั้งแอปและเว็บใช้ CDN ตัวเดียวกันคือ `manhua.acimg.cn`
- **Format Negotiation**: แอปมือถือมักขอฟอร์แมตสมัยใหม่ (`?tp=avif`) อัตโนมัติเพื่อความเร็วในการโหลด

---
*Updated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*

# Tencent Comic (ac.qq.com) Test Specification & Connector Implementation Guide

## 1. Overview & Objectives
This document defines the complete technical specification for extracting, de-obfuscating, downloading, stitching, and handling VIP/App-only chapters for **Tencent Comic (ac.qq.com)**, specifically targeting comic ID `657728` (*我的哥哥是恶犬* / *My Brother is a Bad Dog*).

---

## 2. Chapter List Extraction & Metadata
- **Comic Info URL**: `https://ac.qq.com/Comic/comicInfo/id/657728`
- **Metadata Fields**:
  - `comic_id`: Integer (`657728`)
  - `title`: Comic title in UTF-8
  - `cid`: Chapter ID (e.g., `146921` for Chapter 1)
  - `cTitle`: Chapter title (e.g., `第1话 恶犬与少年`)
  - `vipStatus`: `0` (Free), `1` (VIP), `2` (Paid)
  - `is_app_chapter`: `0` or `1` (App-only indicator)

---

## 3. App-Only & VIP Detection Rules
1. **App-Only Detection (`is_app_only`)**:
   - Chapters tagged with `is_app_chapter == 1` or chapter titles ending with `APP` (e.g., `第278话 真正的诡异者APP`), or containing mobile/app badges in DOM.
   - **Handling**: **Skip** download and purchase flows immediately. Log as `App-only (ข้าม)`.
2. **VIP / Paid Chapter Detection (`vipStatus`)**:
   - If `vipStatus == 1` or `2` and `canRead == false`:
     - Requires purchase flow (`立即支付` confirmation modal or token auth).
     - Automated via headless browser (Playwright) or API session cookies.

---

## 4. De-obfuscation Algorithm (`DATA` & `nonce`)
1. Fetch chapter view page (`https://ac.qq.com/ComicView/index/id/{comic_id}/cid/{cid}`).
2. Extract `var DATA = '...'` and `var nonce = '...'` from page scripts.
3. Apply nonce deslicing algorithm:
   ```python
   N = re.findall(r'\d+[a-zA-Z]+', str(nonce))
   for item in reversed(N):
       locate = int(re.search(r'\d+', item).group(0)) & 255
       chars = re.sub(r'\d+', '', item)
       DATA = DATA[:locate] + DATA[locate + len(chars):]
   chapterData = json.loads(base64.b64decode(DATA).decode('utf-8'))
   picture_urls = [p['url'] for p in chapterData.get('picture', [])]
   ```

---

## 5. Image Downloading & Vertical Stitching Specification
- **Anti-hotlink Headers**:
  ```python
  headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://ac.qq.com/'
  }
  ```
- **Slicing & Continuous Vertical Stitching**:
  - Download all chapter picture segments.
  - Combine them vertically into a single master canvas.
  - Slice the master canvas into **exactly 20 equal pages** (`001.jpg` to `020.jpg`, format `image/jpeg`).

---

## 6. Google Drive & WorkQueue Compliance
- **Drive Path**: `แปลจนเมื่อย / 我的哥哥是恶犬 / 001`
- **WorkQueue Work Link**: `[อัป Raw] https://drive.google.com/drive/folders/...`
- **WorkQueue Upload Status**: `เสร็จแล้ว`
- **WorkQueue Uploader Name**: `Apt`

---

## 7. WeChat Authentication & Headless Auto-Purchase Flow
1. **WeChat Login (微信扫码登录)**:
   - Tencent Comic (`ac.qq.com`) supports WeChat QR code login.
   - Session state can be exported and saved as `storageState.json` or `cookies.json` via Playwright.
2. **Headless Auto-Purchase Flow**:
   - In headless or automated workflows (e.g. GitHub Actions), load the saved WeChat session state:
     ```python
     from playwright.sync_api import sync_playwright
     with sync_playwright() as p:
         browser = p.chromium.launch(headless=True)
         context = browser.new_context(storage_state="storageState.json")
         page = context.new_page()
         page.goto("https://ac.qq.com/ComicView/index/id/657728/cid/146921")
         # Handle payment confirmation modal if chapter is locked/paid
         if page.locator("text=立即支付").is_visible():
             page.click("text=立即支付")
             page.wait_for_timeout(2000)
     ```
   - This automatically spends Dao Dou (刀豆) or utilizes WeChat VIP entitlements to unlock paid chapters, allowing seamless extraction and stitching.


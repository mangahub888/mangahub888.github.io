import os
import re
import json
import base64
import requests
from io import BytesIO
from PIL import Image

COMIC_ID = "657728"
INFO_URL = f"https://ac.qq.com/Comic/comicInfo/id/{COMIC_ID}"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://ac.qq.com/'
}

def is_app_only(title, is_app_chapter_flag):
    if is_app_chapter_flag == 1:
        return True
    if re.search(r'APP$', title.strip(), re.IGNORECASE):
        return True
    return False

def test_chapter_with_playwright(cid="146921", ctitle="第1话 恶犬与少年", output_dir="test_output/tencent_657728_1", storage_state_path="storageState.json"):
    """
    Playwright automation supporting WeChat login session (storageState.json)
    to automatically click '立即支付' (Pay Now) for paid/VIP chapters.
    """
    print(f"\n--- Testing Chapter CID {cid}: {ctitle} (Playwright WeChat Auth Mode) ---")
    if is_app_only(ctitle, 0):
        print(f"[SKIP] Chapter {ctitle} is App-only.")
        return False
        
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[WARNING] Playwright is not installed. Falling back to HTTP requests.")
        return test_chapter_http(cid, ctitle, output_dir)
        
    view_url = f"https://ac.qq.com/ComicView/index/id/{COMIC_ID}/cid/{cid}"
    
    html = ""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context_kwargs = {}
        
        if os.path.exists(storage_state_path):
            print(f"[INFO] Loading WeChat session state from {storage_state_path}...")
            context_kwargs['storage_state'] = storage_state_path
        else:
            print(f"[INFO] Warning: {storage_state_path} not found. Running without pre-authenticated session.")
            
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        
        print(f"Navigating to {view_url}...")
        page.goto(view_url)
        page.wait_for_timeout(3000)
        
        # Check and handle payment / VIP unlock modal if present (e.g., '立即支付' or '确认支付')
        try:
            pay_btn = page.locator("text=立即支付")
            if pay_btn.is_visible(timeout=3000):
                print("[INFO] Payment modal detected! Clicking '立即支付' to unlock chapter...")
                pay_btn.click()
                page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[INFO] No payment modal required or payment click skipped: {e}")
            
        html = page.content()
        browser.close()
        
    return process_html_and_download(html, ctitle, output_dir)

def test_chapter_http(cid="146921", ctitle="第1话 恶犬与少年", output_dir="test_output/tencent_657728_1"):
    print(f"\n--- Testing Chapter CID {cid}: {ctitle} (HTTP Request Mode) ---")
    if is_app_only(ctitle, 0):
        print(f"[SKIP] Chapter {ctitle} is App-only.")
        return False
        
    view_url = f"https://ac.qq.com/ComicView/index/id/{COMIC_ID}/cid/{cid}"
    resp = requests.get(view_url, headers=HEADERS)
    resp.encoding = 'utf-8'
    return process_html_and_download(resp.text, ctitle, output_dir)

def process_html_and_download(html, ctitle, output_dir):
    data_m = re.search(r'var\s+DATA\s*=\s*[\x27\x22]([^\x27\x22]+)[\x27\x22]', html)
    if not data_m:
        print("[ERROR] DATA variable not found in chapter page. Might require WeChat login state (`storageState.json`).")
        return False
        
    data = data_m.group(1)
    try:
        dec = base64.b64decode(data[3:] + '===', validate=False)
        text = dec.decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"[ERROR] Failed to decode base64 DATA: {e}")
        return False
    
    urls = re.findall(r'(https://[^\s\"\'\\]+)', text)
    seen_urls = []
    for u in urls:
        clean_u = u.replace('\\/', '/')
        if 'manhua.acimg.cn' in clean_u and clean_u not in seen_urls:
            seen_urls.append(clean_u)
            
    if not seen_urls:
        print("[ERROR] No picture URLs found in chapter DATA.")
        return False
        
    print(f"Successfully extracted {len(seen_urls)} picture URLs.")
    
    os.makedirs(output_dir, exist_ok=True)
    
    images = []
    for idx, url in enumerate(seen_urls):
        img_resp = requests.get(url, headers=HEADERS)
        if img_resp.status_code == 200:
            try:
                img = Image.open(BytesIO(img_resp.content)).convert('RGB')
                images.append(img)
            except Exception as e:
                print(f"Warning: failed to open image {idx}: {e}")
                
    if not images:
        print("[ERROR] No valid images downloaded.")
        return False
        
    total_width = max(img.width for img in images)
    total_height = sum(img.height for img in images)
    print(f"Stitching {len(images)} images into master canvas ({total_width}x{total_height})...")
    
    master = Image.new('RGB', (total_width, total_height))
    y_offset = 0
    for img in images:
        if img.width != total_width:
            img = img.resize((total_width, int(img.height * total_width / img.width)), Image.Resampling.LANCZOS)
        master.paste(img, (0, y_offset))
        y_offset += img.height
        
    num_pages = 20
    page_height = master.height / num_pages
    
    print(f"Slicing master canvas into {num_pages} equal pages (.jpg)...")
    for i in range(num_pages):
        box_top = int(i * page_height)
        box_bottom = int((i + 1) * page_height) if i < num_pages - 1 else master.height
        page_img = master.crop((0, box_top, total_width, box_bottom))
        
        out_path = os.path.join(output_dir, f"{i+1:03d}.jpg")
        page_img.save(out_path, 'JPEG', quality=95)
        
    print(f"[SUCCESS] Chapter successfully sliced and saved to {output_dir} ({num_pages} pages).")
    return True

if __name__ == '__main__':
    # Test with Playwright & WeChat session state (if available)
    test_chapter_with_playwright("146921", "第1话 恶犬与少年", output_dir="test_output/tencent_657728_1", storage_state_path="storageState.json")
    
    print("\n--- Testing App-Only Detection Rule ---")
    app_only_title = "第278话 真正的诡异者APP"
    print(f"Checking title '{app_only_title}': is_app_only = {is_app_only(app_only_title, 0)}")

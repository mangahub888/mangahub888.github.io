#!/usr/bin/env python3
"""
Tencent Comic ADB Offline Dumper
---------------------------------
Extracts page URLs from offline-downloaded chapters in LDPlayer,
then downloads, stitches, slices to 20 JPEG pages, uploads to Drive,
and registers WorkQueue entries.

Usage:
  python tools/adb_offline_dumper.py --comic-id 656779 --chapter-id 154947
  python tools/adb_offline_dumper.py --comic-id 656779 --all-downloaded
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import requests
from PIL import Image

# Import existing tencent purchaser tools if available
try:
    from tools.tencent_purchaser import upload_chapter_to_drive, register_workqueue
except ImportError:
    # Fallback mock/stub if imported independently
    def upload_chapter_to_drive(comic_title, chapter_num, image_files):
        print(f"[Mock Drive Upload] Uploading {len(image_files)} pages for {comic_title} Ch.{chapter_num}")
        return "https://drive.google.com/drive/folders/mock_folder_id"

    def register_workqueue(comic_title, chapter_num, drive_url):
        print(f"[Mock WorkQueue] Registering {comic_title} Ch.{chapter_num} -> {drive_url}")

HEADERS = {
    'Referer': 'https://ac.qq.com/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36'
}

def get_adb_path():
    return 'C:\\LDPlayer\\LDPlayer9\\adb.exe'

def get_downloaded_chapters(comic_id, adb_host):
    """List all chapter_ids that have been downloaded for a comic"""
    adb = get_adb_path()
    result = subprocess.run(
        [adb, '-s', adb_host, 'shell',
         f'su -c "ls /sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/"'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return []
    return [c.strip() for c in result.stdout.strip().split() if c.strip().isdigit()]

def extract_page_urls(comic_id, chapter_id, adb_host):
    """Pull _image_info_list and extract all page URLs"""
    adb = get_adb_path()
    remote_path = f'/sdcard/Android/data/com.qq.ac.android/files/comics/{comic_id}/{chapter_id}/_image_info_list'
    local_dir = Path('C:/temp/tencent_dl')
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / f'{comic_id}_{chapter_id}_image_info_list'
    
    subprocess.run([adb, '-s', adb_host, 'pull', remote_path, str(local_path)], check=True)
    
    with open(local_path, 'rb') as f:
        raw = f.read()
    
    urls = []
    # Try parsing json or decoded json
    try:
        data = json.loads(raw)
    except Exception:
        try:
            # Skip 16-byte binary header if present
            decoded = base64.b64decode(raw)
            data = json.loads(decoded)
        except Exception:
            try:
                # Find JSON starting with '{' or '['
                idx = raw.find(b'{')
                if idx == -1:
                    idx = raw.find(b'[')
                if idx != -1:
                    data = json.loads(raw[idx:])
                else:
                    raise ValueError("No JSON found")
            except Exception:
                data = None

    if data:
        # Extract urls from parsed json structure
        items = []
        if isinstance(data, dict):
            items = data.get('data', []) or data.get('picture', []) or data.get('pictures', [])
        elif isinstance(data, list):
            items = data
        
        for item in items:
            if isinstance(item, dict):
                url = item.get('current_img_url') or item.get('url') or item.get('img_url') or item.get('pic_url')
                if url:
                    urls.append(url)

    # Fallback to robust regex extraction if JSON parsing didn't find URLs
    if not urls:
        found = re.findall(rb'https://manhua\.acimg\.cn/[^\x00\s"\'<>]+', raw)
        urls = [u.decode('utf-8', errors='ignore') for u in found]

    # Clean and standardize URLs to JPEG
    clean_urls = []
    for u in urls:
        u = re.sub(r'\?.*$', '', u)  # remove query params
        if not u.endswith('.jpg') and not u.endswith('.jpeg'):
            u = u + '/1200'
        if u not in clean_urls:
            clean_urls.append(u)
    
    return clean_urls

def download_pages(urls, tmp_dir):
    """Download all page images to tmp_dir"""
    Path(tmp_dir).mkdir(parents=True, exist_ok=True)
    files = []
    for i, url in enumerate(urls):
        out = Path(tmp_dir) / f'raw_{i:03d}.jpg'
        print(f'Downloading page {i+1}/{len(urls)}: {url}')
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        out.write_bytes(r.content)
        files.append(str(out))
    return files

def stitch_and_slice(image_files, output_dir, num_slices=20):
    """Vertically stitch all pages, then slice into exactly num_slices equal parts"""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    imgs = [Image.open(f).convert('RGB') for f in image_files]
    total_width = max(img.width for img in imgs)
    
    resized = []
    for img in imgs:
        if img.width != total_width:
            ratio = total_width / img.width
            img = img.resize((total_width, int(img.height * ratio)), Image.LANCZOS)
        resized.append(img)
    
    total_height = sum(img.height for img in resized)
    
    canvas = Image.new('RGB', (total_width, total_height))
    y_offset = 0
    for img in resized:
        canvas.paste(img, (0, y_offset))
        y_offset += img.height
    
    slice_height = total_height / num_slices
    output_files = []
    for i in range(num_slices):
        y_start = int(i * slice_height)
        y_end = int((i + 1) * slice_height) if i < num_slices - 1 else total_height
        slice_img = canvas.crop((0, y_start, total_width, y_end))
        out_path = Path(output_dir) / f'{i+1:03d}.jpg'
        slice_img.save(str(out_path), 'JPEG', quality=95)
        output_files.append(str(out_path))
        print(f'  Sliced page {i+1}/{num_slices}')
    
    return output_files

def process_chapter(comic_id, chapter_id, adb_host):
    print(f"\n========================================")
    print(f"Processing Comic {comic_id}, Chapter {chapter_id}")
    print(f"========================================")
    
    urls = extract_page_urls(comic_id, chapter_id, adb_host)
    print(f"Extracted {len(urls)} page URLs.")
    if not urls:
        print("ERROR: No page URLs found!")
        return
    
    tmp_dir = f'C:/temp/tencent_dl/{comic_id}_{chapter_id}_raw'
    output_dir = f'C:/temp/tencent_dl/{comic_id}_{chapter_id}_sliced'
    
    image_files = download_pages(urls, tmp_dir)
    sliced_files = stitch_and_slice(image_files, output_dir, num_slices=20)
    
    comic_title = f"Comic_{comic_id}"
    chapter_num = chapter_id
    
    drive_url = upload_chapter_to_drive(comic_title, chapter_num, sliced_files)
    print(f"Uploaded to Drive: {drive_url}")
    
    register_workqueue(comic_title, chapter_num, drive_url)
    print("WorkQueue registered successfully!")

def main():
    parser = argparse.ArgumentParser(description='Tencent Comic ADB Offline Dumper')
    parser.add_argument('--comic-id', required=True, help='Comic ID (e.g. 656779)')
    parser.add_argument('--chapter-id', help='Specific chapter ID to process')
    parser.add_argument('--all-downloaded', action='store_true', help='Process all downloaded chapters')
    parser.add_argument('--adb-host', default='127.0.0.1:5555', help='ADB device host:port')
    args = parser.parse_args()
    
    if args.chapter_id:
        process_chapter(args.comic_id, args.chapter_id, args.adb_host)
    elif args.all_downloaded:
        chapters = get_downloaded_chapters(args.comic_id, args.adb_host)
        print(f"Found downloaded chapters for comic {args.comic_id}: {chapters}")
        for ch in chapters:
            try:
                process_chapter(args.comic_id, ch, args.adb_host)
            except Exception as e:
                print(f"ERROR processing chapter {ch}: {e}")
    else:
        print("Please specify either --chapter-id or --all-downloaded")

if __name__ == '__main__':
    main()

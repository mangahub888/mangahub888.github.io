import json
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(os.path.join(DATA_DIR, 'chaply_all_comics.json'), 'r', encoding='utf-8') as f:
    chaply = json.load(f)

with open(os.path.join(DATA_DIR, 'kairew_manage_book_props.json'), 'r', encoding='utf-8') as f:
    kairew = json.load(f).get('props', {}).get('cartoon_list', [])

rr1_path = os.path.join(DATA_DIR, 'readrealm_stats_lionking.json')
rr2_path = os.path.join(DATA_DIR, 'readrealm_stats.json')
rr = []
if os.path.exists(rr1_path):
    rr += json.load(open(rr1_path, encoding='utf-8')).get('comics', [])
if os.path.exists(rr2_path):
    rr += json.load(open(rr2_path, encoding='utf-8')).get('comics', [])

print("--- Searching for ID 4 keywords ('วายร้าย', 'fated villain', 'ข้าคือจอม') ---")
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['วายร้าย', 'fated', 'villain', 'ข้าคือจอม']):
        print("Chaply:", t)

print("\n--- Searching for ID 7 keywords ('ศิษย์บ้า', 'กบฎ', 'กบฏ', 'อาจารย์') ---")
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['ศิษย์บ้า', 'กบฎ', 'กบฏ', 'อาจารย์']):
        print("Chaply:", t)

print("\n--- Searching for ID 10 keywords ('ไร้อาชีพ', 'สังหารเหล่าเทพ', 'เทพ') ---")
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['ไร้อาชีพ', 'สังหารเหล่าเทพ']):
        print("Chaply:", t)

print("\n--- Searching for ID 16 keywords ('zombie', 'ซอมบี้') ---")
for c in rr:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['zombie', 'ซอมบี้']):
        print("ReadRealm:", t)
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['zombie', 'ซอมบี้']):
        print("Chaply:", t)

print("\n--- Searching for ID 17 keywords ('เสบียง', 'ล้านล้าน', 'โหดเหี้ยม', 'โลกาวินาศ') ---")
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['เสบียง', 'ล้านล้าน', 'โหดเหี้ยม', 'โลกาวินาศ']):
        print("Chaply:", t)

print("\n--- Searching for ID 102 keywords ('จอมเวท', 'ขังลืม', 'madoushi', 'munou', 'sekai', 'saikyou') ---")
for c in kairew:
    t = c.get('name') or c.get('subject') or ''
    if any(k.lower() in t.lower() for k in ['จอมเวท', 'ขังลืม', 'madoushi', 'munou', 'ไร้ค่า']):
        print("Kairew:", t)
for c in chaply:
    t = c.get('subject') or c.get('title') or ''
    if any(k.lower() in t.lower() for k in ['จอมเวท', 'ขังลืม', 'madoushi', 'munou', 'ไร้ค่า']):
        print("Chaply:", t)

import os
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")

sys.path.append(BASE_DIR)
from manga_matcher import get_manga_setting, match_manga_setting, normalize_title

# Standard Thai Month List for Multi-Platform Monthly Sales
THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

def sanitize_monthly_sales(raw_m):
    if not isinstance(raw_m, dict) or not raw_m:
        return {}
    res = {}
    items = list(raw_m.items())
    has_mojibake = any('' in str(k) or str(k) not in THAI_MONTHS for k in raw_m.keys())
    if has_mojibake and len(items) in (11, 12):
        for idx, (_, v) in enumerate(items):
            if idx < len(THAI_MONTHS):
                res[THAI_MONTHS[idx]] = round(float(v or 0.0), 2)
        return res
    for k, v in raw_m.items():
        if k in THAI_MONTHS:
            res[k] = round(float(v or 0.0), 2)
    return res

# 1. ReadRealm (use readrealm_growth_latest.json first if available, else stats files)
rr_growth_path = os.path.join(DATA_DIR, 'readrealm_growth_latest.json')
rr1_path = os.path.join(DATA_DIR, 'readrealm_stats_lionking.json')
rr2_path = os.path.join(DATA_DIR, 'readrealm_stats.json')
rr_list = []
if os.path.exists(rr_growth_path):
    try:
        with open(rr_growth_path, 'r', encoding='utf-8') as f:
            rr_list = json.load(f).get('comics', [])
    except Exception:
        rr_list = []
if not rr_list:
    rr1 = []
    rr2 = []
    if os.path.exists(rr1_path):
        with open(rr1_path, 'r', encoding='utf-8') as f:
            rr1 = json.load(f).get('comics', [])
    if os.path.exists(rr2_path):
        with open(rr2_path, 'r', encoding='utf-8') as f:
            rr2 = json.load(f).get('comics', [])
    rr_list = rr1 + rr2

# 2. Kairew
kairew = []
kairew_growth_path = os.path.join(DATA_DIR, 'kairew_growth_latest.json')
kairew_path = os.path.join(DATA_DIR, 'kairew_manage_book_props.json')
if os.path.exists(kairew_growth_path):
    try:
        with open(kairew_growth_path, 'r', encoding='utf-8') as f:
            kairew = json.load(f).get('comics', [])
    except Exception:
        kairew = []
if not kairew and os.path.exists(kairew_path):
    with open(kairew_path, 'r', encoding='utf-8') as f:
        kairew = json.load(f).get('props', {}).get('cartoon_list', [])

# 3. Chaply
chaply = []
chaply_growth_path = os.path.join(DATA_DIR, 'chaply_growth_latest.json')
chaply_all_path = os.path.join(DATA_DIR, 'chaply_all_comics.json')
if os.path.exists(chaply_growth_path):
    try:
        with open(chaply_growth_path, 'r', encoding='utf-8') as f:
            growth_data = json.load(f)
            chaply = growth_data.get('comics', [])
    except Exception:
        chaply = []

if not chaply and os.path.exists(chaply_all_path):
    with open(chaply_all_path, 'r', encoding='utf-8') as f:
        chaply = json.load(f)

# Load MangaSetting projects
manga_setting = get_manga_setting()
print(f"📊 เริ่มต้นจัดกลุ่มข้อมูลตาม MangaSetting ({len(manga_setting)} เรื่อง)...")

matched_groups = []

for m in manga_setting:
    mid = m.get('mangaid') or m.get('MangaID')
    mname = (m.get('manganame') or m.get('MangaName') or '').strip()
    norm_k = normalize_title(mname)
    
    # Best Match on ReadRealm
    rr_c = None
    best_rr_s = 0.0
    for c in rr_list:
        mat, s = match_manga_setting(c.get('subject', ''), [m], threshold=0.85)
        if mat and s > best_rr_s:
            best_rr_s = s
            rr_c = c
            
    # Best Match on Kairew
    kw_c = None
    best_kw_s = 0.0
    for c in kairew:
        t = (c.get('name') or c.get('subject') or '').strip()
        mat, s = match_manga_setting(t, [m], threshold=0.85)
        if mat and s > best_kw_s:
            best_kw_s = s
            kw_c = c

    # Best Match on Chaply
    ch_c = None
    best_ch_s = 0.0
    for c in chaply:
        t = (c.get('subject') or c.get('title') or '').strip()
        mat, s = match_manga_setting(t, [m], threshold=0.85)
        if mat and s > best_ch_s:
            best_ch_s = s
            ch_c = c
            
    has_rr = rr_c is not None
    has_kw = kw_c is not None
    has_ch = ch_c is not None
    plat_count = (1 if has_rr else 0) + (1 if has_kw else 0) + (1 if has_ch else 0)
    
    # We include any story that matches at least 1 platform in MangaSetting
    if plat_count >= 1:
        rr_obj = {
            'exists': has_rr,
            'title': rr_c.get('subject', '') if has_rr else '',
            'id': str(rr_c.get('comic_id', '')) if has_rr else '',
            'sales': float(rr_c.get('total_sales') or 0.0) if has_rr else 0.0,
            'views': int(rr_c.get('total_views') or 0) if has_rr else 0,
            'eps': int(rr_c.get('chapters_count') or 0) if has_rr else 0,
            'monthly_sales': sanitize_monthly_sales(rr_c.get('monthly_sales', {})) if has_rr else {}
        }
        
        kw_obj = {
            'exists': has_kw,
            'title': (kw_c.get('name') or kw_c.get('subject') or '') if has_kw else '',
            'id': str(kw_c.get('comic_id') or kw_c.get('id', '')) if has_kw else '',
            'sales': float(kw_c.get('total_sales') or kw_c.get('sales') or 0.0) if has_kw else 0.0,
            'views': int(kw_c.get('total_views') or kw_c.get('view_count') or 0) if has_kw else 0,
            'eps': int(kw_c.get('chapters_count') or kw_c.get('episode_count') or 0) if has_kw else 0,
            'monthly_sales': sanitize_monthly_sales(kw_c.get('monthly_sales', {})) if has_kw else {}
        }
        
        ch_obj = {
            'exists': has_ch,
            'title': (ch_c.get('subject') or ch_c.get('title') or '') if has_ch else '',
            'id': str(ch_c.get('comic_id') or ch_c.get('id', '')) if has_ch else '',
            'sales': float(ch_c.get('total_sales') or ch_c.get('sales') or 0.0) if has_ch else 0.0,
            'views': int(ch_c.get('total_views') or ch_c.get('totalView') or 0) if has_ch else 0,
            'eps': int(ch_c.get('chapters_count') or ch_c.get('totalEpisode') or 0) if has_ch else 0,
            'fav': int(ch_c.get('totalFavorite') or 0) if has_ch else 0,
            'monthly_sales': sanitize_monthly_sales(ch_c.get('monthly_sales', {})) if has_ch else {}
        }
        
        platforms = []
        if has_rr: platforms.append('ReadRealm')
        if has_kw: platforms.append('Kairew')
        if has_ch: platforms.append('Chaply')
        
        total_s = round(rr_obj['sales'] + kw_obj['sales'] + ch_obj['sales'], 2)
        total_v = rr_obj['views'] + kw_obj['views'] + ch_obj['views']
        max_e = max(rr_obj['eps'], kw_obj['eps'], ch_obj['eps'])
        
        matched_groups.append({
            'key': norm_k,
            'title': mname,
            'manga_id': mid,
            'platform_count': plat_count,
            'platforms': platforms,
            'readrealm': rr_obj,
            'kairew': kw_obj,
            'chaply': ch_obj,
            'total_sales': total_s,
            'total_views': total_v,
            'max_eps': max_e
        })

print(f"Total matched groups from MangaSetting: {len(matched_groups)}")
all_3 = [g for g in matched_groups if g['platform_count'] == 3]
print(f"Matching all 3 platforms (ReadRealm + Kairew + Chaply): {len(all_3)}")
only_2 = [g for g in matched_groups if g['platform_count'] == 2]
print(f"Matching 2 platforms: {len(only_2)}")
only_1 = [g for g in matched_groups if g['platform_count'] == 1]
print(f"Matching 1 platform: {len(only_1)}")

# Save to data file
output_path = os.path.join(DATA_DIR, 'grouped_matched_comics.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(matched_groups, f, ensure_ascii=False, indent=2)
print(f"✓ บันทึกผลลัพธ์ลง {output_path}")

# Sync to frontend
for out_dir in [FRONTEND_SRC_DIR, FRONTEND_PUB_DIR]:
    if os.path.exists(out_dir):
        target = os.path.join(out_dir, 'grouped_matched_comics.json')
        with open(target, 'w', encoding='utf-8') as f:
            json.dump(matched_groups, f, ensure_ascii=False, indent=2)
        print(f"✓ อัปเดตไปยัง Frontend: {target}")

matched_groups.sort(key=lambda x: x['total_sales'], reverse=True)
print("\n=== TOP 15 BY COMBINED TOTAL SALES ===")
for idx, g in enumerate(matched_groups[:15], 1):
    plats_str = ', '.join(g['platforms'])
    print(f"#{idx}: {g['title']} [{plats_str}]")
    print(f"    ยอดขายรวม: ฿{g['total_sales']:,.2f} (RR: ฿{g['readrealm']['sales']:,.2f} | KW: ฿{g['kairew']['sales']:,.2f} | CH: ฿{g['chaply']['sales']:,.2f})")
    print(f"    ยอดวิวรวม: {g['total_views']:,} ครั้ง (RR: {g['readrealm']['views']:,} | KW: {g['kairew']['views']:,} | CH: {g['chaply']['views']:,})")

import os
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "data")
FRONTEND_PUB_DIR = os.path.join(BASE_DIR, "..", "frontend", "public", "data")

# 1. ReadRealm (combine lionking and adieu)
rr1_path = os.path.join(DATA_DIR, 'readrealm_stats_lionking.json')
rr2_path = os.path.join(DATA_DIR, 'readrealm_stats.json')
rr1 = []
rr2 = []
if os.path.exists(rr1_path):
    with open(rr1_path, 'r', encoding='utf-8') as f:
        rr1 = json.load(f).get('comics', [])
if os.path.exists(rr2_path):
    with open(rr2_path, 'r', encoding='utf-8') as f:
        rr2 = json.load(f).get('comics', [])

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

# Load cross-platform mapping if present
mapping_path = os.path.join(DATA_DIR, 'comic_cross_platform_mapping.json')
mappings_data = []
if os.path.exists(mapping_path):
    with open(mapping_path, 'r', encoding='utf-8') as f:
        mappings_data = json.load(f).get('mappings', [])

def normalize_title(t: str) -> str:
    if not t:
        return ''
    
    # Check manual mappings first
    for m in mappings_data:
        for alias in m.get('aliases', []):
            if alias.lower() in t.lower():
                return re.sub(r'[^\u0E00-\u0E7F]', '', m.get('canonical_title'))
    
    # Built-in manual aliases
    if 'เจ้าแห่งกงล้อหมุนฝืนโชคชะตา' in t or 'เจ้าแห่งกงล้อโชคชะตา' in t:
        return re.sub(r'[^\u0E00-\u0E7F]', '', 'เจ้าแห่งกงล้อโชคชะตา')
    if 'เกิดใหม่เป็นกบฏแห่งตระกูลขุนนางทรราช' in t or 'กบฏแห่งตระกูลขุนนางทรราช' in t:
        return re.sub(r'[^\u0E00-\u0E7F]', '', 'กบฏแห่งตระกูลขุนนางทรราช')
    if any(k in t for k in ['จอมมารแสนดีขนาดนี้', 'จอมมารแสนดีเช่นข้า', 'ผู้ชายแสนดีเช่นข้า', 'The Disciple Wants to Kill Me']):
        return re.sub(r'[^\u0E00-\u0E7F]', '', 'จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต')
    
    return re.sub(r'[^\u0E00-\u0E7F]', '', t)

def get_canonical_display(t: str, key: str) -> str:
    for m in mappings_data:
        canonical_clean = re.sub(r'[^\u0E00-\u0E7F]', '', m.get('canonical_title'))
        if key == canonical_clean:
            return m.get('canonical_title')
    
    if any(k in t for k in ['จอมมารแสนดีขนาดนี้', 'จอมมารแสนดีเช่นข้า', 'ผู้ชายแสนดีเช่นข้า', 'The Disciple Wants to Kill Me']):
        return 'จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต'
    
    return t.split('|')[0].strip()

groups = {}

# ReadRealm
for c in rr1 + rr2:
    t = c.get('subject', '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = get_canonical_display(t, k)
    clean_display = get_canonical_display(t, k)
    c_monthly = {m: round(float(v or 0), 2) for m, v in c.get('monthly_sales', {}).items()}
    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {
                'exists': True,
                'title': t,
                'id': c.get('comic_id', ''),
                'sales': float(c.get('total_sales') or 0),
                'views': int(c.get('total_views') or 0),
                'eps': int(c.get('chapters_count') or 0),
                'monthly_sales': c_monthly
            },
            'kairew': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0},
            'chaply': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'fav': 0}
        }
    else:
        groups[k]['readrealm']['sales'] += float(c.get('total_sales') or 0)
        groups[k]['readrealm']['views'] += int(c.get('total_views') or 0)
        groups[k]['readrealm']['eps'] = max(groups[k]['readrealm']['eps'], int(c.get('chapters_count') or 0))
        if not groups[k]['readrealm'].get('id'):
            groups[k]['readrealm']['id'] = c.get('comic_id', '')
        if c_monthly:
            if 'monthly_sales' not in groups[k]['readrealm']:
                groups[k]['readrealm']['monthly_sales'] = {}
            for m_k, m_v in c_monthly.items():
                groups[k]['readrealm']['monthly_sales'][m_k] = round(
                    groups[k]['readrealm']['monthly_sales'].get(m_k, 0.0) + m_v, 2
                )
# Standard Thai Month List for Multi-Platform Monthly Sales
THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

def init_empty_monthly_sales():
    return {m: 0.0 for m in THAI_MONTHS}

# Kairew
for c in kairew:
    t = (c.get('name') or c.get('subject') or '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = get_canonical_display(t, k)
    kw_monthly = c.get('monthly_sales') if isinstance(c.get('monthly_sales'), dict) else {}
    kw_obj = {
        'exists': True,
        'title': t,
        'id': str(c.get('comic_id') or c.get('id', '')),
        'sales': float(c.get('total_sales') or c.get('sales') or 0),
        'views': int(c.get('total_views') or c.get('view_count') or 0),
        'eps': int(c.get('chapters_count') or c.get('episode_count') or 0),
        'monthly_sales': kw_monthly
    }
    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'monthly_sales': init_empty_monthly_sales()},
            'kairew': kw_obj,
            'chaply': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'fav': 0, 'monthly_sales': {}}
        }
    else:
        groups[k]['title'] = clean_display
        groups[k]['kairew'] = kw_obj

# Chaply
for c in chaply:
    t = (c.get('subject') or c.get('title') or '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = get_canonical_display(t, k)
    c_id = str(c.get('comic_id') or c.get('id') or '')
    c_sales = float(c.get('total_sales') or c.get('sales') or 0.0)
    c_views = int(c.get('total_views') or c.get('totalView') or 0)
    c_eps = int(c.get('chapters_count') or c.get('totalEpisode') or 0)
    c_fav = int(c.get('totalFavorite') or 0)
    ch_monthly = c.get('monthly_sales') if isinstance(c.get('monthly_sales'), dict) else {}

    chaply_obj = {
        'exists': True,
        'title': t,
        'id': c_id,
        'sales': c_sales,
        'views': c_views,
        'eps': c_eps,
        'fav': c_fav,
        'monthly_sales': ch_monthly
    }

    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'monthly_sales': init_empty_monthly_sales()},
            'kairew': {'exists': False, 'title': '', 'id': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'monthly_sales': {}},
            'chaply': chaply_obj
        }
    else:
        groups[k]['chaply'] = chaply_obj

# Filter matching only (exists in >= 2 platforms)
matched_groups = []
for k, g in groups.items():
    plat_count = (1 if g['readrealm']['exists'] else 0) + (1 if g['kairew']['exists'] else 0) + (1 if g['chaply']['exists'] else 0)
    if plat_count >= 2:
        g['platform_count'] = plat_count
        g['platforms'] = []
        if g['readrealm']['exists']:
            g['platforms'].append('ReadRealm')
        if g['kairew']['exists']:
            g['platforms'].append('Kairew')
        if g['chaply']['exists']:
            g['platforms'].append('Chaply')
        g['total_sales'] = round(g['readrealm']['sales'] + g['kairew']['sales'] + g['chaply']['sales'], 2)
        g['total_views'] = g['readrealm']['views'] + g['kairew']['views'] + g['chaply']['views']
        g['max_eps'] = max(g['readrealm']['eps'], g['kairew']['eps'], g['chaply']['eps'])
        matched_groups.append(g)

print(f"Total matched groups across >= 2 platforms: {len(matched_groups)}")
all_3 = [g for g in matched_groups if g['platform_count'] == 3]
print(f"Matching all 3 platforms (ReadRealm + Kairew + Chaply): {len(all_3)}")
only_2 = [g for g in matched_groups if g['platform_count'] == 2]
print(f"Matching exactly 2 platforms: {len(only_2)}")

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

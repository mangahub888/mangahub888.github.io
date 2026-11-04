import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. ReadRealm (combine lionking and adieu)
with open('D:/new backend/mangahub888.github.io/tools/data/readrealm_stats_lionking.json', 'r', encoding='utf-8') as f:
    rr1 = json.load(f)['comics']
with open('D:/new backend/mangahub888.github.io/tools/data/readrealm_stats.json', 'r', encoding='utf-8') as f:
    rr2 = json.load(f)['comics']

# 2. Kairew
with open('D:/new backend/mangahub888.github.io/tools/data/kairew_manage_book_props.json', 'r', encoding='utf-8') as f:
    kairew = json.load(f)['props']['cartoon_list']

# 3. Chaply
with open('D:/new backend/mangahub888.github.io/tools/data/chaply_all_comics.json', 'r', encoding='utf-8') as f:
    chaply = json.load(f)

def normalize_title(t):
    if not t:
        return ''
    # extract only thai characters
    th = re.sub(r'[^\u0E00-\u0E7F]', '', t)
    # Manual aliases
    if 'เจ้าแห่งกงล้อหมุนฝืนโชคชะตา' in t or 'เจ้าแห่งกงล้อโชคชะตา' in t:
        return re.sub(r'[^\u0E00-\u0E7F]', '', 'เจ้าแห่งกงล้อโชคชะตา')
    if 'เกิดใหม่เป็นกบฏแห่งตระกูลขุนนางทรราช' in t or 'กบฏแห่งตระกูลขุนนางทรราช' in t:
        return re.sub(r'[^\u0E00-\u0E7F]', '', 'กบฏแห่งตระกูลขุนนางทรราช')
    return th

groups = {}

# ReadRealm
for c in rr1 + rr2:
    t = c.get('subject', '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = t.split('|')[0].strip()
    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {'exists': True, 'title': t, 'sales': float(c.get('total_sales') or 0), 'views': int(c.get('total_views') or 0), 'eps': int(c.get('chapters_count') or 0)},
            'kairew': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0},
            'chaply': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'fav': 0}
        }
    else:
        # If appeared in both rr accounts
        groups[k]['readrealm']['sales'] += float(c.get('total_sales') or 0)
        groups[k]['readrealm']['views'] += int(c.get('total_views') or 0)
        groups[k]['readrealm']['eps'] = max(groups[k]['readrealm']['eps'], int(c.get('chapters_count') or 0))

# Kairew
for c in kairew:
    t = c.get('name', '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = t.split('|')[0].strip()
    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0},
            'kairew': {'exists': True, 'title': t, 'sales': float(c.get('sales') or 0), 'views': int(c.get('view_count') or 0), 'eps': int(c.get('episode_count') or 0)},
            'chaply': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0, 'fav': 0}
        }
    else:
        groups[k]['kairew'] = {'exists': True, 'title': t, 'sales': float(c.get('sales') or 0), 'views': int(c.get('view_count') or 0), 'eps': int(c.get('episode_count') or 0)}

# Chaply
for c in chaply:
    t = c.get('title', '').strip()
    k = normalize_title(t)
    if not k:
        continue
    clean_display = t.split('|')[0].strip()
    if k not in groups:
        groups[k] = {
            'key': k,
            'title': clean_display,
            'readrealm': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0},
            'kairew': {'exists': False, 'title': '', 'sales': 0.0, 'views': 0, 'eps': 0},
            'chaply': {'exists': True, 'title': t, 'sales': 0.0, 'views': int(c.get('totalView') or 0), 'eps': int(c.get('totalEpisode') or 0), 'fav': int(c.get('totalFavorite') or 0)}
        }
    else:
        groups[k]['chaply'] = {'exists': True, 'title': t, 'sales': 0.0, 'views': int(c.get('totalView') or 0), 'eps': int(c.get('totalEpisode') or 0), 'fav': int(c.get('totalFavorite') or 0)}

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
        g['total_sales'] = g['readrealm']['sales'] + g['kairew']['sales'] + g['chaply']['sales']
        g['total_views'] = g['readrealm']['views'] + g['kairew']['views'] + g['chaply']['views']
        g['max_eps'] = max(g['readrealm']['eps'], g['kairew']['eps'], g['chaply']['eps'])
        matched_groups.append(g)

print(f"Total matched groups across >= 2 platforms: {len(matched_groups)}")
all_3 = [g for g in matched_groups if g['platform_count'] == 3]
print(f"Matching all 3 platforms (ReadRealm + Kairew + Chaply): {len(all_3)}")
only_2 = [g for g in matched_groups if g['platform_count'] == 2]
print(f"Matching exactly 2 platforms: {len(only_2)}")

# Save to data file
with open('D:/new backend/mangahub888.github.io/tools/data/grouped_matched_comics.json', 'w', encoding='utf-8') as f:
    json.dump(matched_groups, f, ensure_ascii=False, indent=2)

matched_groups.sort(key=lambda x: x['total_sales'], reverse=True)
print("\n=== TOP 15 BY COMBINED TOTAL SALES ===")
for idx, g in enumerate(matched_groups[:15], 1):
    plats_str = ', '.join(g['platforms'])
    print(f"#{idx}: {g['title']} [{plats_str}]")
    print(f"    ยอดขายรวม: ฿{g['total_sales']:,.2f} (RR: ฿{g['readrealm']['sales']:,.2f} | KW: ฿{g['kairew']['sales']:,.2f} | CH: ฿{g['chaply']['sales']:,.2f})")
    print(f"    ยอดวิวรวม: {g['total_views']:,} ครั้ง (RR: {g['readrealm']['views']:,} | KW: {g['kairew']['views']:,} | CH: {g['chaply']['views']:,})")

matched_views = sorted(matched_groups, key=lambda x: x['total_views'], reverse=True)
print("\n=== TOP 10 BY COMBINED TOTAL VIEWS ===")
for idx, g in enumerate(matched_views[:10], 1):
    plats_str = ', '.join(g['platforms'])
    print(f"#{idx}: {g['title']} [{plats_str}]")
    print(f"    ยอดวิวรวม: {g['total_views']:,} ครั้ง | ยอดขายรวม: ฿{g['total_sales']:,.2f} | ตอนสูงสุด: {g['max_eps']} ตอน")

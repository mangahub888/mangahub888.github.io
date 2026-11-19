import os
import sys
import json
from difflib import SequenceMatcher

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
sys.path.append(BASE_DIR)
from manga_matcher import get_manga_setting, match_manga_setting, normalize_title

# 1. Load manga list (54 items)
manga_list = get_manga_setting(force_refresh=False)
print(f"=== Manga List from Setting: {len(manga_list)} items ===")

# 2. Load ReadRealm
rr_path1 = os.path.join(DATA_DIR, 'readrealm_stats_lionking.json')
rr_path2 = os.path.join(DATA_DIR, 'readrealm_stats.json')
rr_path3 = os.path.join(DATA_DIR, 'readrealm_growth_latest.json')

rr_comics = []
for p in [rr_path3, rr_path1, rr_path2]:
    if os.path.exists(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                data = json.load(f)
                comics = data.get('comics', [])
                if comics:
                    for c in comics:
                        # Deduplicate by comic_id
                        cid = c.get('comic_id') or c.get('id')
                        if cid and not any((x.get('comic_id') or x.get('id')) == cid for x in rr_comics):
                            rr_comics.append(c)
        except Exception as e:
            print(f"Error reading {p}: {e}")

print(f"ReadRealm available comics in data: {len(rr_comics)}")

# 3. Load Kairew
kw_path1 = os.path.join(DATA_DIR, 'kairew_growth_latest.json')
kw_path2 = os.path.join(DATA_DIR, 'kairew_manage_book_props.json')
kw_comics = []
if os.path.exists(kw_path1):
    try:
        with open(kw_path1, 'r', encoding='utf-8') as f:
            data = json.load(f)
            kw_comics = data.get('comics', [])
    except Exception as e:
        print(f"Error reading {kw_path1}: {e}")

if not kw_comics and os.path.exists(kw_path2):
    try:
        with open(kw_path2, 'r', encoding='utf-8') as f:
            data = json.load(f)
            kw_comics = data.get('props', {}).get('cartoon_list', [])
    except Exception as e:
        print(f"Error reading {kw_path2}: {e}")

# If we have both, combine to ensure we have all
if os.path.exists(kw_path2):
    try:
        with open(kw_path2, 'r', encoding='utf-8') as f:
            data = json.load(f)
            raw_kw = data.get('props', {}).get('cartoon_list', [])
            for rc in raw_kw:
                cid = rc.get('id') or rc.get('comic_id')
                if cid and not any((x.get('id') or x.get('comic_id')) == cid for x in kw_comics):
                    kw_comics.append(rc)
    except Exception:
        pass

print(f"Kairew available comics in data: {len(kw_comics)}")

# 4. Load Chaply
ch_path1 = os.path.join(DATA_DIR, 'chaply_growth_latest.json')
ch_path2 = os.path.join(DATA_DIR, 'chaply_all_comics.json')
ch_comics = []
if os.path.exists(ch_path1):
    try:
        with open(ch_path1, 'r', encoding='utf-8') as f:
            ch_comics = json.load(f).get('comics', [])
    except Exception:
        pass
if os.path.exists(ch_path2):
    try:
        with open(ch_path2, 'r', encoding='utf-8') as f:
            raw_ch = json.load(f)
            for rc in raw_ch:
                cid = rc.get('id') or rc.get('comic_id')
                if cid and not any((x.get('id') or x.get('comic_id')) == cid for x in ch_comics):
                    ch_comics.append(rc)
    except Exception:
        pass

print(f"Chaply available comics in data: {len(ch_comics)}")

# Also load cross-platform mappings
mapping_path = os.path.join(DATA_DIR, 'comic_cross_platform_mapping.json')
mappings = []
if os.path.exists(mapping_path):
    with open(mapping_path, 'r', encoding='utf-8') as f:
        mappings = json.load(f).get('mappings', [])
print(f"Cross-platform mappings: {len(mappings)}")

print("\n" + "="*80)
print("TESTING DRY RUN MATCHING FOR ALL 54 MANGA SETTINGS")
print("="*80)

results = []

for idx, m in enumerate(manga_list, 1):
    mid = m.get('mangaid') or m.get('MangaID')
    mname = (m.get('manganame') or m.get('MangaName') or '').strip()
    platforms_cfg = (m.get('platforms') or m.get('Platforms') or '').lower()
    
    expected_rr = 'readrealm' in platforms_cfg
    expected_kw = 'kairew' in platforms_cfg
    expected_ch = 'chaply' in platforms_cfg

    # Match ReadRealm
    rr_match = None
    best_rr_score = 0.0
    for c in rr_comics:
        sub = c.get('subject') or c.get('title') or ''
        # Direct matcher
        mat, s = match_manga_setting(sub, [m], threshold=0.85)
        if mat and s > best_rr_score:
            best_rr_score = s
            rr_match = c
    # Fallback to mapping check if not matched
    if not rr_match:
        for map_item in mappings:
            # Check if canonical_title matches mname
            _, s_map = match_manga_setting(map_item.get('canonical_title', ''), [m], threshold=0.85)
            if s_map >= 0.85:
                # Find in rr_comics by comic_id
                target_id = map_item.get('platforms', {}).get('readrealm', {}).get('comic_id')
                if target_id:
                    for c in rr_comics:
                        if str(c.get('comic_id') or c.get('id')) == str(target_id):
                            rr_match = c
                            best_rr_score = s_map
                            break

    # Match Kairew
    kw_match = None
    best_kw_score = 0.0
    for c in kw_comics:
        sub = c.get('name') or c.get('subject') or c.get('title') or ''
        mat, s = match_manga_setting(sub, [m], threshold=0.85)
        if mat and s > best_kw_score:
            best_kw_score = s
            kw_match = c
    if not kw_match:
        for map_item in mappings:
            _, s_map = match_manga_setting(map_item.get('canonical_title', ''), [m], threshold=0.85)
            if s_map >= 0.85:
                target_id = map_item.get('platforms', {}).get('kairew', {}).get('comic_id')
                if target_id:
                    for c in kw_comics:
                        if str(c.get('comic_id') or c.get('id')) == str(target_id):
                            kw_match = c
                            best_kw_score = s_map
                            break

    # Match Chaply
    ch_match = None
    best_ch_score = 0.0
    for c in ch_comics:
        sub = c.get('subject') or c.get('title') or ''
        mat, s = match_manga_setting(sub, [m], threshold=0.85)
        if mat and s > best_ch_score:
            best_ch_score = s
            ch_match = c
    if not ch_match:
        for map_item in mappings:
            _, s_map = match_manga_setting(map_item.get('canonical_title', ''), [m], threshold=0.85)
            if s_map >= 0.85:
                target_id = map_item.get('platforms', {}).get('chaply', {}).get('comic_id')
                if target_id:
                    for c in ch_comics:
                        if str(c.get('comic_id') or c.get('id')) == str(target_id):
                            ch_match = c
                            best_ch_score = s_map
                            break

    rr_ok = (rr_match is not None) if expected_rr else (rr_match is None)
    kw_ok = (kw_match is not None) if expected_kw else (kw_match is None)
    ch_ok = (ch_match is not None) if expected_ch else (ch_match is None)
    
    is_100_percent = rr_ok and kw_ok and ch_ok

    res_item = {
        'index': idx,
        'manga_id': mid,
        'title': mname,
        'expected_platforms': platforms_cfg,
        'rr_match': bool(rr_match),
        'rr_title': (rr_match.get('subject') or rr_match.get('title')) if rr_match else None,
        'rr_id': (rr_match.get('comic_id') or rr_match.get('id')) if rr_match else None,
        'rr_score': round(best_rr_score, 3),
        'rr_ok': rr_ok,
        'kw_match': bool(kw_match),
        'kw_title': (kw_match.get('name') or kw_match.get('subject') or kw_match.get('title')) if kw_match else None,
        'kw_id': (kw_match.get('comic_id') or kw_match.get('id')) if kw_match else None,
        'kw_score': round(best_kw_score, 3),
        'kw_ok': kw_ok,
        'ch_match': bool(ch_match),
        'ch_title': (ch_match.get('subject') or ch_match.get('title')) if ch_match else None,
        'ch_id': (ch_match.get('comic_id') or ch_match.get('id')) if ch_match else None,
        'ch_score': round(best_ch_score, 3),
        'ch_ok': ch_ok,
        'is_100': is_100_percent
    }
    results.append(res_item)

total = len(results)
full_matches = [r for r in results if r['is_100']]
mismatches = [r for r in results if not r['is_100']]

print(f"\nTotal Stories Evaluated: {total}")
print(f"100% Fully Matched Stories: {len(full_matches)} / {total} ({len(full_matches)/total*100:.1f}%)")
print(f"Issues / Mismatches: {len(mismatches)} / {total}")

if mismatches:
    print("\n" + "="*80)
    print("LIST OF MISMATCHED / MISSING STORIES:")
    print("="*80)
    for m in mismatches:
        print(f"\n[ID {m['manga_id']}] {m['title']}")
        print(f"  Expected: {m['expected_platforms']}")
        print(f"  ReadRealm: {'OK' if m['rr_ok'] else 'FAIL'} (Matched: {m['rr_match']}, Score: {m['rr_score']}, Title: '{m['rr_title']}')")
        print(f"  Kairew:    {'OK' if m['kw_ok'] else 'FAIL'} (Matched: {m['kw_match']}, Score: {m['kw_score']}, Title: '{m['kw_title']}')")
        print(f"  Chaply:    {'OK' if m['ch_ok'] else 'FAIL'} (Matched: {m['ch_match']}, Score: {m['ch_score']}, Title: '{m['ch_title']}')")

# Save results to json for detailed analysis
with open(os.path.join(DATA_DIR, "matching_dry_run_results.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(f"\nResults saved to tools/data/matching_dry_run_results.json")

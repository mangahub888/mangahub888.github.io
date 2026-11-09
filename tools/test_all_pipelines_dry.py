#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comprehensive Dry Run & Unit Test Suite for:
1. Multi-Platform Growth & P&L Tracker (ReadRealm + Kairew + Chaply)
2. Weekly Project Ideas Crawler (Mgeko + Comix.to Chrome DOM)
3. Comix 1-Click Auto-Downloader (RawTracker & 20-Page Virtual Canvas)
4. Batch Scripts & Frontend Data Integrity
"""

import os
import sys
import json
import time
import unittest
import io
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
TOOLS_DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_SRC_DATA = os.path.join(REPO_ROOT, "frontend", "src", "data")
FRONTEND_PUB_DATA = os.path.join(REPO_ROOT, "frontend", "public", "data")


class TestDeliverable1GrowthAndPnL(unittest.TestCase):
    """Deliverable 1: 3-Platform Growth, Sales, and P&L Tracking Tests"""

    def test_01_batch_file_syntax(self):
        bat_path = os.path.join(REPO_ROOT, "RUN_3PLATFORMS_GROWTH_TRACKER.bat")
        self.assertTrue(os.path.exists(bat_path), "RUN_3PLATFORMS_GROWTH_TRACKER.bat must exist")
        with open(bat_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("chcp 65001", content)
        self.assertIn("multi_platform_tracker.py", content)
        self.assertIn("--send-gas", content)
        self.assertIn("npm run build", content)

    def test_02_cross_platform_mappings(self):
        map_path = os.path.join(TOOLS_DATA_DIR, "comic_cross_platform_mapping.json")
        self.assertTrue(os.path.exists(map_path), "comic_cross_platform_mapping.json must exist")
        with open(map_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        mappings = data.get("mappings", [])
        self.assertGreater(len(mappings), 30, "Mappings should have at least 30 titles mapped")
        for m in mappings[:5]:
            self.assertIn("canonical_key", m)
            self.assertIn("canonical_title", m)
            self.assertIn("platforms", m)

    def test_03_consolidate_multi_platform_data(self):
        from multi_platform_tracker import consolidate_multi_platform_data
        unified = consolidate_multi_platform_data()
        self.assertIsInstance(unified, dict)
        self.assertIn("total_sales_portfolio", unified)
        self.assertIn("total_views_portfolio", unified)
        self.assertIn("total_comics", unified)
        self.assertIn("platforms_breakdown", unified)
        self.assertGreater(unified["total_sales_portfolio"], 100000.0, "Portfolio sales should be substantial (>100k)")
        self.assertGreater(unified["total_comics"], 100, "Portfolio should have > 100 comics")
        self.assertIn("readrealm", unified["platforms_breakdown"])
        self.assertIn("kairew", unified["platforms_breakdown"])
        self.assertIn("chaply", unified["platforms_breakdown"])

    def test_04_grouped_matched_comics_generation(self):
        import subprocess
        res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "group_matching_comics.py")],
                             cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, f"group_matching_comics.py failed: {res.stderr}")
        out_json = os.path.join(TOOLS_DATA_DIR, "grouped_matched_comics.json")
        self.assertTrue(os.path.exists(out_json))
        with open(out_json, "r", encoding="utf-8") as f:
            groups = json.load(f)
        self.assertIsInstance(groups, list)
        self.assertGreater(len(groups), 50, "Should have > 50 matched groups")


class TestDeliverable2ProjectIdeasCrawler(unittest.TestCase):
    """Deliverable 2: Weekly Project Ideas Crawler Tests (Mgeko + Comix.to)"""

    def test_01_batch_file_syntax(self):
        bat_path = os.path.join(REPO_ROOT, "RUN_PROJECT_IDEAS_WEEKLY.bat")
        self.assertTrue(os.path.exists(bat_path), "RUN_PROJECT_IDEAS_WEEKLY.bat must exist")
        with open(bat_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("chcp 65001", content)
        self.assertIn("mgeko_project_ideas_crawler.py", content)
        self.assertIn("--pages 10", content)
        self.assertIn("--max-chapters 100", content)
        self.assertIn("npm run build", content)

    def test_02_historical_baseline_preserves_30_chapter_gems(self):
        from mgeko_project_ideas_crawler import load_historical_mgeko_candidates, load_historical_comix_candidates
        mgeko_hist = load_historical_mgeko_candidates(100)
        comix_hist = load_historical_comix_candidates(100)
        self.assertGreater(len(mgeko_hist), 50, "Mgeko baseline should retain historical portfolio")
        self.assertGreater(len(comix_hist), 100, "Comix baseline should retain historical portfolio")

        # Specific verification: "The Return of the Scorned Genius" must exist in Mgeko historical portfolio
        scorned_found = any("scorned-genius" in k.lower() or "scorned genius" in it.get("title", "").lower()
                            for k, it in mgeko_hist.items())
        self.assertTrue(scorned_found, "'The Return of the Scorned Genius' must be preserved in Mgeko candidates")

    def test_03_comix_raw_item_parser_threshold(self):
        from mgeko_project_ideas_crawler import parse_comix_raw_item
        # Under 100 chapters -> Accepted
        raw_ok = {
            "hid": "test1234",
            "title": "Solo Leveling Beginner",
            "latestChapter": 30,
            "type": "manhwa",
            "status": "releasing",
            "followsTotal": 5400,
            "synopsis": "A great story"
        }
        res_ok = parse_comix_raw_item(raw_ok, max_chapters=100)
        self.assertIsNotNone(res_ok)
        self.assertEqual(res_ok["chapter_count"], 30)
        self.assertEqual(res_ok["origin"], "KR (Manhwa)")

        # Over 100 chapters -> Filtered out
        raw_over = {
            "hid": "over1234",
            "title": "Infinite Martial God",
            "latestChapter": 450,
            "type": "manhua"
        }
        res_over = parse_comix_raw_item(raw_over, max_chapters=100)
        self.assertIsNone(res_over, "Comics with > 100 chapters must be filtered out")

    def test_04_project_ideas_latest_json_schema(self):
        ideas_file = os.path.join(TOOLS_DATA_DIR, "project_ideas_latest.json")
        self.assertTrue(os.path.exists(ideas_file), "project_ideas_latest.json must exist")
        with open(ideas_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("sources", data)
        self.assertIn("mgeko", data["sources"])
        self.assertIn("comix", data["sources"])
        m_items = data["sources"]["mgeko"]["items"]
        c_items = data["sources"]["comix"]["items"]
        self.assertGreater(len(m_items), 50)
        self.assertGreater(len(c_items), 100)

        # Ensure all items adhere to <= 100 chapters rule
        for it in m_items[:20]:
            self.assertLessEqual(float(it.get("chapter_count", 0)), 100)
        for it in c_items[:20]:
            self.assertLessEqual(float(it.get("chapter_count", 0)), 100)


class TestDeliverable3ComixPurchaserAndSlicer(unittest.TestCase):
    """Deliverable 3: Comix 1-Click Auto-Downloader, Virtual Canvas & Slicing Tests"""

    def test_01_batch_file_syntax(self):
        bat_path = os.path.join(REPO_ROOT, "RUN_COMIX_1CLICK_ALL_PENDING.bat")
        self.assertTrue(os.path.exists(bat_path), "RUN_COMIX_1CLICK_ALL_PENDING.bat must exist")
        with open(bat_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("chcp 65001", content)
        self.assertIn("comix_purchaser.py", content)
        self.assertIn("--all-pending", content)

    def test_02_continuous_canvas_stitching_and_20_pages_slicing(self):
        """Test continuous vertical slicing into exactly 20 standard pages (001.jpg - 020.jpg)"""
        from comix_purchaser import stitch_comix_pages_in_memory, TARGET_TOTAL_PAGES

        # Create 5 synthetic image slices of variable heights
        slices = []
        for h in [600, 1200, 800, 1500, 900]:
            img = Image.new("RGB", (720, h), color=(100, 150, 200))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            slices.append(buf.getvalue())

        pages = stitch_comix_pages_in_memory(slices)
        self.assertEqual(len(pages), TARGET_TOTAL_PAGES, f"Must yield exactly {TARGET_TOTAL_PAGES} pages")
        self.assertEqual(pages[0][0], "001.jpg")
        self.assertEqual(pages[19][0], "020.jpg")

        for p_name, img_bytes, p_h in pages:
            self.assertTrue(p_name.endswith(".jpg"))
            self.assertGreater(len(img_bytes), 1000)
            self.assertGreater(p_h, 0)
            # Verify valid decodable image
            with Image.open(io.BytesIO(img_bytes)) as decoded:
                self.assertEqual(decoded.width, 720)

    def test_03_comix_purchaser_cli_dry_run(self):
        import subprocess
        res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "comix_purchaser.py"), "--dry-run"],
                             cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, f"--dry-run should exit with 0: {res.stderr}")
        self.assertIn("[DRY RUN]", res.stdout)

    def test_04_comix_info_only_via_dom(self):
        """Verify Playwright Chrome DOM Reader Area extracts 100% of images without token error"""
        from comix_purchaser import fetch_comix_chapter_info
        test_url = "https://comix.to/title/z0l20-god-level-assassin-im-the-shadow/11686863-chapter-152"
        res = fetch_comix_chapter_info(test_url, use_dom=True)
        self.assertTrue(res.get("success"), f"fetch_comix_chapter_info failed: {res.get('error')}")
        self.assertEqual(res.get("chapterNumber"), 152.0)
        self.assertGreater(res.get("imagesCount", 0), 10, "Should extract slices from DOM reader area")
        self.assertTrue(all(u.startswith("http") for u in res.get("images", [])))


class TestDataSynchronizationAndBuild(unittest.TestCase):
    """Integration: Data Sync & Frontend Build Verification"""

    def test_01_json_data_mirrored_to_frontend(self):
        files_to_check = [
            "multi_platform_growth_latest.json",
            "grouped_matched_comics.json",
            "project_ideas_latest.json",
            "comix_project_ideas_latest.json"
        ]
        for fname in files_to_check:
            t_path = os.path.join(TOOLS_DATA_DIR, fname)
            src_path = os.path.join(FRONTEND_SRC_DATA, fname)
            pub_path = os.path.join(FRONTEND_PUB_DATA, fname)
            self.assertTrue(os.path.exists(t_path), f"{t_path} missing")
            self.assertTrue(os.path.exists(src_path), f"{src_path} missing")
            self.assertTrue(os.path.exists(pub_path), f"{pub_path} missing")
            self.assertGreater(os.path.getsize(src_path), 100, f"{src_path} should not be empty")

    def test_02_frontend_dist_built(self):
        dist_html = os.path.join(REPO_ROOT, "frontend", "dist", "index.html")
        self.assertTrue(os.path.exists(dist_html), "frontend/dist/index.html must exist")
        self.assertGreater(os.path.getsize(dist_html), 1000)


if __name__ == "__main__":
    unittest.main(verbosity=2)

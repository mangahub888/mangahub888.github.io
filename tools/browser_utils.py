#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Browser Utilities for MangaHub Automation
-----------------------------------------
Provides shared helpers for Playwright Chrome automation:
1. set_browser_window_bottom_most(): Places Chrome window at HWND_BOTTOM
   (behind all active windows) on Windows so it doesn't steal focus or interrupt user.
2. get_browser_executable_path(): Detects Google Chrome or Edge executable paths.
"""

import os
import sys
import ctypes
from typing import Optional

def get_browser_executable_path() -> Optional[str]:
    """Detect installed Google Chrome or Edge executable on Windows."""
    if sys.platform != "win32":
        return None
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

def set_browser_window_bottom_most(title_filter: str = ""):
    """
    Sets the Chrome browser window to HWND_BOTTOM (behind all active windows).
    Opposite of topmost (หน้าหลังสุด / ตรงกันข้ามกับ topmost) so that it remains
    visible on screen in the background without stealing user focus or interrupting work.
    """
    if sys.platform != "win32":
        return
    try:
        user32 = ctypes.windll.user32
        HWND_BOTTOM = 1
        SWP_NOSIZE = 0x0001
        SWP_NOMOVE = 0x0002
        SWP_NOACTIVATE = 0x0010

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        found_hwnds = []

        keywords = [
            "chrome", "manga", "readrealm", "kairew", "chaply",
            "kuaikan", "comix", "mgeko", "tencent", "thunderscans"
        ]

        def enum_windows_callback(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    txt = buf.value.lower()
                    if any(k in txt for k in keywords) or (title_filter and title_filter.lower() in txt):
                        found_hwnds.append(hwnd)
            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        for hwnd in found_hwnds:
            user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    except Exception:
        pass

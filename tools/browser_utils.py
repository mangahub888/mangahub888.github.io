#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Browser Utilities for MangaHub Automation
-----------------------------------------
Provides shared helpers for Playwright Chrome automation:
1. set_browser_window_bottom_most(): Places Google Chrome window at HWND_BOTTOM
   (behind all active windows) on Windows so it doesn't steal focus or interrupt user.
   STRICT EDGE PROTECTION: Microsoft Edge is completely protected and excluded.
   Edge windows will NEVER be pushed to background or manipulated.
2. get_browser_executable_path(): Detects Google Chrome executable paths (never Edge).
"""

import os
import sys
import ctypes
from typing import Optional


def get_browser_executable_path() -> Optional[str]:
    """Detect installed Google Chrome executable on Windows (strictly excludes Microsoft Edge)."""
    if sys.platform != "win32":
        return None
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe")
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def get_process_name_from_hwnd(hwnd) -> str:
    """Retrieve process executable basename for a given window HWND."""
    try:
        pid = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return ""
        # PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, fallback to 0x0400
        h_process = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid.value)
        if not h_process:
            h_process = ctypes.windll.kernel32.OpenProcess(0x0400, False, pid.value)
        if h_process:
            buf = ctypes.create_unicode_buffer(512)
            size = ctypes.c_ulong(512)
            success = ctypes.windll.kernel32.QueryFullProcessImageNameW(h_process, 0, buf, ctypes.byref(size))
            ctypes.windll.kernel32.CloseHandle(h_process)
            if success:
                return os.path.basename(buf.value).lower()
    except Exception:
        pass
    return ""


def set_browser_window_bottom_most(title_filter: str = ""):
    """
    Sets the Google Chrome browser window to HWND_BOTTOM (behind all active windows).
    Opposite of topmost (หน้าหลังสุด / ตรงกันข้ามกับ topmost) so that it remains
    visible on screen in the background without stealing user focus or interrupting work.

    STRICT EDGE PROTECTION:
    - Microsoft Edge (msedge.exe) is explicitly and 100% ignored/protected.
    - Any window matching Edge process or title is never moved or modified.
    - Only Google Chrome (chrome.exe) is placed at HWND_BOTTOM.
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
            if not user32.IsWindowVisible(hwnd):
                return True

            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True

            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            txt = buf.value.lower()

            # 1. STRICT EDGE EXCLUSION BY TITLE
            # If window belongs to or mentions Microsoft Edge, DO NOT TOUCH!
            if "edge" in txt or "microsoft edge" in txt:
                return True

            # 2. STRICT EDGE EXCLUSION BY PROCESS EXE NAME
            proc = get_process_name_from_hwnd(hwnd)
            if "edge" in proc or "msedge" in proc:
                return True

            # 3. TARGET ONLY GOOGLE CHROME
            # Only windows belonging to chrome.exe (or matching keywords if proc name could not be queried)
            if proc and proc != "chrome.exe":
                return True

            if any(k in txt for k in keywords) or (title_filter and title_filter.lower() in txt):
                found_hwnds.append(hwnd)

            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        for hwnd in found_hwnds:
            user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    except Exception:
        pass

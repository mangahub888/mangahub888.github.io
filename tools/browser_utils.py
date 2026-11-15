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
2. bring_browser_window_to_top(): Adaptively brings Google Chrome to foreground
   when human intervention is needed (e.g. Cloudflare Turnstile / Captcha / 2FA).
3. check_and_handle_antibot_or_login(): Monitors page for Cloudflare challenges
   or login redirects; brings window to front, alerts user, and sends back to bottom
   when solved.
4. get_browser_executable_path(): Detects Google Chrome executable paths (never Edge).
"""

import os
import sys
import ctypes
import time
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


def get_chrome_hwnds(title_filter: str = "") -> list:
    """
    Find HWNDs belonging strictly to Google Chrome (never Edge).
    STRICT EDGE PROTECTION:
    - Microsoft Edge (msedge.exe) is explicitly and 100% ignored/protected.
    - Any window matching Edge process or title is never moved or modified.
    - Only Google Chrome (chrome.exe) is collected.
    """
    if sys.platform != "win32":
        return []
    try:
        user32 = ctypes.windll.user32
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
            if "edge" in txt or "microsoft edge" in txt:
                return True

            # 2. STRICT EDGE EXCLUSION BY PROCESS EXE NAME
            proc = get_process_name_from_hwnd(hwnd)
            if "edge" in proc or "msedge" in proc:
                return True

            # 3. TARGET ONLY GOOGLE CHROME
            if proc and proc != "chrome.exe":
                return True

            if any(k in txt for k in keywords) or (title_filter and title_filter.lower() in txt):
                found_hwnds.append(hwnd)

            return True

        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
        return found_hwnds
    except Exception:
        return []


def set_browser_window_bottom_most(title_filter: str = ""):
    """
    Sets the Google Chrome browser window to HWND_BOTTOM (behind all active windows).
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

        found_hwnds = get_chrome_hwnds(title_filter)
        for hwnd in found_hwnds:
            user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    except Exception:
        pass


def bring_browser_window_to_top(browser_proc=None, page=None, title_filter: str = ""):
    """
    Brings Google Chrome window to the foreground / HWND_TOP.
    Used adaptively when an anti-bot challenge (e.g. Cloudflare Turnstile / Captcha)
    or login screen requires human interaction.

    STRICT EDGE PROTECTION:
    - Microsoft Edge is strictly excluded and never touched.
    """
    if page:
        try:
            page.bring_to_front()
        except Exception:
            pass

    if sys.platform != "win32":
        return

    try:
        user32 = ctypes.windll.user32
        HWND_TOPMOST = -1
        HWND_NOTOPMOST = -2
        SWP_NOSIZE = 0x0001
        SWP_NOMOVE = 0x0002
        SW_RESTORE = 9

        found_hwnds = get_chrome_hwnds(title_filter)
        for hwnd in found_hwnds:
            user32.ShowWindow(hwnd, SW_RESTORE)
            user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
            user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
    except Exception:
        pass


def check_and_handle_antibot_or_login(page, platform_name: str = "", timeout_sec: int = 180) -> bool:
    """
    Adaptive Anti-Bot & Session Loss Handler:
    1. Checks if current page is blocked by Cloudflare (Turnstile, Just a moment..., Challenge)
       or has redirected to a login page due to expired session.
    2. If detected:
       - Brings Google Chrome window to Foreground / Topmost
       - Emits an audible beep (winsound)
       - Displays a high-visibility terminal alert banner
       - Waits adaptively for the user to solve the challenge or complete login
    3. Once resolved:
       - Automatically sends the browser window back to HWND_BOTTOM
       - Resumes scraping seamlessly
    """
    def detect_block(p) -> tuple[bool, str]:
        try:
            t = (p.title() or "").lower()
            u = (p.url or "").lower()

            cf_title_keywords = [
                "just a moment", "attention required", "cloudflare",
                "verify you are human", "ddos-guard", "checking your browser"
            ]
            for kw in cf_title_keywords:
                if kw in t:
                    return True, f"Cloudflare Anti-Bot Title ('{p.title()}')"

            cf_selectors = [
                "iframe[src*='cloudflare']",
                "iframe[src*='challenges.cloudflare.com']",
                "iframe[src*='turnstile']",
                "#cf-wrapper",
                "#challenge-stage",
                ".cf-turnstile",
                "div[class*='turnstile']",
                "[name='cf-turnstile-response']"
            ]
            for sel in cf_selectors:
                try:
                    if p.locator(sel).count() > 0:
                        return True, f"Cloudflare DOM Selector ('{sel}')"
                except Exception:
                    pass

            if "/login" in u or "/signin" in u:
                return True, f"Login screen redirect ({p.url})"

            return False, ""
        except Exception:
            return False, ""

    is_blocked, reason = detect_block(page)
    if not is_blocked:
        return True

    plat_label = f" [{platform_name}]" if platform_name else ""
    print("\n" + "=" * 76)
    print(f"🚨 ⚠️  [ANTI-BOT / LOGIN REQUIRED]{plat_label} ตรวจพบหน้าจอที่ต้องมีการตอบสนอง!")
    print(f"       สาเหตุ: {reason}")
    print(f"       ⚡ กำลังดึง Google Chrome ขึ้นมา Foreground / หน้าสุดของจอ...")
    print(f"       👉 กรุณาคลิกผ่าน Cloudflare Turnstile หรือดำเนินการเข้าสู่ระบบในหน้าจอ Chrome")
    print(f"       (ระบบจะรออัตโนมัติสูงสุด {timeout_sec} วินาที และจะส่งหน้าต่างกลับไปอยู่หลังสุดเมื่อเสร็จ)")
    print("=" * 76 + "\n", flush=True)

    if sys.platform == "win32":
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
            time.sleep(0.1)
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass

    bring_browser_window_to_top(page=page, title_filter=platform_name)

    start_wait = time.time()
    while time.time() - start_wait < timeout_sec:
        time.sleep(2)
        still_blocked, _ = detect_block(page)
        if not still_blocked:
            time.sleep(1.5)
            still_blocked2, _ = detect_block(page)
            if not still_blocked2:
                print(f"✅ [ANTI-BOT RESOLVED]{plat_label} ผ่านการตรวจสอบเรียบร้อยแล้ว!")
                print(f"   -> ส่ง Google Chrome กลับไปอยู่หลังสุดของจอ (HWND_BOTTOM) อัตโนมัติ\n", flush=True)
                set_browser_window_bottom_most(title_filter=platform_name)
                return True

    print(f"❌ [ANTI-BOT TIMEOUT]{plat_label} หมดเวลารอ ({timeout_sec}s)\n", flush=True)
    return False

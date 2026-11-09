import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
profile_dir = os.path.join(BASE_DIR, ".chrome_chaply")
AUTH_FILE = os.path.join(DATA_DIR, "chaply_auth.json")
BEARER_FILE = os.path.join(DATA_DIR, "chaply_bearer.json")

try:
    from browser_utils import get_browser_executable_path, set_browser_window_bottom_most
except ImportError:
    try:
        from tools.browser_utils import get_browser_executable_path, set_browser_window_bottom_most
    except ImportError:
        def get_browser_executable_path():
            return None
        def set_browser_window_bottom_most(t=""):
            pass

exec_path = get_browser_executable_path()

USER = "kuroko11.p.g@gmail.com"
PASS = "@Poom112345ad"

captured_tokens = {}

def on_request(request):
    url = request.url
    headers = request.headers
    if "api" in url or "chaply" in url:
        auth = headers.get("authorization")
        if auth and "Bearer" in auth:
            token = auth.split(" ")[1]
            if token != captured_tokens.get("token"):
                captured_tokens["token"] = token
                captured_tokens["bearer"] = auth
                captured_tokens["url"] = url
                print(f"\n[INTERCEPT] Found Bearer Token! Length: {len(token)} from {url}", flush=True)
                with open(BEARER_FILE, "w", encoding="utf-8") as f:
                    json.dump(captured_tokens, f, indent=2)

def main():
    os.makedirs(os.path.dirname(AUTH_FILE), exist_ok=True)
    os.makedirs(profile_dir, exist_ok=True)

    with sync_playwright() as p:
        launch_kwargs = {
            "user_data_dir": profile_dir,
            "headless": False,
            "channel": "chrome",
            "no_viewport": True,
            "ignore_default_args": ["--enable-automation"],
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars"
            ]
        }
        if exec_path:
            launch_kwargs["executable_path"] = exec_path

        try:
            context = p.chromium.launch_persistent_context(**launch_kwargs)
        except Exception:
            launch_kwargs.pop("channel", None)
            context = p.chromium.launch_persistent_context(**launch_kwargs)

        set_browser_window_bottom_most("chaply")
        page = context.pages[0] if context.pages else context.new_page()
        page.on("request", on_request)

        print("Navigating to https://www.chaply.net ...", flush=True)
        page.goto("https://www.chaply.net", wait_until="domcontentloaded")
        set_browser_window_bottom_most("chaply")
        time.sleep(3)

        # Check if already logged in
        session_info = page.evaluate("""async () => {
            try {
                const res = await fetch('/api/auth/session');
                return await res.json();
            } catch(e) { return null; }
        }""")
        print("Initial session:", session_info, flush=True)

        if not session_info or not session_info.get("user"):
            print("Opening login modal...", flush=True)
            user_btn = page.locator("header button.ms-2, nav button.ms-2").first
            if user_btn.count():
                user_btn.click()
                time.sleep(2)

            email_inp = page.locator("input[name='email']").first
            pass_inp = page.locator("input[name='password']").first
            if email_inp.count() and pass_inp.count():
                print("Filling credentials...", flush=True)
                email_inp.fill(USER)
                pass_inp.fill(PASS)

            btn = page.locator("div[role='dialog'] button[type='submit']").first
            print("Waiting for Turnstile verification / user login (up to 45s)...", flush=True)
            for i in range(45):
                time.sleep(1)
                # Check if dialog closed or session exists
                try:
                    s = page.evaluate("async () => (await (await fetch('/api/auth/session')).json())")
                    if s and s.get("user"):
                        print(f"Logged in successfully as {s.get('user', {}).get('email')}!", flush=True)
                        break
                except Exception:
                    pass

                if btn.count() and not btn.is_disabled():
                    print("Button is enabled! Clicking submit...", flush=True)
                    btn.click()
                    time.sleep(3)

                if (i + 1) % 5 == 0:
                    print(f"Waiting {i+1}s...", flush=True)

        # Save session
        context.storage_state(path=AUTH_FILE)
        print(f"Saved auth to {AUTH_FILE}", flush=True)

        # Inspect session again
        final_session = page.evaluate("""async () => {
            try {
                const res = await fetch('/api/auth/session');
                return await res.json();
            } catch(e) { return null; }
        }""")
        print("Final session:", final_session, flush=True)

        # Navigate to creator/writer if available
        print("Testing creator URL: https://www.chaply.net/creator ...", flush=True)
        page.goto("https://www.chaply.net/writer/dashboard", wait_until="domcontentloaded")
        time.sleep(4)
        print("Creator URL:", page.url, "Title:", page.title(), flush=True)
        page.screenshot(path="tools/data/chaply_creator.png")

        context.close()
        print("Done.", flush=True)

if __name__ == "__main__":
    main()

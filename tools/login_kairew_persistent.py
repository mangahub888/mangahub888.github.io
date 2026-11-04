import os
import sys
import time
import json
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

exec_path = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
profile_dir = r"D:\new backend\mangahub888.github.io\tools\.chrome_kairew"
AUTH_FILE = r"D:\new backend\mangahub888.github.io\tools\data\kairew_auth.json"
BEARER_FILE = r"D:\new backend\mangahub888.github.io\tools\data\kairew_bearer.json"

USER = "0886172880"
PASS = "poom112345ad"

captured_tokens = {}

def on_request(request):
    url = request.url
    headers = request.headers
    if "kairew" in url:
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
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            executable_path=exec_path,
            headless=False,
            no_viewport=True,
            ignore_default_args=["--enable-automation"],
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars"
            ]
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.on("request", on_request)

        print("Navigating to https://kairew.com/ ...", flush=True)
        page.goto("https://kairew.com/", wait_until="domcontentloaded")
        time.sleep(3)

        # Check if already logged in
        cur_url = page.url
        print("Homepage URL:", cur_url, flush=True)

        print("Navigating to https://kairew.com/login ...", flush=True)
        page.goto("https://kairew.com/login", wait_until="domcontentloaded")
        time.sleep(3)

        if "/login" in page.url:
            user_inp = page.locator("input[placeholder*='เบอร์'], input[placeholder*='อีเมล']").first
            pass_inp = page.locator("input[type='password']").first
            if user_inp.count() and pass_inp.count():
                print("Filling credentials...", flush=True)
                user_inp.click()
                user_inp.fill(USER)
                pass_inp.click()
                pass_inp.fill(PASS)

            btn = page.locator("button[type='submit'], button.btn-login").first
            print("Waiting for Turnstile verification / user login (up to 45s)...", flush=True)
            for i in range(45):
                time.sleep(1)
                cur_url = page.url
                if "/login" not in cur_url:
                    print(f"Logged in successfully! New URL: {cur_url}", flush=True)
                    break

                if btn.count() and not btn.is_disabled():
                    print("Button is enabled! Clicking submit...", flush=True)
                    btn.click()
                    time.sleep(3)

                if (i + 1) % 5 == 0:
                    print(f"Waiting {i+1}s: url={cur_url}", flush=True)

        # Save session
        context.storage_state(path=AUTH_FILE)
        print(f"Saved auth to {AUTH_FILE}", flush=True)

        print("Navigating to https://kairew.com/writer/manage-book ...", flush=True)
        page.goto("https://kairew.com/writer/manage-book", wait_until="domcontentloaded")
        time.sleep(4)
        print("Manage Book URL:", page.url, "Title:", page.title(), flush=True)
        page.screenshot(path="tools/data/kairew_manage_book.png")

        # Extract Inertia page props
        props_data = page.evaluate("""() => {
            const app = document.getElementById('app');
            if (!app) return null;
            try {
                return JSON.parse(app.dataset.page);
            } catch(e) { return null; }
        }""")
        if props_data:
            with open("tools/data/kairew_manage_book_props.json", "w", encoding="utf-8") as f:
                json.dump(props_data, f, indent=2, ensure_ascii=False)
            print("Saved tools/data/kairew_manage_book_props.json", flush=True)

        context.close()
        print("Done.", flush=True)

if __name__ == "__main__":
    main()

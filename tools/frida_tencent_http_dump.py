#!/usr/bin/env python3
"""
Frida runner for tools/frida_tencent_http_dump.js
-------------------------------------------------
Starts (or reuses) frida-server inside LDPlayer, spawns Tencent Comic with the
dump script injected, and streams every captured HTTP event to a JSONL file.

This captures traffic at the JAVA application layer (OkHttp / URLConnection),
so SSL pinning, MITM proxies and CA installation are not involved at all.

Prerequisites
  1. LDPlayer: Settings -> enable "Root permission" and "ADB debugging"
  2. pip install frida frida-tools         (version must match frida-server)
  3. Download frida-server-<ver>-android-x86_64 from frida/releases
     (x86_64, NOT arm64 - LDPlayer runs on an x86_64 kernel) and save it as
     tools/frida-server or pass --server <path>

Usage
  python tools/frida_tencent_http_dump.py --server tools\\frida-server
  python tools/frida_tencent_http_dump.py --no-spawn          # attach to running app
  python tools/frida_tencent_http_dump.py --filter ac.qq.com  # only print matching URLs
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

APP_ID = "com.qq.ac.android"
REMOTE_BIN = "/data/local/tmp/fsd"
REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = Path(__file__).resolve().parent / "frida_tencent_http_dump.js"

ADB_CANDIDATES = [
    r"C:\LDPlayer\LDPlayer9\adb.exe",
    r"C:\LDPlayer\LDPlayer5\adb.exe",
    r"C:\LDPlayer\LDPlayer4\adb.exe",
    "adb",
]


def log(msg):
    print(f"[runner] {msg}", flush=True)


def find_adb(explicit):
    if explicit:
        return explicit
    for cand in ADB_CANDIDATES:
        if cand == "adb":
            try:
                subprocess.run([cand, "version"], capture_output=True, timeout=10, check=False)
                return cand
            except Exception:
                continue
        if Path(cand).exists():
            return cand
    return "adb"


def pick_serial(adb_path):
    """LDPlayer often exposes the same instance twice (IP + emulator-NNNN)."""
    out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=30).stdout
    serials = [l.split("\t")[0].strip() for l in out.splitlines()[1:] if "\tdevice" in l]
    if serials:
        log(f"auto-selected adb serial: {serials[0]} (of {len(serials)} device(s))")
    return serials[0] if serials else ""


def adb(adb_path, serial, *args, check=False, timeout=120):
    cmd = [adb_path] + (["-s", serial] if serial else []) + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {res.stderr.strip() or res.stdout.strip()}")
    return res.stdout.strip()


def ensure_server(adb_path, serial, server_path, port):
    """Push + launch frida-server (renamed to 'fsd' to dodge anti-frida checks)."""
    out = adb(adb_path, serial, "shell", f"ls {REMOTE_BIN} 2>/dev/null")
    if not out:
        if not server_path or not Path(server_path).exists():
            log(f"frida-server not on device and local binary not found: {server_path}")
            log("download frida-server-<pip-version>-android-x86_64 and pass --server <path>")
            sys.exit(2)
        log(f"pushing {server_path} -> {REMOTE_BIN}")
        adb(adb_path, serial, "push", str(server_path), REMOTE_BIN, check=True, timeout=300)
    adb(adb_path, serial, "shell", f"chmod 755 {REMOTE_BIN}")

    adb(adb_path, serial, "shell", "pkill -f fsd 2>/dev/null; true")
    time.sleep(0.5)

    # adbd normally runs as uid=2000(shell); frida-server must be started as root
    # to be able to spawn/inject into another app.
    start_cmd = f"nohup {REMOTE_BIN} -l 127.0.0.1:{port} >/dev/null 2>&1 &"
    as_root = adb(adb_path, serial, "shell", f'su -c "{start_cmd}" 2>&1')
    if "not found" in as_root.lower() or "permission denied" in as_root.lower():
        log("su failed, trying plain shell (spawn may be blocked)")
        adb(adb_path, serial, "shell", start_cmd)
    time.sleep(1.5)

    ps = adb(adb_path, serial, "shell", "ps -A 2>/dev/null | grep fsd")
    if "fsd" not in ps:
        log("frida-server did not start - is Root enabled in LDPlayer? (adb root)")
        sys.exit(3)

    adb(adb_path, serial, "forward", f"tcp:{port}", f"tcp:{port}")
    log(f"frida-server ready on 127.0.0.1:{port}")


def write_event(out_file, msg, filter_prefix):
    if not isinstance(msg, dict):
        msg = {"kind": "raw", "raw": str(msg)}
    with open(out_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")

    kind = msg.get("kind")
    url = msg.get("url", "")
    if kind == "request":
        if not filter_prefix or filter_prefix in url:
            print(f"[REQ ] {msg.get('method')} {url}", flush=True)
    elif kind == "response":
        if not filter_prefix or filter_prefix in url:
            print(f"[RESP] {msg.get('code')} {url}", flush=True)
    elif kind in ("cipher_init", "cipher_doFinal", "cipher_update"):
        data = msg.get("data") or {}
        if kind == "cipher_init":
            print(f"[INIT] {data.get('algorithm')}  {json.dumps(data, ensure_ascii=False)}", flush=True)
        else:
            print(f"[CRYPT] {data.get('algorithm')} in={data.get('inLen')} out={data.get('outLen')}", flush=True)
            print(f"        in : {data.get('inHead')}", flush=True)
            print(f"        out: {data.get('outHead')}", flush=True)
    elif kind == "h2_headers":
        data = msg.get("data") or {}
        if isinstance(data, dict):
            print(f"[H2 ] {data.get('where')}", flush=True)
            for h in (data.get("headers") or []):
                print(f"      {h}", flush=True)
    elif kind == "glide_url":
        print(f"[IMG ] {msg.get('url')}", flush=True)
    elif kind == "cipher":
        data = msg.get("data") or {}
        if data.get("phase"):
            print(f"[CRYPT] {data.get('phase')} {data.get('algo') or ''} key={data.get('key')} iv={data.get('iv')}", flush=True)
        else:
            print(f"[CRYPT] id={data.get('id')} in={data.get('inLen')} out={data.get('outLen')} key={data.get('key')}", flush=True)
    elif kind in ("native_ssl_write", "native_ssl_read", "socket_send", "socket_recv"):
        mark = ">>" if kind.endswith("send") or kind.endswith("write") else "<<"
        print(f"[{mark}] {(msg.get('preview') or '')[:160]}", flush=True)
    elif kind == "pinned_host":
        print(f"[PIN ] {msg.get('host')}", flush=True)
    elif kind in ("info", "error"):
        detail = msg.get("detail") or msg.get("data") or msg.get("where") or msg.get("msg") or msg.get("error") or ""
        print(f"[{kind.upper():5}] {detail}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Dump Tencent Comic HTTP traffic via Frida (no TLS MITM)")
    ap.add_argument("--adb", default=None, help="path to adb.exe (auto-detected)")
    ap.add_argument("--serial", default="", help="adb serial, e.g. emulator-5554")
    ap.add_argument("--connect", default="", help="adb connect target, e.g. 127.0.0.1:5555")
    ap.add_argument("--app", default=APP_ID)
    ap.add_argument("--server", default=str(REPO_ROOT / "tools" / "frida-server"))
    ap.add_argument("--port", type=int, default=27042, help="frida-server port")
    ap.add_argument("--out", default=str(REPO_ROOT / "scratch" / "tencent_http_dump.jsonl"))
    ap.add_argument("--script", default=str(SCRIPT_PATH))
    ap.add_argument("--filter", default="", help="only print URLs containing this substring")
    ap.add_argument("--no-spawn", action="store_true", help="attach to running app instead of spawning")
    ap.add_argument("--seconds", type=float, default=0, help="stop after N seconds (0 = forever)")
    args = ap.parse_args()

    try:
        import frida
    except ImportError:
        log("frida is not installed - run: pip install frida frida-tools")
        sys.exit(1)

    adb_path = find_adb(args.adb)
    serial = args.serial
    if args.connect:
        subprocess.run([adb_path, "connect", args.connect], capture_output=True, text=True)
        serial = serial or args.connect
    serial = serial or pick_serial(adb_path)

    if "uid=0" not in adb(adb_path, serial, "shell", "id"):
        log("warning: adb is not root - run 'adb root' if frida-server fails to start")

    ensure_server(adb_path, serial, args.server, args.port)

    out_file = Path(args.out)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    log(f"writing events to {out_file}")

    device = frida.get_device_manager().add_remote_device(f"127.0.0.1:{args.port}")
    log(f"frida {frida.__version__} connected")

    script_source = Path(args.script).read_text(encoding="utf-8")
    pid = None
    if args.no_spawn:
        # Android truncates the process comm to 15 chars, so attach-by-name can
        # fail for com.qq.ac.android -> resolve the pid through adb instead.
        pids = adb(adb_path, serial, "shell", f"pidof {args.app}").split()
        if pids and pids[0].isdigit():
            pid = int(pids[0])
            session = device.attach(pid)
            log(f"attached to running {args.app} (pid={pid})")
        else:
            session = device.attach(args.app)
            log(f"attached to running {args.app}")
    else:
        pid = device.spawn([args.app])
        session = device.attach(pid)
        log(f"spawned {args.app} (pid={pid})")

    script = session.create_script(script_source)
    script.on("message", lambda m, _d: write_event(out_file, m.get("payload", m), args.filter))
    script.load()

    if pid is not None and not args.no_spawn:
        device.resume(pid)
        log("app resumed - interact with the app to generate traffic")

    deadline = time.time() + args.seconds if args.seconds else None
    try:
        while deadline is None or time.time() < deadline:
            time.sleep(0.5)
    except KeyboardInterrupt:
        log("stopping...")
    finally:
        try:
            script.unload()
        except Exception:
            pass
        log(f"done - events saved to {out_file}")


if __name__ == "__main__":
    main()

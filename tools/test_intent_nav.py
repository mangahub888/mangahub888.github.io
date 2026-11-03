# -*- coding: utf-8 -*-
import frida
import subprocess
import time
import sys
import gzip
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

adb_exe = r"C:\LDPlayer\LDPlayer9\adb.exe"
pid_out = subprocess.run([adb_exe, "-s", "emulator-5554", "shell", "pidof", "com.qq.ac.android"], capture_output=True, text=True).stdout.strip()
if not pid_out:
    print("App not running!")
    sys.exit(1)
pid = int(pid_out.split()[0])
print(f"Target PID: {pid}")

# Ensure port forward
subprocess.run([adb_exe, "-s", "emulator-5554", "forward", "tcp:27042", "tcp:27042"])

dm = frida.get_device_manager()
device = dm.add_remote_device("127.0.0.1:27042")
session = device.attach(pid)

js_code = """
'use strict';

function cleanUrl(u) {
    if (!u) return '';
    return u.replace(/\\\\\\//g, '/').replace(/\\?tp=avif.*$/, '');
}

rpc.exports = {
    nav: function(comicId, chapterId, seqNo) {
        Java.perform(function() {
            var ActivityThread = Java.use('android.app.ActivityThread');
            var app = ActivityThread.currentApplication();
            var ctx = app.getApplicationContext();

            var Intent = Java.use('android.content.Intent');
            var ComponentName = Java.use('android.content.ComponentName');

            var intent = Intent.$new();
            intent.setComponent(ComponentName.$new('com.qq.ac.android', 'com.qq.ac.android.reader.comic.ComicReaderActivity'));
            intent.putExtra('STR_MSG_COMIC_ID', String(comicId));
            intent.putExtra('STR_MSG_CHAPTER_ID', String(chapterId));
            if (seqNo) {
                intent.putExtra('STR_MSG_CHAPTER_SEQ_NO', String(seqNo));
            }
            intent.putExtra('STR_MSG_FROM_ID', 'auto');
            intent.setFlags(0x14000000);

            ctx.startActivity(intent);
            send({type: 'log', msg: 'Navigated to Comic ' + comicId + ' Chapter ' + chapterId});
        });
    }
};

Java.perform(function() {
    var Cipher = Java.use('javax.crypto.Cipher');

    function toJSByteArray(jbytes) {
        if (!jbytes) return null;
        try {
            return Java.array('byte', jbytes);
        } catch (e) {
            return null;
        }
    }

    function checkGzipAndEmit(rawBytes, source) {
        if (!rawBytes || rawBytes.length < 2) return;
        var arr = toJSByteArray(rawBytes);
        if (!arr || arr.length < 2) return;
        if ((arr[0] & 0xff) === 0x1f && (arr[1] & 0xff) === 0x8b) {
            var buf = new ArrayBuffer(arr.length);
            var u8 = new Uint8Array(buf);
            for (var i = 0; i < arr.length; i++) {
                u8[i] = arr[i] & 0xff;
            }
            send({type: 'plain_gzip', source: source, len: arr.length}, buf);
        }
    }

    Cipher.doFinal.overloads.forEach(function(ov) {
        ov.implementation = function() {
            var res = ov.call(this, ...arguments);
            try {
                if (res !== null) checkGzipAndEmit(res, 'doFinal_out');
                for (var i = 0; i < arguments.length; i++) {
                    var a = arguments[i];
                    if (a !== null && a.getClass && a.getClass().getName() === '[B') {
                        checkGzipAndEmit(a, 'doFinal_in');
                    }
                }
            } catch(e) {}
            return res;
        };
    });

    Cipher.update.overloads.forEach(function(ov) {
        ov.implementation = function() {
            var res = ov.call(this, ...arguments);
            try {
                if (res !== null) checkGzipAndEmit(res, 'update_out');
                for (var i = 0; i < arguments.length; i++) {
                    var a = arguments[i];
                    if (a !== null && a.getClass && a.getClass().getName() === '[B') {
                        checkGzipAndEmit(a, 'update_in');
                    }
                }
            } catch(e) {}
            return res;
        };
    });

    Java.enumerateLoadedClassesSync().forEach(function(cn) {
        if (cn.indexOf('okhttp3.internal.http2.') !== 0) return;
        var C;
        try { C = Java.use(cn); } catch(e) { return; }
        var methods;
        try { methods = C.class.getDeclaredMethods(); } catch(e) { return; }
        for (var i = 0; i < methods.length; i++) {
            var mName = methods[i].getName();
            if (/toString|hashCode|equals/.test(mName)) continue;
            var holder = C[mName];
            if (!holder || !holder.overloads) continue;
            holder.overloads.forEach(function(ov) {
                var types = ov.argumentTypes.map(function(t) { return t.className; });
                if (types.indexOf('java.util.List') < 0) return;
                ov.implementation = function() {
                    for (var a = 0; a < arguments.length; a++) {
                        if (types[a] === 'java.util.List' && arguments[a] !== null) {
                            try {
                                var list = arguments[a];
                                var sz = list.size();
                                var path = null;
                                var auth = null;
                                for (var k = 0; k < sz; k++) {
                                    var s = String(list.get(k));
                                    if (s.indexOf(':path: ') === 0) path = s.slice(7);
                                    else if (s.indexOf(':authority: ') === 0) auth = s.slice(12);
                                }
                                if (path) {
                                    if (auth === 'manhua.acimg.cn' || path.indexOf('/manhua_detail/') === 0) {
                                        send({type: 'image_url', url: 'https://manhua.acimg.cn' + path});
                                    } else {
                                        send({type: 'api_path', path: path});
                                    }
                                }
                            } catch(e) {}
                        }
                    }
                    return ov.call(this, ...arguments);
                };
            });
        }
    });

    send({type: 'log', msg: 'Cipher & OkHttp2 hooks attached'});
});
"""

captured_images = []

def clean_url(u):
    return u.replace(r"\/", "/").split("?tp=")[0]

def on_message(message, data):
    global captured_images
    payload = message.get("payload", {})
    mtype = payload.get("type")
    if mtype == "log":
        print(f"[Frida Log] {payload.get('msg')}")
    elif mtype == "api_path":
        print(f"[API Route] {payload.get('path')}")
    elif mtype == "image_url":
        u = clean_url(payload.get("url"))
        if u and u not in captured_images:
            captured_images.append(u)
            print(f"[HTTP/2 Image #{len(captured_images)}] {u}")
    elif mtype == "plain_gzip":
        if data:
            try:
                dec = gzip.decompress(data)
                text = dec.decode("utf-8")
                j = json.loads(text)
                print(f"[GZIP JSON Decrypted] Len={len(data)} -> {len(dec)} bytes. Keys: {list(j.keys())}")
                def walk(item):
                    if isinstance(item, dict):
                        if "picture" in item and isinstance(item["picture"], list):
                            for pic in item["picture"]:
                                raw = pic.get("url") if isinstance(pic, dict) else str(pic)
                                if raw:
                                    cln = clean_url(raw)
                                    if cln not in captured_images:
                                        captured_images.append(cln)
                        for v in item.values(): walk(v)
                    elif isinstance(item, list):
                        for el in item: walk(el)
                walk(j)
                if captured_images:
                    print(f"🎉 Total URLs extracted from JSON: {len(captured_images)}")
            except Exception:
                pass

script = session.create_script(js_code)
script.on("message", on_message)
script.load()

time.sleep(1)
print("Navigating to comic 657583, chapter 139650...")
script.exports_sync.nav("657583", "139650", "2")

print("Listening for 10 seconds...")
for _ in range(10):
    if len(captured_images) >= 5:
        break
    time.sleep(1)

print(f"Finished test. Captured {len(captured_images)} images.")
script.unload()
session.detach()

/*
 * frida_h2_headers.js
 * ------------------------------------------------------------------
 * Decodes HTTP/2 request headers WITHOUT touching TLS or HPACK itself.
 *
 * OkHttp's HPACK layer keeps headers as plain Java objects (List<Header>)
 * *before* they get Huffman-encoded into binary frames, so hooking any
 * method in okhttp3.internal.http2.* that takes a java.util.List gives us
 * the real `:method`, `:path`, `:authority`, `cookie`, ... values.
 *
 * Obuscated names seen in com.qq.ac.android 12.12.8:
 *   okhttp3.internal.http2.a$b.g(java.util.List)     -> Hpack.Writer.writeHeaders
 *   okhttp3.internal.http2.b.U(int, java.util.List, boolean) -> Http2Stream.writeHeaders
 *
 * Usage:
 *   python tools/frida_tencent_http_dump.py --no-spawn --script tools/frida_h2_headers.js
 */
'use strict';

var MAX_ITEMS = 40;
var hookedCount = 0;

function emit(kind, data) {
  try { send({ kind: kind, ts: Date.now(), data: data }); } catch (e) { }
}

function listToText(list) {
  var out = [];
  try {
    var n = list.size();
    for (var i = 0; i < n && i < MAX_ITEMS; i++) {
      out.push(String(list.get(i)));
    }
  } catch (e) {
    return null;
  }
  return out;
}

Java.perform(function () {
  emit('info', 'scanning okhttp3.internal.http2.* for List arguments');
  var seen = {};
  var passes = 0;

  function scanOnce() {
    passes++;
    var found = 0;
    Java.enumerateLoadedClassesSync().forEach(function (cn) {
      if (cn.indexOf('okhttp3.internal.http2.') !== 0) { return; }
      if (seen[cn]) { return; }
      seen[cn] = true;

      var C;
      try { C = Java.use(cn); } catch (e) { return; }
      var methods;
      try { methods = C.class.getDeclaredMethods(); } catch (e) { return; }

      for (var i = 0; i < methods.length; i++) {
        var name = methods[i].getName();
        var holder;
        try { holder = C[name]; } catch (e) { continue; }
        if (!holder || !holder.overloads) { continue; }
        if (/toString|hashCode|equals/.test(name)) { continue; }

        for (var k = 0; k < holder.overloads.length; k++) {
          (function (ov, cls, mName) {
            var types = ov.argumentTypes.map(function (t) { return t.className; });
            if (types.indexOf('java.util.List') < 0) { return; }
            ov.implementation = function () {
              for (var a = 0; a < arguments.length; a++) {
                if (types[a] === 'java.util.List') {
                  var items = listToText(arguments[a]);
                  if (items && items.length) {
                    emit('h2_headers', { where: cls + '#' + mName, headers: items });
                  }
                }
              }
              return ov.call(this, ...arguments);
            };
            hookedCount++;
          })(holder.overloads[k], cn, name);
          found++;
        }
      }
    });

    if (found) { emit('info', 'hooked +' + found + ' (total ' + hookedCount + ', pass ' + passes + ')'); }
    if (passes >= 40) { clearInterval(timer); emit('info', 'scan finished, total hooks: ' + hookedCount); }
  }

  scanOnce();
  var timer = setInterval(scanOnce, 2000);
});

setInterval(function () { emit('heartbeat', { hooked: hookedCount }); }, 30000);

setInterval(function () { emit('heartbeat', { hooked: hookedCount }); }, 30000);

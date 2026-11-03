/*
 * frida_plaintext_dump.js
 * ------------------------------------------------------------------
 * Plan A (Developer Instrumentation) for Tencent Comic (com.qq.ac.android).
 *
 * Captures chapter image URLs and plaintext data through two complementary paths:
 *   1. javax.crypto.Cipher.doFinal / update:
 *      Intercepts decrypted GZIP streams (magic bytes 0x1f, 0x8b), sends
 *      the raw binary stream to Python via send(msg, data) for decompression
 *      and JSON parsing.
 *
 *   2. okhttp3.internal.http2.*:
 *      Intercepts HTTP/2 request headers to:
 *      a) Track API routes (:path) for endpoint correlation (e.g. Chapter/preview).
 *      b) Directly intercept comic image requests (manhua.acimg.cn/manhua_detail/...).
 */
'use strict';

var MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
var DEDUPE_HISTORY_SIZE = 256;
var seenHashes = [];
var lastEndpoints = [];

function emit(kind, obj, buf) {
  var msg = { kind: kind, ts: Date.now() };
  if (obj) {
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        msg[k] = obj[k];
      }
    }
  }
  try {
    if (buf) {
      send(msg, buf);
    } else {
      send(msg);
    }
  } catch (e) {}
}

function toJSByteArray(jbytes) {
  if (!jbytes) return null;
  try {
    return Java.array('byte', jbytes);
  } catch (e) {
    if (jbytes.length !== undefined) return jbytes;
    return null;
  }
}

function hexSnippet(arr, max) {
  if (!arr) return '';
  var n = Math.min(arr.length, max || 32);
  var out = '';
  for (var i = 0; i < n; i++) {
    var b = (arr[i] + 256) % 256;
    out += ('0' + b.toString(16)).slice(-2);
  }
  return out;
}

function isGzip(arr) {
  if (!arr || arr.length < 2) return false;
  return ((arr[0] & 0xff) === 0x1f) && ((arr[1] & 0xff) === 0x8b);
}

function toArrayBuffer(arr) {
  var buf = new ArrayBuffer(arr.length);
  var u8 = new Uint8Array(buf);
  for (var i = 0; i < arr.length; i++) {
    u8[i] = arr[i] & 0xff;
  }
  return buf;
}

function simpleHash(arr) {
  var h = 0x811c9dc5;
  var step = Math.max(1, Math.floor(arr.length / 64));
  for (var i = 0; i < arr.length; i += step) {
    h ^= (arr[i] & 0xff);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + '_' + arr.length;
}

function recordEndpoint(authority, path) {
  if (!path) return;
  lastEndpoints.push({
    ts: Date.now(),
    authority: authority || '',
    path: path
  });
  while (lastEndpoints.length > 30) {
    lastEndpoints.shift();
  }
}

function getRecentEndpoint() {
  var now = Date.now();
  for (var i = lastEndpoints.length - 1; i >= 0; i--) {
    var ep = lastEndpoints[i];
    if (now - ep.ts < 20000) {
      return ep;
    }
  }
  return null;
}

Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');
  var lastKeyHex = '';
  var lastIvHex = '';

  function inspectKeyIv(arg) {
    if (!arg) return;
    try {
      var enc = arg.getEncoded();
      if (enc !== null) {
        lastKeyHex = hexSnippet(toJSByteArray(enc), 32);
        return;
      }
    } catch (e) {}
    try {
      var iv = arg.getIV();
      if (iv !== null) {
        lastIvHex = hexSnippet(toJSByteArray(iv), 32);
      }
    } catch (e) {}
  }

  // 1. Hook Cipher.init
  Cipher.init.overloads.forEach(function (ov) {
    ov.implementation = function () {
      try {
        for (var i = 0; i < arguments.length; i++) {
          inspectKeyIv(arguments[i]);
        }
      } catch (e) {}
      return ov.call(this, ...arguments);
    };
  });

  // 2. Hook Cipher.doFinal & update
  function processBuffer(direction, rawJBytes, cipherObj) {
    if (!rawJBytes) return;
    var arr = toJSByteArray(rawJBytes);
    if (!arr || arr.length < 2) return;
    if (!isGzip(arr)) return;
    if (arr.length > MAX_PAYLOAD_BYTES) return;

    var h = simpleHash(arr);
    if (seenHashes.indexOf(h) >= 0) return;
    seenHashes.push(h);
    while (seenHashes.length > DEDUPE_HISTORY_SIZE) {
      seenHashes.shift();
    }

    var ep = getRecentEndpoint();
    var buf = toArrayBuffer(arr);
    var algo = '';
    try { algo = String(cipherObj.getAlgorithm()); } catch (e) {}

    emit('plain_gzip', {
      dir: direction,
      len: arr.length,
      algo: algo,
      key: lastKeyHex,
      iv: lastIvHex,
      head: hexSnippet(arr, 32),
      endpoint: ep ? ep.path : null,
      authority: ep ? ep.authority : null
    }, buf);
  }

  Cipher.doFinal.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  Cipher.update.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var res = ov.call(this, ...arguments);
      try {
        if (res !== null) processBuffer('out', res, this);
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a !== null && a.getClass && a.getClass().getName() === '[B') {
            processBuffer('in', a, this);
          }
        }
      } catch (e) {}
      return res;
    };
  });

  emit('info', { msg: 'Cipher doFinal/update gzip hooks active' });

  // 3. Hook okhttp3 HTTP/2 headers
  var scannedClasses = {};
  var scanPasses = 0;

  function scanHttp2() {
    scanPasses++;
    Java.enumerateLoadedClassesSync().forEach(function (cn) {
      if (cn.indexOf('okhttp3.internal.http2.') !== 0) return;
      if (scannedClasses[cn]) return;
      scannedClasses[cn] = true;

      var C;
      try { C = Java.use(cn); } catch (e) { return; }
      var methods;
      try { methods = C.class.getDeclaredMethods(); } catch (e) { return; }

      for (var i = 0; i < methods.length; i++) {
        var mName = methods[i].getName();
        if (/toString|hashCode|equals/.test(mName)) continue;
        var holder = C[mName];
        if (!holder || !holder.overloads) continue;

        holder.overloads.forEach(function (ov) {
          var types = ov.argumentTypes.map(function (t) { return t.className; });
          if (types.indexOf('java.util.List') < 0) return;

          ov.implementation = function () {
            for (var a = 0; a < arguments.length; a++) {
              if (types[a] === 'java.util.List' && arguments[a] !== null) {
                try {
                  var list = arguments[a];
                  var sz = list.size();
                  var path = null;
                  var auth = null;
                  var method = 'GET';
                  for (var k = 0; k < sz; k++) {
                    var s = String(list.get(k));
                    if (s.indexOf(':path: ') === 0) path = s.slice(7);
                    else if (s.indexOf(':authority: ') === 0) auth = s.slice(12);
                    else if (s.indexOf(':method: ') === 0) method = s.slice(9);
                  }
                  if (path) {
                    if (auth === 'manhua.acimg.cn' || path.indexOf('/manhua_detail/') === 0) {
                      var imgUrl = 'https://manhua.acimg.cn' + path;
                      emit('image_url', { url: imgUrl, path: path });
                    } else {
                      recordEndpoint(auth, path);
                      emit('h2_path', { method: method, path: path, authority: auth });
                    }
                  }
                } catch (e) {}
              }
            }
            return ov.call(this, ...arguments);
          };
        });
      }
    });
    if (scanPasses >= 30) {
      clearInterval(scanTimer);
    }
  }

  scanHttp2();
  var scanTimer = setInterval(scanHttp2, 2000);
});

setInterval(function () {
  emit('heartbeat', { ts: Date.now() });
}, 30000);

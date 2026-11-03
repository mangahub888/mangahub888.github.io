/*
 * frida_crypto_capture.js
 * ------------------------------------------------------------------
 * Captures FULL input/output of javax.crypto.Cipher.doFinal so both the
 * request-body decryption AND the response decryption can be reproduced
 * offline.  Streams to Frida messages: {kind:'cipher', id, dir, algo, key, iv, in, out}
 *
 * Run with tools/frida_tencent_http_dump.py:
 *   python tools/frida_tencent_http_dump.py --no-spawn \
 *       --script tools/frida_crypto_capture.js --out scratch/crypto_capture.jsonl
 *
 * Tip: open the app, choose a comic, open one chapter. The chapter API call
 * (Chapter/preview) will show up as a decrypt record whose output starts 1f8b
 * (gzip) and gunzips into {"data": {... picture:[...] ...}}.
 */
'use strict';

var counter = 0;
var MAX_CAPTURE = 256 * 1024; // safety: skip enormous blobs

function hexStr(jbytes) {
  var out = '';
  for (var i = 0; i < jbytes.length; i++) {
    out += ('0' + ((jbytes[i] + 256) % 256).toString(16)).slice(-2);
  }
  return out;
}

function emit(obj) {
  try { send({ kind: 'cipher', ts: Date.now(), data: obj }); } catch (e) {}
}

function bytesOf(a) {
  try {
    if (a === null || a === undefined) return null;
    var cls = a.getClass ? a.getClass().getName() : '';
    if (cls === '[B') return Java.array('byte', a);
  } catch (e) { }
  return null;
}

Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');
  var lastKey = null;
  var lastIv = null;

  function grabSpec(a) {
    if (a === null) { return; }
    try {
      var enc = a.getEncoded();
      if (enc !== null) { lastKey = hexStr(Java.array('byte', enc)); return; }
    } catch (e) { }
    try {
      var iv = a.getIV();
      if (iv !== null) { lastIv = hexStr(Java.array('byte', iv)); }
    } catch (e2) { }
  }

  Cipher.init.overloads.forEach(function (ov) {
    ov.implementation = function () {
      lastKey = null;
      lastIv = null;
      try {
        for (var i = 0; i < arguments.length; i++) { grabSpec(arguments[i]); }
        emit({ phase: 'init', algo: String(this.getAlgorithm()), key: lastKey, iv: lastIv });
      } catch (e) { }
      return ov.call(this, ...arguments);
    };
  });

  Cipher.doFinal.overloads.forEach(function (ov) {
    var types = ov.argumentTypes.map(function (t) { return t.className; });
    if (types.indexOf('[B') < 0) { return; }
    ov.implementation = function () {
      var result = ov.call(this, ...arguments);
      try {
        var input = bytesOf(arguments[0]);
        var out = bytesOf(result);
        var id = ++counter;
        if (input && input.length < MAX_CAPTURE) {
          emit({
            id: id,
            dir: 'encrypt-or-decrypt',
            algo: String(this.getAlgorithm()),
            key: lastKey,
            iv: lastIv,
            inLen: input.length,
            in: hexStr(input),
            outLen: out ? out.length : 0,
            out: out ? hexStr(out) : ''
          });
        }
      } catch (e) { }
      return result;
    };
  });

  emit({ phase: 'ready', note: 'full Cipher.doFinal capture installed' });
});

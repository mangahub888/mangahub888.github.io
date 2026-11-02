/*
 * frida_tencent_http_dump.js
 * ------------------------------------------------------------------
 * Dumps Tencent Comic (com.qq.ac.android) HTTP traffic at the Java
 * application layer, so NO TLS interception / NO CA install / NO
 * SSL-pinning bypass is required.
 *
 * Hooks:
 *   1. okhttp3.OkHttpClient.newCall        -> URL, method, headers
 *   2. okhttp3.internal.http.CallServerInterceptor.intercept
 *                                          -> status, content-type, body preview
 *   3. okhttp3.CertificatePinner.check      -> which hosts are pinned (intel only, no bypass)
 *   4. java.net.URL.openConnection          -> legacy HttpURLConnection paths
 *   5. SSL_write (native, best effort)      -> Flutter/Dart traffic if exported
 *
 * Usage:
 *   frida -U -f com.qq.ac.android -l tools/frida_tencent_http_dump.js --no-pause
 *   (recommended) python tools/frida_tencent_http_dump.py --server tools\frida-server
 */
'use strict';

var MAX_BODY = 64 * 1024;
var stats = { request: 0, response: 0, url: 0, error: 0 };

function emit(kind, data) {
  var msg = { kind: kind, ts: Date.now() };
  if (data) {
    for (var k in data) {
      try { msg[k] = data[k]; } catch (e) { /* ignore */ }
    }
  }
  if (stats[kind] !== undefined) { stats[kind]++; }
  try { send(msg); } catch (e) { /* channel closed */ }
}

function fail(where, e) {
  emit('error', { where: where, error: String(e && e.message ? e.message : e) });
}

function headersToText(headers) {
  if (!headers) { return ''; }
  var out = [];
  try {
    var n = headers.size();
    for (var i = 0; i < n; i++) {
      out.push(headers.name(i) + ': ' + headers.value(i));
    }
  } catch (e) {
    return '[headers unavailable]';
  }
  return out.join('\n');
}

function bytesRaw(ptr, len) {
  try {
    var buf = Memory.readByteArray(ptr, Math.min(len, 64));
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i++) { out += String.fromCharCode(bytes[i]); }
    return out;
  } catch (e) {
    return '';
  }
}

/** true when >=90% of the raw bytes are printable ASCII (text/JSON, not gzip/image) */
function looksLikeText(ptr, len) {
  try {
    var buf = Memory.readByteArray(ptr, len > 4096 ? 4096 : len);
    var bytes = new Uint8Array(buf);
    var ok = 0;
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) { ok++; }
    }
    return bytes.length > 0 && (ok / bytes.length) >= 0.9;
  } catch (e) {
    return false;
  }
}

function bytesToText(ptr, len) {

  try {
    var buf = Memory.readByteArray(ptr, Math.min(len, 4096));
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      out += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
    }
    return out;
  } catch (e) {
    return null;
  }
}

Java.perform(function () {
  emit('info', { msg: 'tencent-http-dump loaded', pid: Process.id });

  /* ---------------- 1. OkHttp request ---------------- */
  try {
    var OkHttpClient = Java.use('okhttp3.OkHttpClient');
    var newCall = OkHttpClient.newCall.overload('okhttp3.Request');
    newCall.implementation = function (req) {
      try {
        emit('request', {
          method: req.method(),
          url: String(req.url().toString()),
          headers: headersToText(req.headers())
        });
      } catch (e) { fail('okhttp.request', e); }
      return newCall.call(this, req);
    };
    emit('info', { msg: 'hooked okhttp3.OkHttpClient.newCall' });
  } catch (e) { fail('hook.okhttp.newCall', e); }

  /* ---------------- 2. OkHttp response (non-destructive peek) ---------------- */
  try {
    var CallServer = Java.use('okhttp3.internal.http.CallServerInterceptor');
    var intercept = CallServer.intercept.overload('okhttp3.Interceptor$Chain');
    intercept.implementation = function (chain) {
      var resp = intercept.call(this, chain);
      try {
        var req = chain.request();
        var ct = '';
        var code = 0;
        try { ct = String(resp.header('Content-Type') || ''); } catch (e2) { }
        try { code = resp.code(); } catch (e3) { }
        var body = null;
        if (/json|text|xml|javascript|x-www-form-urlencoded/i.test(ct)) {
          try {
            var rb = resp.body();
            if (rb !== null) { body = String(rb.peekBody(MAX_BODY).string()); }
          } catch (e4) { fail('okhttp.peekBody', e4); }
        }
        emit('response', {
          url: String(req.url().toString()),
          code: code,
          contentType: ct,
          bodyPreview: body
        });
      } catch (e) { fail('okhttp.response', e); }
      return resp;
    };
    emit('info', { msg: 'hooked CallServerInterceptor.intercept' });
  } catch (e) { fail('hook.okhttp.intercept', e); }

  /* ---------------- 3. Pinning intel (log only, no bypass) ---------------- */
  try {
    var Pinner = Java.use('okhttp3.CertificatePinner');
    var pinCheck = Pinner.check.overload('java.lang.String', 'java.util.List');
    pinCheck.implementation = function (host, pins) {
      try {
        var list = [];
        for (var i = 0; i < pins.size(); i++) { list.push(String(pins.get(i).toString())); }
        emit('pinned_host', { host: String(host), pins: list.join(' | ') });
      } catch (e) { fail('pinner.check', e); }
      return pinCheck.call(this, host, pins);
    };
    emit('info', { msg: 'hooked CertificatePinner.check' });
  } catch (e) { fail('hook.pinner.check', e); }

  /* ---------------- 4. Legacy URLConnection paths ---------------- */
  try {
    var URL = Java.use('java.net.URL');
    var openConn = URL.openConnection.overload();
    openConn.implementation = function () {
      try { emit('urlconnection', { url: String(this.toString()) }); } catch (e) { }
      return openConn.call(this);
    };
    emit('info', { msg: 'hooked java.net.URL.openConnection' });
  } catch (e) { fail('hook.url.openConnection', e); }

  /* ---------------- 5. Best-effort native TLS (Flutter/Dart) ---------------- */
  try {
    var libs = ['libflutter.so', 'libttssl.so', 'libssl.so', 'libmonochrome.so'];
    var hooked = 0;
    for (var c = 0; c < libs.length; c++) {
      var sym = Module.findExportByName(libs[c], 'SSL_write');
      if (sym === null) { continue; }
      (function (addr, name) {
        Interceptor.attach(addr, {
          onEnter: function (args) {
            try {
              var len = args[2].toInt32();
              if (len > 0 && len <= 65536) {
                emit('native_ssl_write', { lib: name, preview: bytesToText(args[1], len) });
              }
            } catch (e) { }
          }
        });

        // SSL_read = plaintext coming back from the server (JSON bodies, image bytes).
        var readSym = Module.findExportByName(name, 'SSL_read');
        if (readSym !== null) {
          Interceptor.attach(readSym, {
            onEnter: function (args) { this.buf = args[1]; },
            onLeave: function (retval) {
              try {
                var n = retval.toInt32();
                if (n <= 0 || n > 65536) { return; }
                if (!looksLikeText(this.buf, n)) { return; }
                var text = bytesToText(this.buf, n);
                if (text === null) { return; }
                emit('native_ssl_read', { lib: name, preview: text });
              } catch (e) { }
            }
          });
        }
      })(sym, libs[c]);
      hooked++;
      emit('info', { msg: 'native SSL_write hook active', lib: libs[c] });
    }
    if (hooked === 0) {
      emit('info', {
        msg: 'no exported SSL_write found - Flutter/Dart traffic will not appear here, use M2/M4'
      });
    }
  } catch (e) { fail('hook.native.ssl_write', e); }
  /* ---------------- 7. Glide image URLs (retry: class loads lazily) ---------------- */
  (function hookGlide() {
    var attempts = 0;
    function attempt() {
      attempts++;
      try {
        var RB = Java.use('com.bumptech.glide.RequestBuilder');
        var loadStr = RB.load.overload('java.lang.String');
        loadStr.implementation = function (url) {
          try { emit('glide_url', { url: String(url) }); } catch (e) { }
          return loadStr.call(this, url);
        };
        emit('info', { msg: 'hooked Glide RequestBuilder.load(String) after ' + attempts + ' try(s)' });
      } catch (e) {
        if (attempts < 40) { setTimeout(attempt, 1000); }
        else { fail('hook.glide.load', e); }
      }
    }
    attempt();
  })();

  /* ---------------- 6. Plaintext HTTP over libc sockets (CDN images, non-TLS) ---------------- */
  try {
    var sendAddr = Module.findExportByName(null, 'send');
    var recvAddr = Module.findExportByName(null, 'recv');
    if (sendAddr !== null) {
      Interceptor.attach(sendAddr, {
        onEnter: function (args) {
          try {
            var len = args[2].toInt32();
            if (len > 16 && len <= 16384) {
              var head = bytesRaw(args[1], 16);
              if (/^(GET|POST|PUT|HEAD|CONNECT|DELETE) |^HTTP\/1\./.test(head)) {
                emit('socket_send', { preview: bytesToText(args[1], len) });
              }
            }
          } catch (e) { }
        }
      });
      emit('info', { msg: 'hooked libc send (plaintext HTTP)' });
    }
    if (recvAddr !== null) {
      Interceptor.attach(recvAddr, {
        onEnter: function (args) { this.buf = args[1]; },
        onLeave: function (retval) {
          try {
            var n = retval.toInt32();
            if (n <= 16 || n > 16384) { return; }
            var head = bytesRaw(this.buf, 16);
            if (/^HTTP\/1\./.test(head)) {
              emit('socket_recv', { preview: bytesToText(this.buf, n) });
            }
          } catch (e) { }
        }
      });
      emit('info', { msg: 'hooked libc recv (plaintext HTTP)' });
    }
  } catch (e) { fail('hook.libc.socket', e); }
});

/* ---------------- heartbeat ---------------- */
setInterval(function () {
  emit('heartbeat', {
    request: stats.request,
    response: stats.response,
    url: stats.url,
    error: stats.error
  });
}, 30000);


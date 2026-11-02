/*
 * frida_crypto_dump.js
 * ------------------------------------------------------------------
 * Logs every javax.crypto.Cipher usage (algorithm, key, IV, input/output)
 * so we can identify how a.ac.qq.com encrypts its API responses and then
 * decrypt captured bodies offline.
 */
'use strict';

function hex(bytes, max) {
  var out = '';
  var n = Math.min(bytes.length, max || 32);
  for (var i = 0; i < n; i++) {
    var b = (bytes[i] + 256) % 256;
    out += ('0' + b.toString(16)).slice(-2);
  }
  return out + (bytes.length > n ? '...' : '');
}

function emit(kind, data) {
  try { send({ kind: kind, ts: Date.now(), data: data }); } catch (e) { }
}

Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');

  Cipher.init.overloads.forEach(function (ov) {
    ov.implementation = function () {
      try {
        var info = { algorithm: String(this.getAlgorithm()), args: ov.argumentTypes.map(function (t) { return t.className; }) };
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a === null) { continue; }
          try {
            if (a.getClass().getName() === '[B') { info['arg' + i] = hex(Java.array('byte', a), 32); }
            else if (a.getClass().getName() === 'javax.crypto.spec.SecretKeySpec') {
              info['arg' + i + '_key'] = hex(Java.array('byte', a.getEncoded()), 32);
            } else if (a.getClass().getName() === 'javax.crypto.spec.IvParameterSpec') {
              info['arg' + i + '_iv'] = hex(Java.array('byte', a.getIV()), 32);
            } else { info['arg' + i] = String(a); }
          } catch (e) { }

          // java.security.Key / AlgorithmParameterSpec arrive as interfaces, not the
          // concrete SecretKeySpec / IvParameterSpec classes - probe the methods.
          try {
            var enc = a.getEncoded();
            if (enc !== null) { info['arg' + i + '_key'] = hex(Java.array('byte', enc), 40); }
          } catch (e2) { }
          try {
            var iv = a.getIV();
            if (iv !== null) { info['arg' + i + '_iv'] = hex(Java.array('byte', iv), 40); }
          } catch (e3) { }
        }
        emit('cipher_init', info);
      } catch (e) { }
      return ov.call(this, ...arguments);
    };
  });

  ['doFinal', 'update'].forEach(function (mName) {
    var holder = Cipher[mName];
    if (!holder || !holder.overloads) { return; }
    holder.overloads.forEach(function (ov) {
      var types = ov.argumentTypes.map(function (t) { return t.className; });
      if (types.indexOf('[B') < 0) { return; }
      ov.implementation = function () {
        var result = ov.call(this, ...arguments);
        try {
          for (var i = 0; i < arguments.length; i++) {
            if (types[i] === '[B' && arguments[i] !== null) {
              var input = Java.array('byte', arguments[i]);
              emit('cipher_' + mName, {
                algorithm: String(this.getAlgorithm()),
                inLen: arguments[i].length,
                inHead: hex(Java.array('byte', arguments[i]), 48),
                outLen: result ? result.length : 0,
                outHead: result ? hex(Java.array('byte', result), 220) : ''
              });
            }
          }
        } catch (e) { }
        return result;
      };
    });
  });

  emit('info', 'javax.crypto.Cipher hooks installed');
});

setInterval(function () { emit('heartbeat', {}); }, 30000);

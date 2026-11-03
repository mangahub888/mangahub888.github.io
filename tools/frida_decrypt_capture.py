#!/usr/bin/env python3
"""Decrypt Tencent Comic cipher captures captured by frida_crypto_capture.js.

Usage:
    python tools/frida_decrypt_capture.py scratch/crypto_capture.jsonl

Each capture record looks like:
    {"id": 3, "dir": "decrypt", "algo": "AES/CBC/PKCS5Padding", "in": "<hex>", "out": "<hex>"}

Output: for every record, tries to interpret the plaintext as gzip / text / json
and prints a preview so we can find the chapter endpoint payload.
"""
import base64
import gzip
import json
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def aes_cbc_decrypt(key: bytes, data: bytes) -> bytes:
    if not data:
        return b""
    iv, body = data[:16], data[16:]
    if len(body) % 16:
        body = body[: len(data) - 16 - (len(data) - 16) % 16]
    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return d.update(body) + d.finalize()


def describe(raw: bytes) -> str:
    if not raw:
        return "<empty>"
    head = raw[:2]
    if head == b"\x1f\x8b":
        try:
            plain = base64.b64decode(raw, validate=False)
        except Exception:
            plain = None
        try:
            out = gzip.decompress(raw)
            return f"GZIP -> {out[:300]!r}"
        except Exception:
            pass
    try:
        txt = raw.decode("utf-8")
        return f"TEXT -> {txt[:300]}"
    except UnicodeDecodeError:
        return f"BIN({len(raw)}) -> {raw[:48].hex()}"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "scratch/crypto_capture.jsonl"
    key = bytes.fromhex(sys.argv[2]) if len(sys.argv) > 2 else b"162d0c0fb24c73b6"

    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue

        direction = rec.get("dir")
        blob = bytes.fromhex(rec.get("in", ""))
        raw_out = bytes.fromhex(rec.get("out", "")) if rec.get("out") else b""

        print(f"--- id={rec.get('id')} dir={direction} in={len(blob)}B out={len(raw_out)}B")
        if direction == "decrypt":
            print("  frida out:", describe(raw_out))
        elif raw_out:
            # plaintext before encryption (payload being sent)
            print("  plain:", describe(raw_out))


if __name__ == "__main__":
    main()

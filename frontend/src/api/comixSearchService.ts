/**
 * Comix.to Pure Web Standards Signature & API Client
 * Works directly in modern browsers (Chrome/Firefox/Edge/Safari) using Web Crypto & DataView
 * Also falls back gracefully to GAS Backend action `SEARCH_COMIX`.
 */

import { callGasApi } from "@/api/gasClient"

const ZJ_HEX =
  "8e7100ce9b1ee4bf7a26896e927e96a40c90dd2d3ea96c37ba06c01567ef0151929b05adde0e7ddc9867386f4938db60e961a1e5e7d7faf23ddceac0006db85517fe42dbe62d46d4fe9c18d62ba24d023f74d392eaa53fceca95e3f198f3e1138250d5c32ada5b1bd0bea9f59f04d623e71f19c2089ddf0a7f7605344a1d60c9a577ca1ff84cd25c19f009df61fed2e846a891ec46c660e53c729eda5ad7df9f929b5fa11523b3199f3763eab5b88a94ee61d176837e009127a84640d628ca82054ddcc29f909c30523e9561d7c085745b5798c2101f85202ca3015f975ccb6041880c42bcaff87f8c90999422eef02c28035113a40ed3b4a2f9e375f1bc00d40fb26ef6c1fd6b2819d34ffaed89d4480fd88782d5e3d3d1510c9d812304e9cbd663f1fc5fae597efa35f10de824f81de1cab4601e56c03c39c8d2d6caedeb5259095e7077a72e00dd9f20bcf31826eccc03b978947b6c6cfc6b2287b9b3672e4d17a15e7e300b12829f1723f1d1f23600f65f85adad2262ecac026c1eff9385e40080a4e6054251f8f8c211b959632912bc0b3118f348da9b9c94b8979685b36b0086fabf29aab82c990c51d93ea2d027f656a92474dee87265a1d84315b84a2637882666855978628ee6f7bd7ffdb7bb3ae563bfcff53009d7164e654a1af09856f87996869250742adeaecda1d74158be8914297ed3e6e1881a4d3100c46af1801eaf88e108fc914e2adc40e4193852ca2336969ac49189677993a1074a5315c430a75de60ef88b5af6a1ad5320af7f6f53c331fe7a73c4cb8d3a2263bae5a8376aa76e3b2aebe7390b9c632de142d1054da3a14c0d948d2f8af53e2a2be13eedbb10bbcb5291642d9e97095ed54ff028e79b65d1671fbb018298bd1fac4cd71ef9162d8d58605187128f752c1af340bf207b7541a2a08460d114d2f138b71af14ec62a2f4f391ca6b63bba2024498913610fa5d47b327eb348b1671bb0cb1b6fc638f7022534d1cba54db7ca29f8cabdb1e69675fd5ce4cf9c48f3d41aab2b2047d6359159f2517fb1093ffa7622b7f8e2511d6c0531fcf5c0455274e6f927acbc18de8930d8ab2e7208632a507509bdf8a23e83e6a26113b388a84e6e30a14ae1016e69d3b2064738d7f9fc8773af0c9eb83e04ad58fd87ff4a214529244a2f0fe80ad3c2acb4d75f307c4e072df187e0171e82140924c0e4cedd91dde6426dbb210998ccb03a852e88ddf5c11b5fd3540638b29d08618db16dc1c56c5418afa271348a89da7244f8ab0004462d77e39eebf48f76ce799f0ff038af335c1ae45730449e3bc2f9b6b466fa394f967f267657c2a6541241644bc753e69db534f1bf7576fcfcdb910ae6002484291612553cb2a0f3e0fabe6bba4a034bfb6c9a8292122d506c5ce972c18a914fb78afb99a10db38d89950c518be6d67333779c7921abefd4a454c8e32a8ed04cc43b9f60da1f004ba29c2aeaf1f96a21accbbda90ac9c1df47ea0cb0d343e7f1838ba41783eeadaa45547eb9a2b27a1c9dce"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

const ZJ = hexToBytes(ZJ_HEX)
const zjView = new DataView(ZJ.buffer)

const SHA256_K = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
  3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
  2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
  666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
  2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
  430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
  1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
]

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

function sha256_continue(state_words: number[], msg_bytes: Uint8Array, prev_len = 64): Uint8Array {
  const P = Array.from(state_words)
  const total_len = prev_len + msg_bytes.length
  let pad_len = msg_bytes.length + 1
  while (pad_len % 64 !== 56) pad_len++

  const buf = new Uint8Array(pad_len + 8)
  buf.set(msg_bytes, 0)
  buf[msg_bytes.length] = 0x80

  const bufView = new DataView(buf.buffer)
  const highBits = Math.floor((total_len * 8) / 0x100000000)
  const lowBits = (total_len * 8) >>> 0
  bufView.setUint32(pad_len, highBits, false)
  bufView.setUint32(pad_len + 4, lowBits, false)

  for (let offset = 0; offset < buf.length; offset += 64) {
    const w = new Array(64).fill(0)
    for (let i = 0; i < 16; i++) {
      w[i] = bufView.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = P
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    P[0] = (P[0] + a) >>> 0
    P[1] = (P[1] + b) >>> 0
    P[2] = (P[2] + c) >>> 0
    P[3] = (P[3] + d) >>> 0
    P[4] = (P[4] + e) >>> 0
    P[5] = (P[5] + f) >>> 0
    P[6] = (P[6] + g) >>> 0
    P[7] = (P[7] + h) >>> 0
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, P[i], false)
  }
  return out
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/")
  while (b64.length % 4 !== 0) b64 += "="
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function signComixRequest(path_and_query: string): string {
  const inner_state: number[] = []
  const outer_state: number[] = []
  for (let i = 0; i < 8; i++) {
    inner_state.push(zjView.getUint32(i * 4, false))
    outer_state.push(zjView.getUint32(32 + i * 4, false))
  }
  const msg = new TextEncoder().encode(path_and_query)
  const inner_hash = sha256_continue(inner_state, msg, 64)
  const outer_hash = sha256_continue(outer_state, inner_hash, 64)
  const b64 = base64UrlEncode(outer_hash)
  return "27e." + b64.substring(0, 16)
}

function decryptComixResponse(e_str: string): any {
  const raw = base64UrlDecode(e_str)
  const offset = (((raw[0] << 8) | raw[1]) >>> 0) % 1024
  const key_1024 = ZJ.subarray(64, 1088)
  const rotated_key = new Uint8Array(1024)
  rotated_key.set(key_1024.subarray(offset), 0)
  rotated_key.set(key_1024.subarray(0, offset), 1024 - offset)

  const payload = new Uint8Array(raw.length - 2)
  for (let i = 0; i < payload.length; i++) {
    payload[i] = raw[i + 2] ^ rotated_key[i % 1024]
  }
  const jsonStr = new TextDecoder("utf-8").decode(payload)
  if (!jsonStr || !jsonStr.trim()) return null
  try {
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

export interface LiveComixItem {
  id: string
  title: string
  alt_titles?: string[]
  url: string
  cover?: string
  chapter_count?: number
  status?: string
  origin?: string
  score?: number
  genres?: string[]
}

function formatRawComixItem(item: any): LiveComixItem {
  const hid = item.hid || ""
  let url = item.url || ""
  if (url && !url.startsWith("http")) {
    url = "https://comix.to" + (url.startsWith("/") ? "" : "/") + url
  } else if (!url && hid) {
    url = `https://comix.to/title/${hid}`
  }

  let coverUrl = ""
  if (item.poster) {
    if (typeof item.poster === "string") {
      coverUrl = item.poster
    } else if (item.poster.medium) {
      coverUrl = item.poster.medium
    } else if (item.poster.large) {
      coverUrl = item.poster.large
    }
  }
  if (coverUrl && !coverUrl.startsWith("http")) {
    coverUrl = "https://comix.to" + (coverUrl.startsWith("/") ? "" : "/") + coverUrl
  }

  let origin = "Manga"
  const lang = String(item.originalLanguage || "").toLowerCase()
  if (lang === "ko" || lang === "kr") origin = "KR (Manhwa)"
  else if (lang === "ja" || lang === "jp") origin = "JP (Manga)"
  else if (lang === "zh" || lang === "cn") origin = "CN (Manhua)"

  return {
    id: hid || String(item.id || ""),
    title: item.title || "",
    alt_titles: Array.isArray(item.altTitles) ? item.altTitles : [],
    url: url,
    cover: coverUrl,
    chapter_count: item.latestChapter !== undefined ? Number(item.latestChapter) : undefined,
    status: item.status || "Releasing",
    origin: origin,
    score: item.ratedAvg || item.ratedScore || 0,
    genres: Array.isArray(item.genres)
      ? item.genres.map((g: any) => (typeof g === "string" ? g : g.name || ""))
      : [],
  }
}

/**
 * Searches Comix.to in real-time.
 * 1. Attempts direct client-side fetch with verified signing (Fastest, zero GAS quota).
 * 2. If client-side fetch encounters CORS or network error, falls back automatically to GAS backend SEARCH_COMIX.
 */
export async function searchComixLive(keyword: string, limit = 20): Promise<LiveComixItem[]> {
  const cleanKeyword = keyword.trim()
  if (!cleanKeyword) return []

  // Attempt 1: Direct client-side fetch
  try {
    const path = "/manga"
    const p: Record<string, string> = { keyword: cleanKeyword, limit: String(limit) }
    const sorted_keys = Object.keys(p).filter((k) => k !== "_").sort()
    const qs = sorted_keys.map((k) => `${k}=${p[k]}`).join("&")
    const canonical = `${path}?${qs}`
    p["_"] = signComixRequest(canonical)
    const full_qs = new URLSearchParams(p).toString()
    const url = `https://comix.to/api/v1${path}?${full_qs}`

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    })

    if (resp.ok) {
      const x_enc = resp.headers.get("x-enc")
      const rawText = await resp.text()
      if (!rawText || !rawText.trim()) return []
      let body: any
      try {
        body = JSON.parse(rawText)
      } catch {
        return []
      }
      let resultData: any = body
      if (x_enc === "2" && body && body.e) {
        const dec = decryptComixResponse(body.e)
        resultData = dec && dec.status === "ok" ? dec.result : dec
      } else if (body && body.status === "ok" && body.result !== undefined) {
        resultData = body.result
      }

      const items = (resultData && Array.isArray(resultData.items))
        ? resultData.items
        : Array.isArray(resultData)
        ? resultData
        : []

      if (items.length > 0) {
        return items.map(formatRawComixItem)
      }
    }
  } catch (clientErr) {
    console.warn("Direct Comix search failed or blocked by CORS, trying backend GAS...", clientErr)
  }

  // Attempt 2: Fallback to Backend GAS action SEARCH_COMIX
  try {
    const gasRes = await callGasApi<{ success: boolean; items: LiveComixItem[] }>("SEARCH_COMIX", {
      keyword: cleanKeyword,
      limit,
    })
    if (gasRes && Array.isArray(gasRes.items)) {
      return gasRes.items
    }
  } catch (backendErr) {
    console.error("Backend GAS searchComix failed:", backendErr)
  }

  return []
}

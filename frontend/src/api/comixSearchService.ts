/**
 * Comix.to Pure Web Standards Signature & API Client
 * Works directly in modern browsers (Chrome/Firefox/Edge/Safari) using Web Crypto & DataView
 * Also falls back gracefully to GAS Backend action `SEARCH_COMIX`.
 */

import { callGasApi } from "@/api/gasClient"

const ZJ_HEX =
  "fa856d9ed6e5a03a37f888c4dcd0cd0f1c8be6a6a072ac6bbd3ce5cbabef3f12fa94a0655d5e2ee4741c295e6727b7cff376650807a7c93168c2b6cc3dc4c83fc47474c907b8b741cfd2873070da62abba357d008183f28a1a42a4ec0ad663aad99653107642f6681404f8def22efb312dd6f6fb3eaa0e4403c721b23e6b0135306b08a089c4d5703950bb623d6cb99c42154aa4935e52851dd0d6f97cc5f1eade76172e28e3a8977812ece851790f93b9a9ea464c0368281205dcf2b17a86dc1d7f36d45b4cd6f96dfa881cf84a50c3ba204a52b34c2e506da83a407eed53b7c1327d16a98c6aa9f6cc6b4cc2e72db63450aed07996385e822366245f0eef2382cd572c5f84087d5d8376224de365dff8608515b968a8770d2df49a204a7db29c36ca3b8dee7f14871b2a9100c9681225179e04664d1c84541bec669b0e572eba27eb0bc992e99baf8a104aabdabad5416946f3325ab5e6539460f95202b37b861fc79f7acaf3eeef1c406565422add146eed7e60fc39065e0c70e311974de1445665a8f5462e3f0abe8d995c3cd08e8a90e69f48c30c4b87562513d8f57959e1a9ab68dfdabd037d09b1bcf4bcfabbf53132ba5c900bffc197e6338558da39a21158275b392a12c804f70ba789ee531e6439915ad0b109ccaf2754de5aa9a383992221c0e4be7dbb052e9d5f175a22c8ab712a740b18b93d41040f84335f50358477ebe561e98023004cc2d650dad1015a7cedb00d1aa03f55efb42d7bb18972110e9120890e35674fd98d07bb024d0b0c0bdff4528d4e6ec9f96a23fc4579b535c26fbc58974f0dd839ee880e429abca3601421cb442d31787a6d3e8e4d2f8fe897f929b22d54056f8b1cea842a4d73f3b3e509099a4383b1088d793ab3b3a39f7b1e18e639848e3101cc609e4a9cc7642f0bfae458a6a386b4162e5db1f6f57430a0c62e50a7d2a9755eaa2dbe3421800ab78a2f5ef15e4a4048a4cd22e7102125e87d5cfe61bb8a20c446622494012fc77fbfcb7e7f23a5cb6fed56eb5f06f53986abe8babbf717f988d457499dc359cfe34b81ff33365259b413a516ef6ba7f1fa2a8f9ded6c02e2d43ab43f1e76654964795b2d6366744859a9ccdecd9ca092d4007fb951bd87ec130ba7415d08d91ad99f97575aa34871d918782591ecfbee947d900e2154bd3e3972870b20ff8ba94c5cdeb9ee6f6a152911f541c59a9eddfad7cbfe076b84978eb24c0b13a071f2b3b52f7c5d2b0d2b95b8ebcc3cd3ef4259d935ac02f5c9bac992a0c797e320979459a21de0e802d8b25234cd15c3af3d9d4449bd34f72fee946debdff284ce6c86930fdc07584c9d2b0dc1e36d767ab72938d6636a413f2248c35d55154bfb73d1ff3af94ff90b2038ef31c00298a09961ac3f43ff107eaf7963a9f7fcfa2007fe13e773ce1eda12bcc8fa1fd5f83259e03a315f9925c7dd23e8620ff2c38584ed8f7efa1474710e018f4a5069280ed1b1fff53296d6a9cfe843467fa0b47f50791203744be3f0faa26218a898"

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
  return "c38." + b64.substring(0, 16)
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
  return JSON.parse(jsonStr)
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
      const body = await resp.json()
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

export const DEFAULT_GAS_URL =
  "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"

const STORAGE_PASSCODE_KEY = "mangahub_passcode"
const STORAGE_GAS_URL_KEY = "mangahub_gas_url"

export function getSavedPasscode(): string {
  return localStorage.getItem(STORAGE_PASSCODE_KEY) || ""
}

export function setSavedPasscode(code: string) {
  if (code) {
    localStorage.setItem(STORAGE_PASSCODE_KEY, code.trim())
  } else {
    localStorage.removeItem(STORAGE_PASSCODE_KEY)
  }
}

export function getGasUrl(): string {
  return localStorage.getItem(STORAGE_GAS_URL_KEY) || DEFAULT_GAS_URL
}

export function setGasUrl(url: string) {
  if (url && url.trim() !== DEFAULT_GAS_URL) {
    localStorage.setItem(STORAGE_GAS_URL_KEY, url.trim())
  } else {
    localStorage.removeItem(STORAGE_GAS_URL_KEY)
  }
}

export async function callGasApi<T = any>(action: string, payload: any = {}, customPasscode?: string): Promise<T> {
  const url = getGasUrl()
  const passcode = customPasscode !== undefined ? customPasscode : getSavedPasscode()

  const response = await fetch(url, {
    method: "POST",
    // text/plain prevents CORS preflight OPTIONS request which GAS doesn't handle
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action,
      payload,
      passcode,
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`)
  }

  const text = await response.text()
  if (!text || !text.trim()) {
    throw new Error("Empty response received from GAS server")
  }

  let result: any
  try {
    result = JSON.parse(text)
  } catch (err: any) {
    throw new Error(`Failed to parse GAS response as JSON: ${text.slice(0, 150)}`)
  }

  if (result.status === "error") {
    const err: any = new Error(result.message || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ GAS")
    err.code = result.code
    throw err
  }

  return result.data as T
}

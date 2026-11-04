import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
]

export const THAI_SHORT_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
]

export const RELEASE_DAYS = [
  { label: "จันทร์", value: "วันจันทร์" },
  { label: "อังคาร", value: "วันอังคาร" },
  { label: "พุธ", value: "วันพุธ" },
  { label: "พฤหัสฯ", value: "วันพฤหัสบดี" },
  { label: "ศุกร์", value: "วันศุกร์" },
  { label: "เสาร์", value: "วันเสาร์" },
  { label: "อาทิตย์", value: "วันอาทิตย์" },
]

export function getThaiDayName(date: Date): string {
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์']
  return days[date.getDay()]
}

export function isUrgentManga(manga: any): boolean {
  if (!manga) return false
  const v = manga.isurgent
  return v === true || String(v).toLowerCase() === 'true'
}

export function parseQueueDate(dateStr: any): Date | null {
  if (!dateStr) return null
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr
  if (typeof dateStr === 'string' && dateStr.includes('/')) {
    const parts = dateStr.trim().split(' ')[0].split('/')
    if (parts.length === 3) {
      let yr = +parts[2]
      if (yr > 2400) yr -= 543
      const d = new Date(yr, +parts[1] - 1, +parts[0])
      return isNaN(d.getTime()) ? null : d
    }
  }
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Returns the true creation/start date of a queue item.
 * Uses QueueID millisecond timestamp if available, fallback to CreatedAt.
 */
export function getQueueItemDate(q: any): Date | null {
  if (!q) return null
  const idNum = typeof q.queueid === 'number' ? q.queueid : parseInt(q.queueid, 10)
  if (!isNaN(idNum) && idNum > 1000000000000 && idNum < 2500000000000) {
    return new Date(idNum)
  }
  return parseQueueDate(q.createdat)
}

export function getChapterCount(chapterStr: any, treatSingleAsCount = false): number {
  if (!chapterStr) return 0
  const s = chapterStr.toString().trim()
  if (s.includes('-')) {
    const parts = s.split('-').map((p: string) => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const count = Math.abs(parts[1] - parts[0]) + 1
      return Math.max(0, count)
    }
  }
  const val = parseFloat(s)
  if (isNaN(val)) return 0
  return treatSingleAsCount ? val : 1
}

export function isStepDone(s: any): boolean {
  const str = (s || '').toString().trim()
  return str === 'เสร็จแล้ว' || str === 'Skipped' || str === 'ข้าม' || str.toLowerCase() === 'done' || str.toLowerCase() === 'skip'
}

export function getQueueCurrentStep(q: any): string {
  if (!q) return 'finished'
  const isDoing = (s: any) => String(s || '').trim() === 'กำลังทำ'

  if (isDoing(q.typesetstatus)) return 'typeset'
  if (isDoing(q.translatestatus)) return 'translate'
  if (isDoing(q.extractstatus)) return 'extract'
  if (isDoing(q.publishstatus)) return 'publish'
  if (isDoing(q.poststatus)) return 'post'
  if (isDoing(q.uploadstatus)) return 'upload'

  if (!isStepDone(q.uploadstatus)) return 'upload'
  if (!isStepDone(q.extractstatus)) return 'extract'
  if (!isStepDone(q.translatestatus)) return 'translate'
  if (!isStepDone(q.typesetstatus)) return 'typeset'
  if (!isStepDone(q.publishstatus)) return 'publish'
  if (!isStepDone(q.poststatus)) return 'post'
  return 'finished'
}

export function formatDuration(startTime: any, endTime: any): string {
  if (!startTime || !endTime) return ""
  const start = new Date(startTime)
  const end = new Date(endTime)
  const diffMs = end.getTime() - start.getTime()
  if (isNaN(diffMs) || diffMs <= 0) return ""

  const diffHrs = diffMs / (1000 * 60 * 60)
  if (diffHrs < 1) {
    const mins = Math.round(diffMs / (1000 * 60))
    return `${mins} นาที`
  }
  if (diffHrs < 24) {
    return `${diffHrs.toFixed(1)} ชม.`
  }
  const days = Math.floor(diffHrs / 24)
  const remainingHrs = Math.round(diffHrs % 24)
  return `${days} วัน ${remainingHrs} ชม.`
}

export function timeSince(dateInput: any): string {
  if (!dateInput) return "-"
  const date = new Date(dateInput)
  if (isNaN(date.getTime())) return "-"
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  let interval = Math.floor(seconds / 31536000)
  if (interval > 1) return interval + " ปีที่แล้ว"
  interval = Math.floor(seconds / 2592000)
  if (interval > 1) return interval + " เดือนที่แล้ว"
  interval = Math.floor(seconds / 86400)
  if (interval > 1) return interval + " วันที่แล้ว"
  if (interval === 1) return "เมื่อวานนี้"
  interval = Math.floor(seconds / 3600)
  if (interval > 1) return interval + " ชั่วโมงที่แล้ว"
  interval = Math.floor(seconds / 60)
  if (interval > 1) return interval + " นาทีที่แล้ว"
  return "เมื่อครู่"
}

export function extractStepLinks(worklink: string | undefined, stepLabel: string): string[] {
  if (!worklink) return []
  const lines = String(worklink).split('\n').filter(l => l.trim())
  const matched: string[] = []

  lines.forEach(linkStr => {
    const match = linkStr.match(/^\[(.*?)\]\s*(.*)$/)
    if (match) {
      const label = match[1].trim()
      const url = match[2].trim()
      if (label === stepLabel && url) {
        matched.push(url)
      }
    } else if (stepLabel === 'อัป Raw') {
      matched.push(linkStr.trim())
    }
  })

  return matched
}

/**
 * Safely parse a chapter number or count from any input:
 * - handles numbers, strings, Thai/Chinese/English text (e.g. "ตอนที่ 120", "Chapter 73", "共366篇正文", "第277话")
 * - guarantees NEVER returning NaN (returns 0 on failure or invalid input)
 */
export function parseChapterNumber(val: any): number {
  if (val == null) return 0
  if (typeof val === "number") {
    return isNaN(val) || !isFinite(val) ? 0 : val
  }
  const str = String(val).trim()
  if (!str || str.toLowerCase() === "nan" || str === "-" || str === "null" || str === "undefined") {
    return 0
  }
  // Direct parseFloat first
  const direct = parseFloat(str)
  if (!isNaN(direct) && isFinite(direct)) {
    return direct
  }
  // Regex extraction for strings like "ตอนที่ 120", "Chapter 73", "共366篇正文", "第277话"
  const match = str.match(/(\d+(?:\.\d+)?)/)
  if (match) {
    const num = parseFloat(match[1])
    return isNaN(num) || !isFinite(num) ? 0 : num
  }
  return 0
}

/**
 * Format chapter number or count for clean UI display
 * - If value is invalid, NaN, "NaN", null, undefined or <= 0 -> returns fallback (default "-")
 */
export function formatChapterDisplay(val: any, fallback: string = "-"): string {
  if (val == null) return fallback
  const str = String(val).trim()
  if (!str || str.toLowerCase() === "nan" || str === "-" || str === "null" || str === "undefined") {
    return fallback
  }
  if (str === "0") return "0"
  const num = parseChapterNumber(val)
  if (num > 0) {
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100)
  }
  if (!str.toLowerCase().includes("nan")) {
    return str
  }
  return fallback
}

/**
 * Sanitize status string to guarantee it NEVER displays "(+NaN ตอน)" or "NaN"
 */
export function sanitizeTrackerStatus(status?: string, safeDiff: number = 0): string {
  if (!status) return "เป็นปัจจุบัน"
  const s = String(status).trim()
  if (!s || s.toLowerCase() === "nan") return "เป็นปัจจุบัน"
  if (s.includes("NaN") || s.includes("nan")) {
    return safeDiff > 0 ? `มีตอนใหม่ (+${safeDiff} ตอน)` : "มีตอนใหม่"
  }
  return s
}

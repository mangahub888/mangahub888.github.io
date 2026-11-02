import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import {
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Download,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  Copy,
  Bookmark,
  BookOpen,
  Scissors,
  Layers,
  AlertTriangle,
  Coins,
  Crown,
  User,
} from "lucide-react"
import { KuaikanCoinWarningBanner } from "@/components/ui/KuaikanCoinWarningBanner"
import { notifyCoinAlertChange } from "@/lib/kuaikanCoinAlert"

interface KuaiKanLoginModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

const GAS_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec"

/**
 * Root Folder ID ใน Google Drive: แปลจนเมื่อย
 */
const DRIVE_ROOT_FOLDER_ID = "1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_"

/**
 * ตรวจสอบและแปลง URL ภาพ KuaiKan ให้เป็น Full HD บน f2.kkmh.com
 * โดยตรวจโครงสร้างโดเมน {subdomain}.kkmh.com/image/... แบบไดนามิก รองรับทั้ง string และ object
 */
export function normalizeKuaikanImageUrl(item: string | { url?: string; rawUrl?: string }): string {
  if (!item) return ""
  const url = typeof item === "object" ? (item.url || item.rawUrl || "") : item
  let u = String(url).trim().replace(/&amp;/g, "&")
  const match = u.match(/^https?:\/\/[a-zA-Z0-9-]+\.kkmh\.com\/image\/(.+)$/i)
  if (match) {
    let path = match[1]
    path = path.replace(/-t\.w\d+.*$/i, "").replace(/-w\d+.*$/i, "").split("?")[0]
    return `https://f2.kkmh.com/image/${path}`
  }
  if (u.startsWith("/image/")) {
    let path = u.replace(/^\/image\//, "").replace(/-t\.w\d+.*$/i, "").replace(/-w\d+.*$/i, "").split("?")[0]
    return `https://f2.kkmh.com/image/${path}`
  }
  return u
}

/**
 * Helper โหลดรูปเข้า HTMLImageElement พร้อมระบบ Auto-Retry และ CDN Fallback ไดนามิก
 * - ตรวจสอบโครงสร้าง {subdomain}.kkmh.com/image/...
 * - คงค่าพารามิเตอร์ Token ?sign=...&t=... ไว้สำหรับ fallback เมื่อ f2 คืนค่า 404
 * - จำกัดรอบ Retry สูงสุด 5 ครั้ง ไม่ค้างลูป Retry 15+ และข้ามชิ้นส่วนที่เสียเพื่อไม่ให้งานค้าง
 */
export async function loadImageElement(
  target: string | { url?: string; rawUrl?: string },
  onRetryNotice?: (text: string) => void
): Promise<HTMLImageElement | null> {
  const url = typeof target === "string" ? target : (target.url || target.rawUrl || "")
  const rawUrl = typeof target === "string" ? target : (target.rawUrl || target.url || "")

  const f2Url = normalizeKuaikanImageUrl(url || rawUrl)
  const candidateUrls: string[] = []

  // 1. ลอง f2.kkmh.com ก่อน (Full HD WebP ไร้ Token รวดเร็ว)
  if (f2Url) candidateUrls.push(f2Url)

  // 2. ถ้า rawUrl มี token sign & t ให้ใส่เป็น candidate อันดับสองทันที (ป้องกัน 404/403)
  if (rawUrl && rawUrl !== f2Url && !candidateUrls.includes(rawUrl)) {
    candidateUrls.push(rawUrl)
  }

  // 3. วิเคราะห์โครงสร้าง {subdomain}.kkmh.com/image/... เพื่อสลับ CDN โดเมนอื่น ๆ แบบไดนามิก
  const kkmhMatch = (rawUrl || url).match(/^https?:\/\/([a-zA-Z0-9-]+)\.kkmh\.com\/image\/(.+)$/i)
  if (kkmhMatch) {
    const originalSub = kkmhMatch[1].toLowerCase()
    const fullPath = kkmhMatch[2]
    const cleanPath = fullPath
      .replace(/-t\.w\d+.*$/i, "")
      .replace(/-w\d+.*$/i, "")
      .split("?")[0]
    const query = fullPath.includes("?") ? fullPath.substring(fullPath.indexOf("?")) : ""

    const cdns = ["tn1", "tn2", "tn1-f2", "tn2-f2", "f2"]
    for (const cdn of cdns) {
      if (cdn !== originalSub) {
        if (query) {
          const candSigned = `https://${cdn}.kkmh.com/image/${cleanPath}.webp-t.w1280.jpg.h${query}`
          if (!candidateUrls.includes(candSigned)) candidateUrls.push(candSigned)
        }
        const candClean = `https://${cdn}.kkmh.com/image/${cleanPath}.webp`
        if (!candidateUrls.includes(candClean)) candidateUrls.push(candClean)
      }
    }
  }

  const maxAttempts = 5
  let attempt = 1
  while (attempt <= maxAttempts) {
    const currentCandidate = candidateUrls[(attempt - 1) % candidateUrls.length]
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.crossOrigin = "anonymous"
        image.referrerPolicy = "no-referrer"

        const timer = setTimeout(() => {
          image.onload = null
          image.onerror = null
          reject(new Error(`Timeout 12s (ครั้งที่ ${attempt})`))
        }, 12000)

        image.onload = () => {
          clearTimeout(timer)
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            resolve(image)
          } else {
            reject(new Error("ขนาดภาพเป็น 0"))
          }
        }

        image.onerror = () => {
          clearTimeout(timer)
          reject(new Error(`โหลดภาพไม่สำเร็จ (ครั้งที่ ${attempt})`))
        }

        image.src = currentCandidate
      })

      return img
    } catch (err: any) {
      console.warn(`[loadImageElement] Retry #${attempt}/${maxAttempts} for ${url}:`, err.message)
      if (onRetryNotice) {
        onRetryNotice(`⚠️ มีภาพกำลัง Retry ครั้งที่ ${attempt}/${maxAttempts}... (กำลังสลับ CDN โดเมน)`)
      }
      attempt++
      if (attempt <= maxAttempts) {
        const delayMs = Math.min(attempt * 500, 2500)
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }

  console.warn(`[loadImageElement] ข้ามภาพที่ไม่สามารถโหลดได้หลังจากพยายาม ${maxAttempts} ครั้ง: ${url}`)
  return null
}

export function KuaiKanLoginModal({
  open,
  onClose,
  onSuccess,
}: KuaiKanLoginModalProps) {
  // Main view tab: "sync" (Connect VIP) vs "test" (Chapter 366 Download)
  const [mainTab, setMainTab] = React.useState<"sync" | "test">("sync")

  // Sync sub-method: "1click" | "qr" | "cookie" | "html"
  const [syncMethod, setSyncMethod] = React.useState<"1click" | "qr" | "cookie" | "html">("1click")
  const [htmlInput, setHtmlInput] = React.useState("")
  const [parsingHtml, setParsingHtml] = React.useState(false)

  const queryClient = useQueryClient()

  // Session state
  const [loadingSession, setLoadingSession] = React.useState(false)
  const [refreshingWallet, setRefreshingWallet] = React.useState(false)
  const [sessionStatus, setSessionStatus] = React.useState<{
    loggedIn: boolean
    isVip?: boolean
    vipInfo?: {
      isVip: boolean
      vipType?: number
      remainedDays?: number
      expireDate?: string
      raw?: any
    } | null
    coinBalance?: number | null
    walletDetails?: any
    user?: any
    updatedAt?: string
    cookiePreview?: string
    message?: string
  } | null>(null)

  // Refresh VIP & Wallet status from KuaiKan server
  const handleRefreshWallet = async () => {
    setRefreshingWallet(true)
    try {
      const res = await callGasApi<any>("CHECK_KUAIKAN_WALLET")
      if (res) {
        setSessionStatus(res)
        queryClient.invalidateQueries({ queryKey: ["kuaikanSessionAuth"] })
        const coinCount =
          res.coinBalance !== undefined && res.coinBalance !== null
            ? Number(res.coinBalance).toLocaleString()
            : "0"
        const vipActive = res.isVip || res.vipInfo?.isVip
        toast.success(
          `อัปเดตข้อมูลสดแล้ว: ${vipActive ? "👑 VIP Active" : "VIP ปกติ"} • ยอดคงเหลือ ${coinCount} KK Coins`
        )
      }
    } catch (err: any) {
      toast.error("รีเฟรชสถานะ KuaiKan ไม่สำเร็จ: " + (err.message || ""))
    } finally {
      setRefreshingWallet(false)
    }
  }

  // QR Login state
  const [qrLoading, setQrLoading] = React.useState(false)
  const [qrData, setQrData] = React.useState<{
    uuid: string
    state: string
    cookies: string[]
    qrUrl: string
  } | null>(null)
  const [qrStatusText, setQrStatusText] = React.useState<string>("รอการสแกน...")
  const [scanState, setScanState] = React.useState<"waiting" | "scanned" | "success" | "expired" | "idle">("idle")
  const pollingRef = React.useRef<boolean>(false)
  const autoDetectRef = React.useRef<boolean>(false)

  // Manual Cookie state
  const [cookieInput, setCookieInput] = React.useState("")
  const [savingCookie, setSavingCookie] = React.useState(false)

  // Test Chapter state
  const [testingChapter, setTestingChapter] = React.useState(false)
  const [testResult, setTestResult] = React.useState<any | null>(null)

  // Download state
  const [downloading, setDownloading] = React.useState(false)
  const [downloadResult, setDownloadResult] = React.useState<any | null>(null)

  // Stitch Mode: "total20" (แบ่งภาพทั้งหมดให้ได้ครบ 20 ไฟล์) vs "slices20" (รวมไฟล์ละ 20 ชิ้น)
  const [stitchMode, setStitchMode] = React.useState<"total20" | "slices20">("total20")

  // Stitch & Upload state (เย็บ 20 หน้า/ไฟล์ ลง Google Drive แปลจนเมื่อย)
  const [stitching, setStitching] = React.useState(false)
  const [stitchProgress, setStitchProgress] = React.useState<{
    currentPart: number
    totalParts: number
    pageRange: string
    percent: number
    statusText: string
    folderUrl?: string
    error?: string
  } | null>(null)
  const [driveAuthError, setDriveAuthError] = React.useState<string | null>(null)

  // Bookmarklet JavaScript Code (ดึงภาพจาก .img-box โดยตรง 100% ตรงตามหน้าเว็บ KuaiKan)
  const bookmarkletCode = React.useMemo(() => {
    return `javascript:(function(){try{var c=document.cookie;var imgs=[];var boxes=document.querySelectorAll('.img-box');if(boxes.length){boxes.forEach(function(b){var img=b.querySelector('img[data-src]')||b.querySelector('img');if(img){var u=img.getAttribute('data-src')||img.src;if(u&&imgs.indexOf(u)===-1)imgs.push(u);}});}if(!imgs.length){document.querySelectorAll('img[data-src*="kkmh.com"], img[src*="kkmh.com"]').forEach(function(img){var u=img.getAttribute('data-src')||img.src;if(u&&(u.indexOf('/image/c')!==-1||u.indexOf('c855368')!==-1)&&imgs.indexOf(u)===-1)imgs.push(u);});}var m=window.location.pathname.match(/\\/comic(?:-next)?\\/(\\d+)/);var cid=m?parseInt(m[1]):855368;var title=document.querySelector('h1, .title, .comic-title')?.innerText?.trim()||'第366话 真真假假';var topic=document.querySelector('.topic-title, .sub-title, a[href*="/topic/"]')?.innerText?.trim()||'我！天命大反派';var u='${GAS_EXEC_URL}';fetch(u,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'SAVE_KUAIKAN_AUTH',passcode:'10211032',payload:{directCookie:c,comicId:cid,title:title,topicTitle:topic,images:imgs}})}).then(function(){alert('🎉 ดึงภาพจาก .img-box สำเร็จครบทั้ง '+imgs.length+' ภาพ และส่งให้ MangaHub เรียบร้อยแล้ว!');}).catch(function(e){alert('Error: '+e.message);});}catch(err){alert('Error: '+err.message);}})();`
  }, [])

  // Console Code (ดึงภาพจาก .img-box โดยตรง 100% ตรงตามหน้าเว็บ KuaiKan)
  const consoleCode = React.useMemo(() => {
    return `(()=>{try{var c=document.cookie,imgs=[],boxes=document.querySelectorAll('.img-box');if(boxes.length){boxes.forEach(b=>{var img=b.querySelector('img[data-src]')||b.querySelector('img');if(img){var u=img.getAttribute('data-src')||img.src;if(u&&!imgs.includes(u))imgs.push(u);}});}if(!imgs.length){document.querySelectorAll('img[data-src*="kkmh.com"], img[src*="kkmh.com"]').forEach(img=>{var u=img.getAttribute('data-src')||img.src;if(u&&(u.includes('/image/c')||u.includes('c855368'))&&!imgs.includes(u))imgs.push(u);});}var m=location.pathname.match(/\\/comic(?:-next)?\\/(\\d+)/),cid=m?parseInt(m[1]):855368,title=document.querySelector('h1, .title, .comic-title')?.innerText?.trim()||'第366话 真真假假',topic=document.querySelector('.topic-title, .sub-title, a[href*="/topic/"]')?.innerText?.trim()||'我！天命大反派';fetch('${GAS_EXEC_URL}',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'SAVE_KUAIKAN_AUTH',passcode:'10211032',payload:{directCookie:c,comicId:cid,title:title,topicTitle:topic,images:imgs}})}).then(()=>alert('🎉 ดึงภาพจาก .img-box สำเร็จครบทั้ง '+imgs.length+' ภาพ และส่งให้ MangaHub เรียบร้อยแล้ว!'));}catch(e){alert('Error: '+e.message);}})();`
  }, [])

  // Check saved session
  const fetchSessionStatus = React.useCallback(async (silent = false) => {
    if (!silent) setLoadingSession(true)
    try {
      const res = await callGasApi<any>("GET_KUAIKAN_SESSION")
      setSessionStatus(res)
      return res
    } catch (err: any) {
      if (!silent) console.error("fetchSessionStatus error:", err)
      return null
    } finally {
      if (!silent) setLoadingSession(false)
    }
  }, [])

  // Auto-detect incoming session sync every 2.5s
  React.useEffect(() => {
    if (!open) {
      autoDetectRef.current = false
      return
    }

    autoDetectRef.current = true
    let isInitial = true

    const interval = setInterval(async () => {
      if (!autoDetectRef.current) return
      const res = await fetchSessionStatus(true)
      if (res && res.loggedIn && !sessionStatus?.loggedIn && !isInitial) {
        toast.success("👑 ตรวจพบ KuaiKan VIP เชื่อมต่อสำเร็จแล้ว!")
        setMainTab("test")
        handleTestChapter()
        if (onSuccess) onSuccess()
      }
      isInitial = false
    }, 2500)

    return () => {
      autoDetectRef.current = false
      clearInterval(interval)
    }
  }, [open, sessionStatus?.loggedIn, fetchSessionStatus, onSuccess])

  React.useEffect(() => {
    if (open) {
      fetchSessionStatus().then((res) => {
        if (res?.loggedIn) {
          setMainTab("test")
        }
      })
      if (syncMethod === "qr") {
        loadQrCode()
      }
    } else {
      pollingRef.current = false
    }
    return () => {
      pollingRef.current = false
    }
  }, [open, syncMethod, fetchSessionStatus])

  // Generate QR session
  const loadQrCode = async () => {
    pollingRef.current = false
    setQrLoading(true)
    setQrData(null)
    setScanState("waiting")
    setQrStatusText("กำลังขอ QR Code...")

    try {
      const res = await callGasApi<any>("GET_KUAIKAN_QR")
      if (res && res.success && res.uuid) {
        setQrData(res)
        setQrStatusText("เปิด WeChat สแกน QR ด้านล่าง")
        startPolling(res.uuid, res.state, res.cookies)
      } else {
        setScanState("expired")
        setQrStatusText(res?.error || "ไม่สามารถขอ QR ได้")
      }
    } catch (err: any) {
      setScanState("expired")
      setQrStatusText(err.message || "เกิดข้อผิดพลาดในการขอ QR")
    } finally {
      setQrLoading(false)
    }
  }

  // Poll WeChat QR Status
  const startPolling = (uuid: string, state: string, cookies: string[]) => {
    pollingRef.current = true

    const pollNext = async () => {
      if (!pollingRef.current) return

      try {
        const pollResult = await new Promise<{ errcode: number; code?: string }>((resolve) => {
          const scriptId = "wx_poll_script_" + Date.now()
          const script = document.createElement("script")
          script.id = scriptId
          script.src = `https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=${uuid}&_=${Date.now()}`
          
          let resolved = false
          const finish = (result: { errcode: number; code?: string }) => {
            if (!resolved) {
              resolved = true
              script.remove()
              resolve(result)
            }
          }

          script.onload = () => {
            const errcode = (window as any).wx_errcode
            const code = (window as any).wx_code
            finish({ errcode: typeof errcode === "number" ? errcode : 408, code })
          }

          script.onerror = () => {
            finish({ errcode: -999 })
          }

          document.body.appendChild(script)
          setTimeout(() => finish({ errcode: 408 }), 25000)
        })

        if (!pollingRef.current) return

        if (pollResult.errcode === 408) {
          setScanState("waiting")
          setQrStatusText("รอการสแกน...")
          setTimeout(pollNext, 1200)
        } else if (pollResult.errcode === 404) {
          setScanState("scanned")
          setQrStatusText("📲 สแกนแล้ว! กดยืนยันบนมือถือ...")
          toast.info("สแกนสำเร็จ! กรุณากดยืนยันบน WeChat")
          setTimeout(pollNext, 800)
        } else if (pollResult.errcode === 405 && pollResult.code) {
          setScanState("success")
          setQrStatusText("🎉 ยืนยันสำเร็จ!")
          toast.success("ยืนยันผ่าน WeChat สำเร็จ!")

          const saveRes = await callGasApi<any>("SAVE_KUAIKAN_AUTH", {
            code: pollResult.code,
            state,
            cookies,
          })

          if (saveRes && saveRes.success) {
            toast.success("บันทึก Session KuaiKan VIP เรียบร้อยแล้ว!")
            fetchSessionStatus()
            setMainTab("test")
            handleTestChapter()
            if (onSuccess) onSuccess()
          } else {
            toast.error(saveRes?.error || "บันทึก Session ไม่สำเร็จ")
          }
        } else if (pollResult.errcode === 402) {
          setScanState("expired")
          setQrStatusText("QR หมดอายุ กดรีเฟรช")
        } else {
          const checkRes = await callGasApi<any>("CHECK_KUAIKAN_QR", {
            uuid,
            state,
            cookies,
          })
          if (checkRes && checkRes.status === "success") {
            setScanState("success")
            toast.success("เข้าสู่ระบบ KuaiKan สำเร็จ!")
            fetchSessionStatus()
            setMainTab("test")
            handleTestChapter()
            if (onSuccess) onSuccess()
          } else {
            setTimeout(pollNext, 2000)
          }
        }
      } catch (e) {
        console.error("Polling error:", e)
        if (pollingRef.current) setTimeout(pollNext, 3000)
      }
    }

    pollNext()
  }

  // Handle direct manual cookie save
  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) {
      toast.error("กรุณาระบุ Cookie เช่น passToken=... หรือ connect.sid=...")
      return
    }

    setSavingCookie(true)
    try {
      const res = await callGasApi<any>("SAVE_KUAIKAN_AUTH", {
        directCookie: cookieInput.trim(),
      })

      if (res && res.success) {
        toast.success("บันทึก Cookie สำเร็จ!")
        setCookieInput("")
        fetchSessionStatus()
        setMainTab("test")
        handleTestChapter()
        if (onSuccess) onSuccess()
      } else {
        toast.error(res?.error || "บันทึก Cookie ไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึก Cookie")
    } finally {
      setSavingCookie(false)
    }
  }

  // Handle parsing raw HTML syntax from <div class="comicDetails"> / <div class="imgList">
  const handleParseHtml = async () => {
    if (!htmlInput.trim()) {
      toast.error("กรุณาวางโค้ด HTML ของตอน เช่น <div class=\"comicDetails\">... หรือ <div class=\"img-box\">...")
      return
    }

    setParsingHtml(true)
    try {
      // 1. Regex อ่าน data-src ภายใน .img-box (format /image/c855368/ หรือ /image/c\d+/)
      const regex = /data-src=["'](https?:\/\/[^"'\s]+kkmh\.com\/image\/c\d+\/[^"'\s]+)["']/gi
      const urls: string[] = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(htmlInput)) !== null) {
        const u = match[1].replace(/&amp;/g, "&")
        if (!urls.includes(u)) urls.push(u)
      }

      // 2. Fallback regex หากไม่มี data-src
      if (urls.length === 0) {
        const fallbackRegex = /https?:\/\/[^"'\s]*kkmh\.com\/image\/c\d+\/[^"'\s<>&]+/gi
        let m2: RegExpExecArray | null
        while ((m2 = fallbackRegex.exec(htmlInput)) !== null) {
          const u = m2[0].replace(/&amp;/g, "&")
          if (!urls.includes(u)) urls.push(u)
        }
      }

      if (urls.length === 0) {
        toast.error("ไม่พบลิงก์ภาพที่ตรงกับ format /image/c<comicId>/ ในโค้ด HTML ที่วาง")
        return
      }

      // สกัด comicId และ chapter title อัตโนมัติจาก HTML
      let detectedComicId = 855368
      let detectedTitle = "第366话 真真假假"
      let detectedTopicTitle = "我！天命大反派"

      const comicIdMatch = htmlInput.match(/\/image\/c(\d+)\//i)
      if (comicIdMatch && comicIdMatch[1]) {
        detectedComicId = parseInt(comicIdMatch[1], 10)
      }

      const altMatch = htmlInput.match(/alt=["']([^"']+)["']/i)
      if (altMatch && altMatch[1] && altMatch[1].trim()) {
        detectedTitle = altMatch[1].trim()
      }

      toast.info(`✓ สกัดภาพจาก HTML สำเร็จ ${urls.length} ภาพ กำลังส่งบันทึกเข้าระบบ...`)

      const saveRes = await callGasApi<any>("SAVE_KUAIKAN_AUTH", {
        comicId: detectedComicId,
        title: detectedTitle,
        topicTitle: detectedTopicTitle,
        images: urls,
      })

      if (saveRes && saveRes.success) {
        toast.success(`🎉 บันทึกภาพ ${urls.length} ภาพ เรียบร้อยแล้ว!`)
        setHtmlInput("")
        fetchSessionStatus()
        setMainTab("test")
        handleTestChapter()
        if (onSuccess) onSuccess()
      } else {
        toast.error(saveRes?.error || "บันทึกภาพไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการแกะโค้ด HTML")
    } finally {
      setParsingHtml(false)
    }
  }

  // Clear session
  const handleClearSession = async () => {
    if (!confirm("ต้องการยกเลิกการเชื่อมต่อบัญชี KuaiKan ใช่หรือไม่?")) return
    try {
      await callGasApi("CLEAR_KUAIKAN_AUTH")
      toast.info("ออกจากระบบ KuaiKan เรียบร้อยแล้ว")
      setSessionStatus(null)
      setTestResult(null)
      setMainTab("sync")
      if (syncMethod === "qr") loadQrCode()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    }
  }

  // Test Chapter 366 (Paid / VIP)
  const handleTestChapter = async () => {
    setTestingChapter(true)
    setTestResult(null)
    try {
      const res = await callGasApi<any>("TEST_KUAIKAN_CHAPTER", {
        comicId: 855368, // Chapter 366 of 我！天命大反派
      })
      setTestResult(res)
      if (res && res.success) {
        if (res.isVipUnlocked && res.imagesCount > 1) {
          toast.success(`🎉 ปลดล็อคสำเร็จ! พบ ${res.imagesCount} ภาพ HD`)
        } else {
          toast.warning("ตอนยังถูกล็อค (อาจยังไม่ใช่ VIP หรือตอนต้องใช้เหรียญซื้อ)")
          if (res.isPay || res.insufficientCoins) {
            notifyCoinAlertChange({
              hasAlert: true,
              comicId: "855368",
              comicTitle: res.thaiTitle || res.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
              chapterTitle: res.title || "第366话",
              message: "เหรียญ KuaiKan ไม่เพียงพอสำหรับการปลดล็อคตอน VIP กรุณาเติมเหรียญ",
              requiredCoins: res.selling_kk_currency || 58,
              timestamp: new Date().toISOString(),
              dismissed: false,
            })
          }
        }
      } else {
        toast.error(res?.error || "ทดสอบดึงตอนไม่สำเร็จ")
        if (res && (res.insufficientCoins || res.isPay || String(res.error).includes("เหรียญ") || String(res.error).includes("coin") || String(res.error).includes("VIP Lock"))) {
          notifyCoinAlertChange({
            hasAlert: true,
            comicId: "855368",
            comicTitle: res?.thaiTitle || res?.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
            chapterTitle: res?.title || "第366话",
            message: res?.error || "เหรียญ KuaiKan ไม่เพียงพอสำหรับการปลดล็อคตอน VIP กรุณาเติมเหรียญ",
            requiredCoins: 58,
            timestamp: new Date().toISOString(),
            dismissed: false,
          })
        }
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการทดสอบ")
    } finally {
      setTestingChapter(false)
    }
  }

  // Auto Download to Google Drive
  const handleDownloadChapter = async () => {
    setDownloading(true)
    setDownloadResult(null)
    setDriveAuthError(null)
    try {
      const res = await callGasApi<any>("DOWNLOAD_KUAIKAN_CHAPTER", {
        comicId: 855368,
        mangaId: "4",
        chapter: "366",
        mangaName: "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
        skipQueue: false,
        isTest: false,
        uploadername: "Apt",
        uploadstatus: "เสร็จแล้ว",
      })
      setDownloadResult(res)
      if (res && res.success) {
        toast.success(`ดาวน์โหลดเรียบร้อย ${res.downloadedCount} ภาพ และนำเข้าคิวงานแล้ว!`)
      } else {
        if (res?.error && (res.error.includes("DriveApp") || res.error.includes("คุณไม่ได้รับอนุญาต") || res.error.includes("permission"))) {
          setDriveAuthError(res.error)
        }
        toast.error(res?.error || "ดาวน์โหลดไม่สำเร็จ")
      }
    } catch (err: any) {
      if (err.message && (err.message.includes("DriveApp") || err.message.includes("คุณไม่ได้รับอนุญาต") || err.message.includes("permission"))) {
        setDriveAuthError(err.message)
      }
      toast.error(err.message || "เกิดข้อผิดพลาดในการดาวน์โหลด")
    } finally {
      setDownloading(false)
    }
  }

  // เย็บภาพ 20 หน้า/ไฟล์ ความกว้างเท่ากันทั้งหมด และอัปโหลดลง Google Drive: แปลจนเมื่อย / {ชื่อเรื่อง} / {เลขตอน}
  const handleStitchAndUpload = async () => {
    if (!testResult) {
      toast.error("กรุณากดทดสอบตอนก่อน")
      return
    }

    const rawItems: any[] = testResult.imageDetails || testResult.allImages || testResult.sampleImages || []
    if (!rawItems.length) {
      toast.error("ไม่พบรายการภาพ กรุณากดทดสอบตอนหรือซิงค์ Session อีกครั้ง")
      return
    }

    const allUrls = rawItems.map((item: any) => {
      const raw = typeof item === "string" ? item : (item.rawUrl || item.url)
      const f2 = normalizeKuaikanImageUrl(raw)
      return {
        url: f2,
        rawUrl: raw
      }
    }).filter((item) => Boolean(item.url || item.rawUrl))

    const totalPages = allUrls.length
    const totalParts =
      stitchMode === "slices20"
        ? Math.ceil(totalPages / 20)
        : Math.min(20, totalPages)

    setStitching(true)
    setDriveAuthError(null)
    setStitchProgress({
      currentPart: 0,
      totalParts,
      pageRange: `เริ่มต้นคำนวณ (${stitchMode === "total20" ? `ทั้งหมด ${totalPages} ชิ้น -> แบ่งเป็น ${totalParts} ไฟล์` : `ทั้งหมด ${totalPages} ชิ้น -> ไฟล์ละ 20 ชิ้น รวมเป็น ${totalParts} ไฟล์`})`,
      percent: 5,
      statusText: "กำลังวิเคราะห์ความกว้างมาตรฐานจากหน้าย่อยที่ 15...",
    })

    try {
      // 1. วัดขนาดความกว้างมาตรฐานจากหน้าย่อยที่ 15 (Index 14) ของเรื่องและตอนนั้นๆ เสมอ (ไม่ล็อค 1280px)
      const sampleIdx = totalPages >= 15 ? 14 : Math.floor(totalPages / 2)
      let standardWidth = 1280

      try {
        const sampleImg = await loadImageElement(allUrls[sampleIdx])
        if (sampleImg && sampleImg.naturalWidth && sampleImg.naturalWidth > 100) {
          standardWidth = sampleImg.naturalWidth
        }
      } catch (err) {
        console.warn("Could not load slice #15, trying first image:", err)
        try {
          const firstImg = await loadImageElement(allUrls[0])
          if (firstImg && firstImg.naturalWidth && firstImg.naturalWidth > 100) {
            standardWidth = firstImg.naturalWidth
          }
        } catch (e2) {}
      }

      toast.info(`📏 ความกว้างมาตรฐาน (หน้าย่อยที่ ${sampleIdx + 1}): ${standardWidth}px (${stitchMode === "total20" ? `แบ่งรวมเป็น ${totalParts} ไฟล์` : `ไฟล์ละ 20 ชิ้น รวมเป็น ${totalParts} ไฟล์`})`)

      let lastFolderUrl = ""
      let lastQueueAdded = false

      // 2. Pre-Render All Pages in Memory (10x Smart Parallel Architecture)
      interface PreRenderedPage {
        partNum: number
        fileName: string
        mimeType: string
        base64Data: string
        totalHeight: number
      }

      const preRenderedPages: PreRenderedPage[] = []

      for (let partIdx = 0; partIdx < totalParts; partIdx++) {
        let startIdx = 0
        let endIdx = 0
        if (stitchMode === "slices20") {
          startIdx = partIdx * 20
          endIdx = Math.min((partIdx + 1) * 20, totalPages)
        } else {
          startIdx = Math.round((partIdx * totalPages) / totalParts)
          endIdx = Math.round(((partIdx + 1) * totalPages) / totalParts)
        }

        const partNum = partIdx + 1
        const sliceCount = endIdx - startIdx
        const partRange = `หน้า ${partNum}/${totalParts} (ชิ้นที่ ${startIdx + 1} - ${endIdx})`

        setStitchProgress((prev) => ({
          currentPart: partNum,
          totalParts,
          pageRange: partRange,
          percent: Math.round(((partIdx + 1) / totalParts) * 25),
          statusText: `⚡ [10x Speedup] กำลังตัดเย็บและเรนเดอร์หน้า ${String(partNum).padStart(3, "0")}.jpg (${partNum}/${totalParts})...`,
        }))

        // 2.1 โหลดภาพใน Part นี้
        const partUrls = allUrls.slice(startIdx, endIdx)
        const loadedResults = await Promise.all(
          partUrls.map((u) =>
            loadImageElement(u, (notice) => {
              setStitchProgress((prev) => (prev ? { ...prev, statusText: notice } : null))
            })
          )
        )
        const loadedImages = loadedResults.filter((img): img is HTMLImageElement => img !== null)
        if (!loadedImages.length) {
          console.warn(`Part ${partNum} ไม่มีภาพที่โหลดสำเร็จ ข้าม Part นี้`)
          continue
        }

        // 2.2 ปรับสเกลภาพให้ความกว้างเท่ากับ standardWidth
        let totalHeight = 0
        const scaledItems = loadedImages.map((img) => {
          const scale = standardWidth / img.naturalWidth
          const scaledH = Math.round(img.naturalHeight * scale)
          totalHeight += scaledH
          return { img, scaledH }
        })

        const fileName = `${String(partNum).padStart(3, "0")}.jpg`
        const mimeType = "image/jpeg"

        // 2.3 สร้าง Canvas แล้ววาดต่อกันลงมา
        const canvas = document.createElement("canvas")
        canvas.width = standardWidth
        canvas.height = totalHeight
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("ไม่สามารถสร้าง 2D Canvas ได้")

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"

        let currentY = 0
        for (const item of scaledItems) {
          ctx.drawImage(item.img, 0, currentY, standardWidth, item.scaledH)
          currentY += item.scaledH
        }

        // 2.4 ส่งออกเป็น Blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("สร้าง JPEG blob ไม่สำเร็จ"))),
            mimeType,
            0.88
          )
        })

        canvas.width = 0
        canvas.height = 0

        // 2.5 แปลงเป็น Base64
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })

        preRenderedPages.push({
          partNum,
          fileName,
          mimeType,
          base64Data,
          totalHeight,
        })
      }

      // 3. Smart Staged Multi-Thread Uploading
      // Phase A: หน้า 1 สร้างโฟลเดอร์ Google Drive
      const p1 = preRenderedPages[0]
      setStitchProgress({
        currentPart: 1,
        totalParts,
        pageRange: `หน้า 1/${totalParts}`,
        percent: 30,
        statusText: `🚀 [Phase A] กำลังอัปโหลด ${p1.fileName} เพื่อสร้างโฟลเดอร์ Google Drive...`,
      })

      const resP1 = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
        mangaName: testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
        chapter: testResult.title || "第366话",
        partIndex: 1,
        totalParts,
        fileName: p1.fileName,
        mimeType: p1.mimeType,
        base64Data: p1.base64Data,
        isLastPart: totalParts === 1,
        clearFolder: true,
        mangaId: String(testResult.mangaId || "4"),
        skipQueue: totalParts > 1,
        isTest: false,
        uploadername: "Apt",
        uploadstatus: "เสร็จแล้ว",
      })

      if (resP1 && resP1.error) {
        throw new Error(resP1.error)
      }

      lastFolderUrl = resP1?.data?.folderUrl || resP1?.folderUrl || ""
      if (resP1 && resP1.queueAdded) lastQueueAdded = true

      // Phase B: อัปโหลดคู่ขนานหน้า 2 ถึง totalParts - 1 ด้วย 4 Concurrent Workers
      if (totalParts > 2) {
        const middlePages = preRenderedPages.slice(1, totalParts - 1)
        let middleUploaded = 0

        setStitchProgress({
          currentPart: 2,
          totalParts,
          pageRange: `หน้า 2 - ${totalParts - 1} / ${totalParts}`,
          percent: 40,
          statusText: `⚡ [Phase B] อัปโหลดคู่ขนานหน้า 002.jpg - ${String(totalParts - 1).padStart(3, "0")}.jpg (4 Workers)...`,
        })

        const uploadWorker = async (page: PreRenderedPage) => {
          let attempt = 1
          while (attempt <= 3) {
            try {
              const r = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
                mangaName: testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
                chapter: testResult.title || "第366话",
                partIndex: page.partNum,
                totalParts,
                fileName: page.fileName,
                mimeType: page.mimeType,
                base64Data: page.base64Data,
                isLastPart: false,
                clearFolder: false,
                mangaId: String(testResult.mangaId || "4"),
                skipQueue: true,
                isTest: false,
                worklink: lastFolderUrl ? `[อัป Raw] ${lastFolderUrl}` : undefined,
                uploadername: "Apt",
                uploadstatus: "เสร็จแล้ว",
              })
              if (r && r.error) throw new Error(r.error)
              middleUploaded++
              setStitchProgress({
                currentPart: page.partNum,
                totalParts,
                pageRange: `หน้า ${page.partNum}/${totalParts}`,
                percent: 30 + Math.round((middleUploaded / middlePages.length) * 55),
                statusText: `✓ [Phase B] หน้า ${String(page.partNum).padStart(3, "0")}.jpg อัปโหลดสำเร็จ (${middleUploaded}/${middlePages.length})...`,
              })
              return
            } catch (e) {
              attempt++
              if (attempt > 3) throw e
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
            }
          }
        }

        const concurrency = 4
        const executing: Promise<any>[] = []
        for (const page of middlePages) {
          const p = uploadWorker(page).then(() => {
            executing.splice(executing.indexOf(p), 1)
          })
          executing.push(p)
          if (executing.length >= concurrency) {
            await Promise.race(executing)
          }
        }
        await Promise.all(executing)
      }

      // Phase C: อัปโหลดหน้าสุดท้ายและลงคิวงาน WorkQueue
      if (totalParts > 1) {
        const pLast = preRenderedPages[totalParts - 1]
        setStitchProgress({
          currentPart: totalParts,
          totalParts,
          pageRange: `หน้า ${totalParts}/${totalParts}`,
          percent: 92,
          statusText: `🎉 [Phase C] อัปโหลด ${pLast.fileName} และบันทึกลงคิวงาน WorkQueue...`,
        })

        const resLast = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
          mangaName: testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
          chapter: testResult.title || "第366话",
          partIndex: totalParts,
          totalParts,
          fileName: pLast.fileName,
          mimeType: pLast.mimeType,
          base64Data: pLast.base64Data,
          isLastPart: true,
          clearFolder: false,
          mangaId: String(testResult.mangaId || "4"),
          skipQueue: false,
          uploadername: "Apt",
          uploadstatus: "เสร็จแล้ว",
          worklink: lastFolderUrl ? `[อัป Raw] ${lastFolderUrl}` : undefined,
          isTest: false,
        })

        if (resLast && resLast.error) {
          throw new Error(resLast.error)
        }

        lastFolderUrl = resLast?.data?.folderUrl || resLast?.folderUrl || lastFolderUrl
        if (resLast && resLast.queueAdded) lastQueueAdded = true
      }

      // Fallback addQueue หาก backend ยังไม่ได้ลงคิว
      if (lastFolderUrl && !lastQueueAdded) {
        try {
          const cleanChapter = (testResult.title || "第366话").replace(/[^\d.]/g, "") || "366"
          await callGasApi("ADD_QUEUE", {
            mangaid: String(testResult.mangaId || "4"),
            chapter: cleanChapter,
            uploadername: "Apt",
            uploadstatus: "เสร็จแล้ว",
            worklink: `[อัป Raw] ${lastFolderUrl}`,
            note: `KuaiKan VIP Concat รวมเป็น ${totalParts} หน้า ลง แปลจนเมื่อย`,
          })
        } catch (addQErr) {
          console.warn("Fallback ADD_QUEUE error:", addQErr)
        }
      }

      setStitchProgress({
        currentPart: totalParts,
        totalParts,
        pageRange: `ครบทั้ง ${totalPages} ชิ้นภาพ`,
        percent: 100,
        statusText: `คำนวณและอัปโหลดรวมเป็น ${totalParts} หน้าเสร็จสิ้นแล้ว!`,
        folderUrl: lastFolderUrl || `https://drive.google.com/drive/folders/${DRIVE_ROOT_FOLDER_ID}`,
      })

      toast.success(`🎉 รวมภาพเป็น ${totalParts} หน้า และบันทึกลง แปลจนเมื่อย สำเร็จ!`)
    } catch (err: any) {
      console.error("handleStitchAndUpload error:", err)
      if (err.message && (err.message.includes("DriveApp") || err.message.includes("คุณไม่ได้รับอนุญาต") || err.message.includes("permission"))) {
        setDriveAuthError(err.message)
      }
      toast.error(err.message || "เกิดข้อผิดพลาดในการเย็บภาพ")
    } finally {
      setStitching(false)
    }
  }

  // Copy helper
  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text)
    toast.success(msg)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[92vw] max-w-md bg-[#0b101b] border-[#1e293b] text-slate-100 p-0 overflow-hidden shadow-2xl rounded-2xl gap-0">
        {/* Compact Header */}
        <DialogHeader className="px-5 py-3.5 border-b border-[#1e293b] flex items-center justify-between bg-[#101726]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 shrink-0">
              <Smartphone className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-white flex items-center gap-2">
                KuaiKan VIP (快看漫画)
              </DialogTitle>
              <div className="text-[11px] text-slate-400">
                ซิงค์ Session เพื่อปลดล็อคตอน VIP
              </div>
            </div>
          </div>

          {/* Status Badge in Header */}
          <div className="flex items-center gap-1.5 pr-6">
            {loadingSession ? (
              <span className="text-[10px] text-slate-400 animate-pulse">ตรวจสถานะ...</span>
            ) : sessionStatus?.loggedIn ? (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <ShieldCheck className="h-3 w-3" />
                  {sessionStatus.isVip ? "👑 VIP Active" : "พร้อมใช้งาน"}
                </span>
                <button
                  type="button"
                  onClick={handleClearSession}
                  className="text-slate-400 hover:text-red-400 p-0.5 transition-colors cursor-pointer"
                  title="ออกจากระบบ"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300">
                <AlertCircle className="h-3 w-3" /> ยังไม่เชื่อมต่อ
              </span>
            )}
          </div>
        </DialogHeader>

        {/* KuaiKan Insufficient Coins Warning Banner */}
        <div className="px-5 pt-3">
          <KuaikanCoinWarningBanner compact={true} />
        </div>

        {/* Account Profile Card (When Logged In) */}
        {sessionStatus?.loggedIn && (
          <div className="px-5 pt-3">
            <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-[#12192a] via-[#0d1424] to-[#141b2f] p-3.5 shadow-md space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* User Info Avatar & Name */}
                <div className="flex items-center gap-3 min-w-0">
                  {sessionStatus.user?.avatar_url ? (
                    <img
                      src={sessionStatus.user.avatar_url}
                      alt="KuaiKan User"
                      className="w-10 h-10 rounded-full border-2 border-amber-400/50 object-cover shadow-sm shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500/25 to-purple-600/35 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow-sm shrink-0">
                      <Crown className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-bold text-white text-xs truncate">
                      <span>{sessionStatus.user?.nickname || "บัญชี KuaiKan VIP"}</span>
                      {sessionStatus.user?.uid && (
                        <span className="text-[10px] text-slate-400 font-normal">
                          (UID: {sessionStatus.user.uid})
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                      <span>
                        {sessionStatus.cookiePreview ? `Cookie: ${sessionStatus.cookiePreview}` : "เชื่อมต่อแล้ว"}
                      </span>
                      {sessionStatus.updatedAt && (
                        <>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-400">
                            อัปเดต{" "}
                            {new Date(sessionStatus.updatedAt).toLocaleTimeString("th-TH", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            น.
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions: Refresh & Logout */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRefreshWallet}
                    disabled={refreshingWallet || loadingSession}
                    className="h-7 text-xs border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-200 cursor-pointer flex items-center gap-1.5 shadow-xs transition-colors"
                    title="ดึงสถานะ VIP และยอดเหรียญล่าสุดจาก KuaiKan ทันที"
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshingWallet ? "animate-spin text-amber-400" : ""}`} />
                    <span>รีเฟรชสถานะ VIP & เหรียญ</span>
                  </Button>
                  <button
                    type="button"
                    onClick={handleClearSession}
                    className="h-7 px-2 rounded-md border border-slate-700/60 bg-slate-800/40 hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 text-xs transition-colors cursor-pointer flex items-center gap-1"
                    title="ออกจากระบบ KuaiKan"
                  >
                    <LogOut className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Status Badges Row: VIP Status & Coin Balance */}
              <div className="pt-2 border-t border-[#1e293b]/70 flex flex-wrap items-center gap-2">
                {/* VIP Status Badge */}
                {sessionStatus.isVip || sessionStatus.vipInfo?.isVip ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500/20 via-purple-600/30 to-amber-500/15 border border-amber-400/50 text-amber-200 shadow-xs">
                    <Crown className="h-3.5 w-3.5 text-amber-300 fill-amber-300/40 shrink-0" />
                    <span>
                      👑 สมาชิก VIP Active
                      {sessionStatus.vipInfo?.remainedDays !== undefined ? (
                        <span className="font-normal text-amber-200/90 ml-1">
                          (เหลืออีก {sessionStatus.vipInfo.remainedDays} วัน
                          {sessionStatus.vipInfo.expireDate ? ` • หมดอายุ ${sessionStatus.vipInfo.expireDate}` : ""}
                          )
                        </span>
                      ) : sessionStatus.vipInfo?.expireDate ? (
                        <span className="font-normal text-amber-200/90 ml-1">
                          (หมดอายุ {sessionStatus.vipInfo.expireDate})
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gradient-to-r from-slate-800/90 to-amber-950/40 border border-amber-500/30 text-amber-300 shadow-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span>⚠️ VIP หมดอายุแล้ว</span>
                  </div>
                )}

                {/* Coin Balance Badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold font-mono bg-[#131b2e] border border-amber-500/30 text-amber-300 shadow-xs">
                  <Coins className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>
                    🪙{" "}
                    {sessionStatus.coinBalance !== null && sessionStatus.coinBalance !== undefined
                      ? Number(sessionStatus.coinBalance).toLocaleString()
                      : "0"}{" "}
                    KK Coins
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation Switcher */}
        <div className="px-5 pt-3 pb-0 bg-[#0b101b]">
          <div className="flex rounded-lg bg-[#141c2e] p-1 border border-[#1e293b]">
            <button
              type="button"
              onClick={() => setMainTab("sync")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                mainTab === "sync"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Zap className="h-3.5 w-3.5" /> ซิงค์คุกกี้ VIP
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("test")
                if (!testResult) handleTestChapter()
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                mainTab === "test"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" /> โหลดตอน 366 (VIP)
              {testResult?.isVipUnlocked && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-1" />
              )}
            </button>
          </div>
        </div>

        {/* Modal Body Container (Strictly Controlled Height, Never Overflows) */}
        <div className="p-5 pt-3 min-h-[220px] max-h-[75vh] overflow-y-auto">
          {/* TAB 1: SYNC VIEW */}
          {mainTab === "sync" && (
            <div className="space-y-3">
              {/* Sub-method pills */}
              <div className="flex rounded-md bg-[#141c2e] p-0.5 border border-[#1e293b] text-[11px]">
                <button
                  type="button"
                  onClick={() => setSyncMethod("1click")}
                  className={`flex-1 py-1 rounded transition-colors cursor-pointer ${
                    syncMethod === "1click"
                      ? "bg-emerald-600 text-white font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  ⚡ 1-Click บุ๊กมาร์ก (แนะนำ)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSyncMethod("qr")
                    loadQrCode()
                  }}
                  className={`flex-1 py-1 rounded transition-colors cursor-pointer ${
                    syncMethod === "qr"
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  📱 WeChat QR
                </button>
                <button
                  type="button"
                  onClick={() => setSyncMethod("cookie")}
                  className={`flex-1 py-1 rounded transition-colors cursor-pointer ${
                    syncMethod === "cookie"
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  🔑 วาง Cookie
                </button>
                <button
                  type="button"
                  onClick={() => setSyncMethod("html")}
                  className={`flex-1 py-1 rounded transition-colors cursor-pointer ${
                    syncMethod === "html"
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  📋 วาง HTML Syntax
                </button>
              </div>

              {/* Sub-tab: 1-Click Bookmarklet */}
              {syncMethod === "1click" && (
                <div className="p-3.5 rounded-xl border border-emerald-500/25 bg-emerald-950/15 space-y-3">
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    ลากปุ่มสีเขียวไปวางบน <b>แถบบุ๊กมาร์ก</b> บนเบราว์เซอร์ แล้วเปิดหน้า{" "}
                    <a
                      href="https://www.kuaikanmanhua.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 underline inline-flex items-center gap-0.5 font-medium"
                    >
                      KuaiKan <ExternalLink className="h-2.5 w-2.5" />
                    </a>{" "}
                    ที่ล็อกอิน VIP ไว้ จากนั้นคลิกปุ่มนี้ คุกกี้จะถูกส่งมาที่นี่ทันที
                  </div>

                  {/* Draggable button */}
                  <div className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg bg-[#070b14] border border-dashed border-emerald-500/40">
                    <a
                      href={bookmarkletCode}
                      draggable="true"
                      onClick={(e) => {
                        e.preventDefault()
                        copyToClipboard(bookmarkletCode, "คัดลอกโค้ด Bookmarklet แล้ว!")
                      }}
                      className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950 flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing border border-emerald-400/30 transition-transform active:scale-95"
                      title="ลากปุ่มนี้ไปวางที่ Bookmarks Bar"
                    >
                      <Bookmark className="h-3.5 w-3.5" /> 📥 ลากปุ่มนี้ไปวางบนแถบ Bookmark Bar
                    </a>
                    <span className="text-[10px] text-slate-400">
                      (หรือคลิกเพื่อคัดลอกโค้ด)
                    </span>
                  </div>

                  {/* Compact secondary actions */}
                  <div className="flex items-center justify-between pt-1 border-t border-[#1e293b] text-[10px]">
                    <span className="text-slate-400">หรือใช้วิธีอื่น:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(consoleCode, "คัดลอกโค้ด Console แล้ว! วางใน F12 ได้เลย")}
                        className="px-2 py-1 rounded bg-[#141c2e] hover:bg-indigo-600/30 text-indigo-300 border border-[#1e293b] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Copy className="h-2.5 w-2.5" /> โค้ด Console
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard("node tools/kuaikan_sync.js", "คัดลอกคำสั่ง CLI เรียบร้อย!")}
                        className="px-2 py-1 rounded bg-[#141c2e] hover:bg-indigo-600/30 text-indigo-300 border border-[#1e293b] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        Node CLI
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab: WeChat QR Code */}
              {syncMethod === "qr" && (
                <div className="p-3 rounded-xl border border-[#1e293b] bg-[#101726] flex flex-col items-center justify-center space-y-2">
                  <div className="relative p-2 bg-white rounded-lg shadow border border-slate-200">
                    {qrLoading ? (
                      <div className="w-28 h-28 flex flex-col items-center justify-center gap-1 text-slate-700">
                        <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
                        <span className="text-[10px]">กำลังโหลด...</span>
                      </div>
                    ) : qrData?.qrUrl ? (
                      <div className="relative">
                        <img
                          src={qrData.qrUrl}
                          alt="KuaiKan WeChat QR"
                          className="w-28 h-28 object-contain rounded"
                        />
                        {scanState === "scanned" && (
                          <div className="absolute inset-0 bg-emerald-950/90 flex flex-col items-center justify-center text-white rounded p-1 text-center">
                            <CheckCircle2 className="h-6 w-6 text-emerald-400 mb-0.5" />
                            <span className="text-[10px] font-bold text-emerald-300">สแกนแล้ว!</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-28 h-28 flex flex-col items-center justify-center text-red-500">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-[10px]">ไม่สำเร็จ</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        scanState === "waiting"
                          ? "bg-amber-400 animate-pulse"
                          : scanState === "scanned"
                          ? "bg-blue-400 animate-ping"
                          : "bg-slate-500"
                      }`}
                    />
                    <span className="text-[11px] text-slate-300">{qrStatusText}</span>
                    <button
                      type="button"
                      onClick={loadQrCode}
                      disabled={qrLoading}
                      className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer ml-1"
                    >
                      <RefreshCw className="h-2.5 w-2.5" /> รีเฟรช
                    </button>
                  </div>
                </div>
              )}

              {/* Sub-tab: Manual Cookie */}
              {syncMethod === "cookie" && (
                <div className="p-3 rounded-xl border border-[#1e293b] bg-[#101726] space-y-2">
                  <Textarea
                    rows={2}
                    placeholder="วาง passToken=... หรือ connect.sid=..."
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    className="font-mono text-xs bg-[#070b14] border-[#1e293b] text-slate-200 resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      ก๊อปปี้ค่า <code>passToken</code> ในหน้าเว็บ KuaiKan
                    </span>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500"
                      onClick={handleSaveCookie}
                      disabled={savingCookie}
                    >
                      {savingCookie ? (
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      บันทึก
                    </Button>
                  </div>
                </div>
              )}

              {/* Sub-tab: Raw HTML Syntax Parser */}
              {syncMethod === "html" && (
                <div className="p-3 rounded-xl border border-indigo-500/25 bg-indigo-950/15 space-y-2">
                  <div className="text-[11px] text-slate-300">
                    ก๊อปปี้ Element <code>&lt;div class="imgList"&gt;...</code> หรือ <code>&lt;div class="img-box"&gt;...</code> จากหน้า Inspect Element มาวางที่นี่:
                  </div>
                  <Textarea
                    rows={3}
                    placeholder="วางโค้ด HTML ของตอน เช่น <div class=&quot;comicDetails&quot;>..."
                    value={htmlInput}
                    onChange={(e) => setHtmlInput(e.target.value)}
                    className="font-mono text-[10px] bg-[#070b14] border-[#1e293b] text-slate-200 resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      ระบบจะ Regex ดึงภาพ <code>/image/c855368/</code> ให้อัตโนมัติ
                    </span>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                      onClick={handleParseHtml}
                      disabled={parsingHtml}
                    >
                      {parsingHtml ? (
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      ดึงภาพจาก HTML
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TEST & DOWNLOAD VIEW */}
          {mainTab === "test" && (
            <div className="space-y-3">
              {/* Comic Info Card */}
              <div className="p-3 rounded-xl border border-indigo-500/20 bg-indigo-950/20 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    我！天命大反派 • 第366话
                  </div>
                  <div className="text-[10px] text-slate-400">
                    comicId: 855368 • ตอน VIP ล่าสุด
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={handleTestChapter}
                  disabled={testingChapter}
                  className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 shadow-sm"
                >
                  {testingChapter ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1" /> ตรวจสอบ...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-3 w-3 mr-1" /> ⚡ ทดสอบตอน 366
                    </>
                  )}
                </Button>
              </div>

              {/* Test Result Display */}
              {testResult ? (
                <div className="p-3 rounded-xl border border-[#1e293b] bg-[#101726] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-300">
                      {testResult.title || "第366话 真真假假"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        testResult.isVipUnlocked && testResult.imagesCount > 1
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-red-500/20 text-red-300 border border-red-500/30"
                      }`}
                    >
                      {testResult.isVipUnlocked && testResult.imagesCount > 1
                        ? `🎉 ปลดล็อคแล้ว (${testResult.imagesCount} ภาพ HD)`
                        : "🔒 ยังติดล็อค (ต้องใช้ VIP)"}
                    </span>
                  </div>

                  {/* Sample Gallery */}
                  {testResult.sampleImages && testResult.sampleImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {testResult.sampleImages.slice(0, 3).map((img: string, idx: number) => (
                        <div
                          key={idx}
                          className="relative rounded-lg overflow-hidden border border-[#1e293b] bg-black/50 h-16 flex items-center justify-center"
                        >
                          <img
                            src={normalizeKuaikanImageUrl(img)}
                            alt={`Sample ${idx + 1}`}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute bottom-0.5 right-1 bg-black/80 text-[8px] px-1 rounded text-white font-mono">
                            #{idx + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Target Folder Path Indicator */}
                  <div className="px-2.5 py-1.5 rounded-lg bg-[#070b14] border border-[#1e293b] text-[10px] text-slate-300 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <FolderOpen className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      <span className="text-slate-400">บันทึกลง:</span>
                      <span className="font-mono text-emerald-300 truncate">
                        แปลจนเมื่อย / {testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่"} / {testResult.title || "第366话"}
                      </span>
                    </div>
                    <a
                      href={`https://drive.google.com/drive/folders/${DRIVE_ROOT_FOLDER_ID}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 shrink-0 text-[10px] underline ml-2"
                    >
                      ดูโฟลเดอร์หลัก
                    </a>
                  </div>

                  {/* Actions: Stitch 20 pages or Download Raw */}
                  {testResult.isVipUnlocked && testResult.imagesCount > 1 && (
                    <div className="pt-2 border-t border-[#1e293b] space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        {/* Mode Selector */}
                        <div className="flex items-center rounded-lg border border-[#1e293b] bg-black/40 p-0.5 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setStitchMode("total20")}
                            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                              stitchMode === "total20"
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            แบ่งเป็น 20 หน้า (20 ไฟล์)
                          </button>
                          <button
                            type="button"
                            onClick={() => setStitchMode("slices20")}
                            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                              stitchMode === "slices20"
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            ไฟล์ละ 20 ชิ้น (~7 ไฟล์)
                          </button>
                        </div>

                        <div className="flex items-center gap-2 flex-1">
                          <Button
                            size="sm"
                            onClick={handleStitchAndUpload}
                            disabled={stitching || downloading}
                            className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md shadow-emerald-950 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {stitching ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />
                                กำลังเย็บ & อัปโหลด...
                              </>
                            ) : (
                              <>
                                <Scissors className="h-3.5 w-3.5 mr-1" />
                                {stitchMode === "total20"
                                  ? "เย็บแบ่งเป็น 20 หน้า & เซฟลง Drive"
                                  : "เย็บไฟล์ละ 20 ชิ้น & เซฟลง Drive"}
                              </>
                            )}
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDownloadChapter}
                            disabled={stitching || downloading}
                            className="h-8 text-xs border-[#1e293b] bg-[#141c2e] hover:bg-slate-800 text-slate-200 shrink-0"
                            title="ดาวน์โหลดภาพดิบทั้งหมดแยกเป็นไฟล์เดี่ยวๆ"
                          >
                            {downloading ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Download className="h-3 w-3 mr-1" /> Raw ({testResult.imagesCount})
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400 text-center">
                        ✂️ {stitchMode === "total20"
                          ? "คำนวณรวมภาพทั้งหมดออกมาให้ได้ 20 หน้าพอดี (ความกว้างมาตรฐานเท่ากัน)"
                          : "เย็บรวมภาพส่วนละ 20 ชิ้น (ความกว้างมาตรฐานเท่ากัน)"}
                      </div>
                    </div>
                  )}

                  {/* Live Stitching Progress */}
                  {stitching && stitchProgress && (
                    <div className="p-3 rounded-xl border border-indigo-500/30 bg-indigo-950/30 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 animate-bounce" />
                          Part {stitchProgress.currentPart} / {stitchProgress.totalParts}
                        </span>
                        <span className="text-[11px] font-mono text-emerald-400">
                          {stitchProgress.percent}%
                        </span>
                      </div>
                      <div className="w-full bg-[#0b101b] rounded-full h-2 overflow-hidden border border-[#1e293b]">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(stitchProgress.percent, 5)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{stitchProgress.pageRange}</span>
                        <span className="text-slate-300">{stitchProgress.statusText}</span>
                      </div>
                    </div>
                  )}

                  {/* Stitch Complete Success Link */}
                  {!stitching && stitchProgress && stitchProgress.percent === 100 && (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        เย็บและบันทึกลง Google Drive สำเร็จครบทั้ง {stitchProgress.totalParts} ส่วน!
                      </div>
                      <div className="text-[11px] text-slate-300">
                        ไฟล์ถูกบันทึกไว้ในโฟลเดอร์ <b>แปลจนเมื่อย / {testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่"} / {testResult.title || "第366话"}</b>
                      </div>
                      {stitchProgress.folderUrl && (
                        <a
                          href={stitchProgress.folderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow transition-colors"
                        >
                          <FolderOpen className="h-3.5 w-3.5" /> เปิดโฟลเดอร์ใน Google Drive
                        </a>
                      )}
                    </div>
                  )}

                  {/* Raw Download Result Link */}
                  {downloadResult && downloadResult.success && (
                    <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-[11px] flex items-center justify-between">
                      <span>✓ โหลดภาพดิบแล้ว {downloadResult.downloadedCount} ภาพ!</span>
                      {downloadResult.folderUrl && (
                        <a
                          href={downloadResult.folderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <FolderOpen className="h-3 w-3" /> เปิดใน Drive
                        </a>
                      )}
                    </div>
                  )}

                  {/* Drive Permission Authorization Alert */}
                  {driveAuthError && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                        ต้องกดอนุญาตสิทธิ์ Google Drive ใน Apps Script 1 ครั้ง
                      </div>
                      <div className="text-[11px] text-slate-300 leading-relaxed">
                        เนื่องจาก Google Apps Script เพิ่มสิทธิ์เข้าถึง Google Drive กรุณาเปิด Apps Script แล้วรันฟังก์ชัน <b>AUTHORIZE_DRIVE</b> เพื่อกดยืนยันสิทธิ์:
                      </div>
                      <a
                        href="https://script.google.com/home/projects/1W-7_ngf3zkLJjCJB4Mm_CJxNyzgQAlD49kaUZQ6iNcaKnM6ntrZaICs5/edit"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> เปิด Apps Script เพื่อกด AUTHORIZE_DRIVE
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-5 rounded-xl border border-dashed border-[#1e293b] bg-[#101726]/40 text-center text-xs text-slate-400 flex flex-col items-center gap-1.5">
                  <ImageIcon className="h-5 w-5 text-slate-500" />
                  <span>กดปุ่ม <b>"⚡ ทดสอบตอน 366"</b> เพื่อทดสอบปลดล็อคภาพ HD</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

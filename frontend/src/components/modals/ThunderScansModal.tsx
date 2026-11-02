import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  FolderOpen,
  Image as ImageIcon,
  LogOut,
  Copy,
  BookOpen,
  Scissors,
  Layers,
  AlertTriangle,
  Lock,
  Globe,
  Sparkles,
  Bookmark,
} from "lucide-react"

interface ThunderScansModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialChapterUrl?: string
}

const DEFAULT_CHAPTER_URL =
  "https://en-thunderscans.com/the-clans-failure-is-a-former-continental-champion-chapter-62/"

const DRIVE_ROOT_FOLDER_ID = "1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_"
const STORAGE_COOKIE_KEY = "thunderscans_session_cookie"

const proxyCache = new Map<string, string>()

export async function loadThunderScansImageElement(
  url: string,
  onRetryNotice?: (text: string) => void
): Promise<HTMLImageElement | null> {
  if (!url) return null

  // 1. Check if we already have a proxied dataUrl in cache
  const cachedDataUrl = proxyCache.get(url)
  if (cachedDataUrl) {
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error("Cached Data URL failed to load"))
        image.src = cachedDataUrl
      })
    } catch {}
  }

  // 2. Try direct load with crossOrigin = "anonymous" first (fastest if CDN supports it)
  try {
    const directImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = "anonymous"
      image.referrerPolicy = "no-referrer"

      const timer = setTimeout(() => {
        image.onload = null
        image.onerror = null
        reject(new Error("Timeout direct load"))
      }, 3500)

      image.onload = () => {
        clearTimeout(timer)
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve(image)
        } else {
          reject(new Error("Width is 0"))
        }
      }

      image.onerror = () => {
        clearTimeout(timer)
        reject(new Error("CORS or network error"))
      }

      image.src = url
    })

    return directImg
  } catch (err: any) {
    console.info(`[loadThunderScansImageElement] Direct CORS load skipped (${err.message}), using GAS Proxy fallback for: ${url}`)
  }

  // 3. Fallback: Proxy via GAS API to bypass CORS without tainting Canvas
  const maxAttempts = 3
  let attempt = 1

  while (attempt <= maxAttempts) {
    try {
      if (onRetryNotice) {
        onRetryNotice(`🔄 กำลังโหลดภาพผ่านระบบ GAS Proxy เพื่อแก้ไขปัญหา CORS (ครั้งที่ ${attempt}/${maxAttempts})...`)
      }

      const proxyRes = await callGasApi<any>("PROXY_THUNDERSCANS_IMAGE", { imageUrl: url })
      if (!proxyRes || !proxyRes.dataUrl) {
        throw new Error(proxyRes?.error || "Proxy API did not return dataUrl")
      }

      const dataUrl = proxyRes.dataUrl
      proxyCache.set(url, dataUrl)

      const proxiedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        const timer = setTimeout(() => {
          image.onload = null
          image.onerror = null
          reject(new Error("Timeout proxied image load"))
        }, 12000)

        image.onload = () => {
          clearTimeout(timer)
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            resolve(image)
          } else {
            reject(new Error("Proxied image width is 0"))
          }
        }

        image.onerror = () => {
          clearTimeout(timer)
          reject(new Error("Proxied image onerror"))
        }

        image.src = dataUrl
      })

      return proxiedImg
    } catch (proxyErr: any) {
      console.warn(`[loadThunderScansImageElement] Proxy Retry #${attempt}/${maxAttempts} for ${url}:`, proxyErr.message)
      if (onRetryNotice) {
        onRetryNotice(`⚠️ Proxy กำลัง Retry ภาพ (${attempt}/${maxAttempts})...`)
      }
      attempt++
      if (attempt <= maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }

  console.warn(`[loadThunderScansImageElement] ข้ามภาพที่ไม่สามารถโหลดได้แม้ผ่าน Proxy: ${url}`)
  return null
}

export function ThunderScansModal({
  open,
  onClose,
  onSuccess,
  initialChapterUrl,
}: ThunderScansModalProps) {
  // Main view tab: "test" (Inspect & Stitch) vs "auth" (Google Cookie) vs "html" (Paste Syntax)
  const [activeTab, setActiveTab] = React.useState<"test" | "auth" | "html" | "bookmarklet">("test")

  // Chapter URL State
  const [chapterUrl, setChapterUrl] = React.useState(initialChapterUrl || DEFAULT_CHAPTER_URL)

  // Session State
  const [cookieInput, setCookieInput] = React.useState("")
  const [savedCookie, setSavedCookie] = React.useState("")
  const [loadingSession, setLoadingSession] = React.useState(false)
  const [savingCookie, setSavingCookie] = React.useState(false)
  const [sessionStatus, setSessionStatus] = React.useState<{
    loggedIn: boolean
    isGoogleLoggedIn?: boolean
    updatedAt?: string
    cookiePreview?: string
    message?: string
  } | null>(null)

  // Fetch / Inspect State
  const [testingChapter, setTestingChapter] = React.useState(false)
  const [testResult, setTestResult] = React.useState<any | null>(null)

  // HTML syntax parser state
  const [htmlInput, setHtmlInput] = React.useState("")
  const [parsingHtml, setParsingHtml] = React.useState(false)

  // Stitch Mode: "total20" (20 proportional pages) vs "slices20" (20 slices per page)
  const [stitchMode, setStitchMode] = React.useState<"total20" | "slices20">("total20")

  // Live Stitch & Upload State
  const [stitching, setStitching] = React.useState(false)
  const [stitchProgress, setStitchProgress] = React.useState<{
    currentPart: number
    totalParts: number
    pageRange: string
    percent: number
    statusText: string
    folderUrl?: string
    liveCanvasPreview?: string
  } | null>(null)
  const [driveAuthError, setDriveAuthError] = React.useState<string | null>(null)

  // Load session from backend & localStorage on open
  const fetchSessionStatus = React.useCallback(async () => {
    setLoadingSession(true)
    try {
      // 1. Try fetching from GAS backend
      let backendRes: any = null
      try {
        backendRes = await callGasApi<any>("GET_THUNDERSCANS_AUTH")
      } catch (e) {
        console.warn("Backend GET_THUNDERSCANS_AUTH warning:", e)
      }

      // 2. Read local client storage
      const localCookie = localStorage.getItem(STORAGE_COOKIE_KEY) || ""
      setSavedCookie(localCookie)

      if (backendRes && backendRes.loggedIn) {
        setSessionStatus(backendRes)
        if (!localCookie && backendRes.cookiePreview) {
          // Sync if local is empty
        }
      } else if (localCookie) {
        const isGoogle = localCookie.includes("wordpress_logged_in")
        setSessionStatus({
          loggedIn: true,
          isGoogleLoggedIn: isGoogle,
          cookiePreview: localCookie.length > 25 ? localCookie.substring(0, 25) + "..." : localCookie,
          message: isGoogle ? "ตรวจพบคุกกี้ Google Login จากเบราว์เซอร์" : "พบคุกกี้ที่บันทึกไว้",
        })
      } else {
        setSessionStatus({ loggedIn: false })
      }
    } catch (err: any) {
      console.error("fetchSessionStatus error:", err)
      setSessionStatus({ loggedIn: false })
    } finally {
      setLoadingSession(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      fetchSessionStatus()
      if (initialChapterUrl) {
        setChapterUrl(initialChapterUrl)
      }
    }
  }, [open, initialChapterUrl, fetchSessionStatus])

  // Save Cookie
  const handleSaveCookie = async (overrideValue?: string) => {
    const val = (overrideValue !== undefined ? overrideValue : cookieInput).trim()
    if (!val) {
      toast.error("กรุณาวาง Cookie (เช่น wordpress_logged_in_...=...)")
      return
    }

    setSavingCookie(true)
    try {
      // 1. Save in local client storage immediately
      localStorage.setItem(STORAGE_COOKIE_KEY, val)
      setSavedCookie(val)

      // 2. Sync to GAS backend
      try {
        await callGasApi<any>("SAVE_THUNDERSCANS_AUTH", {
          directCookie: val,
          chapterUrl: chapterUrl,
        })
      } catch (beErr) {
        console.warn("GAS save ThunderScans auth fallback:", beErr)
      }

      const isGoogle = val.includes("wordpress_logged_in")
      toast.success(
        isGoogle
          ? "🎉 บันทึก Cookie บัญชี Google เรียบร้อยแล้ว! พร้อมเข้าถึงตอนที่ซื้อ"
          : "บันทึก Cookie เรียบร้อยแล้ว!"
      )
      setCookieInput("")
      fetchSessionStatus()
      setActiveTab("test")
      if (onSuccess) onSuccess()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึก Cookie")
    } finally {
      setSavingCookie(false)
    }
  }

  // Clear Cookie
  const handleClearCookie = async () => {
    if (!confirm("ต้องการยกเลิกการเชื่อมต่อ Cookie ของ ThunderScans ใช่หรือไม่?")) return
    try {
      localStorage.removeItem(STORAGE_COOKIE_KEY)
      setSavedCookie("")
      try {
        await callGasApi("CLEAR_THUNDERSCANS_AUTH")
      } catch {}
      setSessionStatus({ loggedIn: false })
      toast.info("ล้างคุกกี้เรียบร้อยแล้ว (สามารถดึงตอนฟรีได้ตามปกติ)")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    }
  }

  // Fetch & Inspect Images
  const handleFetchChapter = async () => {
    const url = chapterUrl.trim()
    if (!url) {
      toast.error("กรุณาระบุ Chapter URL ของ ThunderScans")
      return
    }

    setTestingChapter(true)
    setTestResult(null)
    setDriveAuthError(null)

    try {
      const activeCookie = savedCookie || cookieInput.trim()

      const res = await callGasApi<any>("TEST_THUNDERSCANS_CHAPTER", {
        chapterUrl: url,
        cookie: activeCookie,
      })

      setTestResult(res)

      if (res && res.success) {
        if (res.isLocked && (!res.allImages || res.allImages.length === 0)) {
          toast.warning("ตอนถูกล็อค (ต้องเข้าสู่ระบบ Google ที่ซื้อตอนแล้ววาง Cookie Session)")
          setActiveTab("auth")
        } else if (res.imagesCount > 0) {
          toast.success(`🎉 สกัดภาพสำเร็จ! พบทั้งหมด ${res.imagesCount} ชิ้นภาพ`)
        } else {
          toast.info("ดึงหน้าสำเร็จ แต่ไม่พบภาพใน readerarea กรุณาตรวจสอบลิงก์ตอนหรือวางโค้ด HTML")
        }
      } else {
        toast.error(res?.error || "ไม่สามารถดึงข้อมูลตอนได้")
      }
    } catch (err: any) {
      console.error("handleFetchChapter error:", err)
      toast.error(err.message || "เกิดข้อผิดพลาดในการดึงภาพ กรุณาตรวจสอบ URL หรือใช้แท็บแกะโค้ด HTML")
    } finally {
      setTestingChapter(false)
    }
  }

  // Parse Raw HTML Syntax from Reader Area
  const handleParseHtml = async () => {
    if (!htmlInput.trim()) {
      toast.error("กรุณาวางโค้ด HTML เช่น <div id=\"readerarea\">... หรือโค้ดหน้าเว็บ")
      return
    }

    setParsingHtml(true)
    try {
      const urls: string[] = []
      // 1. Regex หา src, data-src, data-lazy-src
      const imgRegex = /<img[^>]+(?:data-lazy-src|data-src|src)=["'](https?:\/\/[^"'>\s]+)["'][^>]*>/gi
      let m: RegExpExecArray | null
      while ((m = imgRegex.exec(htmlInput)) !== null) {
        const u = m[1].replace(/&amp;/g, "&")
        if (!u.match(/(?:logo|avatar|favicon|icon|banner|ads|sponsor)/i) && !urls.includes(u)) {
          urls.push(u)
        }
      }

      // 2. Fallback regex หากเป็น plain URLs
      if (urls.length === 0) {
        const plainRegex = /https?:\/\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png)(?:\?[^\s"'<>]*)?/gi
        let m2: RegExpExecArray | null
        while ((m2 = plainRegex.exec(htmlInput)) !== null) {
          const u = m2[0].replace(/&amp;/g, "&")
          if (!u.match(/(?:logo|avatar|favicon|icon|banner|ads)/i) && !urls.includes(u)) {
            urls.push(u)
          }
        }
      }

      if (urls.length === 0) {
        toast.error("ไม่พบลิงก์ภาพมังงะในโค้ด HTML ที่วาง")
        return
      }

      // สกัด title
      let detectedTitle = "ThunderScans Chapter"
      const titleMatch = htmlInput.match(/<title>(.*?)<\/title>/i)
      if (titleMatch && titleMatch[1]) {
        detectedTitle = titleMatch[1].replace(/&#8211;/g, "-").replace(/&#8217;/g, "'").split(" - ")[0].trim()
      }

      const parsedResult = {
        success: true,
        chapterUrl: chapterUrl,
        mangaName: "The Clan's Failure Is a Former Continental Champion",
        thaiTitle: "อดีตแชมป์ทวีปผู้ไร้ค่าของตระกูล",
        mangaId: "4",
        chapter: detectedTitle.includes("Chapter") ? detectedTitle : "Chapter 62",
        title: detectedTitle,
        isLocked: false,
        isGoogleLoggedIn: Boolean(savedCookie.includes("wordpress_logged_in")),
        imagesCount: urls.length,
        allImages: urls,
        sampleImages: urls.slice(0, 6),
      }

      setTestResult(parsedResult)
      toast.success(`🎉 สกัดภาพจาก HTML สำเร็จ ${urls.length} ชิ้นภาพ!`)
      setHtmlInput("")
      setActiveTab("test")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการแกะโค้ด HTML")
    } finally {
      setParsingHtml(false)
    }
  }

  // VIP Stitch & Upload to Google Drive (Continuous Vertical Stitching & Slicing into 20 Proportional Pages)
  const handleStitchAndUpload = async () => {
    if (!testResult) {
      toast.error("กรุณากดทดสอบดึงตอนก่อน")
      return
    }

    const rawUrls: string[] = testResult.allImages || testResult.images || testResult.sampleImages || []
    if (!rawUrls.length) {
      toast.error("ไม่พบรายการภาพสำหรับเย็บ กรุณากดทดสอบดึงตอนอีกครั้ง")
      return
    }

    const totalPages = rawUrls.length
    // In total20 mode, target is always exactly 20 pages!
    const targetParts = stitchMode === "slices20" ? Math.ceil(totalPages / 20) : 20

    setStitching(true)
    setDriveAuthError(null)
    setStitchProgress({
      currentPart: 0,
      totalParts: targetParts,
      pageRange: `เตรียมการเย็บต่อเนื่อง ${targetParts} หน้า`,
      percent: 3,
      statusText: `กำลังดาวน์โหลดและวิเคราะห์ชิ้นภาพทั้งหมด ${totalPages} ชิ้น...`,
    })

    let uploadedCount = 0

    try {
      // 1. Download and load all raw slice images
      const loadedSlices = await Promise.all(
        rawUrls.map((u, i) =>
          loadThunderScansImageElement(u, (notice) => {
            setStitchProgress((prev) =>
              prev ? { ...prev, statusText: `ชิ้นที่ ${i + 1}/${totalPages}: ${notice}` } : null
            )
          })
        )
      )

      const validSlices: HTMLImageElement[] = []
      for (let i = 0; i < loadedSlices.length; i++) {
        const img = loadedSlices[i]
        if (!img) {
          throw new Error(`ไม่สามารถโหลดชิ้นภาพที่ ${i + 1} จากทั้งหมด ${totalPages} ชิ้นได้ กรุณาลองใหม่อีกครั้ง`)
        }
        validSlices.push(img)
      }

      // 2. Dynamic slice #15 canvas width measurement
      const sampleIdx = validSlices.length >= 15 ? 14 : Math.floor(validSlices.length / 2)
      const standardWidth = validSlices[sampleIdx].naturalWidth || validSlices[0].naturalWidth || 1280

      // 3. Calculate continuous vertical layout of all slices
      interface SliceLayout {
        img: HTMLImageElement
        scaledH: number
        yTop: number
        yBottom: number
        scale: number
      }

      let runningY = 0
      const sliceLayouts: SliceLayout[] = []

      for (let i = 0; i < validSlices.length; i++) {
        const img = validSlices[i]
        const scale = standardWidth / img.naturalWidth
        const scaledH = Math.round(img.naturalHeight * scale)
        sliceLayouts.push({
          img,
          scaledH,
          yTop: runningY,
          yBottom: runningY + scaledH,
          scale,
        })
        runningY += scaledH
      }

      const totalChapterHeight = runningY
      if (totalChapterHeight <= 0) {
        throw new Error("ความสูงรวมของมังงะเป็น 0 ไม่สามารถเย็บภาพได้")
      }

      const totalParts = targetParts
      const pageTargetHeight = Math.ceil(totalChapterHeight / totalParts)

      toast.info(
        `📏 ความกว้างมาตรฐาน: ${standardWidth}px | ความสูงรวม: ${totalChapterHeight.toLocaleString()}px (${totalPages} ชิ้น) ➔ ซอยเป็น ${totalParts} หน้า (~${pageTargetHeight.toLocaleString()}px/หน้า)`
      )

      let lastFolderUrl = ""

      // 4. Pre-Render All 20 Proportional Pages in Memory
      interface PreRenderedPage {
        partNum: number
        fileName: string
        mimeType: string
        base64Data: string
        canvasH: number
        thumbnailDataUrl?: string
      }

      const preRenderedPages: PreRenderedPage[] = []

      for (let partIdx = 0; partIdx < totalParts; partIdx++) {
        const partNum = partIdx + 1
        const yPageStart = partIdx * pageTargetHeight
        const yPageEnd = Math.min((partIdx + 1) * pageTargetHeight, totalChapterHeight)
        const canvasH = yPageEnd - yPageStart

        if (canvasH <= 0) continue

        const partRange = `หน้า ${partNum}/${totalParts} (Y: ${yPageStart.toLocaleString()} - ${yPageEnd.toLocaleString()}px, สูง ${canvasH.toLocaleString()}px)`

        setStitchProgress((prev) => ({
          currentPart: partNum,
          totalParts,
          pageRange: partRange,
          percent: Math.round(((partIdx + 1) / totalParts) * 25),
          statusText: `⚡ [10x Speedup] กำลังตัดเย็บและเรนเดอร์หน้า ${String(partNum).padStart(3, "0")}.jpg (${partNum}/${totalParts})...`,
          liveCanvasPreview: prev?.liveCanvasPreview,
        }))

        // 4.1 Create Canvas for this page
        const canvas = document.createElement("canvas")
        canvas.width = standardWidth
        canvas.height = canvasH
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("ไม่สามารถสร้าง 2D Canvas ได้")

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"

        // 4.2 Draw all slices that overlap with [yPageStart, yPageEnd]
        for (const slice of sliceLayouts) {
          if (slice.yBottom <= yPageStart || slice.yTop >= yPageEnd) {
            continue
          }

          const yOverlapStart = Math.max(slice.yTop, yPageStart)
          const yOverlapEnd = Math.min(slice.yBottom, yPageEnd)
          const drawH = yOverlapEnd - yOverlapStart

          if (drawH <= 0) continue

          const dy = yOverlapStart - yPageStart
          const dh = drawH
          const dx = 0
          const dw = standardWidth

          const sliceTopOffset = yOverlapStart - slice.yTop
          const sy = sliceTopOffset / slice.scale
          const sh = drawH / slice.scale
          const sx = 0
          const sw = slice.img.naturalWidth

          ctx.drawImage(slice.img, sx, sy, sw, sh, dx, dy, dw, dh)
        }

        // 4.3 Generate small live canvas preview thumbnail
        let thumbnailDataUrl: string | undefined
        try {
          const thumbCanvas = document.createElement("canvas")
          thumbCanvas.width = 160
          thumbCanvas.height = Math.round((canvasH / standardWidth) * 160)
          const thumbCtx = thumbCanvas.getContext("2d")
          if (thumbCtx) {
            thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height)
            thumbnailDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.6)
          }
        } catch {}

        // 4.4 Export blob
        const fileName = `${String(partNum).padStart(3, "0")}.jpg`
        const mimeType = "image/jpeg"

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("สร้าง JPEG blob ไม่สำเร็จ"))),
            mimeType,
            0.88
          )
        })

        // Free canvas memory
        canvas.width = 0
        canvas.height = 0

        // 4.5 Convert to Base64
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
          canvasH,
          thumbnailDataUrl,
        })
      }

      // 5. Smart Staged Multi-Thread Uploading
      // Phase A: หน้า 1 สร้างโฟลเดอร์ Google Drive
      const p1 = preRenderedPages[0]
      setStitchProgress({
        currentPart: 1,
        totalParts,
        pageRange: `หน้า 1/${totalParts}`,
        percent: 30,
        statusText: `🚀 [Phase A] กำลังอัปโหลด ${p1.fileName} เพื่อสร้างโฟลเดอร์ Google Drive...`,
        liveCanvasPreview: p1.thumbnailDataUrl,
      })

      const resP1 = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
        mangaName: testResult.thaiTitle || testResult.mangaName || "The Clan's Failure Is a Former Continental Champion",
        chapter: testResult.chapter || "Chapter 62",
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
      })

      if (resP1 && resP1.error) {
        throw new Error(resP1.error)
      }

      lastFolderUrl = resP1?.data?.folderUrl || resP1?.folderUrl || ""
      uploadedCount++

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
          liveCanvasPreview: middlePages[0]?.thumbnailDataUrl,
        })

        const uploadWorker = async (page: PreRenderedPage) => {
          let attempt = 1
          while (attempt <= 3) {
            try {
              const r = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
                mangaName: testResult.thaiTitle || testResult.mangaName || "The Clan's Failure Is a Former Continental Champion",
                chapter: testResult.chapter || "Chapter 62",
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
              })
              if (r && r.error) throw new Error(r.error)
              middleUploaded++
              uploadedCount++
              setStitchProgress((prev) => ({
                currentPart: page.partNum,
                totalParts,
                pageRange: `หน้า ${page.partNum}/${totalParts}`,
                percent: 30 + Math.round((middleUploaded / middlePages.length) * 55),
                statusText: `✓ [Phase B] หน้า ${String(page.partNum).padStart(3, "0")}.jpg อัปโหลดสำเร็จ (${middleUploaded}/${middlePages.length})...`,
                liveCanvasPreview: page.thumbnailDataUrl,
              }))
              return
            } catch (e) {
              attempt++
              if (attempt > 3) throw e
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
            }
          }
        }

        // Run with concurrency limit of 4
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
          liveCanvasPreview: pLast.thumbnailDataUrl,
        })

        const resLast = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
          mangaName: testResult.thaiTitle || testResult.mangaName || "The Clan's Failure Is a Former Continental Champion",
          chapter: testResult.chapter || "Chapter 62",
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
        uploadedCount++
      }

      if (uploadedCount === 0) {
        throw new Error("ไม่มีไฟล์ภาพที่อัปโหลดสำเร็จขึ้น Google Drive กรุณาตรวจสอบสิทธิ์การเข้าถึงหรือลองใหม่อีกครั้ง")
      }

      setStitchProgress({
        currentPart: totalParts,
        totalParts,
        pageRange: `ครบทั้ง ${totalParts} หน้าพอดี (ความสูงรวม ${totalChapterHeight.toLocaleString()}px)`,
        percent: 100,
        statusText: `เย็บแนวตั้งและซอยเป็น ${totalParts} หน้ามาตรฐานเสร็จสิ้นแล้ว! นำเข้า WorkQueue อัตโนมัติ`,
        folderUrl: lastFolderUrl || `https://drive.google.com/drive/folders/${DRIVE_ROOT_FOLDER_ID}`,
      })

      toast.success(`🎉 เย็บต่อเนื่องและแบ่งเป็น ${totalParts} หน้า (001.jpg - ${String(totalParts).padStart(3, "0")}.jpg) บันทึกลง แปลจนเมื่อย สำเร็จ!`)
      if (onSuccess) onSuccess()
    } catch (err: any) {
      console.error("handleStitchAndUpload error:", err)
      if (
        err.message &&
        (err.message.includes("DriveApp") ||
          err.message.includes("คุณไม่ได้รับอนุญาต") ||
          err.message.includes("permission"))
      ) {
        setDriveAuthError(err.message)
      }
      toast.error(err.message || "เกิดข้อผิดพลาดในการเย็บภาพ")
    } finally {
      setStitching(false)
    }
  }

  // Bookmarklet code for 1-Click extraction on en-thunderscans.com
  const bookmarkletCode = React.useMemo(() => {
    return `javascript:(function(){try{var c=document.cookie;var imgs=[];var sel='#readerarea img,.reading-content img,.entry-content img,.ts-main-image img,#chapter-images img';var list=document.querySelectorAll(sel);if(!list.length)list=document.querySelectorAll('img[src*="wp-content/uploads"],img[data-src*="wp-content/uploads"]');list.forEach(function(img){var u=img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.src;if(u&&imgs.indexOf(u)===-1&&!u.match(/(?:logo|avatar|banner|favicon|icon|advert)/i))imgs.push(u);});var t=document.querySelector('h1,.entry-title')?.innerText?.trim()||document.title;var u='https://script.google.com/macros/s/AKfycbzG1H1eBoTsF7Omfso8v23N6HidWXU4kS-yyf0xDunb2BoZgPiUYPIOO2vMLSvYWwHsnw/exec';fetch(u,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'SAVE_THUNDERSCANS_AUTH',passcode:'10211032',payload:{directCookie:c,chapterUrl:window.location.href,title:t,images:imgs}})}).then(function(){alert('🎉 ดึงภาพ ThunderScans สำเร็จ '+imgs.length+' ภาพ และส่งให้ MangaHub เรียบร้อยแล้ว!');}).catch(function(e){alert('Error: '+e.message);});}catch(e){alert('Error: '+e.message);}})();`
  }, [])

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text)
    toast.success(msg)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[94vw] max-w-2xl bg-[#0b101b] border-[#1e293b] text-slate-100 p-0 overflow-hidden shadow-2xl rounded-2xl gap-0">
        {/* Modal Header */}
        <DialogHeader className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between bg-gradient-to-r from-amber-950/30 via-[#101726] to-[#0b101b]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shrink-0 shadow-inner">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                ⚡ ThunderScans EN
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold">
                  en-thunderscans.com
                </Badge>
              </DialogTitle>
              <div className="text-[11px] text-slate-400 mt-0.5">
                ดึงมังงะต้นฉบับอังกฤษ • รองรับตอนฟรี & บัญชี Google • Auto-Stitch 20 หน้าลง Google Drive
              </div>
            </div>
          </div>

          {/* Status Badge in Header */}
          <div className="flex items-center gap-2 pr-6">
            {loadingSession ? (
              <span className="text-[11px] text-slate-400 animate-pulse">ตรวจสถานะ...</span>
            ) : sessionStatus?.loggedIn ? (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {sessionStatus.isGoogleLoggedIn ? "Google Login Active" : "Cookie พร้อมใช้งาน"}
                </span>
                <button
                  type="button"
                  onClick={handleClearCookie}
                  className="text-slate-400 hover:text-red-400 p-1 transition-colors cursor-pointer"
                  title="ล้าง Cookie"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 border border-slate-700 text-slate-300">
                <Globe className="h-3.5 w-3.5 text-amber-400" />
                ตอนฟรี / พร้อมดึงภาพ
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Tab Navigation Switcher */}
        <div className="px-5 pt-3 pb-0 bg-[#0b101b]">
          <div className="flex rounded-lg bg-[#141c2e] p-1 border border-[#1e293b]">
            <button
              type="button"
              onClick={() => setActiveTab("test")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                activeTab === "test"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Zap className="h-3.5 w-3.5" /> ทดสอบดึงภาพ & เย็บลง Drive
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("auth")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                activeTab === "auth"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Lock className="h-3.5 w-3.5" /> บัญชี Google & Cookie
              {sessionStatus?.loggedIn && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-1" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("html")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                activeTab === "html"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Scissors className="h-3.5 w-3.5" /> แกะโค้ด HTML
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("bookmarklet")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                activeTab === "bookmarklet"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" /> 1-Click Bookmarklet
            </button>
          </div>
        </div>

        {/* Modal Body Container */}
        <div className="p-5 pt-3 min-h-[280px] max-h-[75vh] overflow-y-auto space-y-4">
          {/* TAB 1: TEST ENGINE & DRIVE STITCHING */}
          {activeTab === "test" && (
            <div className="space-y-4">
              {/* Chapter URL Input Bar */}
              <div className="rounded-xl border border-[#26334d] bg-[#101726] p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-amber-400" />
                    ระบุลิงก์ตอนที่ต้องการดึง (ThunderScans Chapter URL):
                  </span>
                  <a
                    href="https://en-thunderscans.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-amber-400 hover:underline inline-flex items-center gap-1"
                  >
                    เปิด en-thunderscans.com <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Input
                    value={chapterUrl}
                    onChange={(e) => setChapterUrl(e.target.value)}
                    placeholder="https://en-thunderscans.com/the-clans-failure-is-a-former-continental-champion-chapter-62/"
                    className="flex-1 h-9 bg-[#070b14] border-[#26334d] text-xs font-mono text-slate-200"
                  />
                  <Button
                    size="sm"
                    onClick={handleFetchChapter}
                    disabled={testingChapter || stitching}
                    className="h-9 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 shadow-md cursor-pointer"
                  >
                    <Zap className={`h-3.5 w-3.5 mr-1.5 ${testingChapter ? "animate-spin" : ""}`} />
                    {testingChapter ? "กำลังดึงภาพ..." : "ทดสอบดึงภาพ (Fetch & Inspect)"}
                  </Button>
                </div>

                {/* Target Drive folder notice */}
                <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                  <span className="text-slate-300">
                    ปลายทาง Drive: <strong className="text-amber-300 font-mono">แปลจนเมื่อย / {testResult?.thaiTitle || testResult?.mangaName || "The Clan's Failure Is a Former Continental Champion"} / {testResult?.chapter || "Chapter 62"}</strong>
                  </span>
                  <span className="text-[11px] text-emerald-400">
                    ✓ รองรับดึงตอนฟรี หรือใช้ Cookie Google สำหรับตอนที่ซื้อ
                  </span>
                </div>
              </div>

              {/* Test Results Display */}
              {testResult && (
                <div className="rounded-xl border border-[#26334d] bg-[#101726] p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#26334d] pb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">
                          {testResult.title || testResult.chapter || "Chapter 62"}
                        </span>
                        {testResult.isLocked ? (
                          <Badge variant="destructive" className="text-[10px] flex items-center gap-1">
                            <Lock className="h-3 w-3" /> ตอนถูกล็อค (ต้องใช้ Cookie บัญชีที่ซื้อแล้ว)
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                            ✓ ปลดล็อคแล้ว (พร้อมดึงภาพ)
                          </Badge>
                        )}
                        {testResult.isGoogleLoggedIn && (
                          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[10px]">
                            Google Session
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        สกัดพบชิ้นส่วนภาพทั้งหมด: <strong className="text-amber-400 font-semibold">{testResult.imagesCount} ชิ้น</strong>{" "}
                        (จะเย็บแนวตั้งต่อเนื่องแล้วซอยแบ่งเป็น <strong className="text-emerald-400 font-semibold">20 หน้ามาตรฐานพอดี</strong> 001.jpg - 020.jpg)
                      </p>
                    </div>

                    {/* Mode selector and Stitch Trigger */}
                    {testResult.imagesCount > 0 && !testResult.isLocked && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex items-center rounded-lg border border-[#26334d] bg-[#070b14] p-0.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setStitchMode("total20")}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              stitchMode === "total20"
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            ซอยแบ่งเป็น 20 หน้า (20 ไฟล์)
                          </button>
                          <button
                            type="button"
                            onClick={() => setStitchMode("slices20")}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              stitchMode === "slices20"
                                ? "bg-indigo-600 text-white font-bold"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            ไฟล์ละ 20 ชิ้น
                          </button>
                        </div>

                        <Button
                          size="sm"
                          onClick={handleStitchAndUpload}
                          disabled={stitching}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md text-xs gap-1.5 cursor-pointer"
                        >
                          <Layers className={`h-3.5 w-3.5 ${stitching ? "animate-spin" : ""}`} />
                          {stitching
                            ? "กำลังเย็บและอัปโหลด..."
                            : stitchMode === "total20"
                            ? "เย็บซอยเป็น 20 หน้าพอดี & ส่งขึ้น Drive"
                            : "เย็บไฟล์ละ 20 ชิ้น & ส่งขึ้น Drive"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Sample Gallery */}
                  {testResult.sampleImages && testResult.sampleImages.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                        ตัวอย่างภาพที่สกัดได้จาก ThunderScans:
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {testResult.sampleImages.slice(0, 6).map((imgUrl: string, idx: number) => (
                          <div
                            key={idx}
                            className="aspect-[3/4] rounded-lg border border-[#26334d] bg-[#070b14] overflow-hidden relative group"
                          >
                            <img
                              src={imgUrl}
                              alt={`Slice ${idx + 1}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const target = e.currentTarget
                                target.classList.add("opacity-60")
                              }}
                            />
                            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[9px] text-white font-mono">
                              #{idx + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Live Stitch Progress Bar */}
              {stitchProgress && (
                <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-indigo-400 animate-spin" />
                      สถานะ: {stitchProgress.pageRange} (ประมวลผลหน้าที่ {stitchProgress.currentPart} จาก {stitchProgress.totalParts} หน้า)
                    </span>
                    <span className="font-mono font-bold text-amber-300">
                      {stitchProgress.percent}%
                    </span>
                  </div>

                  {/* Progress Track */}
                  <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 via-indigo-500 to-emerald-500 transition-all duration-300"
                      style={{ width: `${stitchProgress.percent}%` }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="text-slate-300">{stitchProgress.statusText}</span>
                    <span className="text-emerald-400 font-medium">
                      ✓ อัปโหลด Base64 ไปยัง แปลจนเมื่อย
                    </span>
                  </div>

                  {/* Live Canvas Preview if available */}
                  {stitchProgress.liveCanvasPreview && (
                    <div className="pt-2 flex items-center gap-3">
                      <div className="w-16 h-20 rounded border border-[#26334d] bg-black overflow-hidden shrink-0">
                        <img
                          src={stitchProgress.liveCanvasPreview}
                          alt="Canvas Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-[11px] text-slate-400">
                        <span className="text-white font-medium">Live Canvas Render:</span> หน้าที่ {stitchProgress.currentPart} กำลังวาดสเกลต่อกันแบบไร้รอยต่อ
                      </div>
                    </div>
                  )}

                  {stitchProgress.percent === 100 && (
                    <div className="pt-2 border-t border-indigo-500/20 flex items-center justify-between">
                      <span className="text-xs text-emerald-300 font-semibold">
                        ✓ อัปโหลดสำเร็จครบ 20 หน้าและบันทึกเข้า WorkQueue แล้ว
                      </span>
                      <a
                        href={stitchProgress.folderUrl || `https://drive.google.com/drive/folders/${DRIVE_ROOT_FOLDER_ID}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        เปิดโฟลเดอร์ Google Drive
                      </a>
                    </div>
                  )}
                </div>
              )}

              {driveAuthError && (
                <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4 text-xs text-red-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-red-200">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    ต้องการสิทธิ์การเข้าถึง Google Drive
                  </div>
                  <p>{driveAuthError}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GOOGLE ACCOUNT & COOKIE INSTRUCTIONS */}
          {activeTab === "auth" && (
            <div className="space-y-4">
              {/* Instructions Callout Box */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  คำแนะนำการเข้าสู่ระบบด้วยบัญชี Google & ใช้งาน Cookie Session
                </div>

                <div className="space-y-2 text-xs text-slate-200 leading-relaxed font-sans">
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 font-bold text-[11px] shrink-0">
                      1
                    </span>
                    <span>
                      เข้าสู่ระบบด้วยบัญชี Google ของคุณบนเว็บ{" "}
                      <a
                        href="https://en-thunderscans.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-amber-400 underline font-semibold inline-flex items-center gap-0.5"
                      >
                        en-thunderscans.com <ExternalLink className="h-3 w-3" />
                      </a>
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 font-bold text-[11px] shrink-0">
                      2
                    </span>
                    <span>
                      คัดลอก Cookie (โดยเฉพาะ <code className="px-1.5 py-0.5 rounded bg-black/60 text-amber-300 font-mono text-[11px]">wordpress_logged_in_*</code>) มาวางในช่อง Cookie Session ด้านล่าง เพื่อเข้าถึงตอนที่ซื้อแล้ว
                    </span>
                  </p>
                  <p className="flex items-start gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 font-bold text-[11px] shrink-0">
                      3
                    </span>
                    <span>
                      หรือใส่ลิงก์ตอนฟรีเพื่อทดสอบดึงภาพได้ทันทีโดยไม่ต้องใส่ Cookie
                    </span>
                  </p>
                </div>
              </div>

              {/* Cookie Input Area */}
              <div className="rounded-xl border border-[#26334d] bg-[#101726] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    วาง Cookie Session จาก en-thunderscans.com:
                  </span>
                  {savedCookie && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> มี Cookie บันทึกอยู่แล้ว
                    </span>
                  )}
                </div>

                <Textarea
                  rows={4}
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="wordpress_logged_in_xxxxxxxx=xxxxxx; wordpress_sec_xxxx=xxxxxx; ..."
                  className="font-mono text-xs bg-[#070b14] border-[#26334d] text-slate-200 resize-y"
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-400">
                    Cookie จะถูกเก็บอย่างปลอดภัยในเบราว์เซอร์ของคุณ
                  </span>
                  <div className="flex items-center gap-2">
                    {savedCookie && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearCookie}
                        className="h-8 text-xs text-red-400 hover:bg-red-950/20"
                      >
                        ล้าง Cookie
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSaveCookie()}
                      disabled={savingCookie}
                      className="h-8 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                    >
                      {savingCookie ? (
                        <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      บันทึก Cookie
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PASTE HTML SYNTAX */}
          {activeTab === "html" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#26334d] bg-[#101726] p-4 space-y-3">
                <span className="text-xs font-semibold text-slate-200">
                  วางโค้ด HTML ของตอนจาก Inspect Element หรือหน้าเว็บ:
                </span>
                <p className="text-[11px] text-slate-400">
                  คัดลอกแท็ก <code>&lt;div id=&quot;readerarea&quot;&gt;...&lt;/div&gt;</code> หรือ <code>&lt;div class=&quot;reading-content&quot;&gt;...</code> มาวางที่นี่ ระบบจะสกัดภาพทั้งหมดให้อัตโนมัติทันที
                </p>
                <Textarea
                  rows={6}
                  value={htmlInput}
                  onChange={(e) => setHtmlInput(e.target.value)}
                  placeholder='<div id="readerarea"><img src="https://img.thunderscans.com/..." /><img data-src="..." />...</div>'
                  className="font-mono text-[11px] bg-[#070b14] border-[#26334d] text-slate-200 resize-y"
                />
                <Button
                  size="sm"
                  onClick={handleParseHtml}
                  disabled={parsingHtml}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                >
                  <Scissors className={`h-3.5 w-3.5 mr-1.5 ${parsingHtml ? "animate-spin" : ""}`} />
                  {parsingHtml ? "กำลังแกะ HTML..." : "แกะภาพ & นำไปเย็บลง Drive"}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 4: 1-CLICK BOOKMARKLET */}
          {activeTab === "bookmarklet" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="text-xs text-slate-200 leading-relaxed">
                  ลากปุ่มสีเขียวด้านล่างไปวางบน <b>แถบบุ๊กมาร์ก (Bookmarks Bar)</b> ของเบราว์เซอร์ จากนั้นเปิดหน้าตอนมังงะบน{" "}
                  <a
                    href="https://en-thunderscans.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 underline font-semibold"
                  >
                    en-thunderscans.com
                  </a>{" "}
                  แล้วคลิกปุ่มนี้ ระบบจะสกัดรูปทั้งหมดและส่งกลับมาที่ MangaHub ทันที
                </div>

                <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#070b14] border border-dashed border-emerald-500/40 space-y-2">
                  <a
                    href={bookmarkletCode}
                    draggable="true"
                    onClick={(e) => {
                      e.preventDefault()
                      copyToClipboard(bookmarkletCode, "คัดลอกโค้ด Bookmarklet แล้ว!")
                    }}
                    className="w-full py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950 flex items-center justify-center gap-2 cursor-grab active:cursor-grabbing border border-emerald-400/30"
                  >
                    <Bookmark className="h-4 w-4" /> ⚡ 1-Click ThunderScans Reader Sync
                  </a>
                  <span className="text-[10px] text-slate-400">
                    (ลากไปวางที่ Bookmarks Bar หรือคลิกเพื่อก๊อปปี้โค้ด)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

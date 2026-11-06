import * as React from "react"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Plug,
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
  BookOpen,
  Layers,
  AlertTriangle,
  QrCode,
  Globe,
  Radio,
  Clock,
  ChevronRight,
  Flame,
  Tv,
  Scissors,
  Coins,
  Crown,
} from "lucide-react"
import {
  normalizeKuaikanImageUrl,
  loadImageElement,
} from "@/components/modals/KuaiKanLoginModal"
import { ThunderScansModal } from "@/components/modals/ThunderScansModal"
import { ComixModal } from "@/components/modals/ComixModal"
import { KuaikanCoinWarningBanner } from "@/components/ui/KuaikanCoinWarningBanner"
import { useKuaikanCoinAlert } from "@/lib/kuaikanCoinAlert"

interface ConnectorsViewProps {
  mangaList: any[]
}

export function ConnectorsView({ mangaList }: ConnectorsViewProps) {
  // Active category filter: "all" | "en" | "cn" | "kr" | "jp"
  const [filterCategory, setFilterCategory] = React.useState<"all" | "en" | "cn" | "kr" | "jp">("all")

  // ThunderScans Modal State
  const [thunderModalOpen, setThunderModalOpen] = React.useState(false)
  const [comixModalOpen, setComixModalOpen] = React.useState(false)

  // KuaiKan Coin & Wallet Alert Hook
  const {
    hasAlert: hasCoinAlert,
    alertInfo: coinAlertInfo,
    coinBalance,
    vipInfo,
    isVip: hookIsVip,
    triggerAlert: triggerCoinAlert,
    checkWallet: checkKuaikanWallet,
    checkingWallet,
  } = useKuaikanCoinAlert()

  // KuaiKan Session State
  const [loadingSession, setLoadingSession] = React.useState(false)
  const [sessionStatus, setSessionStatus] = React.useState<{
    loggedIn: boolean
    isVip?: boolean
    updatedAt?: string
    cookiePreview?: string
    message?: string
    coinBalance?: number | null
    insufficientCoins?: boolean
    coinAlert?: any
  } | null>(null)

  // KuaiKan Active Sub-tab
  const [kuaikanTab, setKuaikanTab] = React.useState<"test" | "qr" | "cookie" | "html">("test")

  // Target comic ID for testing (default: 855368 = Chapter 366 of ข้าคือจอมวายร้ายผู้ยิ่งใหญ่)
  const [comicIdInput, setComicIdInput] = React.useState("855368")

  // Stitch Mode: "total20" (แบ่งภาพทั้งหมดให้ได้ครบ 20 ไฟล์) vs "slices20" (รวมไฟล์ละ 20 ชิ้น)
  const [stitchMode, setStitchMode] = React.useState<"total20" | "slices20">("total20")

  // Test Chapter State
  const [testingChapter, setTestingChapter] = React.useState(false)
  const [testResult, setTestResult] = React.useState<any | null>(null)

  // Stitch & Upload 20 Pages State
  const [stitching, setStitching] = React.useState(false)
  const [stitchProgress, setStitchProgress] = React.useState<{
    currentPart: number
    totalParts: number
    pageRange: string
    percent: number
    statusText: string
  } | null>(null)
  const [driveAuthError, setDriveAuthError] = React.useState<string | null>(null)

  // QR Login State
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

  // Manual Cookie & HTML Inputs
  const [cookieInput, setCookieInput] = React.useState("")
  const [savingCookie, setSavingCookie] = React.useState(false)
  const [htmlInput, setHtmlInput] = React.useState("")
  const [parsingHtml, setParsingHtml] = React.useState(false)

  // Load Session Status on Mount
  const fetchSessionStatus = React.useCallback(async () => {
    setLoadingSession(true)
    try {
      const res = await callGasApi<any>("GET_KUAIKAN_SESSION")
      if (res && (res.loggedIn || res.status === "success")) {
        setSessionStatus(res)
      } else {
        setSessionStatus({ loggedIn: false })
      }
    } catch (e) {
      console.error("fetchSessionStatus error:", e)
      setSessionStatus({ loggedIn: false })
    } finally {
      setLoadingSession(false)
    }
  }, [])

  React.useEffect(() => {
    fetchSessionStatus()
  }, [fetchSessionStatus])

  // QR Code Generation
  const loadQrCode = async () => {
    setQrLoading(true)
    setQrData(null)
    setScanState("idle")
    setQrStatusText("กำลังสร้าง QR Code จาก KuaiKan...")

    try {
      const res = await callGasApi<any>("GET_KUAIKAN_QR")
      if (res && res.status === "success" && res.qrUrl) {
        setQrData(res)
        setScanState("waiting")
        setQrStatusText("เปิดแอป WeChat แล้วสแกนเพื่อเข้าสู่ระบบ")
        startPolling(res.uuid, res.state, res.cookies)
      } else {
        setQrStatusText("สร้าง QR Code ไม่สำเร็จ")
        toast.error("สร้าง QR Code ไม่สำเร็จ: " + (res?.message || "ไม่ทราบสาเหตุ"))
      }
    } catch (err: any) {
      setQrStatusText("เกิดข้อผิดพลาดในการโหลด QR Code")
      toast.error(err.message || "เกิดข้อผิดพลาด")
    } finally {
      setQrLoading(false)
    }
  }

  // QR Polling
  const startPolling = (uuid: string, state: string, cookies: string[]) => {
    pollingRef.current = true

    const pollNext = async () => {
      if (!pollingRef.current) return

      try {
        const pollUrl = `https://long.open.weixin.qq.com/connect/l/qrconnect?f=json&uuid=${uuid}&_=${Date.now()}`
        let pollResult: any = null

        try {
          const resp = await fetch(pollUrl, { method: "GET" })
          const text = await resp.text()
          const jsonMatch = text.match(/window\.wx_errcode\s*=\s*(\d+)/i)
          if (jsonMatch) {
            pollResult = { errcode: parseInt(jsonMatch[1], 10) }
            const codeMatch = text.match(/window\.wx_code\s*=\s*['"]([^'"]+)['"]/i)
            if (codeMatch) pollResult.code = codeMatch[1]
          }
        } catch {
          // Fallback to GAS proxy
          const proxyRes = await callGasApi<any>("CHECK_KUAIKAN_QR", { uuid, state, cookies })
          if (proxyRes && proxyRes.status === "success") {
            setScanState("success")
            toast.success("เข้าสู่ระบบ KuaiKan สำเร็จ!")
            fetchSessionStatus()
            return
          }
        }

        if (!pollingRef.current) return

        if (!pollResult) {
          setTimeout(pollNext, 2000)
          return
        }

        if (pollResult.errcode === 405) {
          setScanState("success")
          setQrStatusText("เข้าสู่ระบบสำเร็จ กำลังบันทึก Session...")
          const authRes = await callGasApi<any>("SAVE_KUAIKAN_AUTH", {
            code: pollResult.code,
            state: state,
            cookies: cookies,
          })

          if (authRes && authRes.status === "success") {
            toast.success("เข้าสู่ระบบ KuaiKan สำเร็จ!")
            fetchSessionStatus()
            setKuaikanTab("test")
            handleTestChapter()
          } else {
            toast.error(authRes?.message || "บันทึก Session ไม่สำเร็จ")
          }
          pollingRef.current = false
        } else if (pollResult.errcode === 404) {
          setScanState("scanned")
          setQrStatusText("สแกนแล้ว กรุณากดยืนยันใน WeChat")
          setTimeout(pollNext, 1500)
        } else if (pollResult.errcode === 402) {
          setScanState("expired")
          setQrStatusText("QR หมดอายุ กดรีเฟรชเพื่อลองใหม่")
        } else {
          setTimeout(pollNext, 2000)
        }
      } catch (e) {
        console.error("Polling error:", e)
        if (pollingRef.current) setTimeout(pollNext, 3000)
      }
    }

    pollNext()
  }

  React.useEffect(() => {
    return () => {
      pollingRef.current = false
    }
  }, [])

  // Test Chapter
  const handleTestChapter = async () => {
    const comicId = parseInt(comicIdInput.trim() || "855368", 10)
    setTestingChapter(true)
    setTestResult(null)
    try {
      const res = await callGasApi<any>("TEST_KUAIKAN_CHAPTER", { comicId })
      setTestResult(res)
      if (res && res.success) {
        if (res.isVipUnlocked && res.imagesCount > 1) {
          toast.success(`🎉 ปลดล็อคสำเร็จ! พบ ${res.imagesCount} ชิ้น HD (${res.thaiTitle || res.mangaName})`)
        } else {
          toast.warning("ตอนยังถูกล็อค (อาจยังไม่ใช่ VIP หรือต้องใช้เหรียญปลด)")
          if (res.isPay || res.insufficientCoins) {
            triggerCoinAlert({
              comicId: String(comicId),
              comicTitle: res.thaiTitle || res.mangaName || "",
              chapterTitle: res.title || `Comic ${comicId}`,
              requiredCoins: res.selling_kk_currency || 58,
              message: `⚠️ เหรียญ KuaiKan ไม่เพียงพอสำหรับตอน [${res.title || comicId}] กรุณาเติมเหรียญ`,
            })
          }
        }
      } else {
        toast.error(res?.error || "ทดสอบดึงตอนไม่สำเร็จ")
        if (res && (res.insufficientCoins || res.isPay || String(res.error).includes("เหรียญ") || String(res.error).includes("coin") || String(res.error).includes("VIP Lock"))) {
          triggerCoinAlert({
            comicId: String(comicId),
            comicTitle: res.thaiTitle || res.mangaName || "",
            chapterTitle: res.title || `Comic ${comicId}`,
            message: res.error || `⚠️ เหรียญ KuaiKan ไม่เพียงพอสำหรับตอน [${res.title || comicId}] กรุณาเติมเหรียญ`,
          })
        }
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการทดสอบ")
    } finally {
      setTestingChapter(false)
    }
  }

  // Handle Stitch & Upload exactly 20 pages with continuous auto-retry
  // หมายเหตุ: ส่ง skipQueue: true, isTest: true เพื่อไม่เพิ่มลงคิวงานตอนเทส
  const handleStitchAndUpload = async () => {
    if (!testResult) {
      toast.error("กรุณากดทดสอบดึงตอนก่อน เพื่อตรวจสอบความพร้อมของรูปภาพ")
      return
    }

    const rawItems: any[] = testResult.imageDetails || testResult.allImages || testResult.sampleImages || []
    if (!rawItems.length) {
      toast.error("ไม่พบรายการภาพ กรุณากดทดสอบตอนอีกครั้ง")
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

      // 2. คำนวณแบ่งภาพตามโหมดที่เลือก
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

        setStitchProgress({
          currentPart: partNum,
          totalParts,
          pageRange: partRange,
          percent: Math.round((partIdx / totalParts) * 100),
          statusText: `กำลังโหลดและเย็บไฟล์ ${String(partNum).padStart(3, "0")}.webp (หน้าที่ ${partNum} จากทั้งหมด ${totalParts} หน้า, รวม ${sliceCount} ชิ้น)...`,
        })

        // 2.1 โหลดภาพใน Part นี้พร้อมระบบ Auto-Retry และ CDN Fallback
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

        // 2.2 ปรับสเกลภาพให้ความกว้างเท่ากับ standardWidth เสมอ
        let totalHeight = 0
        const scaledItems = loadedImages.map((img) => {
          const scale = standardWidth / img.naturalWidth
          const scaledH = Math.round(img.naturalHeight * scale)
          totalHeight += scaledH
          return { img, scaledH }
        })

        // หากความสูงเกิน 16,000px ใช้ JPEG เพื่อไม่ให้ติดลิมิต 16,383px ของ WebP spec
        const useJpeg = totalHeight > 16000
        const fileName = `${String(partNum).padStart(3, "0")}.${useJpeg ? "jpg" : "webp"}`
        const mimeType = useJpeg ? "image/jpeg" : "image/webp"

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
            (b) => (b ? resolve(b) : reject(new Error(`สร้าง ${useJpeg ? "JPEG" : "WebP"} blob ไม่สำเร็จ`))),
            mimeType,
            0.92
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

        // 2.6 ส่งขึ้น Google Drive
        setStitchProgress({
          currentPart: partNum,
          totalParts,
          pageRange: partRange,
          percent: Math.round(((partIdx + 0.6) / totalParts) * 100),
          statusText: `กำลังอัปโหลด ${fileName} (หน้า ${partNum}/${totalParts}) ขึ้น แปลจนเมื่อย...`,
        })

        const isLast = partIdx === totalParts - 1
        let res: any = null

        // Auto-Retry ต่อเนื่องจนกว่าจะสำเร็จครบถ้วน (ข้ามการเพิ่มคิวงานตอนเทส: skipQueue: true, isTest: true)
        let uploadAttempt = 1
        while (true) {
          try {
            res = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
              mangaName: testResult.thaiTitle || testResult.mangaName || "ข้าคือจอมวายร้ายผู้ยิ่งใหญ่",
              chapter: testResult.title || "第366话",
              partIndex: partNum,
              totalParts,
              fileName,
              mimeType,
              base64Data,
              isLastPart: isLast,
              clearFolder: partNum === 1,
              mangaId: String(testResult.mangaId || "4"),
              skipQueue: true,
              isTest: true,
            })

            if (res && res.error) {
              if (res.error.includes("DriveApp") || res.error.includes("คุณไม่ได้รับอนุญาต") || res.error.includes("permission")) {
                setDriveAuthError(res.error)
                throw new Error(res.error)
              }
              throw new Error(res.error)
            }
            break
          } catch (uploadErr: any) {
            console.warn(`[UPLOAD_CHAPTER_STITCHED_PART] Attempt #${uploadAttempt} for part ${partNum} failed:`, uploadErr)
            setStitchProgress((prev) =>
              prev
                ? {
                    ...prev,
                    statusText: `⚠️ อัปโหลด ${fileName} ขัดข้อง กำลัง Retry ครั้งที่ ${uploadAttempt}...`,
                  }
                : null
            )
            uploadAttempt++
            const delayMs = Math.min(uploadAttempt * 1200, 6000)
            await new Promise((r) => setTimeout(r, delayMs))
          }
        }

        if (res && res.folderUrl) {
          lastFolderUrl = res.folderUrl
        }
      }

      setStitchProgress({
        currentPart: totalParts,
        totalParts,
        pageRange: `สำเร็จครบทั้ง ${totalParts} หน้า`,
        percent: 100,
        statusText: `🎉 บันทึกภาพครบ ${totalParts} หน้าลง แปลจนเมื่อย เรียบร้อยแล้ว! (ไม่เพิ่มคิวงานตามที่กำหนด)`,
      })

      toast.success(`🎉 เย็บและอัปโหลดภาพครบ ${totalParts} หน้าลง Google Drive เรียบร้อยแล้ว!`)
    } catch (err: any) {
      console.error("handleStitchAndUpload error:", err)
      toast.error(err.message || "เกิดข้อผิดพลาดในการเย็บและอัปโหลด")
    } finally {
      setStitching(false)
    }
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
        setKuaikanTab("test")
        handleTestChapter()
      } else {
        toast.error(res?.error || "บันทึก Cookie ไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึก Cookie")
    } finally {
      setSavingCookie(false)
    }
  }

  // Handle parsing raw HTML syntax
  const handleParseHtml = async () => {
    if (!htmlInput.trim()) {
      toast.error("กรุณาวางโค้ด HTML ของตอน เช่น <div class=\"comicDetails\">... หรือ <div class=\"img-box\">...")
      return
    }

    setParsingHtml(true)
    try {
      const regex = /data-src=["'](https?:\/\/[^"'\s]+kkmh\.com\/image\/c\d+\/[^"'\s]+)["']/gi
      const urls: string[] = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(htmlInput)) !== null) {
        const u = match[1].replace(/&amp;/g, "&")
        if (!urls.includes(u)) urls.push(u)
      }

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
        setKuaikanTab("test")
        handleTestChapter()
      } else {
        toast.error(saveRes?.error || "บันทึกภาพไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการแกะโค้ด HTML")
    } finally {
      setParsingHtml(false)
    }
  }

  // Clear Session
  const handleClearSession = async () => {
    if (!confirm("ต้องการยกเลิกการเชื่อมต่อบัญชี KuaiKan ใช่หรือไม่?")) return
    try {
      await callGasApi("CLEAR_KUAIKAN_AUTH")
      toast.info("ออกจากระบบ KuaiKan เรียบร้อยแล้ว")
      setSessionStatus(null)
      setTestResult(null)
      setKuaikanTab("qr")
      loadQrCode()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    }
  }

  // List of Connectors
  const connectorsList = [
    {
      id: "comix",
      name: "🌐 Comix.to (Multi-Group Scanner)",
      region: "en",
      active: true,
      status: "ready",
      statusLabel: "🌐 พร้อมใช้งาน (ไม่ต้องล็อกอิน)",
      desc: "ดึงมังงะอังกฤษแบบเลือกค่ายแปลได้ (เช่น CrowScans) ไม่ต้องล็อกอิน พร้อมระบบเย็บ 20 หน้าลง แปลจนเมื่อย อัตโนมัติ",
      icon: Globe,
      color: "from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-400",
    },
    {
      id: "thunderscans",
      name: "⚡ ThunderScans EN (en-thunderscans.com)",
      region: "en",
      active: true,
      status: "ready",
      statusLabel: "⚡ พร้อมใช้งาน",
      desc: "ดึงมังงะต้นฉบับอังกฤษ รองรับทั้งตอนฟรีและตอนซื้อด้วยบัญชี Google พร้อมระบบ Dynamic Slice #15 เย็บเป็น 20 หน้าลง แปลจนเมื่อย",
      icon: Zap,
      color: "from-amber-500/20 to-yellow-500/20 border-amber-500/40 text-amber-400",
    },
    {
      id: "kuaikan",
      name: "KuaiKan Manhua (快看漫画)",
      region: "cn",
      active: true,
      status: sessionStatus?.loggedIn && sessionStatus.isVip ? "connected" : "ready",
      statusLabel: sessionStatus?.loggedIn && sessionStatus.isVip ? "VIP เชื่อมต่อแล้ว" : "พร้อมเชื่อมต่อ",
      desc: "เชื่อมต่อ VIP ดึงภาพต้นฉบับคมชัดพิเศษ และเย็บเป็น 20 หน้าลง แปลจนเมื่อย อัตโนมัติ",
      icon: Sparkles,
      color: "from-amber-500/20 to-orange-500/20 border-amber-500/40 text-amber-400",
    },
    {
      id: "tencent",
      name: "Tencent AC (腾讯动漫 / ac.qq.com)",
      region: "cn",
      active: false,
      status: "coming_soon",
      statusLabel: "เร็วๆ นี้",
      desc: "ระบบเชื่อมต่อบัญชี QQ / WeChat VIP และคูปองอ่านล่วงหน้าสำหรับมังงะค่าย Tencent",
      icon: Flame,
      color: "from-blue-500/10 to-cyan-500/10 border-blue-500/20 text-blue-400",
    },
    {
      id: "bilibili",
      name: "Bilibili Comics (哔哩哔哩漫画)",
      region: "cn",
      active: false,
      status: "coming_soon",
      statusLabel: "เร็วๆ นี้",
      desc: "รองรับการเข้าสู่ระบบสมาชิก Bilibili VIP ดึงภาพ Raw ความละเอียดสูง",
      icon: Tv,
      color: "from-pink-500/10 to-rose-500/10 border-pink-500/20 text-pink-400",
    },
    {
      id: "webtoon",
      name: "LINE / Naver Webtoon",
      region: "kr",
      active: false,
      status: "coming_soon",
      statusLabel: "เร็วๆ นี้",
      desc: "ดึงต้นฉบับ Webtoon รายสัปดาห์ (Naver Series / LINE มังงะ) และจัดการจัดหน้าอัตโนมัติ",
      icon: Smartphone,
      color: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-400",
    },
    {
      id: "kakao",
      name: "Kakao Webtoon / Page (카카오페이지)",
      region: "kr",
      active: false,
      status: "coming_soon",
      statusLabel: "เร็วๆ นี้",
      desc: "เชื่อมต่อบัญชี Kakao รองรับระบบเหรียญและสิทธิ์อ่านล่วงหน้ามังฮวาเกาหลี",
      icon: BookOpen,
      color: "from-yellow-500/10 to-amber-500/10 border-yellow-500/20 text-yellow-400",
    },
    {
      id: "iqiyi",
      name: "IQIYI Comics (爱奇艺漫画)",
      region: "cn",
      active: false,
      status: "coming_soon",
      statusLabel: "เร็วๆ นี้",
      desc: "รองรับการดึงการ์ตูนจีนในเครือ IQIYI ผ่านระบบสมาชิก VIP Pass",
      icon: Layers,
      color: "from-green-500/10 to-emerald-500/10 border-green-500/20 text-green-400",
    },
  ]

  const filteredConnectors = connectorsList.filter((c) => {
    if (filterCategory === "all") return true
    return c.region === filterCategory
  })

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#26334d] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                จัดการตัวเชื่อมต่อ
                <Badge variant="outline" className="border-indigo-500/40 bg-indigo-950/30 text-indigo-300 text-xs font-semibold">
                  Platform Connectors
                </Badge>
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                ศูนย์กลางเชื่อมต่อแพลตฟอร์มมังงะต้นฉบับ ดึงภาพ VIP และระบบ Auto-Stitch 20 หน้าลง Google Drive
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSessionStatus}
            disabled={loadingSession}
            className="border-[#26334d] bg-[#151d2f] text-slate-200 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingSession ? "animate-spin" : ""}`} />
            รีเฟรชสถานะ
          </Button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterCategory("all")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCategory === "all"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-[#151d2f] text-slate-400 hover:text-slate-200 border border-[#26334d]"
          }`}
        >
          ทั้งหมด ({connectorsList.length})
        </button>
        <button
          onClick={() => setFilterCategory("en")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCategory === "en"
              ? "bg-amber-500 text-slate-950 font-bold shadow-xs"
              : "bg-[#151d2f] text-slate-400 hover:text-slate-200 border border-[#26334d]"
          }`}
        >
          ⚡ สแกนอังกฤษ (Comix.to, ThunderScans)
        </button>
        <button
          onClick={() => setFilterCategory("cn")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCategory === "cn"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-[#151d2f] text-slate-400 hover:text-slate-200 border border-[#26334d]"
          }`}
        >
          🇨🇳 แพลตฟอร์มจีน (KuaiKan, Tencent, Bilibili, IQIYI)
        </button>
        <button
          onClick={() => setFilterCategory("kr")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterCategory === "kr"
              ? "bg-indigo-600 text-white shadow-xs"
              : "bg-[#151d2f] text-slate-400 hover:text-slate-200 border border-[#26334d]"
          }`}
        >
          🇰🇷 แพลตฟอร์มเกาหลี (Naver Webtoon, Kakao)
        </button>
      </div>

      {/* Primary Active Connector: KuaiKan Manhua */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-base font-semibold text-white">ตัวเชื่อมต่อหลักที่ใช้งานอยู่ (Active)</h2>
          </div>
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">
            Auto-Stitch 20 Pages Enabled
          </Badge>
        </div>

        <Card className="border-amber-500/30 bg-[#0d1322] shadow-xl overflow-hidden">
          {/* Card Top Banner */}
          <div className="border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-[#151d2f] to-[#0d1322] p-5 sm:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-md">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg font-bold text-white">KuaiKan Manhua (快看漫画)</h3>
                    {sessionStatus?.loggedIn && (sessionStatus.isVip || vipInfo?.isVip || hookIsVip) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500/20 via-purple-600/25 to-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                        <Crown className="h-3.5 w-3.5 text-amber-400" />
                        👑 VIP Active {vipInfo?.remainedDays !== undefined && vipInfo.remainedDays > 0 ? `(${vipInfo.remainedDays} วัน)` : ""}
                      </span>
                    ) : sessionStatus?.loggedIn ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        ⚠️ VIP หมดอายุแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                        <AlertCircle className="h-3.5 w-3.5" />
                        รอซิงค์ Session VIP
                      </span>
                    )}
                    <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-slate-300 text-[11px]">
                      Root: แปลจนเมื่อย
                    </Badge>
                    {/* Coin / Wallet Status Badge */}
                    {coinBalance !== null ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          hasCoinAlert || coinBalance <= 0
                            ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                            : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        }`}
                      >
                        <Coins className="h-3.5 w-3.5" />
                        เหรียญ: {coinBalance} KK币
                      </span>
                    ) : (sessionStatus?.insufficientCoins || hasCoinAlert) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-semibold text-rose-300 border border-rose-500/40 animate-pulse">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        เหรียญ KuaiKan หมด
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    ระบบดึงตอน VIP ต้นฉบับจีน • คำนวณความกว้างมาตรฐาน • เย็บเป็น 20 หน้าลง Google Drive
                  </p>
                  {sessionStatus?.updatedAt && (
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                      <Clock className="h-3 w-3 text-slate-500" />
                      <span>ซิงค์ล่าสุดเมื่อ: {new Date(sessionStatus.updatedAt).toLocaleString("th-TH")}</span>
                      {sessionStatus.cookiePreview && (
                        <span className="text-slate-500 font-mono">({sessionStatus.cookiePreview})</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkKuaikanWallet}
                  disabled={checkingWallet}
                  className="border-[#26334d] bg-[#151d2f] text-amber-300 hover:text-white text-xs"
                  title="ตรวจสอบยอดเหรียญ KuaiKan"
                >
                  <Coins className={`h-3.5 w-3.5 mr-1.5 ${checkingWallet ? "animate-spin" : ""}`} />
                  ตรวจยอดเหรียญ
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchSessionStatus}
                  disabled={loadingSession}
                  className="border-[#26334d] bg-[#151d2f] text-slate-300 hover:text-white text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingSession ? "animate-spin" : ""}`} />
                  ตรวจสอบ
                </Button>
                {sessionStatus?.loggedIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSession}
                    className="text-red-400 hover:bg-red-950/20 hover:text-red-300 text-xs"
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" />
                    ยกเลิกการเชื่อมต่อ
                  </Button>
                )}
              </div>
            </div>

            {/* Emergency KuaiKan Coin Warning Banner inside Connector Card */}
            <div className="mt-4">
              <KuaikanCoinWarningBanner inCard={true} />
            </div>

            {/* Sub-Tabs Selector */}
            <div className="flex items-center gap-2 mt-6 pt-4 border-t border-[#26334d]/60">
              <button
                onClick={() => setKuaikanTab("test")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  kuaikanTab === "test"
                    ? "bg-amber-500 text-slate-950 shadow-md font-bold"
                    : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
                }`}
              >
                ⚡ ทดสอบดึงตอน & เย็บ 20 หน้า (Test Engine)
              </button>
              <button
                onClick={() => {
                  setKuaikanTab("qr")
                  if (scanState === "idle") loadQrCode()
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  kuaikanTab === "qr"
                    ? "bg-amber-500 text-slate-950 shadow-md font-bold"
                    : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
                }`}
              >
                📱 WeChat QR Code
              </button>
              <button
                onClick={() => setKuaikanTab("html")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  kuaikanTab === "html"
                    ? "bg-amber-500 text-slate-950 shadow-md font-bold"
                    : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
                }`}
              >
                ✂️ แกะโค้ด HTML
              </button>
              <button
                onClick={() => setKuaikanTab("cookie")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  kuaikanTab === "cookie"
                    ? "bg-amber-500 text-slate-950 shadow-md font-bold"
                    : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
                }`}
              >
                🔑 กรอก Cookie ตรง
              </button>
            </div>
          </div>

          {/* Sub-Tab 1: Test & Stitch Engine */}
          {kuaikanTab === "test" && (
            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* Comic Target Input & Trigger */}
              <div className="rounded-xl border border-[#26334d] bg-[#151d2f]/70 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-200">
                      ทดสอบดึงตอนต้นฉบับ VIP (ค่าเริ่มต้น: ข้าคือจอมวายร้ายผู้ยิ่งใหญ่ ตอนที่ 366)
                    </span>
                    <p className="text-[11px] text-slate-400">
                      ระบบจะสกัด slice ทั้งหมด วิเคราะห์ขนาดความกว้าง และเย็บเป็น 20 หน้ามาตรฐาน
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                        Comic ID:
                      </span>
                      <Input
                        value={comicIdInput}
                        onChange={(e) => setComicIdInput(e.target.value)}
                        placeholder="855368"
                        className="w-36 h-9 pl-18 bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-100"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleTestChapter}
                      disabled={testingChapter || stitching}
                      className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs"
                    >
                      <Zap className={`h-3.5 w-3.5 mr-1.5 ${testingChapter ? "animate-spin" : ""}`} />
                      {testingChapter ? "กำลังดึง..." : "ทดสอบตอน"}
                    </Button>
                  </div>
                </div>

                {/* Thai Manga Info Banner */}
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 px-3.5 py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-indigo-300">
                    <BookOpen className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span>
                      ชื่อเรื่องภาษาไทยจากฐานข้อมูล: <strong className="text-white">ข้าคือจอมวายร้ายผู้ยิ่งใหญ่</strong> (ID: 4)
                    </span>
                  </div>
                  <span className="text-[11px] text-indigo-400 hidden sm:inline">
                    ปลายทาง Drive: แปลจนเมื่อย / ข้าคือจอมวายร้ายผู้ยิ่งใหญ่ / 第366话
                  </span>
                </div>
              </div>

              {/* Test Results Display */}
              {testResult && (
                <div className="rounded-xl border border-[#26334d] bg-[#151d2f]/40 p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#26334d] pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          {testResult.title || "第366话"}
                        </span>
                        <span className="text-xs text-slate-400">
                          ({testResult.topicTitle || "我！天命大反派"})
                        </span>
                        {testResult.isVipUnlocked ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                            ✓ ปลดล็อค VIP แล้ว
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            ล็อค (ต้องใช้ VIP)
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        พบภาพชิ้นส่วนทั้งหมด: <strong className="text-amber-400">{testResult.imagesCount} ชิ้น</strong> (จะนำมารวมเย็บเป็น <strong className="text-emerald-400">20 หน้า</strong>)
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                      {/* Mode Selector */}
                      <div className="flex items-center rounded-lg border border-[#26334d] bg-[#0b0f19] p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setStitchMode("total20")}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            stitchMode === "total20"
                              ? "bg-indigo-600 text-white font-bold shadow-xs"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          แบ่งรวมเป็น 20 หน้า (20 ไฟล์)
                        </button>
                        <button
                          type="button"
                          onClick={() => setStitchMode("slices20")}
                          className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                            stitchMode === "slices20"
                              ? "bg-indigo-600 text-white font-bold shadow-xs"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          เย็บไฟล์ละ 20 ชิ้น (~7 ไฟล์)
                        </button>
                      </div>

                      <Button
                        size="sm"
                        onClick={handleStitchAndUpload}
                        disabled={stitching}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md text-xs gap-1.5"
                      >
                        <Layers className={`h-3.5 w-3.5 ${stitching ? "animate-spin" : ""}`} />
                        {stitching
                          ? "กำลังเย็บและอัปโหลด..."
                          : stitchMode === "total20"
                          ? "เย็บแบ่งเป็น 20 หน้า & ส่งขึ้น Drive"
                          : "เย็บไฟล์ละ 20 ชิ้น & ส่งขึ้น Drive"}
                      </Button>
                    </div>
                  </div>

                  {/* Sample Images Gallery */}
                  {testResult.sampleImages && testResult.sampleImages.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                        ตัวอย่างภาพที่สกัดได้จริง (ต้นฉบับ HD):
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {testResult.sampleImages.slice(0, 6).map((imgUrl: string, idx: number) => (
                          <div
                            key={idx}
                            className="aspect-[3/4] rounded-lg border border-[#26334d] bg-[#0b0f19] overflow-hidden relative group"
                          >
                            <img
                              src={normalizeKuaikanImageUrl(imgUrl)}
                              alt={`Slice ${idx + 1}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              referrerPolicy="no-referrer"
                              crossOrigin="anonymous"
                              onError={(e) => {
                                const target = e.currentTarget
                                if (target.src !== imgUrl) {
                                  target.src = imgUrl
                                }
                              }}
                            />
                            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">
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
                      สถานะ: {stitchProgress.pageRange} (กำลังประมวลผลหน้าที่ {stitchProgress.currentPart} จากทั้งหมด {stitchProgress.totalParts} หน้า)
                    </span>
                    <span className="font-mono font-bold text-amber-300">
                      {stitchProgress.percent}%
                    </span>
                  </div>

                  {/* Progress Track */}
                  <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-500 transition-all duration-300"
                      style={{ width: `${stitchProgress.percent}%` }}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="text-slate-300">{stitchProgress.statusText}</span>
                    <span className="text-emerald-400 font-medium">
                      ✓ ระบบจะ Retry ต่อเนื่องอัตโนมัติจนครบ 20 หน้า
                    </span>
                  </div>

                  {stitchProgress.percent === 100 && (
                    <div className="pt-2 border-t border-indigo-500/20 flex items-center justify-between">
                      <span className="text-xs text-emerald-300 font-semibold">
                        ✓ อัปโหลดสำเร็จครบ 20 หน้าเรียบร้อยแล้ว
                      </span>
                      <a
                        href="https://drive.google.com/drive/folders/1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        เปิดโฟลเดอร์ Google Drive (แปลจนเมื่อย)
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
            </CardContent>
          )}

          {/* Sub-Tab 2: WeChat QR Code */}
          {kuaikanTab === "qr" && (
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-[#26334d] bg-[#151d2f]/40 space-y-4">
                <div className="relative flex h-60 w-60 items-center justify-center rounded-2xl border-2 border-amber-500/40 bg-white p-3 shadow-xl">
                  {qrLoading ? (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <RefreshCw className="h-8 w-8 animate-spin text-amber-500" />
                      <span className="text-xs">กำลังสร้าง QR Code...</span>
                    </div>
                  ) : qrData?.qrUrl ? (
                    <img
                      src={qrData.qrUrl}
                      alt="KuaiKan WeChat QR"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-600">
                      <QrCode className="h-10 w-10 text-slate-400" />
                      <span className="text-xs">กดปุ่มด้านล่างเพื่อสร้าง QR Code</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">{qrStatusText}</p>
                  <p className="text-xs text-slate-400">
                    เปิดแอป WeChat ในโทรศัพท์มือถือ แล้วสแกน QR Code ด้านบนเพื่อต่ออายุหรือเข้าสู่ระบบ VIP
                  </p>
                </div>

                <Button
                  size="sm"
                  onClick={loadQrCode}
                  disabled={qrLoading}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${qrLoading ? "animate-spin" : ""}`} />
                  สร้าง QR Code ใหม่
                </Button>
              </div>
            </CardContent>
          )}

          {/* Sub-Tab 3: HTML Parser */}
          {kuaikanTab === "html" && (
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-200">
                  วางโค้ด HTML ของตอนจากหน้าเว็บ KuaiKan:
                </span>
                <p className="text-[11px] text-slate-400">
                  คัดลอกแท็ก &lt;div class=&quot;comicDetails&quot;&gt; หรือ &lt;div class=&quot;imgList&quot;&gt; ระบบจะ Regex สกัด data-src ที่เป็นภาพตอนแท้จริงอัตโนมัติ
                </p>
                <Textarea
                  value={htmlInput}
                  onChange={(e) => setHtmlInput(e.target.value)}
                  placeholder='<div class="comicDetails"><div class="imgList"><div class="img-box"><img data-src="https://tn1.kkmh.com/image/c855368/...">'
                  className="h-32 bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-200 resize-y"
                />
              </div>

              <Button
                size="sm"
                onClick={handleParseHtml}
                disabled={parsingHtml}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                <Scissors className={`h-3.5 w-3.5 mr-1.5 ${parsingHtml ? "animate-spin" : ""}`} />
                {parsingHtml ? "กำลังแกะ HTML..." : "แกะภาพ & บันทึกเข้าระบบ"}
              </Button>
            </CardContent>
          )}

          {/* Sub-Tab 4: Direct Cookie Input */}
          {kuaikanTab === "cookie" && (
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-200">
                  กรอก Cookie หรือ Token โดยตรง:
                </span>
                <p className="text-[11px] text-slate-400">
                  คัดลอก passToken=... หรือ connect.sid=... จาก DevTools ของ kuaikanmanhua.com
                </p>
                <Textarea
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  placeholder="passToken=xxxxxx; connect.sid=xxxxxx"
                  className="h-28 bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-200 resize-y"
                />
              </div>

              <Button
                size="sm"
                onClick={handleSaveCookie}
                disabled={savingCookie}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                <CheckCircle2 className={`h-3.5 w-3.5 mr-1.5 ${savingCookie ? "animate-spin" : ""}`} />
                {savingCookie ? "กำลังบันทึก..." : "บันทึก Cookie"}
              </Button>
            </CardContent>
          )}
        </Card>

        {/* Dedicated Active Connector Card: ⚡ ThunderScans EN */}
        <Card className="border-amber-500/40 bg-[#0d1322] shadow-xl overflow-hidden mt-6">
          <div className="border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-[#151d2f] to-[#0d1322] p-5 sm:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-md">
                  <Zap className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg font-bold text-white">⚡ ThunderScans EN (en-thunderscans.com)</h3>
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs font-semibold">
                      English Webtoon / Manga
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      พร้อมใช้งาน (ตอนฟรี & บัญชี Google)
                    </span>
                    <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-slate-300 text-[11px]">
                      Root: แปลจนเมื่อย
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    ระบบดึงมังงะภาษาอังกฤษ • รองรับตอนฟรีและตอนซื้อด้วยบัญชี Google • Dynamic Slice #15 Canvas Measurement • เย็บ 20 หน้าลง Google Drive
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => setThunderModalOpen(true)}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                  เปิดเครื่องมือดึงภาพ (Open ThunderScans)
                </Button>
              </div>
            </div>
          </div>

          <CardContent className="p-4 sm:p-5 bg-[#0b0f19]/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-300 flex-wrap">
                <BookOpen className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  ตอนทดสอบหลัก: <strong className="text-white">The Clan's Failure Is a Former Continental Champion (Ch. 62)</strong>
                </span>
                <span className="text-slate-500 hidden md:inline">|</span>
                <span className="text-slate-400 hidden md:inline">
                  ปลายทาง Drive: <span className="text-emerald-400 font-mono">แปลจนเมื่อย / The Clan's Failure Is a Former Continental Champion / Chapter 62</span>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setThunderModalOpen(true)}
                  className="h-8 border-[#26334d] bg-[#151d2f] text-slate-200 hover:text-white text-xs cursor-pointer"
                >
                  <Scissors className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                  ทดสอบดึงภาพ & เย็บ 20 หน้า
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Dedicated Active Connector Card: 🌐 Comix.to (Multi-Group Scanner) */}
        <Card className="border-purple-500/40 bg-[#0d1322] shadow-xl overflow-hidden mt-6">
          <div className="border-b border-purple-500/20 bg-gradient-to-r from-purple-950/40 via-[#151d2f] to-[#0d1322] p-5 sm:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-500/20 border border-purple-500/40 text-purple-400 shadow-md">
                  <Globe className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg font-bold text-white">🌐 Comix.to (Multi-Group Scanner)</h3>
                    <Badge variant="outline" className="border-purple-500/40 bg-purple-500/10 text-purple-300 text-xs font-semibold">
                      เลือกค่ายแปลได้ (เช่น CrowScans)
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      พร้อมใช้งาน (ไม่ต้องล็อกอิน)
                    </span>
                    <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-slate-300 text-[11px]">
                      Root: แปลจนเมื่อย
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    รองรับมังงะที่มีหลายค่ายแปลในเรื่องเดียว • เลือกค่ายแปลในตั้งค่ามังงะได้ • รองรับทั้งดึงตรงและแกะจาก HTML (.reader-area / img.rpage-page__img)
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => setComixModalOpen(true)}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 mr-1.5" />
                  เปิดเครื่องมือ Comix.to (Open Comix)
                </Button>
              </div>
            </div>
          </div>

          <CardContent className="p-4 sm:p-5 bg-[#0b0f19]/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-300 flex-wrap">
                <BookOpen className="h-4 w-4 text-purple-400 shrink-0" />
                <span>
                  เรื่องทดสอบหลัก: <strong className="text-white">นักฆ่าระดับเทพ ข้าคือเงามืด (God-level Assassin, I&apos;m the Shadow)</strong> • ค่าย: <strong className="text-purple-300">CrowScans</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setComixModalOpen(true)}
                  className="h-8 border-[#26334d] bg-[#151d2f] text-slate-200 hover:text-white text-xs cursor-pointer"
                >
                  <Scissors className="h-3.5 w-3.5 mr-1.5 text-purple-400" />
                  เลือกค่ายแปล & เย็บ 20 หน้า
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Connectors Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">แพลตฟอร์มอื่นๆ ที่กำลังจะรองรับ (Platform Shelf)</h2>
          </div>
          <span className="text-xs text-slate-400">
            โครงสร้างระบบเตรียมพร้อมสำหรับขยายตัวเชื่อมต่อ
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredConnectors
            .filter((c) => c.id !== "kuaikan")
            .map((conn) => {
              const Icon = conn.icon
              const isThunder = conn.id === "thunderscans" || conn.id === "comix"
              return (
                <Card
                  key={conn.id}
                  className={`border-[#26334d] bg-[#0d1322] hover:border-[#384869] transition-all duration-200 relative overflow-hidden group ${isThunder ? "border-amber-500/40 hover:border-amber-500/70" : ""}`}
                >
                  <CardHeader className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isThunder ? "bg-amber-500/20 border border-amber-500/40 text-amber-400" : "bg-slate-800/80 border border-slate-700/60 text-slate-400 group-hover:text-white"} transition-colors`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge
                        variant="outline"
                        className={`${isThunder ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-slate-700 bg-slate-800/50 text-slate-400"} text-[10px] font-medium`}
                      >
                        {conn.statusLabel}
                      </Badge>
                    </div>

                    <div className="mt-3">
                      <CardTitle className={`text-sm font-bold ${isThunder ? "text-amber-200" : "text-white"} group-hover:text-amber-300 transition-colors`}>
                        {conn.name}
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {conn.desc}
                      </CardDescription>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 pt-0">
                    <div className="pt-3 border-t border-[#26334d]/60 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {conn.region === "en" ? "🇬🇧 English / Scan" : conn.region === "cn" ? "🇨🇳 China" : "🇰🇷 Korea"}
                      </span>
                      {isThunder ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => conn.id === "comix" ? setComixModalOpen(true) : setThunderModalOpen(true)}
                          className="h-7 text-xs bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500 hover:text-slate-950 font-semibold cursor-pointer"
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          เปิดใช้งาน
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          className="h-7 text-xs text-slate-500 cursor-not-allowed"
                        >
                          ตั้งค่า (เร็วๆ นี้)
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
        </div>
      </div>

      {/* ThunderScans Modal */}
      <ThunderScansModal
        open={thunderModalOpen}
        onClose={() => setThunderModalOpen(false)}
      />
      <ComixModal
        open={comixModalOpen}
        onClose={() => setComixModalOpen(false)}
      />
    </div>
  )
}

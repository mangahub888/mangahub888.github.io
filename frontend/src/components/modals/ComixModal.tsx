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
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  Scissors,
  Layers,
  AlertTriangle,
  Globe,
  Users,
  Copy,
} from "lucide-react"

interface ComixModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  initialUrl?: string
  initialScanGroup?: string
}

const DEFAULT_COMIX_URL =
  "https://comix.to/title/z0l20-god-level-assassin-im-the-shadow"
const DRIVE_ROOT_FOLDER_ID = "1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_"

const proxyCache = new Map<string, string>()

export async function loadComixImageElement(
  url: string,
  onRetryNotice?: (text: string) => void
): Promise<HTMLImageElement | null> {
  if (!url) return null

  const cachedDataUrl = proxyCache.get(url)
  if (cachedDataUrl) {
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error("Cached Data URL failed"))
        image.src = cachedDataUrl
      })
    } catch {}
  }

  // Try direct load with referrerPolicy = "no-referrer" (Comix.to CDN requires no-referrer)
  try {
    const directImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = "anonymous"
      image.referrerPolicy = "no-referrer"

      const timer = setTimeout(() => {
        image.onload = null
        image.onerror = null
        reject(new Error("Timeout direct load"))
      }, 4000)

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
    console.info(
      `[loadComixImageElement] Direct CORS load skipped (${err.message}), using GAS Proxy fallback for: ${url}`
    )
  }

  // Fallback: GAS Proxy (requests without Referer header)
  const maxAttempts = 3
  let attempt = 1

  while (attempt <= maxAttempts) {
    try {
      if (onRetryNotice) {
        onRetryNotice(
          `🔄 กำลังโหลดภาพผ่านระบบ GAS Proxy (ครั้งที่ ${attempt}/${maxAttempts})...`
        )
      }

      const proxyRes = await callGasApi<any>("PROXY_COMIX_IMAGE", {
        imageUrl: url,
      })
      if (!proxyRes || !proxyRes.dataUrl) {
        throw new Error(proxyRes?.error || "Proxy API did not return dataUrl")
      }

      const dataUrl = proxyRes.dataUrl
      proxyCache.set(url, dataUrl)

      const proxiedImg = await new Promise<HTMLImageElement>(
        (resolve, reject) => {
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
        }
      )

      return proxiedImg
    } catch (proxyErr: any) {
      console.warn(
        `[loadComixImageElement] Proxy Retry #${attempt}/${maxAttempts} for ${url}:`,
        proxyErr.message
      )
      attempt++
      if (attempt <= maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }

  return null
}

export function ComixModal({
  open,
  onClose,
  onSuccess,
  initialUrl,
  initialScanGroup,
}: ComixModalProps) {
  const [activeTab, setActiveTab] = React.useState<"test" | "html">("test")

  const [targetUrl, setTargetUrl] = React.useState(
    initialUrl || DEFAULT_COMIX_URL
  )
  const [scanGroup, setScanGroup] = React.useState(initialScanGroup || "")
  const [chapterNumInput, setChapterNumInput] = React.useState("")

  // Available Scan Groups (fetched on-demand when user clicks button)
  const [groups, setGroups] = React.useState<
    Array<{ id: string; name: string }>
  >([])
  const [loadingGroups, setLoadingGroups] = React.useState(false)

  // Fetch / Inspect State
  const [testingChapter, setTestingChapter] = React.useState(false)
  const [testResult, setTestResult] = React.useState<any | null>(null)

  // HTML Reader-Area parser state
  const [htmlInput, setHtmlInput] = React.useState("")
  const [parsingHtml, setParsingHtml] = React.useState(false)

  // Stitch Mode
  const [stitchMode, setStitchMode] = React.useState<"total20" | "slices20">(
    "total20"
  )

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
  const [driveAuthError, setDriveAuthError] = React.useState<string | null>(
    null
  )

  // ดึงรายชื่อค่ายแปลแบบรายครั้งเมื่อผู้ใช้กดปุ่ม
  const handleLoadGroups = async (urlOverride?: string) => {
    const u = (urlOverride ?? targetUrl).trim()
    if (!u) {
      toast.error("กรุณาวางลิงก์เรื่องจาก comix.to ก่อนกดดึงชื่อค่ายแปล")
      return
    }
    setLoadingGroups(true)
    try {
      const res = await callGasApi<any>("GET_COMIX_GROUPS", { url: u })
      if (
        res &&
        res.success &&
        Array.isArray(res.groups) &&
        res.groups.length > 0
      ) {
        setGroups(res.groups)
        toast.success(
          `ดึงรายชื่อค่ายแปลใส่ Dropdown แล้ว (${res.groups.length} ค่าย)`
        )
      } else {
        toast.error(
          res?.error ||
            "ไม่พบรายชื่อค่ายแปลจากลิงก์นี้ (คุณสามารถพิมพ์ชื่อค่ายเองได้)"
        )
      }
    } catch (err: any) {
      toast.error(err.message || "ดึงค่ายแปลไม่สำเร็จ")
    } finally {
      setLoadingGroups(false)
    }
  }

  React.useEffect(() => {
    if (open) {
      setGroups([])
      if (initialUrl) setTargetUrl(initialUrl)
      if (initialScanGroup !== undefined) setScanGroup(initialScanGroup)
    }
  }, [open, initialUrl, initialScanGroup])

  const handleFetchChapter = async (overrideParams?: {
    url?: string
    group?: string
    chapNum?: string | number
  }) => {
    const url = (overrideParams?.url ?? targetUrl).trim()
    const grp = (overrideParams?.group ?? scanGroup).trim()
    const cNum =
      overrideParams?.chapNum !== undefined
        ? String(overrideParams.chapNum)
        : chapterNumInput.trim()

    if (!url) {
      toast.error("กรุณาระบุ URL ของ Comix.to (หน้าเรื่อง หรือ หน้าตอน)")
      return
    }

    setTestingChapter(true)
    setTestResult(null)
    setDriveAuthError(null)

    try {
      const res = await callGasApi<any>("TEST_COMIX_CHAPTER", {
        chapterUrl: url,
        scanGroup: grp,
        chapterNum: cNum || undefined,
      })

      setTestResult(res)
      if (res && res.availableGroups && Array.isArray(res.availableGroups)) {
        setGroups(res.availableGroups)
      }

      if (res && res.success) {
        if (res.imagesCount > 0) {
          toast.success(
            `🎉 ดึงภาพสำเร็จ! พบ ${res.imagesCount} ภาพ (${res.chapter}${
              res.scanGroup ? ` • ค่าย ${res.scanGroup}` : ""
            })`
          )
        } else {
          toast.warning("ดึงข้อมูลสำเร็จแต่ไม่พบรูปภาพในตอนนี้")
        }
      } else {
        toast.error(res?.error || "ไม่สามารถดึงข้อมูลตอนจาก Comix.to ได้")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการดึงภาพ")
    } finally {
      setTestingChapter(false)
    }
  }

  // Parse Raw HTML from <div class="reader-area"> (<img class="rpage-page__img" src="...">)
  const handleParseReaderHtml = async () => {
    if (!htmlInput.trim()) {
      toast.error(
        'กรุณาวางโค้ด HTML จาก <div class="reader-area"> หรือ <img class="rpage-page__img">'
      )
      return
    }

    setParsingHtml(true)
    try {
      const urls: string[] = []
      const imgRegex =
        /<img[^>]+(?:data-src|src)=["'](https?:\/\/[^"'>\s]+)["'][^>]*>/gi
      let m: RegExpExecArray | null
      while ((m = imgRegex.exec(htmlInput)) !== null) {
        const u = m[1].replace(/&amp;/g, "&")
        if (
          !u.match(/(?:logo|avatar|favicon|icon|banner|ads)/i) &&
          !urls.includes(u)
        ) {
          urls.push(u)
        }
      }

      if (urls.length === 0) {
        const plainRegex =
          /https?:\/\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png)(?:\?[^\s"'<>]*)?/gi
        let m2: RegExpExecArray | null
        while ((m2 = plainRegex.exec(htmlInput)) !== null) {
          const u = m2[0].replace(/&amp;/g, "&")
          if (
            !u.match(/(?:logo|avatar|favicon|icon|banner|ads)/i) &&
            !urls.includes(u)
          ) {
            urls.push(u)
          }
        }
      }

      if (urls.length === 0) {
        toast.error(
          "ไม่พบลิงก์ภาพใน HTML ที่วาง (แนะนำให้ตั้ง Preload = All หรือเลื่อนหน้าให้ครบก่อนคัดลอก .reader-area)"
        )
        return
      }

      const chapMatch =
        targetUrl.match(/chapter-(\d+(?:\.\d+)?)/i) ||
        htmlInput.match(/Chapter\s*(\d+(?:\.\d+)?)/i)
      const chapLabel = chapMatch
        ? `Chapter ${chapMatch[1]}`
        : chapterNumInput
        ? `Chapter ${chapterNumInput}`
        : "Chapter 111"

      setTestResult({
        success: true,
        chapterUrl: targetUrl,
        mangaName:
          testResult?.mangaName || "God-level Assassin, I'm the Shadow",
        thaiTitle: testResult?.thaiTitle || "นักฆ่าระดับเทพ ข้าคือเงามืด",
        mangaId: testResult?.mangaId || "4",
        chapter: chapLabel,
        chapterNumber: chapMatch ? Number(chapMatch[1]) : 111,
        scanGroup: scanGroup || "",
        isLocked: false,
        imagesCount: urls.length,
        allImages: urls,
        sampleImages: urls.slice(0, 6),
      })

      toast.success(
        `🎉 สกัดภาพจาก HTML (.reader-area) สำเร็จ ${urls.length} ภาพ!`
      )
      setHtmlInput("")
      setActiveTab("test")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการแกะ HTML")
    } finally {
      setParsingHtml(false)
    }
  }

  const handleStitchAndUpload = async () => {
    if (!testResult) {
      toast.error("กรุณากดดึงข้อมูลตอนก่อน")
      return
    }

    const rawUrls: string[] =
      testResult.allImages ||
      testResult.images ||
      testResult.sampleImages ||
      []
    if (!rawUrls.length) {
      toast.error("ไม่พบรายการภาพสำหรับเย็บ")
      return
    }

    const totalPages = rawUrls.length
    const targetParts =
      stitchMode === "slices20" ? Math.ceil(totalPages / 20) : 20

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
      const loadedSlices = await Promise.all(
        rawUrls.map((u, i) =>
          loadComixImageElement(u, (notice) => {
            setStitchProgress((prev) =>
              prev
                ? {
                    ...prev,
                    statusText: `ชิ้นที่ ${i + 1}/${totalPages}: ${notice}`,
                  }
                : null
            )
          })
        )
      )

      const validSlices: HTMLImageElement[] = []
      for (let i = 0; i < loadedSlices.length; i++) {
        const img = loadedSlices[i]
        if (!img) {
          throw new Error(
            `ไม่สามารถโหลดชิ้นภาพที่ ${i + 1} จากทั้งหมด ${totalPages} ชิ้นได้`
          )
        }
        validSlices.push(img)
      }

      const sampleIdx =
        validSlices.length >= 15 ? 14 : Math.floor(validSlices.length / 2)
      const standardWidth =
        validSlices[sampleIdx].naturalWidth ||
        validSlices[0].naturalWidth ||
        1280

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
        `📏 ความกว้างมาตรฐาน: ${standardWidth}px | ความสูงรวม: ${totalChapterHeight.toLocaleString()}px (${totalPages} ภาพ) ➔ ซอยเป็น ${totalParts} หน้า`
      )

      let lastFolderUrl = ""

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
        const yPageEnd = Math.min(
          (partIdx + 1) * pageTargetHeight,
          totalChapterHeight
        )
        const canvasH = yPageEnd - yPageStart
        if (canvasH <= 0) continue

        const partRange = `หน้า ${partNum}/${totalParts} (สูง ${canvasH.toLocaleString()}px)`
        setStitchProgress((prev) => ({
          currentPart: partNum,
          totalParts,
          pageRange: partRange,
          percent: Math.round(((partIdx + 1) / totalParts) * 25),
          statusText: `⚡ กำลังตัดเย็บและเรนเดอร์หน้า ${String(partNum).padStart(
            3,
            "0"
          )}.jpg (${partNum}/${totalParts})...`,
          liveCanvasPreview: prev?.liveCanvasPreview,
        }))

        const canvas = document.createElement("canvas")
        canvas.width = standardWidth
        canvas.height = canvasH
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("ไม่สามารถสร้าง 2D Canvas ได้")

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"

        for (const slice of sliceLayouts) {
          if (slice.yBottom <= yPageStart || slice.yTop >= yPageEnd) continue
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

        let thumbnailDataUrl: string | undefined
        try {
          const thumbCanvas = document.createElement("canvas")
          thumbCanvas.width = 160
          thumbCanvas.height = Math.round((canvasH / standardWidth) * 160)
          const thumbCtx = thumbCanvas.getContext("2d")
          if (thumbCtx) {
            thumbCtx.drawImage(
              canvas,
              0,
              0,
              thumbCanvas.width,
              thumbCanvas.height
            )
            thumbnailDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.6)
          }
        } catch {}

        const fileName = `${String(partNum).padStart(3, "0")}.jpg`
        const mimeType = "image/jpeg"

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("สร้าง JPEG ไม่สำเร็จ"))),
            mimeType,
            0.88
          )
        })

        canvas.width = 0
        canvas.height = 0

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

      // Phase A: Page 1
      const p1 = preRenderedPages[0]
      setStitchProgress({
        currentPart: 1,
        totalParts,
        pageRange: `หน้า 1/${totalParts}`,
        percent: 30,
        statusText: `🚀 [Phase A] กำลังอัปโหลด ${p1.fileName} เพื่อสร้างโฟลเดอร์ Google Drive...`,
        liveCanvasPreview: p1.thumbnailDataUrl,
      })

      const targetMangaName =
        testResult.thaiTitle ||
        testResult.mangaName ||
        "นักฆ่าระดับเทพ ข้าคือเงามืด"
      const targetChapter = testResult.chapter || "Chapter 111"

      const resP1 = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
        mangaName: targetMangaName,
        chapter: targetChapter,
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

      if (resP1 && resP1.error) throw new Error(resP1.error)
      lastFolderUrl = resP1?.data?.folderUrl || resP1?.folderUrl || ""
      uploadedCount++

      // Phase B: Pages 2..19 (4 Concurrent Workers)
      if (totalParts > 2) {
        const middlePages = preRenderedPages.slice(1, totalParts - 1)
        let middleUploaded = 0

        const uploadWorker = async (page: PreRenderedPage) => {
          let attempt = 1
          while (attempt <= 3) {
            try {
              const r = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
                mangaName: targetMangaName,
                chapter: targetChapter,
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
                worklink: lastFolderUrl
                  ? `[อัป Raw] ${lastFolderUrl}`
                  : undefined,
              })
              if (r && r.error) throw new Error(r.error)
              middleUploaded++
              uploadedCount++
              setStitchProgress({
                currentPart: page.partNum,
                totalParts,
                pageRange: `หน้า ${page.partNum}/${totalParts}`,
                percent:
                  30 + Math.round((middleUploaded / middlePages.length) * 55),
                statusText: `✓ [Phase B] หน้า ${page.fileName} อัปโหลดสำเร็จ (${middleUploaded}/${middlePages.length})...`,
                liveCanvasPreview: page.thumbnailDataUrl,
              })
              return
            } catch (e) {
              attempt++
              if (attempt > 3) throw e
              await new Promise((r) => setTimeout(r, attempt * 1000))
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

      // Phase C: Last page & WorkQueue entry
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
          mangaName: targetMangaName,
          chapter: targetChapter,
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

        if (resLast && resLast.error) throw new Error(resLast.error)
        lastFolderUrl =
          resLast?.data?.folderUrl || resLast?.folderUrl || lastFolderUrl
        uploadedCount++
      }

      if (uploadedCount === 0) {
        throw new Error("ไม่มีไฟล์ภาพที่อัปโหลดสำเร็จขึ้น Google Drive")
      }

      setStitchProgress({
        currentPart: totalParts,
        totalParts,
        pageRange: `ครบทั้ง ${totalParts} หน้าพอดี`,
        percent: 100,
        statusText: `เย็บแนวตั้งและซอยเป็น ${totalParts} หน้ามาตรฐานเสร็จสิ้น! นำเข้า WorkQueue อัตโนมัติ`,
        folderUrl:
          lastFolderUrl ||
          `https://drive.google.com/drive/folders/${DRIVE_ROOT_FOLDER_ID}`,
      })

      toast.success(
        `🎉 เย็บต่อเนื่อง ${totalParts} หน้า (${targetMangaName} - ${targetChapter}) และลงคิวงานสำเร็จ!`
      )
      if (onSuccess) onSuccess()
    } catch (err: any) {
      console.error("Comix stitch error:", err)
      if (
        err.message &&
        (err.message.includes("DriveApp") ||
          err.message.includes("คุณไม่ได้รับอนุญาต") ||
          err.message.includes("permission"))
      ) {
        setDriveAuthError(err.message)
      }
      toast.error(err.message || "เกิดข้อผิดพลาดในการเย็บและอัปโหลด")
    } finally {
      setStitching(false)
    }
  }

  const readerPreloadSnippet = `localStorage.setItem('reader.webtoon.v3', JSON.stringify({state:{readingDirection:'ttb',pageLayout:'single',preload:'all'},version:0})); location.reload();`

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto bg-[#0d1322] border-purple-500/40 text-slate-100">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#26334d] pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-400">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                  🌐 Comix.to Connector (Multi-Group Scanner)
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-xs">
                    ไม่ต้องล็อกอิน (No Login Required)
                  </Badge>
                </DialogTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  พิมพ์ชื่อค่ายแปลเอง หรือกดปุ่มดึงชื่อค่ายมาใส่ Dropdown แบบรายครั้ง • เย็บ 20 หน้าลง Google Drive
                </p>
              </div>
            </div>
          </div>

          {/* Sub-Tabs */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab("test")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "test"
                  ? "bg-purple-600 text-white shadow-md font-bold"
                  : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
              }`}
            >
              ⚡ ดึงตอนตามค่ายแปล & เย็บ 20 หน้า
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("html")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "html"
                  ? "bg-purple-600 text-white shadow-md font-bold"
                  : "bg-[#151d2f] text-slate-300 hover:text-white border border-[#26334d]"
              }`}
            >
              ✂️ ดึงจาก HTML (.reader-area / img.rpage-page__img)
            </button>
          </div>
        </DialogHeader>

        {activeTab === "test" && (
          <div className="space-y-4 mt-2">
            {/* Target URL & Group Scanner Input */}
            <div className="rounded-xl border border-[#26334d] bg-[#151d2f]/70 p-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  1. วางลิงก์เรื่อง (Title URL) หรือ ลิงก์ตอน (Chapter URL) บน Comix.to:
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://comix.to/title/z0l20-god-level-assassin-im-the-shadow"
                    className="bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-100 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleLoadGroups(targetUrl)}
                    disabled={loadingGroups}
                    className="shrink-0 border-purple-500/40 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40 text-xs cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 mr-1.5 ${
                        loadingGroups ? "animate-spin" : ""
                      }`}
                    />
                    {loadingGroups
                      ? "กำลังดึงรายชื่อค่าย..."
                      : "ดึงชื่อค่ายมาใส่ Dropdown"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1">
                <div className="md:col-span-5 space-y-1">
                  <label className="text-xs font-semibold text-purple-300 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-purple-400" />
                    2. ค่ายแปล (พิมพ์เองได้อิสระ):
                  </label>
                  <Input
                    value={scanGroup}
                    onChange={(e) => setScanGroup(e.target.value)}
                    placeholder="พิมพ์ชื่อค่ายแปลเอง (เว้นว่าง = ทุกค่าย)"
                    className="bg-[#0b0f19] border-purple-500/40 text-xs text-purple-200 font-semibold"
                  />
                </div>

                <div className="md:col-span-5 space-y-1">
                  <label className="text-xs font-semibold text-purple-300">
                    หรือเลือกจาก Dropdown (ที่ดึงมาจากลิงก์):
                  </label>
                  <select
                    className="flex h-9 w-full rounded-md border border-purple-500/40 bg-[#0b0f19] px-3 py-1 text-xs text-purple-200 disabled:opacity-50"
                    value={
                      groups.some(
                        (g) =>
                          g.name.toLowerCase() ===
                          scanGroup.trim().toLowerCase()
                      )
                        ? scanGroup
                        : ""
                    }
                    disabled={groups.length === 0}
                    onChange={(e) => {
                      const val = e.target.value
                      setScanGroup(val)
                    }}
                  >
                    <option value="">
                      {groups.length > 0
                        ? `-- เลือกค่ายแปลจากลิงก์นี้ (${groups.length} ค่าย) --`
                        : "-- กดปุ่ม 'ดึงชื่อค่ายมาใส่ Dropdown' ด้านบน --"}
                    </option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    เลขตอน (ว่าง=ล่าสุด):
                  </label>
                  <Input
                    value={chapterNumInput}
                    onChange={(e) => setChapterNumInput(e.target.value)}
                    placeholder="เช่น 111"
                    className="bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#26334d]/60">
                <div className="text-[11px] text-slate-400">
                  ค่ายที่ระบุ:{" "}
                  <span className="text-purple-300 font-semibold">
                    {scanGroup.trim() || "ไม่เจาะจงค่าย (ดึงตอนล่าสุดรวม)"}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleFetchChapter()}
                  disabled={testingChapter || stitching}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs cursor-pointer"
                >
                  <Zap
                    className={`h-3.5 w-3.5 mr-1.5 ${
                      testingChapter ? "animate-spin" : ""
                    }`}
                  />
                  {testingChapter
                    ? "กำลังดึงภาพ..."
                    : "ดึงภาพตอนนี้ (Fetch Chapter)"}
                </Button>
              </div>
            </div>

            {/* Test Result */}
            {testResult && testResult.success && (
              <div className="rounded-xl border border-[#26334d] bg-[#151d2f]/40 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#26334d] pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">
                        {testResult.thaiTitle || testResult.mangaName}
                      </span>
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-xs">
                        {testResult.chapter}
                      </Badge>
                      {testResult.scanGroup && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs"
                        >
                          ค่ายแปล: {testResult.scanGroup}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      สกัดภาพต้นฉบับสำเร็จ:{" "}
                      <strong className="text-amber-400">
                        {testResult.imagesCount} ภาพ
                      </strong>{" "}
                      • พร้อมเย็บแนวตั้งและซอยเป็น{" "}
                      <strong className="text-emerald-400">20 หน้า</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center rounded-lg border border-[#26334d] bg-[#0b0f19] p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setStitchMode("total20")}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                          stitchMode === "total20"
                            ? "bg-purple-600 text-white font-bold"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        ซอย 20 หน้ามาตรฐาน
                      </button>
                      <button
                        type="button"
                        onClick={() => setStitchMode("slices20")}
                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                          stitchMode === "slices20"
                            ? "bg-purple-600 text-white font-bold"
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
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs gap-1.5 cursor-pointer"
                    >
                      <Layers
                        className={`h-3.5 w-3.5 ${
                          stitching ? "animate-spin" : ""
                        }`}
                      />
                      {stitching
                        ? "กำลังเย็บ & อัปโหลด..."
                        : "เย็บ 20 หน้า & ส่งขึ้น Drive + ลงคิวงาน"}
                    </Button>
                  </div>
                </div>

                {/* Quick Chapter Selector from Group */}
                {testResult.groupChapters &&
                  testResult.groupChapters.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-slate-300">
                        รายการตอนล่าสุดของค่าย{" "}
                        <span className="text-purple-300">
                          {testResult.scanGroup || "ทั้งหมด"}
                        </span>{" "}
                        (คลิกเพื่อสลับตอน):
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1">
                        {testResult.groupChapters
                          .slice(0, 20)
                          .map((ch: any) => {
                            const isCurrent =
                              Number(ch.number) ===
                              Number(testResult.chapterNumber)
                            return (
                              <button
                                key={ch.chapter_id}
                                type="button"
                                onClick={() => {
                                  setChapterNumInput(String(ch.number))
                                  handleFetchChapter({
                                    chapNum: ch.number,
                                    group: ch.group_name || scanGroup,
                                  })
                                }}
                                className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                                  isCurrent
                                    ? "bg-emerald-600 text-white border-emerald-400 font-bold"
                                    : "bg-[#0b0f19] text-slate-300 border-[#26334d] hover:border-purple-400"
                                }`}
                              >
                                Ch.{ch.number} ({ch.group_name})
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}

                {/* Sample Images */}
                {testResult.sampleImages &&
                  testResult.sampleImages.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                        ตัวอย่างภาพที่ดึงได้ ({testResult.imagesCount} หน้า):
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {testResult.sampleImages
                          .slice(0, 6)
                          .map((imgUrl: string, idx: number) => (
                            <div
                              key={idx}
                              className="aspect-[3/4] rounded-lg border border-[#26334d] bg-[#0b0f19] overflow-hidden relative"
                            >
                              <img
                                src={imgUrl}
                                alt={`Page ${idx + 1}`}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] text-white font-mono">
                                #{idx + 1}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Stitch Progress */}
            {stitchProgress && (
              <div className="rounded-xl border border-purple-500/40 bg-purple-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-purple-400 animate-spin" />
                    {stitchProgress.pageRange}
                  </span>
                  <span className="font-mono font-bold text-amber-300">
                    {stitchProgress.percent}%
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${stitchProgress.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>{stitchProgress.statusText}</span>
                  {stitchProgress.folderUrl && (
                    <a
                      href={stitchProgress.folderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-semibold"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      เปิดโฟลเดอร์ Google Drive
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {driveAuthError && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4 text-xs text-red-300 space-y-1">
                <div className="flex items-center gap-2 font-bold text-red-200">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  เกิดข้อผิดพลาดสิทธิ์ Google Drive
                </div>
                <p>{driveAuthError}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "html" && (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/15 p-4 space-y-2.5 text-xs">
              <div className="font-bold text-purple-200 flex items-center gap-1.5">
                <Scissors className="h-4 w-4 text-purple-400" />
                วิธีดึงลิงก์ภาพจาก HTML Element (div.reader-area / img.rpage-page__img)
              </div>
              <p className="text-slate-300 leading-relaxed">
                เนื่องจากเว็บ <code className="text-purple-300">comix.to</code>{" "}
                ตั้งค่าเริ่มต้นของ Reader เป็นแบบ{" "}
                <code className="text-amber-300">preload: &quot;some&quot;</code>{" "}
                (สร้างแท็ก{" "}
                <code className="text-emerald-300">
                  &lt;img class=&quot;rpage-page__img&quot;&gt;
                </code>{" "}
                เฉพาะหน้าที่เลื่อนผ่าน) หากต้องการให้หน้าเว็บโหลด{" "}
                <code>&lt;img&gt;</code> ครบทุกหน้าใน{" "}
                <code>&lt;div class=&quot;reader-area&quot;&gt;</code> ทันที
                สามารถตั้งค่า Preload = All หรือรันคำสั่งด้านล่างใน Console (F12) แล้วคัดลอก HTML ของ{" "}
                <code>.reader-area</code> มาวางได้เลยครับ:
              </p>
              <div className="flex items-center gap-2 bg-[#0b0f19] border border-[#26334d] rounded-lg p-2 font-mono text-[11px] text-emerald-300">
                <span className="truncate flex-1">{readerPreloadSnippet}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] shrink-0 cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(readerPreloadSnippet)
                    toast.success("คัดลอกคำสั่งเปิด Preload All แล้ว!")
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> คัดลอกคำสั่ง
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-200">
                วางโค้ด HTML จาก <code className="text-purple-300">&lt;div class=&quot;reader-area&quot;&gt;</code>:
              </label>
              <Textarea
                value={htmlInput}
                onChange={(e) => setHtmlInput(e.target.value)}
                placeholder='<div class="reader-area"><div class="rpage-pages"><div class="rpage-page"><img class="rpage-page__img" src="https://...">'
                className="h-40 bg-[#0b0f19] border-[#26334d] text-xs font-mono text-slate-200"
              />
            </div>

            <Button
              size="sm"
              onClick={handleParseReaderHtml}
              disabled={parsingHtml}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              {parsingHtml
                ? "กำลังสกัดลิงก์ภาพ..."
                : "สกัดภาพจาก HTML (.reader-area)"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

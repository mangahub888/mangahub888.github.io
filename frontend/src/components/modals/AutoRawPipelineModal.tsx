import * as React from "react"
import { callGasApi } from "@/api/gasClient"
import { parseChapterNumber } from "@/lib/utils"
import { loadImageElement, normalizeKuaikanImageUrl } from "./KuaiKanLoginModal"
import { notifyCoinAlertChange } from "@/lib/kuaikanCoinAlert"
import { KuaikanCoinWarningBanner } from "@/components/ui/KuaikanCoinWarningBanner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Play,
  Pause,
  FastForward,
  Square,
  CheckCircle2,
  AlertCircle,
  Coffee,
  Sparkles,
  ExternalLink,
  Loader2,
  Zap,
  Clock,
  ShieldCheck,
  RefreshCw,
  FolderOpen,
  Github
} from "lucide-react"

export interface PendingChapterTask {
  trackerId: string
  mangaId: string | number
  mangaName: string
  comicId: string | number
  chapterNum: number
  chapterTitle: string
  sourceUrl: string
  connector: string
  status: "pending" | "fetching" | "stitching" | "uploading" | "cooldown" | "done" | "error" | "skipped"
  progress?: number
  statusText?: string
  driveFolderUrl?: string
  error?: string
}

interface AutoRawPipelineModalProps {
  open: boolean
  onClose: () => void
  initialTrackerId?: string | null
  onSuccess?: () => void
}

export function AutoRawPipelineModal({
  open,
  onClose,
  initialTrackerId,
  onSuccess,
}: AutoRawPipelineModalProps) {
  const [loadingTasks, setLoadingTasks] = React.useState(false)
  const [tasks, setTasks] = React.useState<PendingChapterTask[]>([])
  const [isRunning, setIsRunning] = React.useState(false)
  const [isPaused, setIsPaused] = React.useState(false)
  const isPausedRef = React.useRef(false)
  const stopRequestedRef = React.useRef(false)
  const skipCooldownRef = React.useRef(false)

  // Settings
  const [enableCooldown, setEnableCooldown] = React.useState(true)
  const [autoAddQueue, setAutoAddQueue] = React.useState(true)

  // Current execution state
  const [currentTaskIndex, setCurrentTaskIndex] = React.useState<number>(-1)
  const [cooldownRemaining, setCooldownRemaining] = React.useState<number>(0)
  const [cooldownActive, setCooldownActive] = React.useState(false)

  // Keep ref updated
  React.useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Fetch pending tasks from GAS when modal opens
  const fetchPendingTasks = React.useCallback(async () => {
    setLoadingTasks(true)
    try {
      const res = await callGasApi<any>("GET_RAW_TRACKER_PENDING_CHAPTERS", {
        trackerId: initialTrackerId || null,
      })
      if (res && res.tasks) {
        const mapped: PendingChapterTask[] = res.tasks.map((t: any) => ({
          trackerId: t.trackerId,
          mangaId: t.mangaId,
          mangaName: t.mangaName,
          comicId: t.comicId,
          chapterNum: parseChapterNumber(t.chapterNum),
          chapterTitle: t.chapterTitle,
          sourceUrl: t.sourceUrl,
          connector: t.connector || "kuaikan",
          status: "pending",
          progress: 0,
          statusText: "รอเริ่ม",
        }))
        setTasks(mapped)
      } else {
        setTasks([])
      }
    } catch (err: any) {
      console.error("fetchPendingTasks error:", err)
      toast.error(err.message || "ไม่สามารถดึงรายการตอนใหม่ได้")
    } finally {
      setLoadingTasks(false)
    }
  }, [initialTrackerId])

  React.useEffect(() => {
    if (open) {
      fetchPendingTasks()
      setIsRunning(false)
      setIsPaused(false)
      setCurrentTaskIndex(-1)
      setCooldownActive(false)
      stopRequestedRef.current = false
      skipCooldownRef.current = false
    }
  }, [open, fetchPendingTasks])

  // Helper for 5-minute cooldown with live tick and skip support
  const runCooldown = async (seconds: number = 300) => {
    setCooldownActive(true)
    setCooldownRemaining(seconds)
    skipCooldownRef.current = false

    for (let r = seconds; r > 0; r--) {
      if (stopRequestedRef.current) break
      if (skipCooldownRef.current) {
        toast.info("⏩ ข้ามเวลาพัก 5 นาที เริ่มตอนต่อไปทันที!")
        break
      }
      // If paused, hold timer
      while (isPausedRef.current && !stopRequestedRef.current && !skipCooldownRef.current) {
        await new Promise((res) => setTimeout(res, 500))
      }
      setCooldownRemaining(r)
      await new Promise((res) => setTimeout(res, 1000))
    }

    setCooldownActive(false)
    setCooldownRemaining(0)
  }

  // Process a single chapter: Fetch -> Stitch 20 pages -> Upload 001.webp..020.webp -> Complete
  const processChapter = async (
    task: PendingChapterTask,
    taskIdx: number
  ): Promise<{ success: boolean; driveUrl?: string; error?: string }> => {
    // 0. Guard for Tencent connector (requires LDPlayer / Frida emulator decryption)
    if (task.connector === "tencent" || task.connector === "qq") {
      return {
        success: false,
        error: "งาน Tencent มีระบบเข้ารหัสภาพเฉพาะ ต้องรันผ่าน RUN_TENCENT_PIPELINE.bat (1-Click Pipeline) หรือ python tools/tencent_ldplayer_pipeline.py บนเครื่อง",
      }
    }

    // 1. Fetch Chapter Images from GAS
    setTasks((prev) =>
      prev.map((t, idx) =>
        idx === taskIdx
          ? { ...t, status: "fetching", statusText: "กำลังดึงรายการภาพจาก KuaiKan VIP...", progress: 5 }
          : t
      )
    )

    let chapterRes: any = null
    try {
      chapterRes = await callGasApi<any>("TEST_KUAIKAN_CHAPTER", {
        comicId: task.comicId,
      })
    } catch (e: any) {
      return { success: false, error: e.message || "ดึงข้อมูลตอนไม่สำเร็จ" }
    }

    if (!chapterRes || (!chapterRes.success && !chapterRes.data?.success)) {
      const errStr = String(chapterRes?.error || "")
      if (
        chapterRes?.insufficientCoins ||
        chapterRes?.isPay ||
        errStr.includes("เหรียญ") ||
        errStr.includes("coin") ||
        errStr.includes("VIP Lock")
      ) {
        notifyCoinAlertChange({
          hasAlert: true,
          comicId: String(task.comicId),
          comicTitle: task.mangaName || "",
          chapterTitle: task.chapterTitle || `Comic ${task.comicId}`,
          message:
            chapterRes?.error ||
            `⚠️ เหรียญ KuaiKan ไม่เพียงพอสำหรับตอน [${task.mangaName}] กรุณาเติมเหรียญ`,
          requiredCoins: 58,
          timestamp: new Date().toISOString(),
          dismissed: false,
        })
      }
      return { success: false, error: chapterRes?.error || "ไม่พบข้อมูลภาพหรือตอนถูกล็อค" }
    }

    const data = chapterRes.data || chapterRes
    const rawItems: any[] = data.imageDetails || data.allImages || data.sampleImages || []
    if (!rawItems.length) {
      return { success: false, error: "ไม่พบรูปภาพในตอนนี้" }
    }

    const allUrls = rawItems
      .map((item: any) => {
        const raw = typeof item === "string" ? item : (item.rawUrl || item.url)
        const f2 = normalizeKuaikanImageUrl(raw)
        return { url: f2, rawUrl: raw }
      })
      .filter((item) => Boolean(item.url || item.rawUrl))

    const totalImages = allUrls.length
    const totalParts = Math.min(20, totalImages)

    // วัดขนาดความกว้างมาตรฐานจากหน้าย่อยที่ 15 (Index 14) ของเรื่องและตอนนั้นๆ เสมอ (ไม่ล็อค 1280px)
    const sampleIdx = totalImages >= 15 ? 14 : Math.floor(totalImages / 2)
    let standardWidth = 1280
    try {
      const sampleImg = await loadImageElement(allUrls[sampleIdx])
      if (sampleImg && sampleImg.naturalWidth && sampleImg.naturalWidth > 100) {
        standardWidth = sampleImg.naturalWidth
      }
    } catch (e1) {
      console.warn("Could not load slice #15, trying first slice:", e1)
      try {
        const firstImg = await loadImageElement(allUrls[0])
        if (firstImg && firstImg.naturalWidth && firstImg.naturalWidth > 100) {
          standardWidth = firstImg.naturalWidth
        }
      } catch (e2) {}
    }

    setTasks((prev) =>
      prev.map((t, idx) =>
        idx === taskIdx
          ? {
              ...t,
              status: "stitching",
              statusText: `พบ ${totalImages} ชิ้นภาพ (ความกว้างมาตรฐานหน้าย่อยที่ 15: ${standardWidth}px) กำลังเย็บเป็น ${totalParts} หน้า...`,
              progress: 10,
            }
          : t
      )
    )

    let lastFolderUrl = ""

    // 2. Stitch and upload 20 pages
    for (let partIdx = 0; partIdx < totalParts; partIdx++) {
      if (stopRequestedRef.current) {
        return { success: false, error: "ผู้ใช้สั่งหยุดการทำงาน" }
      }
      while (isPausedRef.current && !stopRequestedRef.current) {
        await new Promise((res) => setTimeout(res, 500))
      }

      const partNum = partIdx + 1
      const startIdx = Math.round((partIdx * totalImages) / totalParts)
      const endIdx = Math.round(((partIdx + 1) * totalImages) / totalParts)
      const sliceCount = endIdx - startIdx
      const partUrls = allUrls.slice(startIdx, endIdx)

      const partPercent = 10 + Math.round((partIdx / totalParts) * 80)
      const fileNameDisplay = `${String(partNum).padStart(3, "0")}.jpg`

      setTasks((prev) =>
        prev.map((t, idx) =>
          idx === taskIdx
            ? {
                ...t,
                status: "stitching",
                statusText: `กำลังเย็บ ${fileNameDisplay} (${partNum}/${totalParts}, ${sliceCount} ชิ้น, ความกว้างหน้าย่อย #15: ${standardWidth}px)...`,
                progress: partPercent,
              }
            : t
        )
      )

      // 2.1 Load images with fallback
      const loadedResults = await Promise.all(
        partUrls.map((u) => loadImageElement(u))
      )
      const loadedImages = loadedResults.filter((img): img is HTMLImageElement => img !== null)
      if (!loadedImages.length) {
        console.warn(`Part ${partNum} has no valid loaded images, skipping slice`)
        continue
      }

      // 2.2 Scale to standard width
      let totalHeight = 0
      const scaledItems = loadedImages.map((img) => {
        const scale = standardWidth / img.naturalWidth
        const scaledH = Math.round(img.naturalHeight * scale)
        totalHeight += scaledH
        return { img, scaledH }
      })

      const fileName = `${String(partNum).padStart(3, "0")}.jpg`
      const mimeType = "image/jpeg"

      // 2.3 Draw to Canvas
      const canvas = document.createElement("canvas")
      canvas.width = standardWidth
      canvas.height = totalHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Canvas 2D Context failed")

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"

      let currentY = 0
      for (const item of scaledItems) {
        ctx.drawImage(item.img, 0, currentY, standardWidth, item.scaledH)
        currentY += item.scaledH
      }

      // 2.4 Blob to Base64
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("สร้าง JPEG blob ไม่สำเร็จ"))),
          mimeType,
          0.90
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

      // 2.5 Upload Part to Drive
      setTasks((prev) =>
        prev.map((t, idx) =>
          idx === taskIdx
            ? {
                ...t,
                status: "uploading",
                statusText: `กำลังอัปโหลด ${fileName} (${partNum}/${totalParts}) ขึ้น Drive...`,
              }
            : t
        )
      )

      const isLast = partIdx === totalParts - 1
      let uploadAttempt = 1
      let uploadRes: any = null

      while (uploadAttempt <= 3) {
        try {
          uploadRes = await callGasApi<any>("UPLOAD_CHAPTER_STITCHED_PART", {
            mangaName: data.thaiTitle || data.mangaName || task.mangaName,
            chapter: data.title || task.chapterTitle || `第${task.chapterNum}话`,
            partIndex: partNum,
            totalParts,
            fileName,
            mimeType,
            base64Data,
            isLastPart: isLast,
            clearFolder: partNum === 1,
            mangaId: String(task.mangaId),
            skipQueue: !autoAddQueue,
            isTest: false,
            uploadername: "Apt",
            uploadstatus: "เสร็จแล้ว",
            worklink: lastFolderUrl ? `[อัป Raw] ${lastFolderUrl}` : undefined,
          })
          if (uploadRes && uploadRes.error) throw new Error(uploadRes.error)
          break
        } catch (upErr: any) {
          uploadAttempt++
          if (uploadAttempt > 3) throw upErr
          await new Promise((r) => setTimeout(r, 1500 * uploadAttempt))
        }
      }

      if (uploadRes && uploadRes.folderUrl) {
        lastFolderUrl = uploadRes.folderUrl
      }
    }

    // 3. Complete chapter in Mangas & RawTracker
    setTasks((prev) =>
      prev.map((t, idx) =>
        idx === taskIdx
          ? {
              ...t,
              statusText: "กำลังอัปเดตสถานะตอนลงฐานข้อมูล Mangas & RawTracker...",
              progress: 95,
            }
          : t
      )
    )

    try {
      await callGasApi("COMPLETE_RAW_TRACKER_CHAPTER", {
        mangaId: task.mangaId,
        chapterNum: task.chapterNum,
      })
    } catch (compErr) {
      console.warn("COMPLETE_RAW_TRACKER_CHAPTER warning:", compErr)
    }

    return { success: true, driveUrl: lastFolderUrl }
  }

  // Main Pipeline Runner
  const handleStartPipeline = async () => {
    if (!tasks.length) return
    setIsRunning(true)
    setIsPaused(false)
    stopRequestedRef.current = false
    skipCooldownRef.current = false

    toast.info(`🚀 เริ่มประมวลผล Auto Raw Pipeline ทั้งหมด ${tasks.length} ตอน`)

    for (let i = 0; i < tasks.length; i++) {
      if (stopRequestedRef.current) break

      const task = tasks[i]
      if (task.status === "done") continue

      setCurrentTaskIndex(i)

      try {
        const result = await processChapter(task, i)
        if (result.success) {
          setTasks((prev) =>
            prev.map((t, idx) =>
              idx === i
                ? {
                    ...t,
                    status: "done",
                    progress: 100,
                    statusText: "✓ เย็บครบ 20 หน้า อัปโหลด และลงคิวงานแล้ว",
                    driveFolderUrl: result.driveUrl,
                  }
                : t
            )
          )
          toast.success(`🎉 เย็บและลงคิวงานสำเร็จ: ${task.mangaName} ${task.chapterTitle}`)
        } else {
          setTasks((prev) =>
            prev.map((t, idx) =>
              idx === i
                ? {
                    ...t,
                    status: "error",
                    error: result.error || "เกิดข้อผิดพลาดในการประมวลผล",
                    statusText: `❌ ล้มเหลว: ${result.error}`,
                  }
                : t
            )
          )
          toast.error(`❌ ล้มเหลว: ${task.mangaName} ${task.chapterTitle} (${result.error})`)
        }
      } catch (err: any) {
        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i
              ? {
                  ...t,
                  status: "error",
                  error: err.message,
                  statusText: `❌ ขัดข้อง: ${err.message}`,
                }
              : t
          )
        )
      }

      // Check if there are more tasks pending
      const hasMoreTasks = i < tasks.length - 1 && !stopRequestedRef.current
      if (hasMoreTasks && enableCooldown) {
        setTasks((prev) =>
          prev.map((t, idx) =>
            idx === i ? { ...t, statusText: "✓ สำเร็จ (กำลังพัก 5 นาที...)" } : t
          )
        )
        // 5-minute Cooldown (300 seconds)
        await runCooldown(300)
      }
    }

    setIsRunning(false)
    setCurrentTaskIndex(-1)
    setCooldownActive(false)
    toast.success("🏁 จบกระบวนการ Auto Raw Pipeline ครบทุกตอนแล้ว!")
    if (onSuccess) onSuccess()
  }

  const handlePause = () => {
    setIsPaused(true)
    toast.info("⏸️ พักการทำงานชั่วคราว (จะทำต่อทันทีเมื่อกด Resume)")
  }

  const handleResume = () => {
    setIsPaused(false)
    toast.info("▶️ ทำงานต่อทันที")
  }

  const handleStop = () => {
    stopRequestedRef.current = true
    setIsRunning(false)
    setIsPaused(false)
    setCooldownActive(false)
    toast.warning("⏹️ สั่งหยุดการทำงานเรียบร้อยแล้ว")
  }

  const handleSkipCooldown = () => {
    skipCooldownRef.current = true
  }

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const completedCount = tasks.filter((t) => t.status === "done").length
  const totalCount = tasks.length

  return (
    <Dialog open={open} onOpenChange={(v) => (!isRunning ? onClose() : null)}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col bg-[#0b0f19] border-[#22304a] text-slate-100 p-0 overflow-hidden shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-[#1c273c] bg-[#0e1424]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-600 to-indigo-600 text-white shadow-lg shadow-pink-500/20">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                  Auto Raw Pipeline
                  <Badge className="bg-pink-600/30 text-pink-300 border border-pink-500/40 text-xs">
                    Raw Tracker ➔ VIP Stitch ➔ Drive ➔ WorkQueue
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400 mt-0.5">
                  ดาวน์โหลด เย็บ 20 หน้า (001.jpg - 020.jpg) อัปขึ้น แปลจนเมื่อย และลงคิวงานอัตโนมัติ พร้อมพัก 5 นาทีระหว่างตอน
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="https://github.com/mangahub888/mangahub888.github.io/actions/workflows/auto_raw_tracker.yml"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition shadow-sm"
                title="สั่งรันใน Cloud ผ่าน GitHub Actions ไม่ต้องเปิดหน้าเว็บหรือคอมพิวเตอร์ทิ้งไว้"
              >
                <Github className="h-3.5 w-3.5 text-white" />
                <span>รันบน GitHub Actions</span>
                <ExternalLink className="h-3 w-3 text-slate-400" />
              </a>

              <Button
                variant="ghost"
                size="sm"
                onClick={fetchPendingTasks}
                disabled={isRunning || loadingTasks}
                className="text-slate-400 hover:text-white hover:bg-slate-800"
                title="รีเฟรชรายการตอนใหม่"
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingTasks ? "animate-spin" : ""}`} />
                รีเฟรช
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* KuaiKan Insufficient Coins Warning Banner */}
        <div className="px-6 pt-3">
          <KuaikanCoinWarningBanner compact={true} />
        </div>

        {/* Cooldown Active Banner */}
        {cooldownActive && (
          <div className="bg-amber-950/40 border-b border-amber-500/30 p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center animate-pulse">
                <Coffee className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                  ☕ จบ 1 ตอนแล้ว! กำลังพัก 5 นาทีเพื่อความปลอดภัยของบัญชี KuaiKan VIP
                  <span className="text-xs font-mono font-bold bg-amber-500/20 px-2 py-0.5 rounded text-amber-300">
                    {formatCountdown(cooldownRemaining)}
                  </span>
                </div>
                <div className="text-xs text-amber-300/70">
                  ระบบจะเริ่มทำตอนถัดไปอัตโนมัติเมื่อครบเวลา หรือคุณสามารถกดข้ามการพักได้ทันที
                </div>
              </div>
            </div>

            <Button
              size="sm"
              onClick={handleSkipCooldown}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-md shadow-amber-600/30 h-8"
            >
              <FastForward className="h-4 w-4 mr-1.5" />
              ข้ามการพัก 5 นาที (เริ่มตอนต่อไป)
            </Button>
          </div>
        )}

        {/* Task List / Queue */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5 custom-scrollbar">
          {loadingTasks ? (
            <div className="py-16 text-center text-slate-400">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-pink-500 mb-3" />
              <p className="text-sm font-medium">กำลังสแกนรายการตอนใหม่จาก Raw Tracker...</p>
            </div>
          ) : !tasks.length ? (
            <div className="py-16 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
              <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-400 mb-2 opacity-80" />
              <p className="text-base font-semibold text-white">ไม่มีตอนใหม่ที่รออัป raw</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                รายการติดตามทั้งหมดเป็นปัจจุบันแล้ว เมื่อมังงะมีตอนใหม่ ระบบจะมาแสดงรอในหน้านี้ทันที
              </p>
            </div>
          ) : (
            tasks.map((task, idx) => {
              const isCurrent = currentTaskIndex === idx
              return (
                <div
                  key={`${task.trackerId}-${task.comicId}`}
                  className={`p-4 rounded-xl border transition-all duration-200 ${
                    isCurrent
                      ? "bg-slate-900/90 border-pink-500/50 shadow-lg shadow-pink-500/10 ring-1 ring-pink-500/30"
                      : task.status === "done"
                      ? "bg-emerald-950/20 border-emerald-500/30 text-slate-300"
                      : task.status === "error"
                      ? "bg-rose-950/20 border-rose-500/30"
                      : "bg-[#111726]/80 border-[#22304a] hover:border-slate-700"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-start gap-3">
                      <div className="text-xs font-mono font-bold text-slate-500 bg-slate-800 px-2 py-1 rounded-md mt-0.5">
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-white flex items-center gap-2">
                          <Badge className={`text-[10px] px-1.5 py-0.2 ${task.connector === 'thunderscans' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : task.connector === 'tencent' || task.connector === 'qq' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-pink-500/20 text-pink-300 border border-pink-500/40'}`}>
                            {task.connector === 'thunderscans' ? 'Thunder' : task.connector === 'tencent' || task.connector === 'qq' ? 'Tencent' : 'KuaiKan'}
                          </Badge>
                          <span>{task.mangaName}</span>
                          <Badge variant="outline" className="text-xs border-indigo-500/40 text-indigo-300">
                            {task.chapterTitle}
                          </Badge>
                          <span className="text-[11px] text-slate-400 font-mono">
                            (ComicID: {task.comicId})
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                          <span>{task.statusText}</span>
                          {task.driveFolderUrl && (
                            <a
                              href={task.driveFolderUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 underline underline-offset-2"
                            >
                              <FolderOpen className="h-3 w-3" /> เปิด Google Drive
                            </a>
                          )}
                          {(task.connector === "tencent" || task.connector === "qq") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard.writeText(`python tools/tencent_ldplayer_pipeline.py --comic-id ${task.comicId} --chapter ${task.chapterNum}`)
                                toast.success("📋 คัดลอกคำสั่งรัน Tencent Pipeline เรียบร้อย!")
                              }}
                              className="h-5 text-[10px] px-2 py-0 border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/40"
                              title="คัดลอกคำสั่งรันผ่าน LDPlayer บนเครื่อง"
                            >
                              คัดลอกคำสั่งรัน LDPlayer
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.status === "done" && (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                          ลงคิวงานแล้ว
                        </Badge>
                      )}
                      {task.status === "error" && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertCircle className="h-3.5 w-3.5 mr-1" />
                          ผิดพลาด
                        </Badge>
                      )}
                      {isCurrent && isRunning && (
                        <Badge className="bg-pink-500/20 text-pink-300 border border-pink-500/40 animate-pulse">
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          กำลังทำงาน...
                        </Badge>
                      )}
                      {task.status === "pending" && !isCurrent && (
                        <Badge variant="outline" className="border-slate-700 text-slate-400">
                          รอเริ่ม
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for running task */}
                  {isCurrent && isRunning && (
                    <div className="mt-3 space-y-1">
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-pink-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.max(5, task.progress || 0)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer Settings & Controls */}
        <div className="p-4 px-6 border-t border-[#1c273c] bg-[#0e1424] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCooldown}
                onChange={(e) => setEnableCooldown(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-700 bg-slate-800 text-pink-600 focus:ring-pink-500 h-4 w-4"
              />
              <span className="flex items-center gap-1 font-medium">
                <Coffee className="h-3.5 w-3.5 text-amber-400" />
                พัก 5 นาทีระหว่างตอน (Anti-Ban 300s)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAddQueue}
                onChange={(e) => setAutoAddQueue(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
              />
              <span className="flex items-center gap-1 font-medium">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                ลงคิวงาน WorkQueue อัตโนมัติ
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2.5">
            {!isRunning ? (
              <>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800 h-9"
                >
                  ปิด
                </Button>
                <Button
                  onClick={handleStartPipeline}
                  disabled={loadingTasks || !tasks.length}
                  className="bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-700 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-pink-600/30 h-9 px-5"
                >
                  <Play className="h-4 w-4 mr-1.5 fill-current" />
                  เริ่มทำงานทั้งหมด ({tasks.length} ตอน)
                </Button>
              </>
            ) : (
              <>
                {!isPaused ? (
                  <Button
                    variant="outline"
                    onClick={handlePause}
                    className="border-amber-500/40 text-amber-300 hover:bg-amber-950/40 h-9"
                  >
                    <Pause className="h-4 w-4 mr-1.5" />
                    พักชั่วคราว
                  </Button>
                ) : (
                  <Button
                    onClick={handleResume}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-9"
                  >
                    <Play className="h-4 w-4 mr-1.5 fill-current" />
                    ทำงานต่อ
                  </Button>
                )}

                <Button
                  variant="destructive"
                  onClick={handleStop}
                  className="bg-rose-600 hover:bg-rose-700 text-white h-9"
                >
                  <Square className="h-4 w-4 mr-1.5 fill-current" />
                  หยุด
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

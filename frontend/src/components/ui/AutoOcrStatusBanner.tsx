import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Bot,
  RefreshCw,
  ExternalLink,
  Play,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  Sparkles,
  FastForward,
  Layers,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { callGasApi } from "@/api/gasClient"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"
import { isStepDone, resolveMangaName } from "@/lib/utils"

interface AutoOcrStatusBannerProps {
  onQueueRefresh?: () => void
  queueList?: any[]
  mangaList?: any[]
  className?: string
}

export function AutoOcrStatusBanner({
  onQueueRefresh,
  queueList = [],
  mangaList = [],
  className = "",
}: AutoOcrStatusBannerProps) {
  const [isOcrCollapsed, setIsOcrCollapsed] = React.useState(false)
  const [isPsdCollapsed, setIsPsdCollapsed] = React.useState(false)
  const [isTriggeringOcr, setIsTriggeringOcr] = React.useState(false)
  const [isTriggeringPsd, setIsTriggeringPsd] = React.useState(false)
  const [selectedOcrQueueId, setSelectedOcrQueueId] = React.useState("")
  const [selectedPsdQueueId, setSelectedPsdQueueId] = React.useState("")
  const [isSingleOcrRunning, setIsSingleOcrRunning] = React.useState(false)
  const [isSinglePsdRunning, setIsSinglePsdRunning] = React.useState(false)

  // 1. GitHub Actions Status
  const {
    isMangaOcrRunning,
    isExportPsdRunning,
    activeMangaOcrRun,
    activeExportPsdRun,
    latestMangaOcrRun,
    latestExportPsdRun,
    refetch: refetchGitRuns,
  } = useGitHubActionsStatus()

  // 2. GAS OCR & PSD Scheduler & Stats Query
  const {
    data: gasOcrStatus,
    isLoading: isLoadingGas,
    refetch: refetchGasStatus,
  } = useQuery({
    queryKey: ["mangaOcrGasStatus"],
    queryFn: async () => {
      try {
        const res = await callGasApi("GET_MANGA_OCR_STATUS")
        return res
      } catch (err) {
        console.warn("Failed to fetch GET_MANGA_OCR_STATUS:", err)
        return null
      }
    },
    refetchInterval: 30000,
    staleTime: 15000,
  })

  // Auto-refresh queue and stats when GitHub Actions run finishes
  const prevIsOcrRunningRef = React.useRef(isMangaOcrRunning)
  const prevIsPsdRunningRef = React.useRef(isExportPsdRunning)

  React.useEffect(() => {
    if (
      (prevIsOcrRunningRef.current && !isMangaOcrRunning) ||
      (prevIsPsdRunningRef.current && !isExportPsdRunning)
    ) {
      onQueueRefresh?.()
      refetchGasStatus()
    }
    prevIsOcrRunningRef.current = isMangaOcrRunning
    prevIsPsdRunningRef.current = isExportPsdRunning
  }, [isMangaOcrRunning, isExportPsdRunning, onQueueRefresh, refetchGasStatus])

  // Format relative time helper
  const formatTimeAgo = (isoString?: string) => {
    if (!isoString) return "-"
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return "-"
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diffSec < 60) return "เมื่อสักครู่"
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ชม. ที่แล้ว`
    return d.toLocaleDateString("th-TH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Compute local fallback stats from queueList if available
  const computedStats = React.useMemo(() => {
    let pendingPsd = 0
    let skippedPsd = 0
    let donePsd = 0
    const ocrCandidates: any[] = []
    const psdCandidates: any[] = []

    queueList.forEach((q) => {
      const manga = mangaList.find((m) => String(m.mangaid) === String(q.mangaid))
      const mangaTitle = resolveMangaName(q.mangaid, manga?.manganame, mangaList)
      const isPrat = String(
        q.translatorname || (manga && manga.lockedtranslator) || ""
      )
        .toLowerCase()
        .includes("pratchaya")
      const psdSt = String(q.psdstatus || "").trim().toLowerCase()
      const trDone = isStepDone(q.translatestatus)
      const tsDone = isStepDone(q.typesetstatus)
      const postDone = isStepDone(q.poststatus)

      if (psdSt === "skip" || isPrat) {
        skippedPsd++
      } else if (psdSt === "เสร็จแล้ว" || tsDone) {
        donePsd++
      } else if (trDone && !tsDone && !postDone) {
        pendingPsd++
      }

      if (!postDone) {
        if (!isStepDone(q.extractstatus) && !isPrat) {
          ocrCandidates.push({ ...q, mangaTitle, manga })
        }
        if (!isPrat) {
          psdCandidates.push({ ...q, mangaTitle, manga })
        }
      }
    })

    return {
      pendingPsd,
      skippedPsd,
      donePsd,
      ocrCandidates: ocrCandidates.slice(0, 60),
      psdCandidates: psdCandidates.slice(0, 60),
    }
  }, [queueList, mangaList])

  // Handle Manual Batch OCR Trigger
  const handleTriggerManualOcr = async () => {
    if (isTriggeringOcr) return
    setIsTriggeringOcr(true)
    const toastId = toast.loading("กำลังสั่ง GAS สแกน Google Drive และส่งเข้า GitHub Actions OCR...")

    try {
      const res: any = await callGasApi("RUN_MANGA_OCR_SCHEDULED_JOB")
      const count = res?.triggeredCount ?? 0
      const total = res?.totalEligible ?? 0

      if (count > 0) {
        toast.success(
          `ส่งงานเข้า GitHub Actions OCR เรียบร้อยแล้ว! (${count} ตอนจาก ${total} ตอนที่รอ)`,
          { id: toastId }
        )
      } else {
        toast.info(
          total > 0
            ? `สแกนพบ ${total} ตอน แต่มีไฟล์ .mtp ใน Drive ครบแล้ว จึงข้ามการดึงคำซ้ำ`
            : "ไม่พบคิวงานที่รอการดึงคำออโต้ในขณะนี้",
          { id: toastId }
        )
      }

      await Promise.allSettled([refetchGasStatus(), refetchGitRuns()])
      onQueueRefresh?.()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการสั่งรันดึงคำออโต้", { id: toastId })
    } finally {
      setIsTriggeringOcr(false)
    }
  }

  // Handle Manual Batch PSD Trigger
  const handleTriggerBatchPsd = async () => {
    if (isTriggeringPsd) return
    setIsTriggeringPsd(true)
    const toastId = toast.loading("กำลังสแกนตอนที่แปลเสร็จแล้วและส่งเข้า GitHub Actions Export PSD...")

    try {
      const res: any = await callGasApi("RUN_EXPORT_PSD_BATCH_JOB", { maxBatch: 3 })
      const count = res?.triggeredCount ?? 0
      const total = res?.totalEligible ?? 0

      if (count > 0) {
        toast.success(
          `ส่งงานเข้า GitHub Actions Export PSD เรียบร้อยแล้ว! (${count} ตอนจาก ${total} ตอนที่แปลเสร็จ)`,
          { id: toastId }
        )
      } else {
        toast.info(
          "ไม่พบตอนที่แปลเสร็จแล้วที่รอ Export PSD (หรือคุณสามารถเลือกตอนด้านล่างเพื่อสั่งรันรายตอนได้ทันที)",
          { id: toastId }
        )
      }

      await Promise.allSettled([refetchGasStatus(), refetchGitRuns()])
      onQueueRefresh?.()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการสั่งรัน Export PSD", { id: toastId })
    } finally {
      setIsTriggeringPsd(false)
    }
  }

  // Handle Single Selected OCR Trigger
  const handleRunSelectedOcr = async () => {
    if (!selectedOcrQueueId || isSingleOcrRunning) return
    const target = queueList.find((q) => String(q.queueid) === String(selectedOcrQueueId))
    if (!target) return
    const manga = mangaList.find((m) => String(m.mangaid) === String(target.mangaid))
    const mangaTitle = resolveMangaName(target.mangaid, manga?.manganame, mangaList)

    setIsSingleOcrRunning(true)
    const toastId = toast.loading(`กำลังส่ง ${mangaTitle} ตอนที่ ${target.chapter} ไปรัน OCR...`)
    try {
      const res: any = await callGasApi("TRIGGER_MANGA_OCR", {
        queueId: target.queueid,
        mangaName: mangaTitle,
        chapterNum: target.chapter,
        workLink: target.worklink,
        mangaId: target.mangaid,
        docUrl: manga?.translationdocurl || "",
      })
      if (res?.success) {
        toast.success(`ส่ง ${mangaTitle} ตอนที่ ${target.chapter} เข้า GitHub Actions OCR สำเร็จ!`, {
          id: toastId,
        })
        await Promise.allSettled([refetchGasStatus(), refetchGitRuns()])
        onQueueRefresh?.()
      } else {
        toast.error(res?.error || "ส่งเข้า GitHub Actions ไม่สำเร็จ", { id: toastId })
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการสั่งรัน OCR", { id: toastId })
    } finally {
      setIsSingleOcrRunning(false)
    }
  }

  // Handle Single Selected PSD Trigger
  const handleRunSelectedPsd = async () => {
    if (!selectedPsdQueueId || isSinglePsdRunning) return
    const target = queueList.find((q) => String(q.queueid) === String(selectedPsdQueueId))
    if (!target) return
    const manga = mangaList.find((m) => String(m.mangaid) === String(target.mangaid))
    const mangaTitle = resolveMangaName(target.mangaid, manga?.manganame, mangaList)

    setIsSinglePsdRunning(true)
    const toastId = toast.loading(`กำลังส่ง ${mangaTitle} ตอนที่ ${target.chapter} ไปรัน Export PSD...`)
    try {
      const res: any = await callGasApi("TRIGGER_EXPORT_PSD", {
        queueId: target.queueid,
        mangaName: mangaTitle,
        chapterNum: target.chapter,
        workLink: target.worklink,
        mangaId: target.mangaid,
        docUrl: manga?.translationdocurl || "",
        font: "TF LANNA Bold",
        full_run: "true",
      })
      if (res?.success) {
        toast.success(`ส่ง ${mangaTitle} ตอนที่ ${target.chapter} เข้า Export PSD สำเร็จ!`, {
          id: toastId,
        })
        await Promise.allSettled([refetchGasStatus(), refetchGitRuns()])
        onQueueRefresh?.()
      } else {
        toast.error(res?.error || "ส่งเข้า GitHub Actions ไม่สำเร็จ", { id: toastId })
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการสั่งรัน Export PSD", { id: toastId })
    } finally {
      setIsSinglePsdRunning(false)
    }
  }

  const is6HourActive = gasOcrStatus?.is6HourTriggerActive ?? true
  const lastOcrTriggerTime = gasOcrStatus?.lastPipelineTrigger?.lastTriggeredAt
  const lastOcrBatch = gasOcrStatus?.lastBatchSummary
  const lastPsdTrigger = gasOcrStatus?.lastPsdTrigger
  const lastPsdBatch = gasOcrStatus?.lastPsdBatchSummary
  const stats = gasOcrStatus?.stats

  // OCR Stats
  const pendingOcr = stats?.pendingOcr ?? 0
  const skippedOcr = stats?.skippedOcr ?? 0
  const doneOcr = stats?.doneOcr ?? 0
  const totalOcrTasks = stats?.totalTasks ?? (pendingOcr + skippedOcr + doneOcr || 1)
  const ocrProgressPercent = Math.min(
    100,
    Math.round(((skippedOcr + doneOcr) / (totalOcrTasks || 1)) * 100)
  )

  // PSD Stats
  const pendingPsd = stats?.pendingPsd ?? computedStats.pendingPsd
  const skippedPsd = stats?.skippedPsd ?? computedStats.skippedPsd
  const donePsd = stats?.donePsd ?? computedStats.donePsd
  const totalPsdTasks = pendingPsd + skippedPsd + donePsd || 1
  const psdProgressPercent = Math.min(
    100,
    Math.round(((skippedPsd + donePsd) / totalPsdTasks) * 100)
  )

  const ocrGitUrl =
    activeMangaOcrRun?.html_url ||
    latestMangaOcrRun?.html_url ||
    "https://github.com/mangahub888/mangahub888.github.io/actions/workflows/gdrive_ocr.yml"

  const psdGitUrl =
    activeExportPsdRun?.html_url ||
    latestExportPsdRun?.html_url ||
    "https://github.com/mangahub888/mangahub888.github.io/actions/workflows/export_psd.yml"

  return (
    <div className={`grid grid-cols-1 xl:grid-cols-2 gap-4 ${className}`}>
      {/* =====================================================================
          CARD 1: MANGA OCR PIPELINE (ดึงคำออโต้ -> .MTP)
         ===================================================================== */}
      <div className="relative overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-r from-[#0c182a] via-[#0d2238] to-[#111f33] p-4 text-white shadow-xl shadow-cyan-950/20 transition-all">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div className="flex items-start sm:items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 shadow-inner shadow-cyan-500/30">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm sm:text-base text-cyan-100 flex items-center gap-1.5">
                  🤖 1. สถานะดึงคำออโต้ (GAS + GitHub Actions OCR)
                </span>

                {isMangaOcrRunning && activeMangaOcrRun ? (
                  <Badge className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 text-[11px] font-bold animate-pulse flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin text-cyan-300" />
                    กำลังดึงคำ AI (Run #{activeMangaOcrRun.run_number})
                  </Badge>
                ) : latestMangaOcrRun ? (
                  <Badge className="bg-slate-800/80 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Git Standby (#{latestMangaOcrRun.run_number} • {formatTimeAgo(latestMangaOcrRun.created_at)})
                  </Badge>
                ) : (
                  <Badge className="bg-slate-800/80 text-slate-400 border border-slate-700 text-[11px]">
                    Git Standby
                  </Badge>
                )}

                <Badge
                  className={`text-[11px] border ${
                    is6HourActive
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                  }`}
                >
                  <Clock className="h-3 w-3 mr-1 inline" />
                  {is6HourActive ? "GAS ทุก 6 ชม. (Active)" : "GAS Trigger: ปิดอยู่"}
                </Badge>
              </div>

              <p className="text-xs text-slate-300 mt-0.5">
                ดึงคำอัตโนมัติด้วย Manga OCR ผ่าน GitHub Actions ส่งไฟล์ .mtp กลับเข้า Google Drive ต้นทาง
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <Button
              size="sm"
              onClick={handleTriggerManualOcr}
              disabled={isTriggeringOcr || isMangaOcrRunning}
              className="h-8 text-xs font-semibold bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-md shadow-cyan-900/30 border border-cyan-400/30 cursor-pointer"
              title="สั่งให้ GAS สแกนคิวงานที่ยังไม่ได้ดึงคำและยิงเข้า GitHub Actions ทันที"
            >
              {isTriggeringOcr ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
              )}
              <span>{isTriggeringOcr ? "กำลังส่งงาน..." : "สั่งดึงคำทันที (Run Now)"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              asChild
              className="h-8 text-xs font-medium border-cyan-500/30 bg-[#0e1d33] text-cyan-200 hover:bg-cyan-950/60 hover:text-white"
            >
              <a href={ocrGitUrl} target="_blank" rel="noreferrer" title="คลิกดู Log สดการรัน OCR บน GitHub Actions">
                <FolderGit2 className="h-3.5 w-3.5 mr-1.5 text-cyan-400" />
                <span>ดู Log บน Git</span>
                <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
              </a>
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                refetchGasStatus()
                refetchGitRuns()
                toast.success("รีเฟรชสถานะ OCR & PSD แล้ว")
              }}
              disabled={isLoadingGas}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
              title="รีเฟรชสถานะ"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingGas ? "animate-spin text-cyan-400" : ""}`} />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsOcrCollapsed(!isOcrCollapsed)}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
              title={isOcrCollapsed ? "ขยายดูรายละเอียด" : "ย่อแถบ"}
            >
              {isOcrCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Expanded Content */}
        {!isOcrCollapsed && (
          <div className="mt-4 pt-3 border-t border-cyan-500/20 space-y-3 relative z-10">
            {/* Quick Single-Chapter Selector */}
            {computedStats.ocrCandidates.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-lg bg-[#081221]/90 border border-cyan-500/25 p-2">
                <span className="text-[11px] font-semibold text-cyan-300 whitespace-nowrap flex items-center gap-1 px-1">
                  <Zap className="h-3.5 w-3.5 text-cyan-400" /> สั่งรัน OCR รายตอน:
                </span>
                <select
                  value={selectedOcrQueueId}
                  onChange={(e) => setSelectedOcrQueueId(e.target.value)}
                  className="flex-1 h-8 rounded border border-cyan-800/60 bg-[#0b1629] px-2 text-xs text-slate-100"
                >
                  <option value="">-- เลือกเรื่อง / ตอนที่ต้องการส่งรัน OCR --</option>
                  {computedStats.ocrCandidates.map((item) => (
                    <option key={item.queueid} value={item.queueid}>
                      {item.mangaTitle} - ตอนที่ {item.chapter} ({item.ocrstatus || "รอเริ่ม"})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!selectedOcrQueueId || isSingleOcrRunning}
                  onClick={handleRunSelectedOcr}
                  className="h-8 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shrink-0 cursor-pointer"
                >
                  {isSingleOcrRunning ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1 fill-current" />
                  )}
                  รัน OCR ตอนที่เลือก
                </Button>
              </div>
            )}

            {/* Progress Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  ความคืบหน้ารวมขั้นตอนดึงคำ (OCR / QC Extract Progress)
                </span>
                <span className="font-mono text-cyan-300 font-bold">
                  {ocrProgressPercent}% ({skippedOcr + doneOcr}/{totalOcrTasks} ตอน)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden flex p-0.5 border border-slate-700/60">
                <div
                  style={{ width: `${(skippedOcr / totalOcrTasks) * 100}%` }}
                  className="bg-indigo-500 rounded-l-full h-full transition-all duration-500"
                  title={`ข้าม (Kikkuk ดึงคำแล้ว): ${skippedOcr} ตอน`}
                />
                <div
                  style={{ width: `${(doneOcr / totalOcrTasks) * 100}%` }}
                  className="bg-cyan-400 h-full transition-all duration-500"
                  title={`ดึงคำออโต้สำเร็จ (.mtp): ${doneOcr} ตอน`}
                />
                <div
                  style={{ width: `${(pendingOcr / totalOcrTasks) * 100}%` }}
                  className="bg-amber-400/80 rounded-r-full h-full transition-all duration-500 animate-pulse"
                  title={`รอดึงคำออโต้: ${pendingOcr} ตอน`}
                />
              </div>
            </div>

            {/* 3 Detail Info Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium">📥 รอดึงคำออโต้ (Pending)</p>
                  <p className="text-lg font-bold text-amber-300 mt-0.5">
                    {pendingOcr} <span className="text-xs font-normal text-slate-400">ตอน</span>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">พร้อมส่งเข้า Git เมื่อถึงรอบ 6 ชม.</p>
                </div>
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                  รอคิว
                </Badge>
              </div>

              <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium">⏭️ ข้าม (Skip: Kikkuk ดึงแล้ว)</p>
                  <p className="text-lg font-bold text-indigo-300 mt-0.5">
                    {skippedOcr} <span className="text-xs font-normal text-slate-400">ตอน</span>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">ไม่ต้องรัน AI ซ้ำ ผ่านไป QC ได้เลย</p>
                </div>
                <FastForward className="h-5 w-5 text-indigo-400 opacity-60" />
              </div>

              <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-400 font-medium">🕒 GAS รันอัตโนมัติล่าสุด</p>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {lastOcrTriggerTime ? formatTimeAgo(lastOcrTriggerTime) : "ยังไม่มีข้อมูล"}
                  </span>
                </div>
                {lastOcrBatch ? (
                  <p className="text-xs text-slate-200 mt-1">
                    รอบล่าสุดพบ <strong className="text-cyan-300">{lastOcrBatch.totalEligible || 0} ตอน</strong> • สั่งรันไป{" "}
                    <strong className="text-emerald-300">{lastOcrBatch.triggeredCount || 0} ตอน</strong>
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">
                    ตั้งเวลาทริกเกอร์ทุก 6 ชั่วโมงเพื่อสแกนโฟลเดอร์ Google Drive อัตโนมัติ
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          CARD 2: EXPORT PSD PIPELINE (Inpaint + Typeset -> .PSD)
         ===================================================================== */}
      <div className="relative overflow-hidden rounded-xl border border-purple-500/30 bg-gradient-to-r from-[#18102b] via-[#211339] to-[#1a1230] p-4 text-white shadow-xl shadow-purple-950/20 transition-all">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-fuchsia-500/10 blur-3xl pointer-events-none" />

        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div className="flex items-start sm:items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-500/40 bg-purple-500/20 text-purple-300 shadow-inner shadow-purple-500/30">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm sm:text-base text-purple-100 flex items-center gap-1.5">
                  🎨 2. สถานะ Export PSD (LaMa Inpaint + GitHub Actions PSD)
                </span>

                {isExportPsdRunning && activeExportPsdRun ? (
                  <Badge className="bg-purple-500/20 text-purple-300 border border-purple-500/50 text-[11px] font-bold animate-pulse flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-spin text-purple-300" />
                    กำลังสร้าง PSD (Run #{activeExportPsdRun.run_number})
                  </Badge>
                ) : latestExportPsdRun ? (
                  <Badge className="bg-slate-800/80 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Git Standby (#{latestExportPsdRun.run_number} • {formatTimeAgo(latestExportPsdRun.created_at)})
                  </Badge>
                ) : (
                  <Badge className="bg-slate-800/80 text-slate-400 border border-slate-700 text-[11px]">
                    Git Standby
                  </Badge>
                )}

                <Badge className="text-[11px] border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
                  <Sparkles className="h-3 w-3 mr-1 inline" />
                  Auto เมื่อแปลเสร็จ (Active)
                </Badge>
              </div>

              <p className="text-xs text-slate-300 mt-0.5">
                ลบข้อความด้วย LaMa AI + ลงคำแปลจาก Docs (ฟอนต์ TF LANNA Bold) + อัปโหลดไฟล์ .psd เข้า Google Drive
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <Button
              size="sm"
              onClick={handleTriggerBatchPsd}
              disabled={isTriggeringPsd || isExportPsdRunning}
              className="h-8 text-xs font-semibold bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white shadow-md shadow-purple-900/30 border border-purple-400/30 cursor-pointer"
              title="สั่งสแกนคิวงานที่แปลเสร็จแล้วและส่งไปสร้างไฟล์ PSD บน GitHub Actions ทันที"
            >
              {isTriggeringPsd ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
              )}
              <span>{isTriggeringPsd ? "กำลังส่งงาน..." : "สั่ง Export PSD ทันที (Run Now)"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              asChild
              className="h-8 text-xs font-medium border-purple-500/30 bg-[#1e1233] text-purple-200 hover:bg-purple-950/60 hover:text-white"
            >
              <a href={psdGitUrl} target="_blank" rel="noreferrer" title="คลิกดู Log สดการรัน Export PSD บน GitHub Actions">
                <FolderGit2 className="h-3.5 w-3.5 mr-1.5 text-purple-400" />
                <span>ดู Log บน Git</span>
                <ExternalLink className="h-3 w-3 ml-1 opacity-70" />
              </a>
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                refetchGasStatus()
                refetchGitRuns()
                toast.success("รีเฟรชสถานะ Export PSD แล้ว")
              }}
              disabled={isLoadingGas}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
              title="รีเฟรชสถานะ"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingGas ? "animate-spin text-purple-400" : ""}`} />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsPsdCollapsed(!isPsdCollapsed)}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
              title={isPsdCollapsed ? "ขยายดูรายละเอียด" : "ย่อแถบ"}
            >
              {isPsdCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Expanded Content */}
        {!isPsdCollapsed && (
          <div className="mt-4 pt-3 border-t border-purple-500/20 space-y-3 relative z-10">
            {/* Quick Single-Chapter Selector */}
            {computedStats.psdCandidates.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-lg bg-[#120b21]/90 border border-purple-500/25 p-2">
                <span className="text-[11px] font-semibold text-purple-300 whitespace-nowrap flex items-center gap-1 px-1">
                  <Zap className="h-3.5 w-3.5 text-purple-400" /> สั่งรัน PSD รายตอน:
                </span>
                <select
                  value={selectedPsdQueueId}
                  onChange={(e) => setSelectedPsdQueueId(e.target.value)}
                  className="flex-1 h-8 rounded border border-purple-800/60 bg-[#180f2c] px-2 text-xs text-slate-100"
                >
                  <option value="">-- เลือกเรื่อง / ตอนที่ต้องการส่งรัน Export PSD --</option>
                  {computedStats.psdCandidates.map((item) => (
                    <option key={item.queueid} value={item.queueid}>
                      {item.mangaTitle} - ตอนที่ {item.chapter} (แปล: {item.translatestatus || "รอเริ่ม"} • PSD: {item.psdstatus || "รอเริ่ม"})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!selectedPsdQueueId || isSinglePsdRunning}
                  onClick={handleRunSelectedPsd}
                  className="h-8 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shrink-0 cursor-pointer"
                >
                  {isSinglePsdRunning ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1 fill-current" />
                  )}
                  รัน PSD ตอนที่เลือก
                </Button>
              </div>
            )}

            {/* Progress Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                  ความคืบหน้ารวมขั้นตอน Export PSD (Inpaint + Typeset Progress)
                </span>
                <span className="font-mono text-purple-300 font-bold">
                  {psdProgressPercent}% ({skippedPsd + donePsd}/{totalPsdTasks} ตอน)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden flex p-0.5 border border-slate-700/60">
                <div
                  style={{ width: `${(skippedPsd / totalPsdTasks) * 100}%` }}
                  className="bg-indigo-500 rounded-l-full h-full transition-all duration-500"
                  title={`ข้าม (Pratchaya แปล): ${skippedPsd} ตอน`}
                />
                <div
                  style={{ width: `${(donePsd / totalPsdTasks) * 100}%` }}
                  className="bg-purple-400 h-full transition-all duration-500"
                  title={`Export PSD สำเร็จ (.psd): ${donePsd} ตอน`}
                />
                <div
                  style={{ width: `${(pendingPsd / totalPsdTasks) * 100}%` }}
                  className="bg-amber-400/80 rounded-r-full h-full transition-all duration-500 animate-pulse"
                  title={`รอ Export PSD (แปลเสร็จแล้ว): ${pendingPsd} ตอน`}
                />
              </div>
            </div>

            {/* 3 Detail Info Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-lg border border-purple-500/20 bg-[#140c24]/80 p-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium">📥 รอ Export PSD (แปลเสร็จ)</p>
                  <p className="text-lg font-bold text-amber-300 mt-0.5">
                    {pendingPsd} <span className="text-xs font-normal text-slate-400">ตอน</span>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">พร้อมส่งสร้าง PSD เข้า Google Drive</p>
                </div>
                <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
                  พร้อมทำ PSD
                </Badge>
              </div>

              <div className="rounded-lg border border-purple-500/20 bg-[#140c24]/80 p-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-slate-400 font-medium">⏭️ ข้าม (Skip: Pratchaya แปล)</p>
                  <p className="text-lg font-bold text-indigo-300 mt-0.5">
                    {skippedPsd} <span className="text-xs font-normal text-slate-400">ตอน</span>
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">ไม่ต้องรัน Export PSD อัตโนมัติ</p>
                </div>
                <FastForward className="h-5 w-5 text-indigo-400 opacity-60" />
              </div>

              <div className="rounded-lg border border-purple-500/20 bg-[#140c24]/80 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-400 font-medium">🕒 Export PSD ล่าสุด</p>
                  <span className="text-[10px] text-purple-400 font-mono">
                    {lastPsdTrigger?.lastTriggeredAt
                      ? formatTimeAgo(lastPsdTrigger.lastTriggeredAt)
                      : latestExportPsdRun?.created_at
                      ? formatTimeAgo(latestExportPsdRun.created_at)
                      : "พร้อมทำงาน"}
                  </span>
                </div>
                {lastPsdBatch ? (
                  <p className="text-xs text-slate-200 mt-1">
                    รอบล่าสุดพบ <strong className="text-purple-300">{lastPsdBatch.totalEligible || 0} ตอน</strong> • สั่งรันไป{" "}
                    <strong className="text-emerald-300">{lastPsdBatch.triggeredCount || 0} ตอน</strong>
                  </p>
                ) : lastPsdTrigger?.mangaName ? (
                  <p className="text-xs text-slate-200 mt-1 truncate">
                    ล่าสุด: <strong className="text-purple-300">{lastPsdTrigger.mangaName}</strong> ตอนที่ {lastPsdTrigger.chapter || "-"}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">
                    ทริกเกอร์อัตโนมัติเมื่อติ๊กแปลเสร็จ หรือกดสั่งรันได้ทันที
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

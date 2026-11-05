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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { callGasApi } from "@/api/gasClient"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"

interface AutoOcrStatusBannerProps {
  onQueueRefresh?: () => void
  className?: string
}

export function AutoOcrStatusBanner({ onQueueRefresh, className = "" }: AutoOcrStatusBannerProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false)
  const [isTriggering, setIsTriggering] = React.useState(false)

  // 1. GitHub Actions Status
  const {
    isMangaOcrRunning,
    activeMangaOcrRun,
    latestMangaOcrRun,
    refetch: refetchGitRuns,
  } = useGitHubActionsStatus()

  // 2. GAS OCR Scheduler & Stats Query
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
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 15000,
  })

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

  // Handle Manual Trigger
  const handleTriggerManualOcr = async () => {
    if (isTriggering) return
    setIsTriggering(true)
    const toastId = toast.loading("กำลังสั่ง GAS สแกน Google Drive และส่งเข้า GitHub Actions...")

    try {
      const res = await callGasApi("RUN_MANGA_OCR_SCHEDULED_JOB")
      const count = res?.triggeredCount ?? 0
      const total = res?.totalEligible ?? 0

      if (count > 0) {
        toast.success(
          `ส่งงานเข้า GitHub Actions เรียบร้อยแล้ว! (${count} ตอนจาก ${total} ตอนที่รอ)`,
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
      setIsTriggering(false)
    }
  }

  const is6HourActive = gasOcrStatus?.is6HourTriggerActive ?? true
  const lastTriggerTime = gasOcrStatus?.lastPipelineTrigger?.lastTriggeredAt
  const lastBatch = gasOcrStatus?.lastBatchSummary
  const stats = gasOcrStatus?.stats

  const pendingCount = stats?.pendingOcr ?? 0
  const skippedCount = stats?.skippedOcr ?? 0
  const doneCount = stats?.doneOcr ?? 0
  const totalTasks = stats?.totalTasks ?? (pendingCount + skippedCount + doneCount || 1)

  const progressPercent = Math.min(
    100,
    Math.round(((skippedCount + doneCount) / (totalTasks || 1)) * 100)
  )

  const gitUrl =
    activeMangaOcrRun?.html_url ||
    latestMangaOcrRun?.html_url ||
    "https://github.com/mangahub888/mangahub888.github.io/actions/workflows/gdrive_ocr.yml"

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-r from-[#0c182a] via-[#0d2238] to-[#111f33] p-4 text-white shadow-xl shadow-cyan-950/20 transition-all ${className}`}
    >
      {/* Background glow decoration */}
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      {/* Top Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 relative z-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 shadow-inner shadow-cyan-500/30">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm sm:text-base text-cyan-100 flex items-center gap-1.5">
                🤖 สถานะดึงคำออโต้ (GAS + GitHub Actions OCR)
              </span>

              {/* Git Status Badge */}
              {isMangaOcrRunning && activeMangaOcrRun ? (
                <Badge className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 text-[11px] font-bold animate-pulse flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  <RefreshCw className="h-3 w-3 animate-spin text-cyan-300" />
                  กำลังดึงคำ AI (Run #{activeMangaOcrRun.run_number})
                </Badge>
              ) : latestMangaOcrRun ? (
                <Badge className="bg-slate-800/80 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  Git Standby (สำเร็จล่าสุด #{latestMangaOcrRun.run_number} • {formatTimeAgo(latestMangaOcrRun.created_at)})
                </Badge>
              ) : (
                <Badge className="bg-slate-800/80 text-slate-400 border border-slate-700 text-[11px]">
                  Git Standby
                </Badge>
              )}

              {/* GAS 6-Hour Scheduler Badge */}
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
              ระบบดึงคำอัตโนมัติด้วย Manga OCR ผ่าน GitHub Actions ส่งไฟล์ .mtp กลับเข้า Google Drive ต้นทาง
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          <Button
            size="sm"
            onClick={handleTriggerManualOcr}
            disabled={isTriggering || isMangaOcrRunning}
            className="h-8 text-xs font-semibold bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-md shadow-cyan-900/30 border border-cyan-400/30 cursor-pointer"
            title="สั่งให้ GAS สแกนคิวงานที่ยังไม่ได้ดึงคำและยิงเข้า GitHub Actions ทันที"
          >
            {isTriggering ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
            )}
            <span>{isTriggering ? "กำลังส่งงาน..." : "สั่งดึงคำทันที (Run Now)"}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            asChild
            className="h-8 text-xs font-medium border-cyan-500/30 bg-[#0e1d33] text-cyan-200 hover:bg-cyan-950/60 hover:text-white"
          >
            <a href={gitUrl} target="_blank" rel="noreferrer" title="คลิกดู Log สดการรันบน GitHub Actions">
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
              toast.success("รีเฟรชสถานะดึงคำออโต้แล้ว")
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
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
            title={isCollapsed ? "ขยายดูรายละเอียด" : "ย่อแถบ"}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded Metrics & Progress Bar */}
      {!isCollapsed && (
        <div className="mt-4 pt-3 border-t border-cyan-500/20 space-y-3 relative z-10">
          {/* Progress Bar Row */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                ความคืบหน้ารวมขั้นตอนดึงคำ (OCR / QC Extract Progress)
              </span>
              <span className="font-mono text-cyan-300 font-bold">
                {progressPercent}% ({skippedCount + doneCount}/{totalTasks} ตอน)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden flex p-0.5 border border-slate-700/60">
              <div
                style={{ width: `${(skippedCount / totalTasks) * 100}%` }}
                className="bg-indigo-500 rounded-l-full h-full transition-all duration-500"
                title={`ข้าม (Kikkuk ดึงคำแล้ว): ${skippedCount} ตอน`}
              />
              <div
                style={{ width: `${(doneCount / totalTasks) * 100}%` }}
                className="bg-cyan-400 h-full transition-all duration-500"
                title={`ดึงคำออโต้สำเร็จ (.mtp): ${doneCount} ตอน`}
              />
              <div
                style={{ width: `${(pendingCount / totalTasks) * 100}%` }}
                className="bg-amber-400/80 rounded-r-full h-full transition-all duration-500 animate-pulse"
                title={`รอดึงคำออโต้: ${pendingCount} ตอน`}
              />
            </div>
          </div>

          {/* 3 Detail Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {/* Card 1: Pending Queue */}
            <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">📥 รอดึงคำออโต้ (Pending)</p>
                <p className="text-lg font-bold text-amber-300 mt-0.5">
                  {pendingCount}{" "}
                  <span className="text-xs font-normal text-slate-400">ตอน</span>
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">พร้อมส่งเข้า Git เมื่อถึงรอบ 6 ชม.</p>
              </div>
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                รอคิว
              </Badge>
            </div>

            {/* Card 2: Skipped (Kikkuk Done) */}
            <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">⏭️ ข้าม (Skip: Kikkuk ดึงแล้ว)</p>
                <p className="text-lg font-bold text-indigo-300 mt-0.5">
                  {skippedCount}{" "}
                  <span className="text-xs font-normal text-slate-400">ตอน</span>
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">ไม่ต้องรัน AI ซ้ำ ผ่านไป QC ได้เลย</p>
              </div>
              <FastForward className="h-5 w-5 text-indigo-400 opacity-60" />
            </div>

            {/* Card 3: GAS 6-Hour Schedule Details */}
            <div className="rounded-lg border border-cyan-500/20 bg-[#0a1728]/80 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-400 font-medium">🕒 GAS รันอัตโนมัติล่าสุด</p>
                <span className="text-[10px] text-cyan-400 font-mono">
                  {lastTriggerTime ? formatTimeAgo(lastTriggerTime) : "ยังไม่มีข้อมูล"}
                </span>
              </div>
              {lastBatch ? (
                <p className="text-xs text-slate-200 mt-1">
                  รอบล่าสุดพบ <strong className="text-cyan-300">{lastBatch.totalEligible || 0} ตอน</strong> • สั่งรันไป{" "}
                  <strong className="text-emerald-300">{lastBatch.triggeredCount || 0} ตอน</strong>
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">
                  ตั้งเวลาทริกเกอร์ทุก 6 ชั่วโมงเพื่อสแกนโฟลเดอร์ Google Drive อัตโนมัติ
                </p>
              )}
              {lastBatch?.triggeredList && lastBatch.triggeredList.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  {lastBatch.triggeredList.slice(0, 2).map((item: any, idx: number) => (
                    <span
                      key={idx}
                      className="inline-block text-[10px] bg-cyan-950/80 border border-cyan-700/40 text-cyan-300 px-1.5 py-0.2 rounded"
                    >
                      ตอนที่ {item.chapter}
                    </span>
                  ))}
                  {lastBatch.triggeredList.length > 2 && (
                    <span className="text-[10px] text-slate-500">
                      +{lastBatch.triggeredList.length - 2} ตอน
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

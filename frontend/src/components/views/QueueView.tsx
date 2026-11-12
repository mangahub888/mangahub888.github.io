import * as React from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { StepUpdateModal } from "@/components/modals/QueueModals"
import {
  THAI_MONTHS,
  QUEUE_STEPS,
  extractStepLinks,
  formatDuration,
  getChapterCount,
  getQueueCurrentStep,
  getQueueItemDate,
  isQueueStepDone,
  isStepDone,
  isUrgentManga,
  matchesStepFilter,
  parseQueueDate,
  resolveMangaName,
} from "@/lib/utils"
import { callGasApi } from "@/api/gasClient"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"
import { AutoOcrStatusBanner } from "@/components/ui/AutoOcrStatusBanner"
import { toast } from "sonner"
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Zap,
  X,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  FileText,
} from "lucide-react"

interface QueueViewProps {
  mangaList: any[]
  queueList: any[]
  teamList: any[]
  isLoading: boolean
  monthFilter: string
  yearFilter: string
  onPeriodChange: (newMonth: string, newYear: string) => void
  initialSearch?: string
  onClearInitialSearch?: () => void
  onOpenAddQueue: () => void
  onOpenUpdateQueue: (item: any) => void
  onQueueChange: (newQueue: any[]) => void
}

export function QueueView({
  mangaList,
  queueList,
  teamList,
  isLoading,
  monthFilter,
  yearFilter,
  onPeriodChange,
  initialSearch,
  onClearInitialSearch,
  onOpenAddQueue,
  onOpenUpdateQueue,
  onQueueChange,
}: QueueViewProps) {
  const now = new Date()
  const [search, setSearch] = React.useState("")
  const [completionFilter, setCompletionFilter] = React.useState("incomplete")
  const [stepFilter, setStepFilter] = React.useState("all")
  const [urgentFilter, setUrgentFilter] = React.useState("all")
  const [assigneeFilter, setAssigneeFilter] = React.useState("all")
  const [showPublishPost, setShowPublishPost] = React.useState(true)
  const { isAnyRunning, isKuaikanRunning, latestActiveRun } = useGitHubActionsStatus()

  const handleOcrQueueRefresh = async () => {
    try {
      const res = await callGasApi("GET_WORK_QUEUE", { forceRefresh: true })
      if (res) onQueueChange(Array.isArray(res) ? res : res.data || res.queue || [])
    } catch (e) {
      console.warn("Failed to refresh queue:", e)
    }
  }

  // Bulk Action state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkStep, setBulkStep] = React.useState("post")
  const [bulkStatus, setBulkStatus] = React.useState("เสร็จแล้ว")
  const [bulkAssignee, setBulkAssignee] = React.useState("__KEEP__")
  const [bulkUpdating, setBulkUpdating] = React.useState(false)

  // Step Modal state
  const [stepModalOpen, setStepModalOpen] = React.useState(false)
  const [activeStepItem, setActiveStepItem] = React.useState<any | null>(null)
  const [activeStepKey, setActiveStepKey] = React.useState("")
  const [backupQueue, setBackupQueue] = React.useState<any[]>([])

  React.useEffect(() => {
    if (initialSearch !== undefined && initialSearch !== "") {
      setSearch(initialSearch)
      onClearInitialSearch?.()
    }
  }, [initialSearch, onClearInitialSearch])

  React.useEffect(() => {
    if (stepFilter !== "all" && stepFilter !== "publish_post") {
      setBulkStep(stepFilter)
    }
  }, [stepFilter])

  // Queue Step Statistics
  const queueStats = React.useMemo(() => {
    let finished = 0,
      waitUpload = 0,
      waitOcr = 0,
      waitExtract = 0,
      waitTranslate = 0,
      waitTypeset = 0,
      waitPublish = 0,
      waitPost = 0

    queueList.forEach((q) => {
      const count = getChapterCount(q.chapter)
      if (isStepDone(q.poststatus)) {
        finished += count
        return
      }

      const mangaItem = (mangaList || []).find((m: any) => String(m.mangaid) === String(q.mangaid))

      if (matchesStepFilter(q, "upload", mangaItem)) {
        waitUpload += count
      } else if (matchesStepFilter(q, "ocr", mangaItem)) {
        waitOcr += count
      } else if (matchesStepFilter(q, "extract", mangaItem)) {
        waitExtract += count
      } else if (matchesStepFilter(q, "translate", mangaItem)) {
        waitTranslate += count
      } else if (matchesStepFilter(q, "typeset", mangaItem)) {
        waitTypeset += count
      } else if (matchesStepFilter(q, "publish", mangaItem)) {
        waitPublish += count
      } else if (matchesStepFilter(q, "post", mangaItem)) {
        waitPost += count
      } else {
        finished += count
      }
    })

    return {
      finished,
      waitUpload,
      waitOcr,
      waitExtract,
      waitTranslate,
      waitTypeset,
      waitPublish,
      waitPost,
    }
  }, [queueList, mangaList])

  // Count tasks waiting in 'publish' or 'post' steps
  const publishPostCount = React.useMemo(() => {
    return queueStats.waitPublish + queueStats.waitPost
  }, [queueStats.waitPublish, queueStats.waitPost])

  // Filtered Queue
  const filteredQueue = React.useMemo(() => {
    const cleanSearch = search
      .toLowerCase()
      .trim()
      .replace(/\.\.\.+$/, "")
      .replace(/…+$/, "")
      .trim()

    const result = queueList.filter((q) => {
      // Month / Year (Uses true task date)
      if (monthFilter !== "all" || yearFilter !== "all") {
        const d = getQueueItemDate(q)
        if (!d) return false
        const mMatch =
          monthFilter === "all" || String(d.getMonth() + 1) === monthFilter
        const yMatch =
          yearFilter === "all" || String(d.getFullYear()) === yearFilter
        if (!mMatch || !yMatch) return false
      }

      // Find associated manga
      const manga = (mangaList || []).find(
        (m: any) =>
          m.mangaid != null &&
          q.mangaid != null &&
          String(m.mangaid) === String(q.mangaid)
      )

      // Search
      if (cleanSearch) {
        const name = manga ? String(manga.manganame).toLowerCase() : ""
        if (!name.includes(cleanSearch)) return false
      }

      // Completion
      const isFinished = isStepDone(q.poststatus)
      if (completionFilter !== "all") {
        if (completionFilter === "complete" && !isFinished) return false
        if (completionFilter === "incomplete" && isFinished) return false
      }

      // Step filter & Publish/Post visibility logic
      const currentStep = getQueueCurrentStep(q, mangaList)
      const isPublishOrPost = currentStep === "publish" || currentStep === "post"

      if (stepFilter === "publish_post") {
        // Show ONLY publish and post steps
        if (!matchesStepFilter(q, "publish_post", manga)) return false
      } else if (stepFilter === "all") {
        // When stepFilter is "all", show all incomplete tasks (including publish and post) by default,
        // unless the user explicitly toggled showPublishPost off (and is not searching or viewing all statuses).
        if (!showPublishPost && !cleanSearch && completionFilter !== "all" && isPublishOrPost) {
          return false
        }
      } else {
        // Strict Sequential Step Rule:
        // งานที่ขั้นตอนนั้นยังไม่เสร็จสิ้น และขั้นตอนก่อนหน้าทั้งหมดเสร็จสิ้นแล้ว
        if (!matchesStepFilter(q, stepFilter, manga)) {
          return false
        }
      }

      // Assignee filter
      if (assigneeFilter !== "all") {
        const matchesAssignee =
          q.uploadername === assigneeFilter ||
          q.extractorname === assigneeFilter ||
          q.translatorname === assigneeFilter ||
          q.typesettername === assigneeFilter ||
          q.publishername === assigneeFilter ||
          q.postername === assigneeFilter
        if (!matchesAssignee) return false
      }

      // Urgent filter
      if (urgentFilter !== "all") {
        const urgent = isUrgentManga(manga)
        if (urgentFilter === "urgent" && !urgent) return false
        if (urgentFilter === "normal" && urgent) return false
      }

      return true
    })

    // If stepFilter is "all" and showPublishPost is enabled, sort publish & post tasks to the very bottom
    if (stepFilter === "all" && showPublishPost) {
      result.sort((a, b) => {
        const stepA = getQueueCurrentStep(a)
        const stepB = getQueueCurrentStep(b)
        const isPubPostA = stepA === "publish" || stepA === "post"
        const isPubPostB = stepB === "publish" || stepB === "post"
        if (isPubPostA !== isPubPostB) {
          return isPubPostA ? 1 : -1 // Push publish & post to bottom
        }
        return 0
      })
    }

    return result
  }, [
    queueList,
    mangaList,
    search,
    monthFilter,
    yearFilter,
    completionFilter,
    stepFilter,
    assigneeFilter,
    urgentFilter,
    showPublishPost,
  ])

  const assigneeOptions = React.useMemo(() => {
    const active = (teamList || []).filter((m) => m.status === "Active")
    return [
      { value: "all", label: "ทีมงาน: ทั้งหมด" },
      ...active.map((m) => ({ value: m.name, label: m.name })),
    ]
  }, [teamList])

  const allVisibleSelected =
    filteredQueue.length > 0 &&
    filteredQueue.every((q) => selectedIds.has(String(q.queueid)))

  const toggleSelectAll = (checked: boolean) => {
    const next = new Set(selectedIds)
    filteredQueue.forEach((q) => {
      const id = String(q.queueid)
      if (checked) next.add(id)
      else next.delete(id)
    })
    setSelectedIds(next)
  }

  const toggleRow = (queueId: string, checked: boolean) => {
    const next = new Set(selectedIds)
    if (checked) next.add(queueId)
    else next.delete(queueId)
    setSelectedIds(next)
  }

  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0) return
    const count = selectedIds.size
    if (
      !window.confirm(
        `ยืนยันการเปลี่ยนสถานะ ${count} รายการ เป็น "${bulkStatus}" หรือไม่?`
      )
    )
      return

    setBulkUpdating(true)
    try {
      const res = await callGasApi("BULK_UPDATE_QUEUE_STEP", {
        queueIds: Array.from(selectedIds),
        step: bulkStep,
        status: bulkStatus,
        assignee: bulkAssignee,
      })
      toast.success(`อัปเดตสถานะสำเร็จ (${res.count || count} รายการ)`)
      setSelectedIds(new Set())
      if (res.queue) {
        onQueueChange(res.queue)
      }
    } catch (err: any) {
      toast.error(err.message || "ไม่สามารถอัปเดตสถานะแบบกลุ่มได้")
    } finally {
      setBulkUpdating(false)
    }
  }

  const handleDeleteQueue = async (id: string) => {
    if (!window.confirm("ยืนยันการลบคิวงานนี้หรือไม่? ข้อมูลจะถูกลบถาวร"))
      return
    try {
      const res = await callGasApi("DELETE_QUEUE_ITEM", { id })
      toast.success("ลบคิวงานเรียบร้อยแล้ว")
      if (res.queue) onQueueChange(res.queue)
    } catch (err: any) {
      toast.error(err.message || "ลบคิวงานไม่สำเร็จ")
    }
  }

  const renderStatusBadge = (item: any, step: string, statusVal: string) => {
    const status = statusVal || "รอเริ่ม"
    const isSkipped = status === "Skipped" || String(status).toLowerCase() === "skip" || status === "ข้าม"
    let variant: "default" | "success" | "warning" | "secondary" = "secondary"
    if (status === "เสร็จแล้ว") variant = "success"
    else if (status === "กำลังทำ") variant = "warning"

    return (
      <Badge
        variant={variant}
        onClick={() => {
          setBackupQueue([...queueList])
          setActiveStepItem(item)
          setActiveStepKey(step)
          setStepModalOpen(true)
        }}
        className={
          isSkipped
            ? "cursor-pointer whitespace-nowrap bg-slate-800/80 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200 transition-all font-mono text-[11px] uppercase tracking-wider"
            : "cursor-pointer whitespace-nowrap hover:scale-105 transition-transform"
        }
      >
        {isSkipped ? "skip" : status}
      </Badge>
    )
  }

  const renderStepLinks = (worklink: string | undefined, stepLabel: string) => {
    const urls = extractStepLinks(worklink, stepLabel)
    if (urls.length === 0) return null
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {urls.map((u, idx) => (
          <a
            key={idx}
            href={u}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/25"
          >
            <ExternalLink className="h-3 w-3 shrink-0" /> Link
          </a>
        ))}
      </div>
    )
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="space-y-6">
      {/* Queue Step Overview Cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            🕒 สถานะคิวงานแยกตามขั้นตอน (จำนวนตอน) • คลิกการ์ดเพื่อกรอง
          </p>
          {(stepFilter !== "all" || completionFilter !== "incomplete") && (
            <button
              type="button"
              onClick={() => {
                setStepFilter("all")
                setCompletionFilter("incomplete")
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
            >
              รีเซ็ตตัวกรองขั้นตอน (แสดงทั้งหมด)
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            {
              id: "finished",
              label: "เสร็จแล้ว",
              val: queueStats.finished,
              icon: "✅",
              color: "text-emerald-400",
              active: completionFilter === "complete",
              onClick: () => {
                if (completionFilter === "complete") {
                  setCompletionFilter("all")
                } else {
                  setCompletionFilter("complete")
                  setStepFilter("all")
                }
              },
            },
            {
              id: "upload",
              label: "1. รออัป Raw",
              val: queueStats.waitUpload,
              icon: "🔼",
              color: "text-indigo-400",
              active: stepFilter === "upload",
              onClick: () => {
                setStepFilter(stepFilter === "upload" ? "all" : "upload")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "ocr",
              label: "2. รอดึงคำออโต้",
              val: queueStats.waitOcr,
              icon: "🤖",
              color: "text-cyan-400",
              active: stepFilter === "ocr",
              onClick: () => {
                setStepFilter(stepFilter === "ocr" ? "all" : "ocr")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "extract",
              label: "3. รอ QC ดึงคำ",
              val: queueStats.waitExtract,
              icon: "📝",
              color: "text-orange-400",
              active: stepFilter === "extract",
              onClick: () => {
                setStepFilter(stepFilter === "extract" ? "all" : "extract")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "translate",
              label: "รอแปล",
              val: queueStats.waitTranslate,
              icon: "🌐",
              color: "text-pink-400",
              active: stepFilter === "translate",
              onClick: () => {
                setStepFilter(stepFilter === "translate" ? "all" : "translate")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "typeset",
              label: "รอลงคำ",
              val: queueStats.waitTypeset,
              icon: "✍️",
              color: "text-amber-300",
              active: stepFilter === "typeset",
              onClick: () => {
                setStepFilter(stepFilter === "typeset" ? "all" : "typeset")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "publish",
              label: "รอ Publish",
              val: queueStats.waitPublish,
              icon: "📤",
              color: "text-sky-400",
              active: stepFilter === "publish",
              onClick: () => {
                setStepFilter(stepFilter === "publish" ? "all" : "publish")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
            {
              id: "post",
              label: "รอโพสต์",
              val: queueStats.waitPost,
              icon: "✉️",
              color: "text-slate-300",
              active: stepFilter === "post",
              onClick: () => {
                setStepFilter(stepFilter === "post" ? "all" : "post")
                if (completionFilter === "complete") setCompletionFilter("incomplete")
              },
            },
          ].map((st) => (
            <Card
              key={st.label}
              onClick={st.onClick}
              className={`p-3.5 flex items-center justify-between cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md select-none ${
                st.active
                  ? "ring-2 ring-indigo-500 bg-indigo-950/40 border-indigo-500 shadow-md"
                  : "hover:border-slate-600"
              }`}
              title={`คลิกเพื่อกรองงาน: ${st.label}`}
            >
              <div>
                <p className="text-xs text-slate-400">{st.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${st.color}`}>{st.val}</p>
              </div>
              <span className="text-lg">{st.icon}</span>
            </Card>
          ))}
        </div>
      </div>

      {/* GAS + GitHub Actions Auto OCR Status Banner */}
      <AutoOcrStatusBanner onQueueRefresh={handleOcrQueueRefresh} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-[#26334d] pt-5">
        <div>
          <h2 className="text-2xl font-bold text-white">รายการคิวงาน</h2>
          <p className="text-sm text-slate-400 flex flex-wrap items-center gap-2">
            <span>ติดตามความคืบหน้าการทำงานรายตอน ({filteredQueue.length} รายการ)</span>
            {!showPublishPost && publishPostCount > 0 && (
              <span className="text-xs text-sky-400 font-medium">
                (ซ่อนรอ Publish & โพสต์ไว้ {publishPostCount} ตอน)
              </span>
            )}
            {isAnyRunning && latestActiveRun && (
              <a
                href={latestActiveRun.html_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/40 font-semibold animate-pulse hover:bg-emerald-500/25"
                title="คลิกเพื่อดู GitHub Actions Log สด"
              >
                <RefreshCw className="h-3 w-3 animate-spin text-emerald-400" />
                <span>⚡ GitAction: กำลังรัน ({isKuaikanRunning ? "KuaiKan" : latestActiveRun.name})</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-70" />
              </a>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Toggle Publish/Post button */}
          <Button
            type="button"
            variant={showPublishPost ? "secondary" : "outline"}
            onClick={() => setShowPublishPost((prev) => !prev)}
            className={`h-9 text-xs font-semibold gap-1.5 transition-all cursor-pointer ${
              showPublishPost
                ? "bg-sky-600 hover:bg-sky-700 text-white border-sky-500 shadow-sm"
                : "border-sky-500/40 bg-sky-950/20 text-sky-300 hover:bg-sky-900/30"
            }`}
          >
            {showPublishPost ? (
              <>
                <EyeOff className="h-4 w-4" />
                <span>ซ่อนงานรอ Publish & โพสต์</span>
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                <span>แสดงงานรอ Publish & โพสต์ ({publishPostCount} ตอน)</span>
              </>
            )}
          </Button>
          <Button onClick={onOpenAddQueue}>
            <Plus className="h-4 w-4" /> เพิ่มคิวงาน
          </Button>
        </div>
      </div>

      {/* GitHub Actions Active Running Alert Banner */}
      {isAnyRunning && latestActiveRun && (
        <div className="rounded-xl border border-sky-500/40 bg-gradient-to-r from-sky-950/60 via-[#0e172e] to-purple-950/40 p-3.5 shadow-lg shadow-sky-950/20 animate-pulse">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/40">
                <RefreshCw className="h-4 w-4 animate-spin text-sky-300" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm text-sky-200">
                    ⚡ GitHub Actions กำลังประมวลผลดึง/ซื้อ Raw อัตโนมัติ
                  </span>
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] font-bold">
                    {latestActiveRun.name} (Run #{latestActiveRun.run_number})
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  สถานะ: <span className="text-amber-300 font-semibold">{latestActiveRun.status === 'in_progress' ? 'กำลังทำงาน (In Progress)' : 'รอคิว (Queued)'}</span> • ระบบกำลังดาวน์โหลดตอนและอัปเดตสถานะคิวงานให้อัตโนมัติ
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={latestActiveRun.html_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                ดูสถานะบน GitHub Actions
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Filters Toolbar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-center">
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="ค้นหาชื่อเรื่อง..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <select
            className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
            value={monthFilter}
            onChange={(e) => onPeriodChange(e.target.value, yearFilter)}
          >
            <option value="all">เดือน: ทั้งหมด</option>
            {THAI_MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>

          <select
            className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
            value={yearFilter}
            onChange={(e) => onPeriodChange(monthFilter, e.target.value)}
          >
            <option value="all">ปี: ทั้งหมด</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y + 543}
              </option>
            ))}
          </select>

          <select
            className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
            value={completionFilter}
            onChange={(e) => setCompletionFilter(e.target.value)}
          >
            <option value="all">สถานะ: ทั้งหมด</option>
            <option value="incomplete">ยังไม่เสร็จ (Incomplete)</option>
            <option value="complete">เสร็จแล้ว (Finished)</option>
          </select>

          <select
            className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100 cursor-pointer"
            value={stepFilter}
            onChange={(e) => {
              const newStep = e.target.value
              setStepFilter(newStep)
              if (newStep === "all") {
                setShowPublishPost(true)
              } else if (completionFilter === "complete") {
                setCompletionFilter("incomplete")
              }
            }}
          >
            <option value="all">ขั้นตอน: ทั้งหมด</option>
            <option value="publish_post">เฉพาะ 2 สเตป: รอ Publish & รอโพสต์ ({publishPostCount} ตอน)</option>
            <option value="upload">รอ/ทำ: 1. อัป Raw</option>
            <option value="ocr">รอ/ทำ: 2. ดึงคำออโต้ (AI)</option>
            <option value="extract">รอ/ทำ: 3. QC ดึงคำ</option>
            <option value="translate">รอ/ทำ: แปล</option>
            <option value="typeset">รอ/ทำ: ลงคำ</option>
            <option value="publish">รอ/ทำ: Publish</option>
            <option value="post">รอ/ทำ: โพสต์</option>
          </select>

          <div className="flex gap-2">
            <select
              className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 py-2 text-sm text-slate-100"
              value={urgentFilter}
              onChange={(e) => setUrgentFilter(e.target.value)}
            >
              <option value="all">ความด่วน: ทั้งหมด</option>
              <option value="urgent">🔥 งานด่วน</option>
              <option value="normal">งานปกติ</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1a2337]">
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="w-full sm:w-64">
              <SearchableSelect
                options={assigneeOptions}
                value={assigneeFilter}
                onChange={(v) => setAssigneeFilter(v || "all")}
                placeholder="ทีมงาน: ทั้งหมด"
                searchPlaceholder="ค้นหาทีมงาน..."
              />
            </div>

            {/* Quick Toggle in Toolbar */}
            <Button
              type="button"
              variant={showPublishPost ? "secondary" : "outline"}
              onClick={() => setShowPublishPost((prev) => !prev)}
              className={`h-10 text-xs font-semibold gap-1.5 transition-all cursor-pointer ${
                showPublishPost
                  ? "bg-sky-600 hover:bg-sky-700 text-white border-sky-500 shadow-sm"
                  : "border-sky-500/40 bg-sky-950/20 text-sky-300 hover:bg-sky-900/30"
              }`}
            >
              {showPublishPost ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  <span>ซ่อนงานรอ Publish & โพสต์</span>
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  <span>แสดงงานรอ Publish & โพสต์ ({publishPostCount} ตอน)</span>
                </>
              )}
            </Button>
          </div>

          {/* Bulk Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-1.5 text-xs font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                className="h-4 w-4 accent-indigo-500 rounded"
              />
              ติ๊กทั้งหมดที่แสดง
            </label>

            <span className="text-xs text-slate-400">
              เลือกอยู่{" "}
              <strong className="text-indigo-400 text-sm">
                {selectedIds.size}
              </strong>{" "}
              รายการ
            </span>

            {selectedIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                className="h-8 text-xs text-slate-400"
              >
                <X className="h-3.5 w-3.5" /> ยกเลิก
              </Button>
            )}

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs text-slate-100"
              value={bulkStep}
              onChange={(e) => setBulkStep(e.target.value)}
            >
              <option value="post">📮 โพสต์</option>
              <option value="publish">📤 Publisher</option>
              <option value="typeset">✍️ ลงคำ</option>
              <option value="translate">🌐 แปล</option>
              <option value="extract">📝 3. QC ดึงคำ</option>
              <option value="ocr">🤖 2. ดึงคำออโต้</option>
              <option value="upload">🔼 1. อัป Raw</option>
            </select>

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs font-semibold text-emerald-400"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
            >
              <option value="เสร็จแล้ว">✅ เสร็จแล้ว</option>
              <option value="กำลังทำ">⏳ กำลังทำ</option>
              <option value="รอเริ่ม">⏸️ รอเริ่ม</option>
              <option value="skip">⏭️ ข้าม</option>
            </select>

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs text-slate-100"
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
            >
              <option value="__KEEP__">-- ผู้รับผิดชอบ: คงเดิม --</option>
              {(teamList || [])
                .filter((m) => m.status === "Active")
                .map((m) => (
                  <option key={m.memberid} value={m.name}>
                    {m.name} ({m.role})
                  </option>
                ))}
            </select>

            <Button
              size="sm"
              disabled={selectedIds.size === 0 || bulkUpdating}
              onClick={handleBulkUpdate}
              className="h-9"
            >
              <Zap className="h-3.5 w-3.5" />
              {bulkUpdating
                ? "กำลังอัปเดต..."
                : `อัปเดตสถานะ (${selectedIds.size})`}
            </Button>
          </div>
        </div>
      </Card>

      {/* Queue Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 px-2.5 text-center whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500 rounded cursor-pointer"
                />
              </TableHead>
              <TableHead className="min-w-[180px] max-w-[260px] px-3 whitespace-nowrap">วันที่ / เรื่อง</TableHead>
              <TableHead className="w-[105px] min-w-[96px] px-2.5 whitespace-nowrap">1. อัป Raw</TableHead>
              <TableHead className="w-[115px] min-w-[106px] px-2.5 whitespace-nowrap">2. ดึงคำออโต้</TableHead>
              <TableHead className="w-[110px] min-w-[100px] px-2.5 whitespace-nowrap">3. QC ดึงคำ</TableHead>
              <TableHead className="w-[96px] min-w-[88px] px-2.5 whitespace-nowrap">แปล</TableHead>
              <TableHead className="w-[105px] min-w-[96px] px-2.5 whitespace-nowrap">ลงคำ</TableHead>
              <TableHead className="w-[96px] min-w-[88px] px-2.5 whitespace-nowrap">Publisher</TableHead>
              <TableHead className="w-[88px] min-w-[80px] px-2.5 whitespace-nowrap">โพสต์</TableHead>
              <TableHead className="min-w-[110px] max-w-[170px] px-2.5 whitespace-nowrap">โน้ต</TableHead>
              <TableHead className="w-[80px] min-w-[76px] px-2.5 text-center whitespace-nowrap">จัดการ</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <TableRow key={idx}>
                  <TableCell colSpan={11}>
                    <Skeleton className="h-12 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredQueue.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="text-center py-12 text-slate-400"
                >
                  ไม่มีข้อมูลคิวงานที่ตรงกับตัวกรอง
                </TableCell>
              </TableRow>
            ) : (
              filteredQueue.map((q) => {
                const qid = String(q.queueid)
                const isSelected = selectedIds.has(qid)
                const manga = mangaList.find(
                  (m) =>
                    m.mangaid != null &&
                    q.mangaid != null &&
                    String(m.mangaid) === String(q.mangaid)
                )
                const mangaName = resolveMangaName(q.mangaid, manga?.manganame, mangaList)
                const urgent = isUrgentManga(manga)
                const createdDate = parseQueueDate(q.createdat)
                const dateStr = createdDate
                  ? createdDate.toLocaleDateString("th-TH") +
                    " " +
                    createdDate.toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "-"

                const upDur = formatDuration(q.createdat, q.uploadtime)
                const exDur = formatDuration(q.uploadtime, q.extracttime)
                const trDur = formatDuration(q.extracttime, q.translatetime)
                const tsDur = formatDuration(q.translatetime, q.typesettime)
                const pbDur = formatDuration(q.typesettime, q.publishtime)

                return (
                  <TableRow
                    key={qid}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    <TableCell className="px-2.5 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRow(qid, e.target.checked)}
                        className="h-4 w-4 accent-indigo-500 rounded cursor-pointer"
                      />
                    </TableCell>

                    <TableCell className="min-w-[180px] max-w-[260px] px-3 py-3">
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">{dateStr}</div>
                      <div
                        className={`font-semibold leading-snug ${
                          urgent ? "text-red-400" : "text-slate-100"
                        } flex items-center gap-1.5 flex-wrap`}
                      >
                        <span className="line-clamp-2 break-words">
                          {urgent && "🔥 "}
                          {mangaName}
                        </span>
                        {urgent && (
                          <span className="rounded bg-red-500/20 border border-red-500/30 px-1.5 py-0.2 text-[10px] font-bold text-red-300 whitespace-nowrap">
                            ด่วน
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 whitespace-nowrap mt-0.5">
                        ตอนที่ {q.chapter}
                      </div>
                      {manga?.translationdocurl && (
                        <div className="mt-1">
                          <a
                            href={manga.translationdocurl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-blue-400 hover:text-blue-300 hover:underline bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-800/50 transition-colors"
                            title="เปิด Google Docs รวมงานแปลทุกตอน"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FileText className="h-3 w-3 text-blue-400 shrink-0" />
                            Docs รวมแปล
                            <ExternalLink className="h-2.5 w-2.5 opacity-70 shrink-0" />
                          </a>
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {renderStatusBadge(q, "upload", q.uploadstatus)}
                      <div className="text-xs text-slate-400 mt-1 truncate max-w-[115px]" title={q.uploadername || "-"}>
                        {q.uploadername || "-"}
                        {upDur && (
                          <div className="text-[11px] text-slate-500">
                            ⏱️ {upDur}
                          </div>
                        )}
                      </div>
                      {renderStepLinks(q.worklink, "อัป Raw")}
                    </TableCell>

                    {/* 2. ดึงคำออโต้ */}
                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {(() => {
                        const isPratchaya = String(q.translatorname || (manga && manga.lockedtranslator) || "").toLowerCase().includes("pratchaya");
                        const extStr = String(q.extractorname || "").toLowerCase();
                        const isKikExtractDone = (extStr.includes("kikuk") || extStr.includes("kik")) && isStepDone(q.extractstatus);
                        const isOcrDoing = String(q.ocrstatus || "").trim() === "กำลังทำ";
                        const effectiveOcrStatus = ((isPratchaya || isKikExtractDone) && !isOcrDoing)
                          ? "skip"
                          : (q.ocrstatus || (isStepDone(q.extractstatus) ? "เสร็จแล้ว" : (isStepDone(q.uploadstatus) ? "รอเริ่ม" : "รอเริ่ม")));
                        const ocrSubLabel = effectiveOcrStatus === "skip"
                          ? (isPratchaya ? "Pratchaya แปล" : (isKikExtractDone ? "Kikkuk ดึงแล้ว" : "ข้ามการดึงคำ"))
                          : (q.ocrtime ? parseQueueDate(q.ocrtime)?.toLocaleDateString("th-TH") : "GitHub Actions");
                        return (
                          <>
                            {renderStatusBadge(q, "ocr", effectiveOcrStatus)}
                            <div className="text-xs text-slate-400 mt-1 truncate max-w-[115px]" title={String(ocrSubLabel || "")}>
                              {ocrSubLabel}
                            </div>
                          </>
                        );
                      })()}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {(() => {
                        const isPratchaya = String(q.translatorname || (manga && manga.lockedtranslator) || "").toLowerCase().includes("pratchaya");
                        const isExtractActive = String(q.extractstatus || "").trim() === "กำลังทำ" || String(q.extractstatus || "").trim() === "รอเริ่ม";
                        const effectiveExtractStatus = (isPratchaya && !isExtractActive) ? "skip" : q.extractstatus;
                        const extractSubLabel = isPratchaya && !isExtractActive ? "Pratchaya แปล" : (q.extractorname || "Kikkuk");
                        return (
                          <>
                            {renderStatusBadge(q, "extract", effectiveExtractStatus)}
                            <div className="text-xs text-slate-400 mt-1 truncate max-w-[115px]" title={extractSubLabel}>
                              {extractSubLabel}
                              {exDur && (
                                <div className="text-[11px] text-slate-500">
                                  ⏱️ {exDur}
                                </div>
                              )}
                            </div>
                            {renderStepLinks(q.worklink, "ดึงคำ")}
                          </>
                        );
                      })()}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {renderStatusBadge(q, "translate", q.translatestatus)}
                      <div className="text-xs text-slate-400 mt-1 truncate max-w-[110px]">
                        {q.translatorname || ((manga && manga.lockedtranslator && String(manga.lockedtranslator).toLowerCase().includes("pratchaya")) ? manga.lockedtranslator : ((manga && manga.lockedtranslator) || "เร"))}
                        {trDur && (
                          <div className="text-[11px] text-slate-500">
                            ⏱️ {trDur}
                          </div>
                        )}
                      </div>
                      {renderStepLinks(q.worklink, "แปล")}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {renderStatusBadge(q, "typeset", q.typesetstatus)}
                      <div className="text-xs text-slate-400 mt-1">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="truncate max-w-[80px]">{q.typesettername || (manga && manga.lockedtypesetter) || "-"}</span>
                          {(q.typesettype === "เกาหลี" || q.typesetratetype === "เกาหลี") && (
                            <span className="inline-block text-[10px] text-sky-400 font-bold bg-sky-500/10 px-1 py-0.2 rounded border border-sky-500/30 shrink-0">
                              เกาหลี
                            </span>
                          )}
                        </div>
                        {tsDur && (
                          <div className="text-[11px] text-slate-500">
                            ⏱️ {tsDur}
                          </div>
                        )}
                      </div>
                      {renderStepLinks(q.worklink, "ลงคำ")}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {renderStatusBadge(q, "publish", q.publishstatus)}
                      <div className="text-xs text-slate-400 mt-1 truncate max-w-[110px]">
                        {q.publishername || "-"}
                        {pbDur && (
                          <div className="text-[11px] text-slate-500">
                            ⏱️ {pbDur}
                          </div>
                        )}
                      </div>
                      {renderStepLinks(q.worklink, "เผยแพร่")}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 whitespace-nowrap">
                      {renderStatusBadge(q, "post", q.poststatus)}
                      <div className="text-xs text-slate-400 mt-1 truncate max-w-[100px]">
                        {q.postername || "-"}
                      </div>
                    </TableCell>

                    <TableCell className="min-w-[110px] max-w-[170px] px-2.5 py-3">
                      {q.note ? (
                        <div className="space-y-0.5 text-xs text-slate-300">
                          {String(q.note)
                            .split("\n")
                            .filter(Boolean)
                            .map((n, i) => (
                              <div key={i} className="truncate" title={n.trim()}>
                                📝 {n.trim()}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </TableCell>

                    <TableCell className="px-2.5 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => onOpenUpdateQueue(q)}
                          title="แก้ไขแบบรวม"
                        >
                          <Pencil className="h-3.5 w-3.5 text-indigo-400" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleDeleteQueue(qid)}
                          title="ลบคิวงาน"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Step Update Modal */}
      <StepUpdateModal
        open={stepModalOpen}
        onClose={() => setStepModalOpen(false)}
        queueItem={activeStepItem}
        step={activeStepKey}
        teamList={teamList}
        onOptimisticUpdate={(updated) => {
          onQueueChange(
            queueList.map((q) =>
              String(q.queueid) === String(updated.queueid) ? updated : q
            )
          )
        }}
        onSuccess={(serverQueue) => onQueueChange(serverQueue)}
        onRollback={() => onQueueChange(backupQueue)}
      />
    </div>
  )
}

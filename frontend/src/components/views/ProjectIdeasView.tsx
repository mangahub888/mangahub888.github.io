import * as React from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import initialIdeasData from "@/data/project_ideas_latest.json"
import initialComixIdeasData from "@/data/comix_project_ideas_latest.json"
import { callGasApi } from "@/api/gasClient"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"
import { toast } from "sonner"
import {
  Lightbulb,
  Sparkles,
  Search,
  ExternalLink,
  Copy,
  Plus,
  RefreshCw,
  LayoutGrid,
  List as ListIcon,
  Star,
  BookOpen,
  Layers,
  Clock,
  Compass,
  Flame,
  Power,
  PowerOff,
  Loader2,
  SlidersHorizontal,
  Globe,
} from "lucide-react"

interface TriggerStatusData {
  is6HourTriggerActive: boolean
  lastPipelineTrigger?: {
    lastTriggeredAt?: string
    triggerSource?: string
    statusCode?: number
    success?: boolean
    response?: string
  } | null
}

interface ProjectIdeasViewProps {
  onOpenAddManga?: (prefilled: any) => void
}

export type SourceFilterId = "mgeko" | "comix"

export interface SourceWebsiteConfig {
  id: SourceFilterId
  name: string
  domain: string
  url: string
  badgeText: string
  accentColor: "amber" | "violet"
  metricLabel: string
  openButtonLabel: string
}

export const SOURCE_WEBSITE_FILTERS: SourceWebsiteConfig[] = [
  {
    id: "mgeko",
    name: "Mgeko",
    domain: "mgeko.cc/jumbo/manga",
    url: "https://www.mgeko.cc/jumbo/manga/",
    badgeText: "เว็บที่ 1 • Mgeko.cc",
    accentColor: "amber",
    metricLabel: "วิว",
    openButtonLabel: "เปิด Mgeko",
  },
  {
    id: "comix",
    name: "Comix - Read Comics online",
    domain: "comix.to",
    url: "https://comix.to/",
    badgeText: "เว็บที่ 2 • Comix.to",
    accentColor: "violet",
    metricLabel: "ผู้ติดตาม",
    openButtonLabel: "เปิด Comix.to",
  },
]

export interface ChapterRangePreset {
  id: string
  label: string
  shortLabel: string
  min: number
  max: number
  group: "broad" | "stepped"
  badgeColor?: string
}

export const CHAPTER_RANGE_PRESETS: ChapterRangePreset[] = [
  // Broad / Overview Ranges
  { id: "0-100", label: "ทั้งหมด (0 - 100 ตอน)", shortLabel: "0 - 100 ตอน", min: 0, max: 100, group: "broad", badgeColor: "amber" },
  { id: "0-30", label: "ไม่เกิน 30 ตอน (0 - 30)", shortLabel: "0 - 30 ตอน", min: 0, max: 30, group: "broad", badgeColor: "emerald" },
  { id: "0-50", label: "ไม่เกิน 50 ตอน (0 - 50)", shortLabel: "0 - 50 ตอน", min: 0, max: 50, group: "broad", badgeColor: "cyan" },
  { id: "31-60", label: "ระดับกลาง (31 - 60 ตอน)", shortLabel: "31 - 60 ตอน", min: 31, max: 60, group: "broad", badgeColor: "indigo" },
  { id: "61-100", label: "ตอนเยอะ (61 - 100 ตอน)", shortLabel: "61 - 100 ตอน", min: 61, max: 100, group: "broad", badgeColor: "purple" },

  // Stepped 5-Episode Ranges (1-5, 6-10, ... up to 96-100)
  { id: "1-5", label: "🌱 1 - 5 ตอน", shortLabel: "1-5", min: 1, max: 5, group: "stepped" },
  { id: "6-10", label: "6 - 10 ตอน", shortLabel: "6-10", min: 6, max: 10, group: "stepped" },
  { id: "11-15", label: "11 - 15 ตอน", shortLabel: "11-15", min: 11, max: 15, group: "stepped" },
  { id: "16-20", label: "16 - 20 ตอน", shortLabel: "16-20", min: 16, max: 20, group: "stepped" },
  { id: "21-25", label: "21 - 25 ตอน", shortLabel: "21-25", min: 21, max: 25, group: "stepped" },
  { id: "26-30", label: "26 - 30 ตอน", shortLabel: "26-30", min: 26, max: 30, group: "stepped" },
  { id: "31-35", label: "31 - 35 ตอน", shortLabel: "31-35", min: 31, max: 35, group: "stepped" },
  { id: "36-40", label: "36 - 40 ตอน", shortLabel: "36-40", min: 36, max: 40, group: "stepped" },
  { id: "41-45", label: "41 - 45 ตอน", shortLabel: "41-45", min: 41, max: 45, group: "stepped" },
  { id: "46-50", label: "46 - 50 ตอน", shortLabel: "46-50", min: 46, max: 50, group: "stepped" },
  { id: "51-55", label: "51 - 55 ตอน", shortLabel: "51-55", min: 51, max: 55, group: "stepped" },
  { id: "56-60", label: "56 - 60 ตอน", shortLabel: "56-60", min: 56, max: 60, group: "stepped" },
  { id: "61-65", label: "61 - 65 ตอน", shortLabel: "61-65", min: 61, max: 65, group: "stepped" },
  { id: "66-70", label: "66 - 70 ตอน", shortLabel: "66-70", min: 66, max: 70, group: "stepped" },
  { id: "71-75", label: "71 - 75 ตอน", shortLabel: "71-75", min: 71, max: 75, group: "stepped" },
  { id: "76-80", label: "76 - 80 ตอน", shortLabel: "76-80", min: 76, max: 80, group: "stepped" },
  { id: "81-85", label: "81 - 85 ตอน", shortLabel: "81-85", min: 81, max: 85, group: "stepped" },
  { id: "86-90", label: "86 - 90 ตอน", shortLabel: "86-90", min: 86, max: 90, group: "stepped" },
  { id: "91-95", label: "91 - 95 ตอน", shortLabel: "91-95", min: 91, max: 95, group: "stepped" },
  { id: "96-100", label: "96 - 100 ตอน", shortLabel: "96-100", min: 96, max: 100, group: "stepped" },
]

export function ProjectIdeasView({ onOpenAddManga }: ProjectIdeasViewProps) {
  const [rawData, setRawData] = React.useState<any>(initialIdeasData)
  const [comixFallbackData, setComixFallbackData] = React.useState<any>(initialComixIdeasData)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [triggering, setTriggering] = React.useState<boolean>(false)

  // 2 Separate Website Filters: "mgeko" vs "comix"
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilterId>("mgeko")

  // 6-Hour Automation Trigger Status
  const [triggerStatus, setTriggerStatus] = React.useState<TriggerStatusData | null>(null)
  const [loadingTriggerStatus, setLoadingTriggerStatus] = React.useState<boolean>(false)
  const [togglingTrigger, setTogglingTrigger] = React.useState<boolean>(false)

  // GitHub Actions Workflow Status
  const { isProjectIdeasRunning, refetch: refetchActions } = useGitHubActionsStatus()

  // Filters
  const [searchQuery, setSearchQuery] = React.useState<string>("")
  const [originFilter, setOriginFilter] = React.useState<string>("all")
  const [chapterRange, setChapterRange] = React.useState<string>("0-100")
  const [customMinEp, setCustomMinEp] = React.useState<string>("")
  const [customMaxEp, setCustomMaxEp] = React.useState<string>("")
  const [selectedGenre, setSelectedGenre] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<"views_desc" | "chap_asc" | "chap_desc" | "score_desc" | "recent">("views_desc")
  const [viewMode, setViewMode] = React.useState<"grid" | "table">("grid")
  const [expandedSummaries, setExpandedSummaries] = React.useState<Record<string, boolean>>({})

  // Resolve separated datasets for Mgeko and Comix.to
  const mgekoDataset = React.useMemo(() => {
    if (rawData?.sources?.mgeko && Array.isArray(rawData.sources.mgeko.items)) {
      return rawData.sources.mgeko
    }
    return rawData
  }, [rawData])

  const comixDataset = React.useMemo(() => {
    if (rawData?.sources?.comix && Array.isArray(rawData.sources.comix.items) && rawData.sources.comix.items.length > 0) {
      return rawData.sources.comix
    }
    return comixFallbackData
  }, [rawData, comixFallbackData])

  // Active dataset based on selected website filter ("mgeko" or "comix")
  const data = React.useMemo(() => {
    return sourceFilter === "comix" ? comixDataset : mgekoDataset
  }, [sourceFilter, mgekoDataset, comixDataset])

  const activeSourceConfig = React.useMemo(() => {
    return SOURCE_WEBSITE_FILTERS.find((s) => s.id === sourceFilter) || SOURCE_WEBSITE_FILTERS[0]
  }, [sourceFilter])

  const handleSelectWebsiteFilter = (nextSource: SourceFilterId) => {
    setSourceFilter(nextSource)
    setSelectedGenre("all")
  }

  // Fetch freshest data
  const loadLatestIdeas = React.useCallback(async () => {
    setLoading(true)
    try {
      // 1. Live raw GitHub content
      try {
        const liveRes = await fetch(
          `https://raw.githubusercontent.com/mangahub888/mangahub888.github.io/main/tools/data/project_ideas_latest.json?_t=${Date.now()}`
        )
        if (liveRes.ok) {
          const json = await liveRes.json()
          if (json && Array.isArray(json.items) && json.items.length > 0) {
            setRawData((prev: any) => {
              const prevHasComix = Boolean(prev?.sources?.comix?.items?.length)
              const nextHasComix = Boolean(json?.sources?.comix?.items?.length)
              if (prevHasComix && !nextHasComix) {
                return {
                  ...json,
                  sources: {
                    mgeko: json,
                    comix: prev.sources.comix,
                  },
                }
              }
              return json
            })
            if (json?.sources?.comix?.items?.length) {
              setComixFallbackData(json.sources.comix)
            }
            setLoading(false)
            return
          }
        }
      } catch {}

      // 2. Public local asset
      const res = await fetch(`./data/project_ideas_latest.json?_t=${Date.now()}`, { cache: "no-store" })
      if (res.ok) {
        const json = await res.json()
        if (json && Array.isArray(json.items) && json.items.length > 0) {
          setRawData(json)
          if (json?.sources?.comix?.items?.length) {
            setComixFallbackData(json.sources.comix)
          }
          setLoading(false)
          return
        }
      }
    } catch (e) {
      console.warn("Could not load local project ideas JSON", e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch 6-Hour Trigger Status from GAS
  const loadTriggerStatus = React.useCallback(async () => {
    try {
      setLoadingTriggerStatus(true)
      const res = await callGasApi<TriggerStatusData>("GET_PROJECT_IDEAS_TRIGGER_STATUS")
      if (res && typeof res.is6HourTriggerActive === "boolean") {
        setTriggerStatus(res)
      }
    } catch (e) {
      console.warn("Could not fetch project ideas trigger status", e)
    } finally {
      setLoadingTriggerStatus(false)
    }
  }, [])

  React.useEffect(() => {
    loadTriggerStatus()
  }, [loadTriggerStatus])

  // Toggle 6-Hour Trigger (Enable / Disable)
  const handleToggleTrigger = async () => {
    if (togglingTrigger) return
    setTogglingTrigger(true)
    const isCurrentlyActive = Boolean(triggerStatus?.is6HourTriggerActive)
    const action = isCurrentlyActive ? "DELETE_PROJECT_IDEAS_TRIGGER" : "CREATE_PROJECT_IDEAS_TRIGGER"
    const toastId = toast.loading(
      isCurrentlyActive
        ? "กำลังปิดระบบ Trigger 6 ชั่วโมงใน GAS..."
        : "กำลังสร้าง Trigger สั่งรันอัตโนมัติทุก 6 ชั่วโมงใน GAS..."
    )

    try {
      const res: any = await callGasApi(action)
      toast.success(
        res?.message ||
          (isCurrentlyActive
            ? "ปิดระบบ Trigger อัตโนมัติทุก 6 ชั่วโมงเรียบร้อยแล้ว"
            : "เปิดใช้งาน Trigger อัตโนมัติทุก 6 ชั่วโมงเรียบร้อยแล้ว"),
        { id: toastId }
      )
      await loadTriggerStatus()
    } catch (e: any) {
      toast.error(e.message || "เกิดข้อผิดพลาดในการเปลี่ยนสถานะ Trigger", { id: toastId })
    } finally {
      setTogglingTrigger(false)
    }
  }

  // Manually Trigger Project Ideas Workflow Pipeline
  const handleTriggerAction = async () => {
    setTriggering(true)
    const toastId = toast.loading("กำลังส่งสัญญาณรันสแกน Mgeko + Comix.to (0-100 ตอน) บน GitHub Actions...")
    try {
      await callGasApi("TRIGGER_PROJECT_IDEAS_PIPELINE", { source: "project_ideas_ui", maxChapters: 100, pages: 5 })
      toast.success("🚀 ส่งสัญญาณให้ระบบสแกนหาไอเดียมังงะใหม่ (Mgeko + Comix.to 0-100 ตอน) เรียบร้อยแล้ว!", { id: toastId })
      if (refetchActions) refetchActions()
      setTimeout(() => {
        loadLatestIdeas()
        loadTriggerStatus()
      }, 4000)
    } catch (e: any) {
      toast.error(e.message || "ไม่สามารถสั่งรันได้", { id: toastId })
    } finally {
      setTriggering(false)
    }
  }

  const handleCopyTitle = (title: string) => {
    navigator.clipboard.writeText(title)
    toast.success(`📋 คัดลอกชื่อเรื่อง "${title.substring(0, 30)}..." แล้ว`)
  }

  const toggleSummary = (id: string) => {
    setExpandedSummaries((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Active Min / Max Chapter bounds
  const activeBounds = React.useMemo(() => {
    const hasCustomMin = customMinEp.trim() !== "" && !isNaN(Number(customMinEp))
    const hasCustomMax = customMaxEp.trim() !== "" && !isNaN(Number(customMaxEp))
    if (hasCustomMin || hasCustomMax) {
      const min = hasCustomMin ? Math.max(0, Number(customMinEp)) : 0
      const max = hasCustomMax ? Math.max(min, Number(customMaxEp)) : 100
      return { min, max, label: `${min} - ${max} ตอน (กำหนดเอง)`, isCustom: true }
    }
    const preset = CHAPTER_RANGE_PRESETS.find((p) => p.id === chapterRange) || CHAPTER_RANGE_PRESETS[0]
    return { min: preset.min, max: preset.max, label: preset.label, isCustom: false }
  }, [chapterRange, customMinEp, customMaxEp])

  const handleSelectPresetRange = (presetId: string) => {
    setChapterRange(presetId)
    setCustomMinEp("")
    setCustomMaxEp("")
  }

  // Compute counts per preset range for the currently selected website filter
  const rangeCounts = React.useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : []
    const counts: Record<string, number> = {}
    for (const preset of CHAPTER_RANGE_PRESETS) {
      counts[preset.id] = items.filter((it: any) => {
        const ch = Number(it.chapter_count || 0)
        return ch >= preset.min && ch <= preset.max
      }).length
    }
    return counts
  }, [data])

  // Filter & Sort Logic
  const filteredItems = React.useMemo(() => {
    if (!data || !Array.isArray(data.items)) return []
    let list = [...data.items]

    // Origin Filter
    if (originFilter !== "all") {
      list = list.filter((item) => item.origin === originFilter || (item.origin && item.origin.includes(originFilter)))
    }

    // Chapter Range Filter (Multi-level 1-5, 6-10 ... 0-100 or custom min-max)
    list = list.filter((item) => {
      const ch = Number(item.chapter_count || 0)
      return ch >= activeBounds.min && ch <= activeBounds.max
    })

    // Genre Filter
    if (selectedGenre !== "all") {
      list = list.filter(
        (item) =>
          Array.isArray(item.genres) &&
          item.genres.some((g: string) => g.toLowerCase() === selectedGenre.toLowerCase())
      )
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (item) =>
          (item.title && item.title.toLowerCase().includes(q)) ||
          (Array.isArray(item.alt_titles) && item.alt_titles.some((t: string) => t && t.toLowerCase().includes(q))) ||
          (item.summary && item.summary.toLowerCase().includes(q)) ||
          (item.summary_th && item.summary_th.toLowerCase().includes(q)) ||
          (Array.isArray(item.genres) && item.genres.some((g: string) => g.toLowerCase().includes(q)))
      )
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "views_desc") return (b.views_count || 0) - (a.views_count || 0)
      if (sortBy === "chap_asc") return (a.chapter_count || 0) - (b.chapter_count || 0)
      if (sortBy === "chap_desc") return (b.chapter_count || 0) - (a.chapter_count || 0)
      if (sortBy === "score_desc") return parseFloat(b.score || 0) - parseFloat(a.score || 0)
      return 0
    })

    return list
  }, [data, originFilter, activeBounds, selectedGenre, searchQuery, sortBy])

  // Top genres list for chips
  const topGenreChips = React.useMemo(() => {
    if (!data || !data.top_genres) return ["Action", "Fantasy", "Isekai", "Comedy", "Manhwa", "Manhua"]
    return Object.keys(data.top_genres).slice(0, 10)
  }, [data])

  const broadPresets = React.useMemo(() => CHAPTER_RANGE_PRESETS.filter((p) => p.group === "broad"), [])
  const steppedPresets = React.useMemo(() => CHAPTER_RANGE_PRESETS.filter((p) => p.group === "stepped"), [])

  const mgekoCount = Array.isArray(mgekoDataset?.items) ? mgekoDataset.items.length : 0
  const comixCount = Array.isArray(comixDataset?.items) ? comixDataset.items.length : 0

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-[#0f172a] to-[#0b1120]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 border border-amber-500/30">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">
                หาไอเดียโปรเจคใหม่ (New Project Discovery)
              </span>
              <Badge className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                รองรับ 2 เว็บไซต์แยกฟิลเตอร์ • 0 - 100 ตอน
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>กำลังดูข้อมูลจาก:</span>
              <a
                href={activeSourceConfig.url}
                target="_blank"
                rel="noreferrer"
                className={`font-mono flex items-center gap-1 underline underline-offset-2 ${
                  sourceFilter === "comix"
                    ? "text-violet-400 hover:text-violet-300"
                    : "text-amber-400 hover:text-amber-300"
                }`}
              >
                {activeSourceConfig.domain} <ExternalLink className="h-3 w-3 inline" />
              </a>
              <span>• อัปเดตล่าสุด:</span>
              <span className="text-slate-200 font-mono">
                {data?.crawled_at
                  ? new Date(data.crawled_at).toLocaleString("th-TH")
                  : "ล่าสุดวันนี้"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadLatestIdeas}
            disabled={loading}
            className="h-8 text-xs border-slate-700 bg-[#0b1120]"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            โหลดข้อมูลใหม่
          </Button>
          <Button
            size="sm"
            onClick={handleTriggerAction}
            disabled={triggering}
            className="h-8 text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-sm shadow-amber-500/20"
          >
            <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${triggering ? "animate-bounce" : ""}`} />
            {triggering ? "กำลังสั่งรัน..." : "สั่งสแกนอัปเดตสด"}
          </Button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2 SEPARATED WEBSITE FILTERS (Mgeko.cc vs Comix.to)                    */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Filter 1: Mgeko (mgeko.cc) */}
        <button
          type="button"
          onClick={() => handleSelectWebsiteFilter("mgeko")}
          className={`text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
            sourceFilter === "mgeko"
              ? "bg-gradient-to-r from-amber-950/60 via-[#131c31] to-[#0f172a] border-amber-500/70 ring-1 ring-amber-500/50 shadow-lg shadow-amber-500/10"
              : "bg-[#0f172a]/70 border-slate-800 hover:border-amber-500/40 hover:bg-[#111a2e]"
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                sourceFilter === "mgeko"
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/50"
                  : "bg-slate-800/70 text-slate-400 border-slate-700"
              }`}
            >
              <Globe className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">
                  🟠 ฟิลเตอร์เว็บ 1: Mgeko (mgeko.cc)
                </span>
                {sourceFilter === "mgeko" && (
                  <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] px-2 py-0">
                    กำลังเลือกใช้งาน
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                แหล่งรวมมังงะอัปเดตไว (mgeko.cc/jumbo/manga) • คัดเฉพาะไม่เกิน 100 ตอน
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-xl font-bold font-mono text-amber-400">
              {mgekoCount} <span className="text-xs font-normal text-slate-400">เรื่อง</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              KR {mgekoDataset?.origin_distribution?.["KR (Manhwa)"] || 0} • CN{" "}
              {mgekoDataset?.origin_distribution?.["CN (Manhua)"] || 0}
            </div>
          </div>
        </button>

        {/* Filter 2: Comix - Read Comics online for free (comix.to) */}
        <button
          type="button"
          onClick={() => handleSelectWebsiteFilter("comix")}
          className={`text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
            sourceFilter === "comix"
              ? "bg-gradient-to-r from-violet-950/60 via-[#161432] to-[#0f172a] border-violet-500/70 ring-1 ring-violet-500/50 shadow-lg shadow-violet-500/10"
              : "bg-[#0f172a]/70 border-slate-800 hover:border-violet-500/40 hover:bg-[#13142c]"
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                sourceFilter === "comix"
                  ? "bg-violet-500/20 text-violet-300 border-violet-500/50"
                  : "bg-slate-800/70 text-slate-400 border-slate-700"
              }`}
            >
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">
                  🟣 ฟิลเตอร์เว็บ 2: Comix - Read Comics online (comix.to)
                </span>
                {sourceFilter === "comix" && (
                  <Badge className="bg-violet-500/20 text-violet-300 border border-violet-500/40 text-[10px] px-2 py-0">
                    กำลังเลือกใช้งาน
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                แหล่งรวม Manhwa / Manhua / Manga มาแรงจาก Comix.to • คัดเฉพาะไม่เกิน 100 ตอน
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-xl font-bold font-mono text-violet-400">
              {comixCount} <span className="text-xs font-normal text-slate-400">เรื่อง</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              KR {comixDataset?.origin_distribution?.["KR (Manhwa)"] || 0} • CN{" "}
              {comixDataset?.origin_distribution?.["CN (Manhua)"] || 0} • JP{" "}
              {comixDataset?.origin_distribution?.["JP (Manga)"] || 0}
            </div>
          </div>
        </button>
      </div>

      {/* 6-Hour Automation Trigger Status & Control Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0f172a]/90 border border-slate-800 backdrop-blur-xs text-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-slate-200">ระบบอัปเดตอัตโนมัติ (6-Hour Trigger):</span>
          </div>

          {loadingTriggerStatus ? (
            <Badge variant="outline" className="bg-slate-800/60 text-slate-400 border-slate-700 animate-pulse text-[11px]">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> กำลังตรวจสอบสถานะ...
            </Badge>
          ) : triggerStatus?.is6HourTriggerActive ? (
            <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 gap-1.5 font-medium px-2.5 py-0.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              เปิดทำงานทุก 6 ชม. (Active)
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30 gap-1.5 font-medium px-2.5 py-0.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              ปิดการทำงาน (Inactive)
            </Badge>
          )}

          {isProjectIdeasRunning && (
            <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse text-[11px]">
              <Sparkles className="h-3 w-3 mr-1 animate-spin" />
              GitHub Actions กำลังสแกนอยู่...
            </Badge>
          )}

          {triggerStatus?.lastPipelineTrigger?.lastTriggeredAt && (
            <span className="text-slate-400 flex items-center gap-1.5 text-[11px]">
              <span>รันล่าสุด:</span>
              <span className="text-slate-300 font-mono">
                {new Date(triggerStatus.lastPipelineTrigger.lastTriggeredAt).toLocaleString("th-TH")}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  triggerStatus.lastPipelineTrigger.success
                    ? "text-emerald-400 bg-emerald-950/40 border border-emerald-800/40"
                    : "text-rose-400 bg-rose-950/40 border border-rose-800/40"
                }`}
              >
                {triggerStatus.lastPipelineTrigger.success ? "สำเร็จ (204/200)" : "ล้มเหลว"}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              loadTriggerStatus()
              if (refetchActions) refetchActions()
            }}
            disabled={loadingTriggerStatus}
            className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-200"
            title="รีเฟรชสถานะ Trigger"
          >
            <RefreshCw className={`h-3 w-3 ${loadingTriggerStatus ? "animate-spin" : ""}`} />
          </Button>

          <Button
            size="sm"
            onClick={handleToggleTrigger}
            disabled={togglingTrigger || loadingTriggerStatus}
            className={`h-7 px-3 text-xs font-medium transition-all ${
              triggerStatus?.is6HourTriggerActive
                ? "bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-700/50 hover:border-rose-600"
                : "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 hover:border-emerald-600"
            }`}
          >
            {togglingTrigger ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                กำลังสลับสถานะ...
              </>
            ) : triggerStatus?.is6HourTriggerActive ? (
              <>
                <PowerOff className="h-3 w-3 mr-1.5 text-rose-400" />
                ปิด Trigger 6 ชม.
              </>
            ) : (
              <>
                <Power className="h-3 w-3 mr-1.5 text-emerald-400" />
                เปิด Trigger 6 ชม.
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 4 KPI Summary Cards (Specific to the active Website Filter) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          onClick={() => handleSelectPresetRange("0-100")}
          className={`p-4 bg-[#0f172a]/90 border-slate-800 cursor-pointer transition-all hover:border-amber-500/40 ${
            !activeBounds.isCustom && chapterRange === "0-100" ? "ring-1 ring-amber-500/50 border-amber-500/40" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">
                🎯 มังงะใน {sourceFilter === "comix" ? "Comix.to" : "Mgeko"} (0 - 100 ตอน)
              </p>
              <p className="text-2xl font-bold font-mono text-amber-400 mt-1">
                {data?.total_candidates || (data?.items || []).length || 0}{" "}
                <span className="text-xs font-normal text-slate-400">เรื่อง</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                ไม่เกิน 30 ตอน: <span className="text-emerald-400 font-mono">{rangeCounts["0-30"] || 0}</span> เรื่อง • 31-100 ตอน:{" "}
                <span className="text-indigo-400 font-mono">{(rangeCounts["31-60"] || 0) + (rangeCounts["61-100"] || 0)}</span> เรื่อง
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Compass className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card
          onClick={() => handleSelectPresetRange("1-5")}
          className={`p-4 bg-[#0f172a]/90 border-slate-800 cursor-pointer transition-all hover:border-emerald-500/40 ${
            !activeBounds.isCustom && chapterRange === "1-5" ? "ring-1 ring-emerald-500/50 border-emerald-500/40" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">🌱 มังงะเปิดใหม่ (1 - 5 ตอน)</p>
              <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {rangeCounts["1-5"] || 0}{" "}
                <span className="text-xs font-normal text-slate-400">เรื่อง</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                6-10 ตอน: <span className="text-cyan-400 font-mono">{rangeCounts["6-10"] || 0}</span> เรื่อง • 11-20 ตอน:{" "}
                <span className="text-teal-400 font-mono">{(rangeCounts["11-15"] || 0) + (rangeCounts["16-20"] || 0)}</span> เรื่อง
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <Flame className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">🌏 สัญชาติมังงะ ({sourceFilter === "comix" ? "Comix.to" : "Mgeko"})</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono font-medium text-slate-200">
                  🇰🇷 Manhwa ({data?.origin_distribution?.["KR (Manhwa)"] || 0})
                </span>
                <span className="text-xs font-mono font-medium text-slate-200">
                  🇨🇳 Manhua ({data?.origin_distribution?.["CN (Manhua)"] || 0})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                🇯🇵 Manga ({(data?.origin_distribution?.["JP (Manga)"] || 0) + (data?.origin_distribution?.["Manga"] || 0)})
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
              <Layers className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">🏷️ หมวดหมู่ยอดนิยม</p>
              <p className="text-sm font-semibold text-cyan-300 mt-1 truncate max-w-[200px]">
                {topGenreChips.slice(0, 3).join(", ")}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                เรื่องย่อแปลไทย &amp; หมวดหมู่ Full Metadata
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
              <BookOpen className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </div>

      {/* Control Filters Bar */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-slate-800 bg-[#0b1120]/80">
        {/* Row 1: Search, Quick Website Switcher, Episode Range Dropdown, Sort, View Toggle */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder={`ค้นหาชื่อมังงะ, ชื่อรอง, หรือเรื่องย่อใน ${sourceFilter === "comix" ? "Comix.to" : "Mgeko"}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-[#0f172a] border-slate-800"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Compact Website Filter Pills inside Filter Bar */}
            <div className="flex items-center bg-[#0f172a] p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleSelectWebsiteFilter("mgeko")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  sourceFilter === "mgeko"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>🟠 Mgeko</span>
                <span className="text-[10px] font-mono opacity-85">({mgekoCount})</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectWebsiteFilter("comix")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  sourceFilter === "comix"
                    ? "bg-violet-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>🟣 Comix.to</span>
                <span className="text-[10px] font-mono opacity-85">({comixCount})</span>
              </button>
            </div>

            {/* Dropdown Select for Episode Range */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">เลือกช่วงตอน:</span>
              <select
                className="h-8 rounded-lg border border-slate-800 bg-[#0f172a] px-2.5 text-xs text-amber-300 font-medium"
                value={activeBounds.isCustom ? "custom" : chapterRange}
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    handleSelectPresetRange(e.target.value)
                  }
                }}
              >
                <optgroup label="🌟 ภาพรวมช่วงกว้าง (Broad Presets)">
                  {broadPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({rangeCounts[p.id] ?? 0} เรื่อง)
                    </option>
                  ))}
                </optgroup>
                <optgroup label="📊 แบ่งระดับทีละ 5 ตอน (1-5, 6-10 ... 96-100)">
                  {steppedPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({rangeCounts[p.id] ?? 0} เรื่อง)
                    </option>
                  ))}
                </optgroup>
                {activeBounds.isCustom && (
                  <option value="custom">🎯 กำหนดเอง ({activeBounds.min} - {activeBounds.max} ตอน)</option>
                )}
              </select>
            </div>

            <select
              className="h-8 rounded-lg border border-slate-800 bg-[#0f172a] px-2.5 text-xs text-slate-200"
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
            >
              <option value="views_desc">
                {sourceFilter === "comix" ? "ผู้ติดตามสูงสุด 🔥" : "ยอดวิวสูงสุด 🔥"}
              </option>
              <option value="chap_asc">ตอนน้อยสุดไปมาก (1 → 100)</option>
              <option value="chap_desc">ตอนมากสุดไปน้อย (100 → 1)</option>
              <option value="score_desc">คะแนนรีวิวสูงสุด ⭐</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-[#0f172a] p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md text-xs transition-all ${
                  viewMode === "grid" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                title="มุมมองการ์ด (Grid View)"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-md text-xs transition-all ${
                  viewMode === "table" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                title="มุมมองตาราง (Table View)"
              >
                <ListIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Origin & Broad Chapter Presets + Custom Min-Max Input */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
          {/* Origin */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 mr-1 font-medium">สัญชาติ:</span>
            <button
              onClick={() => setOriginFilter("all")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                originFilter === "all"
                  ? "bg-slate-700 text-white border-slate-600"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              ทั้งหมด
            </button>
            <button
              onClick={() => setOriginFilter("KR")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                originFilter === "KR"
                  ? "bg-purple-600/30 text-purple-300 border-purple-500/60 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              🇰🇷 Manhwa
            </button>
            <button
              onClick={() => setOriginFilter("CN")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                originFilter === "CN"
                  ? "bg-rose-600/30 text-rose-300 border-rose-500/60 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              🇨🇳 Manhua
            </button>
            <button
              onClick={() => setOriginFilter("JP")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                originFilter === "JP"
                  ? "bg-blue-600/30 text-blue-300 border-blue-500/60 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              🇯🇵 Manga
            </button>
          </div>

          {/* Broad Chapter Range Presets & Custom Min/Max */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 mr-1 font-medium">ช่วงหลัก:</span>
            {broadPresets.map((preset) => {
              const isSelected = !activeBounds.isCustom && chapterRange === preset.id
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPresetRange(preset.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${
                    isSelected
                      ? "bg-amber-600/30 text-amber-300 border-amber-500/60 font-semibold shadow-xs"
                      : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <span>{preset.shortLabel}</span>
                  <span className="text-[10px] font-mono opacity-75">({rangeCounts[preset.id] ?? 0})</span>
                </button>
              )
            })}

            {/* Custom Min-Max Episode Inputs */}
            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-800">
              <SlidersHorizontal className="h-3 w-3 text-slate-400 mr-0.5" />
              <span className="text-[11px] text-slate-400">กำหนดเอง:</span>
              <input
                type="number"
                min={0}
                max={100}
                placeholder="ต่ำสุด"
                value={customMinEp}
                onChange={(e) => setCustomMinEp(e.target.value)}
                className="w-14 h-7 px-1.5 text-center text-xs font-mono rounded-md bg-[#0f172a] border border-slate-800 text-slate-200 focus:border-amber-500/60 focus:outline-none"
              />
              <span className="text-slate-500 text-xs">-</span>
              <input
                type="number"
                min={0}
                max={100}
                placeholder="สูงสุด"
                value={customMaxEp}
                onChange={(e) => setCustomMaxEp(e.target.value)}
                className="w-14 h-7 px-1.5 text-center text-xs font-mono rounded-md bg-[#0f172a] border border-slate-800 text-slate-200 focus:border-amber-500/60 focus:outline-none"
              />
              {activeBounds.isCustom && (
                <button
                  onClick={() => {
                    setCustomMinEp("")
                    setCustomMaxEp("")
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                >
                  ล้าง
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Multi-level Stepped 5-Episode Chips (1-5, 6-10, 11-15 ... 96-100) */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-medium">
              🎚️ เลือกระดับจำนวนตอนแบบละเอียด (ซอยย่อยทุกๆ 5 ตอน: 1-5, 6-10 ... ถึง 100 ตอน):
            </span>
            <span className="text-[11px] font-mono text-amber-400">
              กำลังเลือก: {activeBounds.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {steppedPresets.map((preset) => {
              const isSelected = !activeBounds.isCustom && chapterRange === preset.id
              const count = rangeCounts[preset.id] ?? 0
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPresetRange(preset.id)}
                  className={`px-2 py-1 text-[11px] font-mono rounded-md border transition-all flex items-center gap-1 ${
                    isSelected
                      ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/60 font-semibold shadow-xs"
                      : count > 0
                      ? "bg-[#0f172a] text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white"
                      : "bg-[#0f172a]/40 text-slate-600 border-slate-800/50 hover:text-slate-400"
                  }`}
                  title={`${preset.label} (มี ${count} เรื่อง)`}
                >
                  <span>{preset.shortLabel}</span>
                  <span
                    className={`text-[9px] px-1 py-0 rounded-full ${
                      isSelected
                        ? "bg-emerald-500/30 text-emerald-200"
                        : count > 0
                        ? "bg-slate-800 text-amber-400/90"
                        : "bg-slate-900 text-slate-600"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Row 4: Genre Chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-800/40">
          <span className="text-[11px] text-slate-400 mr-1 font-medium">หมวดหมู่:</span>
          <button
            onClick={() => setSelectedGenre("all")}
            className={`px-2 py-0.5 text-[11px] rounded-md transition-all ${
              selectedGenre === "all"
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200 bg-[#0f172a]"
            }`}
          >
            ทุกหมวด
          </button>
          {topGenreChips.map((g) => (
            <button
              key={g}
              onClick={() => setSelectedGenre(g === selectedGenre ? "all" : g)}
              className={`px-2 py-0.5 text-[11px] rounded-md border transition-all ${
                selectedGenre.toLowerCase() === g.toLowerCase()
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count Header */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1 flex-wrap gap-2">
        <span className="flex items-center gap-2 flex-wrap">
          <Badge
            className={`text-[10px] font-mono ${
              sourceFilter === "comix"
                ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
            }`}
          >
            {activeSourceConfig.badgeText}
          </Badge>
          <span>
            พบมังงะไอเดียใหม่ที่ตรงกับเงื่อนไข:{" "}
            <strong className="text-amber-400 font-mono text-sm">{filteredItems.length}</strong> เรื่อง
          </span>
        </span>
        <span>
          กรองช่วงตอน:{" "}
          <strong className="text-emerald-400 font-mono">
            {activeBounds.min} - {activeBounds.max} ตอน
          </strong>{" "}
          (จากฐานข้อมูล {sourceFilter === "comix" ? "Comix.to" : "Mgeko"} 0 - {data?.max_chapters_threshold || 100} ตอน)
        </span>
      </div>

      {/* Main View: Grid Mode */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.length === 0 ? (
            <div className="col-span-full py-16 text-center text-slate-500">
              <Compass className="h-8 w-8 mx-auto mb-2 text-slate-600 opacity-60" />
              <p>
                ไม่พบมังงะใน {sourceFilter === "comix" ? "Comix.to" : "Mgeko"} ช่วง {activeBounds.min} - {activeBounds.max} ตอน ที่ตรงกับเงื่อนไขการค้นหา
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSelectPresetRange("0-100")}
                className="mt-3 text-xs border-slate-700 bg-[#0f172a] text-amber-400 hover:text-amber-300"
              >
                แสดงทั้งหมด (0 - 100 ตอน)
              </Button>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isExpanded = expandedSummaries[item.id] || false
              const displaySummary = item.summary_th || item.summary || ""
              const hasLongSummary = displaySummary.length > 140
              const isComixItem = item.source === "comix" || sourceFilter === "comix"

              return (
                <Card
                  key={`${item.source || sourceFilter}-${item.id || idx}`}
                  className={`overflow-hidden border-slate-800 bg-[#0f172a]/80 transition-all flex flex-col justify-between group ${
                    isComixItem
                      ? "hover:border-violet-500/40 hover:bg-[#14162e]"
                      : "hover:border-amber-500/40 hover:bg-[#121b2f]"
                  }`}
                >
                  <div className="p-4 flex gap-4">
                    {/* Cover Image */}
                    <div className="relative w-24 h-32 sm:w-28 sm:h-36 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                      {item.cover ? (
                        <img
                          src={item.cover}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <BookOpen className="h-6 w-6" />
                        </div>
                      )}

                      {/* Views / Follows / Score Badge */}
                      {item.views_text || item.views_count ? (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono text-amber-400 flex items-center gap-1 font-bold border border-amber-500/20">
                          <Flame className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                          {item.views_text || `${(item.views_count || 0).toLocaleString()}`}
                        </span>
                      ) : item.score ? (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono text-amber-400 flex items-center gap-0.5 font-bold">
                          <Star className="h-2.5 w-2.5 fill-amber-400" />
                          {item.score}
                        </span>
                      ) : null}

                      {/* Chapter Pill Badge */}
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-indigo-600/90 text-white text-[10px] font-mono font-bold shadow-sm">
                        Ch.{item.chapter_count}
                      </span>
                    </div>

                    {/* Manga Info */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        {/* Origin & Update Time */}
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <Badge
                            className={`text-[10px] px-1.5 py-0 border font-medium ${
                              item.origin?.includes("KR")
                                ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                                : item.origin?.includes("CN")
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                : "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            }`}
                          >
                            {item.origin || "Manga"}
                          </Badge>
                          {item.score && (
                            <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0 rounded border border-amber-500/20">
                              ⭐ {item.score}
                            </span>
                          )}
                          {item.time_updated && (
                            <span className="text-[10px] text-slate-500 font-mono">
                              {item.time_updated}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h4
                          className="text-xs sm:text-sm font-semibold text-slate-100 hover:text-amber-300 transition-colors line-clamp-2 leading-tight cursor-pointer"
                          onClick={() => handleCopyTitle(item.title)}
                          title="คลิกเพื่อคัดลอกชื่อเรื่อง"
                        >
                          {item.title}
                        </h4>

                        {/* Genres */}
                        {Array.isArray(item.genres) && item.genres.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-1.5">
                            {item.genres.slice(0, 3).map((g: string) => (
                              <span
                                key={g}
                                className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400 font-medium"
                              >
                                {g}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Chapter Count Banner */}
                      <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between">
                        <span className="font-mono text-emerald-400 font-semibold">
                          {item.latest_chapter_text || `Chapter ${item.chapter_count}`}
                        </span>
                        {item.views_text ? (
                          <span className="text-[11px] text-amber-400 font-mono flex items-center gap-1 font-semibold">
                            <Flame className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {item.views_text} {activeSourceConfig.metricLabel}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">
                            (กำลังได้รับความนิยม)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Synopsis / Summary */}
                  {displaySummary && (
                    <div className="px-4 pb-3 pt-1 border-t border-slate-800/60 text-[11px] text-slate-300/80 leading-relaxed">
                      <p className={isExpanded ? "" : "line-clamp-2"}>
                        {displaySummary}
                      </p>
                      {hasLongSummary && (
                        <button
                          onClick={() => toggleSummary(item.id)}
                          className="text-amber-400 hover:text-amber-300 text-[10px] mt-0.5 font-medium underline underline-offset-2"
                        >
                          {isExpanded ? "ย่อเรื่องย่อ" : "อ่านเรื่องย่อเพิ่มเติม..."}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="p-2.5 bg-[#0b1120]/90 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyTitle(item.title)}
                        className="h-7 px-2 text-[11px] text-slate-400 hover:text-slate-200"
                        title="คัดลอกชื่อเรื่องไปค้นหา"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        คัดลอกชื่อ
                      </Button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center h-7 px-2 text-[11px] transition-colors font-medium rounded-md ${
                          isComixItem
                            ? "text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                            : "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                        }`}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        {isComixItem ? "เปิด Comix.to" : "เปิด Mgeko"}
                      </a>
                    </div>

                    {onOpenAddManga && (
                      <Button
                        size="sm"
                        onClick={() =>
                          onOpenAddManga({
                            manganame: item.title,
                            originalname: item.title,
                            originalurl: item.url,
                            lastchapter: String(item.chapter_count || "0"),
                            status: item.status || "Ongoing",
                          })
                        }
                        className="h-7 px-2.5 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        เปิดโปรเจคนี้
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })
          )}
        </div>
      )}

      {/* Main View: Table Mode */}
      {viewMode === "table" && (
        <Card className="border-slate-800 bg-[#0f172a]/70 overflow-hidden">
          <div className="overflow-x-auto max-h-[650px]">
            <Table>
              <TableHeader className="bg-[#0b1120] sticky top-0 z-10">
                <TableRow className="border-slate-800">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="w-16 text-center">รูป</TableHead>
                  <TableHead className="min-w-[200px]">ชื่อเรื่องมังงะ</TableHead>
                  <TableHead className="text-center min-w-[90px]">สัญชาติ</TableHead>
                  <TableHead className="text-center min-w-[100px]">ตอนล่าสุด</TableHead>
                  <TableHead className="text-center min-w-[90px]">
                    {sourceFilter === "comix" ? "ผู้ติดตาม" : "ยอดวิว"}
                  </TableHead>
                  <TableHead className="min-w-[180px]">หมวดหมู่</TableHead>
                  <TableHead className="text-center min-w-[120px]">อัปเดตเมื่อ</TableHead>
                  <TableHead className="text-right min-w-[140px]">การจัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                      ไม่พบมังงะในช่วง {activeBounds.min} - {activeBounds.max} ตอน ที่ตรงกับเงื่อนไข
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item, idx) => {
                    const isComixItem = item.source === "comix" || sourceFilter === "comix"
                    return (
                      <TableRow
                        key={`${item.source || sourceFilter}-${item.id || idx}`}
                        className="border-slate-800/60 hover:bg-[#151d2f]/50 transition-colors"
                      >
                        <TableCell className="text-center font-mono font-medium text-xs text-slate-400">
                          #{idx + 1}
                        </TableCell>

                        <TableCell className="text-center">
                          <div className="w-10 h-14 rounded overflow-hidden bg-slate-900 border border-slate-800 mx-auto">
                            {item.cover ? (
                              <img
                                src={item.cover}
                                alt={item.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <BookOpen className="h-4 w-4 m-auto text-slate-600" />
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-100 hover:text-amber-300 transition-colors line-clamp-1">
                              {item.title}
                            </span>
                            {(item.summary_th || item.summary) && (
                              <span className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                                {item.summary_th || item.summary}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge
                            className={`text-[10px] font-normal border ${
                              item.origin?.includes("KR")
                                ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                                : item.origin?.includes("CN")
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                : "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            }`}
                          >
                            {item.origin || "Manga"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono text-xs">
                            {item.chapter_count} ตอน
                          </Badge>
                        </TableCell>

                        <TableCell className="text-center font-mono text-xs text-amber-400 font-semibold">
                          {item.views_text || item.views_count ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold shadow-xs">
                              <Flame className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
                              {item.views_text || `${item.views_count?.toLocaleString()}`}
                            </span>
                          ) : item.score ? (
                            <span>⭐ {item.score}</span>
                          ) : (
                            <span className="text-slate-500 font-normal">-</span>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {(item.genres || []).slice(0, 3).map((g: string) => (
                              <span key={g} className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400">
                                {g}
                              </span>
                            ))}
                          </div>
                        </TableCell>

                        <TableCell className="text-center text-[10px] font-mono text-slate-400">
                          {item.time_updated || "-"}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopyTitle(item.title)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                              title="คัดลอกชื่อเรื่อง"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center justify-center h-7 w-7 ${
                                isComixItem
                                  ? "text-violet-400 hover:text-violet-300"
                                  : "text-amber-400 hover:text-amber-300"
                              }`}
                              title={isComixItem ? "เปิดอ่านบน Comix.to" : "เปิดอ่านบน Mgeko"}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            {onOpenAddManga && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  onOpenAddManga({
                                    manganame: item.title,
                                    originalname: item.title,
                                    originalurl: item.url,
                                    lastchapter: String(item.chapter_count || "0"),
                                    status: item.status || "Ongoing",
                                  })
                                }
                                className="h-7 px-2 text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                              >
                                <Plus className="h-3 w-3 mr-0.5" />
                                เปิดโปรเจค
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}

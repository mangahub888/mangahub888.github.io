import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
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
import { callGasApi } from "@/api/gasClient"
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
  ArrowUpDown,
  Filter,
  Check,
} from "lucide-react"

interface ProjectIdeasViewProps {
  onOpenAddManga?: (prefilled: any) => void
}

export function ProjectIdeasView({ onOpenAddManga }: ProjectIdeasViewProps) {
  const [data, setData] = React.useState<any>(initialIdeasData)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [triggering, setTriggering] = React.useState<boolean>(false)

  // Filters
  const [searchQuery, setSearchQuery] = React.useState<string>("")
  const [originFilter, setOriginFilter] = React.useState<string>("all")
  const [chapterRange, setChapterRange] = React.useState<"all" | "1-5" | "6-15" | "16-30">("all")
  const [selectedGenre, setSelectedGenre] = React.useState<string>("all")
  const [sortBy, setSortBy] = React.useState<"chap_asc" | "chap_desc" | "score_desc" | "recent">("chap_asc")
  const [viewMode, setViewMode] = React.useState<"grid" | "table">("grid")
  const [expandedSummaries, setExpandedSummaries] = React.useState<Record<string, boolean>>({})

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
            setData(json)
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
          setData(json)
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

  const handleTriggerAction = async () => {
    setTriggering(true)
    try {
      // Trigger via GAS or notify
      await callGasApi("TRIGGER_RAW_TRACKER_PIPELINE", { source: "project_ideas_ui" })
      toast.success("🚀 ส่งสัญญาณให้ระบบอัปเดตสแกนไอเดียมังงะใหม่เรียบร้อยแล้ว!")
      setTimeout(() => {
        loadLatestIdeas()
      }, 4000)
    } catch (e: any) {
      toast.error(e.message || "ไม่สามารถสั่งรันได้")
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

  // Filter & Sort Logic
  const filteredItems = React.useMemo(() => {
    if (!data || !Array.isArray(data.items)) return []
    let list = [...data.items]

    // Origin Filter
    if (originFilter !== "all") {
      list = list.filter((item) => item.origin === originFilter || (item.origin && item.origin.includes(originFilter)))
    }

    // Chapter Range Filter (Strict Rule <= 30)
    if (chapterRange === "1-5") {
      list = list.filter((item) => (item.chapter_count || 0) >= 1 && (item.chapter_count || 0) <= 5)
    } else if (chapterRange === "6-15") {
      list = list.filter((item) => (item.chapter_count || 0) >= 6 && (item.chapter_count || 0) <= 15)
    } else if (chapterRange === "16-30") {
      list = list.filter((item) => (item.chapter_count || 0) >= 16 && (item.chapter_count || 0) <= 30)
    }

    // Genre Filter
    if (selectedGenre !== "all") {
      list = list.filter((item) =>
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
          (item.summary && item.summary.toLowerCase().includes(q)) ||
          (Array.isArray(item.genres) && item.genres.some((g: string) => g.toLowerCase().includes(q)))
      )
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "chap_asc") return (a.chapter_count || 0) - (b.chapter_count || 0)
      if (sortBy === "chap_desc") return (b.chapter_count || 0) - (a.chapter_count || 0)
      if (sortBy === "score_desc") return parseFloat(b.score || 0) - parseFloat(a.score || 0)
      return 0
    })

    return list
  }, [data, originFilter, chapterRange, selectedGenre, searchQuery, sortBy])

  // Top genres list for chips
  const topGenreChips = React.useMemo(() => {
    if (!data || !data.top_genres) return ["Action", "Fantasy", "Isekai", "Comedy", "Manhwa", "Manhua"]
    return Object.keys(data.top_genres).slice(0, 10)
  }, [data])

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-[#0f172a] to-[#0b1120]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 border border-amber-500/30">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                หาไอเดียโปรเจคใหม่ (New Project Discovery)
              </span>
              <Badge className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                กฎคัดกรอง: ไม่เกิน 30 ตอน (≤ 30 ตอน)
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span>สแกนจาก:</span>
              <a
                href="https://www.mgeko.cc/jumbo/manga/"
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:text-amber-300 font-mono flex items-center gap-1 underline underline-offset-2"
              >
                mgeko.cc/jumbo/manga <ExternalLink className="h-3 w-3 inline" />
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

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">🎯 มังงะที่ผ่านเกณฑ์ (≤ 30 ตอน)</p>
              <p className="text-2xl font-bold font-mono text-amber-400 mt-1">
                {data?.total_candidates || 57}{" "}
                <span className="text-xs font-normal text-slate-400">เรื่อง</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                จากที่สแกนทั้งหมด {data?.total_scanned || 204} เรื่อง (5 หน้า)
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <Compass className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">🌱 มังงะเปิดใหม่ (1 - 5 ตอน)</p>
              <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {(data?.items || []).filter((i: any) => (i.chapter_count || 0) <= 5).length || 6}{" "}
                <span className="text-xs font-normal text-slate-400">เรื่อง</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                เริ่มแปลได้ทันที ต้นทุนและเวลาเริ่มต้นต่ำ
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
              <p className="text-xs text-slate-400">🌏 สัญชาติมังงะ</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono font-medium text-slate-200">
                  🇰🇷 Manhwa ({data?.origin_distribution?.["KR (Manhwa)"] || 20})
                </span>
                <span className="text-xs font-mono font-medium text-slate-200">
                  🇨🇳 Manhua ({data?.origin_distribution?.["CN (Manhua)"] || 15})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                🇯🇵 Manga ({data?.origin_distribution?.["JP (Manga)"] || 22})
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
                เรื่องย่อ &amp; หมวดหมู่ถูกดึงแบบ Full Metadata
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
        {/* Row 1: Search, Sort, View Toggle */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="ค้นหาชื่อมังงะ, คีย์เวิร์ด, หรือเรื่องย่อ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-[#0f172a] border-slate-800"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-lg border border-slate-800 bg-[#0f172a] px-2.5 text-xs text-slate-200"
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
            >
              <option value="chap_asc">ตอนน้อยสุดไปมาก (1 → 30)</option>
              <option value="chap_desc">ตอนมากสุดไปน้อย (30 → 1)</option>
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

        {/* Row 2: Origin & Chapter Range Chips */}
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

          {/* Chapter Range */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 mr-1 font-medium">ช่วงตอน:</span>
            <button
              onClick={() => setChapterRange("all")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                chapterRange === "all"
                  ? "bg-amber-600/30 text-amber-300 border-amber-500/50 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              ทั้งหมด (≤ 30 ตอน)
            </button>
            <button
              onClick={() => setChapterRange("1-5")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                chapterRange === "1-5"
                  ? "bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              🌱 1 - 5 ตอน
            </button>
            <button
              onClick={() => setChapterRange("6-15")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                chapterRange === "6-15"
                  ? "bg-cyan-600/30 text-cyan-300 border-cyan-500/50 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              ⚡ 6 - 15 ตอน
            </button>
            <button
              onClick={() => setChapterRange("16-30")}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                chapterRange === "16-30"
                  ? "bg-indigo-600/30 text-indigo-300 border-indigo-500/50 font-semibold"
                  : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              🔥 16 - 30 ตอน
            </button>
          </div>
        </div>

        {/* Row 3: Genre Chips */}
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
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          พบมังงะไอเดียใหม่ที่ตรงกับเงื่อนไข:{" "}
          <strong className="text-amber-400 font-mono text-sm">{filteredItems.length}</strong> เรื่อง
        </span>
        <span>แสดงผลมังงะที่มีไม่เกิน 30 ตอนเท่านั้น</span>
      </div>

      {/* Main View: Grid Mode */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.length === 0 ? (
            <div className="col-span-full py-16 text-center text-slate-500">
              <Compass className="h-8 w-8 mx-auto mb-2 text-slate-600 opacity-60" />
              <p>ไม่พบมังงะที่ตรงกับเงื่อนไขการค้นหา</p>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isExpanded = expandedSummaries[item.id] || false
              const hasLongSummary = item.summary && item.summary.length > 140

              return (
                <Card
                  key={item.id || idx}
                  className="overflow-hidden border-slate-800 bg-[#0f172a]/80 hover:border-amber-500/40 hover:bg-[#121b2f] transition-all flex flex-col justify-between group"
                >
                  <div className="p-4 flex gap-4">
                    {/* Cover Image */}
                    <div className="relative w-24 h-32 sm:w-28 sm:h-36 shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                      {item.cover ? (
                        <img
                          src={item.cover}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <BookOpen className="h-6 w-6" />
                        </div>
                      )}

                      {/* Score Badge */}
                      {item.score && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[10px] font-mono text-amber-400 flex items-center gap-0.5 font-bold">
                          <Star className="h-2.5 w-2.5 fill-amber-400" />
                          {item.score}
                        </span>
                      )}

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
                        <span className="text-[10px] text-slate-500">
                          (เหลือที่ให้แปลตามอีกเยอะ)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Synopsis / Summary */}
                  {item.summary && (
                    <div className="px-4 pb-3 pt-1 border-t border-slate-800/60 text-[11px] text-slate-300/80 leading-relaxed">
                      <p className={isExpanded ? "" : "line-clamp-2"}>
                        {item.summary}
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
                        className="inline-flex items-center h-7 px-2 text-[11px] text-amber-400 hover:text-amber-300 transition-colors font-medium rounded-md hover:bg-amber-500/10"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        เปิด Mgeko
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
                  <TableHead className="text-center min-w-[70px]">คะแนน</TableHead>
                  <TableHead className="min-w-[180px]">หมวดหมู่</TableHead>
                  <TableHead className="text-center min-w-[120px]">อัปเดตเมื่อ</TableHead>
                  <TableHead className="text-right min-w-[140px]">การจัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                      ไม่พบมังงะที่ตรงกับเงื่อนไข
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item, idx) => (
                    <TableRow
                      key={item.id || idx}
                      className="border-slate-800/60 hover:bg-[#151d2f]/50 transition-colors"
                    >
                      <TableCell className="text-center font-mono font-medium text-xs text-slate-400">
                        #{idx + 1}
                      </TableCell>

                      <TableCell className="text-center">
                        <div className="w-10 h-14 rounded overflow-hidden bg-slate-900 border border-slate-800 mx-auto">
                          {item.cover ? (
                            <img src={item.cover} alt={item.title} className="w-full h-full object-cover" />
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
                          {item.summary && (
                            <span className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                              {item.summary}
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
                        {item.score ? `⭐ ${item.score}` : "-"}
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
                            className="inline-flex items-center justify-center h-7 w-7 text-amber-400 hover:text-amber-300"
                            title="เปิดอ่านบน Mgeko"
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
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}

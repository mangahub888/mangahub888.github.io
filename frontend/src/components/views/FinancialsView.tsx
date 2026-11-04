import * as React from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js"
import { Line, Doughnut, Bar } from "react-chartjs-2"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { THAI_SHORT_MONTHS, getChapterCount } from "@/lib/utils"
import initialGrowthData from "@/data/multi_platform_growth_latest.json"
import initialGroupedData from "@/data/grouped_matched_comics.json"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Plus,
  Upload,
  Trash2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Trophy,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  BookOpen,
  Layers,
  Sparkles,
} from "lucide-react"

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const DEFAULT_WEBSITES = [
  "ReadRealm แปลจนเมื่อย",
  "ReadRealm น้องแมวส้ม",
  "ReadRealm แปลแล้วแปลอีก",
  "ReadRealm แปลจนแขนหัก",
  "kairew",
  "chaply",
]

interface FinancialsViewProps {
  mangaList: any[]
  salesList: any[]
  websiteList: string[]
  onSalesChange: (newSales: any[], newWebsites?: string[]) => void
}

export function FinancialsView({
  mangaList,
  salesList,
  websiteList,
  onSalesChange,
}: FinancialsViewProps) {
  const now = new Date()

  // Top Tab Switcher
  const [activeTab, setActiveTab] = React.useState<"growth" | "grouped" | "pnl">("growth")

  // --- Cross-Platform Grouped Titles State (ReadRealm + Kairew + Chaply) ---
  const [groupedList, setGroupedList] = React.useState<any[]>(initialGroupedData)
  const [groupedSearch, setGroupedSearch] = React.useState<string>("")
  const [groupedPlatFilter, setGroupedPlatFilter] = React.useState<"all" | "3" | "2">("all")
  const [groupedSortBy, setGroupedSortBy] = React.useState<"sales" | "views" | "eps">("sales")

  const filteredGroupedComics = React.useMemo(() => {
    let list = [...groupedList]
    if (groupedPlatFilter === "3") {
      list = list.filter((g) => g.platform_count === 3)
    } else if (groupedPlatFilter === "2") {
      list = list.filter((g) => g.platform_count === 2)
    }
    if (groupedSearch.trim()) {
      const q = groupedSearch.trim().toLowerCase()
      list = list.filter((g) => g.title.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      if (groupedSortBy === "sales") return (b.total_sales || 0) - (a.total_sales || 0)
      if (groupedSortBy === "views") return (b.total_views || 0) - (a.total_views || 0)
      if (groupedSortBy === "eps") return (b.max_eps || 0) - (a.max_eps || 0)
      return 0
    })
    return list
  }, [groupedList, groupedPlatFilter, groupedSearch, groupedSortBy])

  const groupedTotals = React.useMemo(() => {
    const s = groupedList.reduce((acc, g) => acc + (g.total_sales || 0), 0)
    const v = groupedList.reduce((acc, g) => acc + (g.total_views || 0), 0)
    const p3 = groupedList.filter((g) => g.platform_count === 3).length
    const p2 = groupedList.filter((g) => g.platform_count === 2).length
    return { sales: s, views: v, p3, p2, total: groupedList.length }
  }, [groupedList])

  // --- Multi-Platform Growth Tracker State (ReadRealm + Kairew + Chaply) ---
  const [trackerData, setTrackerData] = React.useState<any>(initialGrowthData)
  const [loadingGrowth, setLoadingGrowth] = React.useState<boolean>(false)
  const [triggeringAction, setTriggeringAction] = React.useState<boolean>(false)
  const [platformFilter, setPlatformFilter] = React.useState<"all" | "readrealm" | "kairew" | "chaply">("all")
  const [accountFilter, setAccountFilter] = React.useState<string>("all")
  const [statusFilter, setStatusFilter] = React.useState<"all" | "inactive30" | "active30" | "inactive90">("all")
  const [searchQuery, setSearchQuery] = React.useState<string>("")
  const [sortBy, setSortBy] = React.useState<"sales" | "views" | "inactive_desc" | "inactive_asc" | "growth7d" | "growth30d">("sales")

  // Load latest Multi-Platform 6h growth data
  const loadGrowthData = React.useCallback(async () => {
    setLoadingGrowth(true)
    try {
      // 1. Live raw GitHub content (freshest from 6h action runs)
      try {
        const liveRes = await fetch(
          `https://raw.githubusercontent.com/mangahub888/mangahub888.github.io/main/tools/data/multi_platform_growth_latest.json?_t=${Date.now()}`
        )
        if (liveRes.ok) {
          const json = await liveRes.json()
          if (json && json.comics && json.comics.length > 0) {
            setTrackerData(json)
            setLoadingGrowth(false)
            return
          }
        }
      } catch {}

      // 2. Local build public json
      const res = await fetch(`./data/multi_platform_growth_latest.json?_t=${Date.now()}`, { cache: "no-store" })
      if (res.ok) {
        const json = await res.json()
        if (json && json.comics && json.comics.length > 0) {
          setTrackerData(json)
          setLoadingGrowth(false)
          return
        }
      }
    } catch (e) {
      console.warn("Could not load local growth json", e)
    }

    try {
      const gasData = await callGasApi("GET_READREALM_GROWTH_DATA")
      if (gasData && gasData.comics && gasData.comics.length > 0) {
        setTrackerData(gasData)
      }
    } catch (e) {
      console.warn("Could not load GAS growth data", e)
    } finally {
      setLoadingGrowth(false)
    }
  }, [])

  React.useEffect(() => {
    loadGrowthData()
  }, [loadGrowthData])

  const handleTriggerPipeline = async () => {
    setTriggeringAction(true)
    try {
      await callGasApi("TRIGGER_READREALM_TRACKER", { source: "frontend_ui" })
      toast.success("🚀 สั่งรัน GitHub Action (Multi-Platform 6H Tracker Pipeline) เรียบร้อยแล้ว!")
      setTimeout(() => {
        loadGrowthData()
      }, 5000)
    } catch (e: any) {
      toast.error(e.message || "ไม่สามารถสั่งรัน Action ได้")
    } finally {
      setTriggeringAction(false)
    }
  }

  // Dynamic KPI Aggregations based on platform filter
  const kpiStats = React.useMemo(() => {
    if (!trackerData) {
      return {
        sales: 0,
        views: 0,
        comics: 0,
        inactive30: 0,
        active30: 0,
        breakdown: {} as any
      }
    }
    const breakdown = trackerData.platforms_breakdown || {}
    if (platformFilter === "all") {
      return {
        sales: trackerData.total_sales_portfolio || 0,
        views: trackerData.total_views_portfolio || 0,
        comics: trackerData.total_comics || (trackerData.comics || []).length,
        inactive30: trackerData.total_inactive_30d || 0,
        active30: trackerData.total_active_30d || 0,
        breakdown
      }
    }
    const pData = breakdown[platformFilter]
    if (pData) {
      return {
        sales: pData.sales || 0,
        views: pData.views || 0,
        comics: pData.comics_count || 0,
        inactive30: pData.inactive_30d || 0,
        active30: pData.active_30d || 0,
        breakdown
      }
    }
    const pComics = (trackerData.comics || []).filter((c: any) => c.platform === platformFilter)
    const inact = pComics.filter((c: any) => (c.days_inactive != null ? c.days_inactive : 0) > 30).length
    return {
      sales: pComics.reduce((sum: number, c: any) => sum + (c.total_sales || 0), 0),
      views: pComics.reduce((sum: number, c: any) => sum + (c.total_views || 0), 0),
      comics: pComics.length,
      inactive30: inact,
      active30: pComics.length - inact,
      breakdown
    }
  }, [trackerData, platformFilter])

  // Filtered & Sorted Comics for Growth Table (with Platform & Inactivity Filters)
  const filteredComics = React.useMemo(() => {
    if (!trackerData || !Array.isArray(trackerData.comics)) return []
    let list = [...trackerData.comics]

    // Platform Filter
    if (platformFilter !== "all") {
      list = list.filter((c) => c.platform === platformFilter)
    }

    // Account Filter
    if (accountFilter !== "all") {
      list = list.filter((c) => c.account_id === accountFilter || c.account === accountFilter)
    }

    // Filter by inactivity (no new chapter > 30 days, <= 30 days, or > 90 days)
    if (statusFilter === "inactive30") {
      list = list.filter((c) => (c.days_inactive != null ? c.days_inactive : 0) > 30)
    } else if (statusFilter === "active30") {
      list = list.filter((c) => (c.days_inactive != null ? c.days_inactive : 0) <= 30)
    } else if (statusFilter === "inactive90") {
      list = list.filter((c) => (c.days_inactive != null ? c.days_inactive : 0) > 90)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (c) =>
          (c.subject && c.subject.toLowerCase().includes(q)) ||
          (c.comic_id && String(c.comic_id).toLowerCase().includes(q))
      )
    }

    list.sort((a, b) => {
      if (sortBy === "sales") return (b.total_sales || 0) - (a.total_sales || 0)
      if (sortBy === "views") return (b.total_views || 0) - (a.total_views || 0)
      if (sortBy === "inactive_desc") {
        return (b.days_inactive != null ? b.days_inactive : 0) - (a.days_inactive != null ? a.days_inactive : 0)
      }
      if (sortBy === "inactive_asc") {
        return (a.days_inactive != null ? a.days_inactive : 0) - (b.days_inactive != null ? b.days_inactive : 0)
      }
      if (sortBy === "growth7d") {
        const gA = a.growth_7d?.sales_growth_pct || 0
        const gB = b.growth_7d?.sales_growth_pct || 0
        return gB - gA
      }
      if (sortBy === "growth30d") {
        const gA = a.growth_30d?.sales_growth_pct || 0
        const gB = b.growth_30d?.sales_growth_pct || 0
        return gB - gA
      }
      return 0
    })

    return list
  }, [trackerData, platformFilter, accountFilter, statusFilter, searchQuery, sortBy])

  // --- Traditional P&L Manual Ledger State ---
  // Month filter removed completely to focus on current totals and historical % growth
  const [yearFilter, setYearFilter] = React.useState("all")

  // Add Sale Modal
  const [addOpen, setAddOpen] = React.useState(false)
  const [finDate, setFinDate] = React.useState(
    now.toISOString().split("T")[0]
  )
  const [finMangaId, setFinMangaId] = React.useState("")
  const [finWebsite, setFinWebsite] = React.useState("")
  const [finChapters, setFinChapters] = React.useState("0")
  const [finCostPerChapter, setFinCostPerChapter] = React.useState<string | number>(0)
  const [finRevenue, setFinRevenue] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  // Bulk Import Modal
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [bulkText, setBulkText] = React.useState("")
  const [bulkImporting, setBulkImporting] = React.useState(false)

  const combinedWebsites = React.useMemo(() => {
    const list = [...DEFAULT_WEBSITES]
    ;(websiteList || []).forEach((w) => {
      const isPlaceholder =
        w === "Other" || w === "ช่องทาง Readrealm" || w === "Readrealm"
      if (w && !list.includes(w) && !isPlaceholder) {
        list.push(w)
      }
    })
    return list
  }, [websiteList])

  const filteredSales = React.useMemo(() => {
    let list = [...(salesList || [])]
    if (yearFilter !== "all") {
      list = list.filter((s) => {
        if (!s.date) return false
        const d = new Date(s.date)
        if (isNaN(d.getTime())) return false
        return String(d.getFullYear()) === yearFilter
      })
    }
    list.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    return list
  }, [salesList, yearFilter])

  const summary = React.useMemo(() => {
    let totalRev = 0
    let totalCost = 0
    const profitMap: Record<string, number> = {}

    filteredSales.forEach((s) => {
      const rev = parseFloat(s.revenue) || 0
      const cost = parseFloat(s.totalcost) || 0
      const profit = rev - cost
      totalRev += rev
      totalCost += cost

      const name = s.seriesname || "Unknown"
      profitMap[name] = (profitMap[name] || 0) + profit
    })

    const sortedRank = Object.keys(profitMap).map((name) => ({
      name,
      profit: profitMap[name],
    }))

    const topProfits = sortedRank
      .filter((p) => p.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5)
    const topLosses = sortedRank
      .filter((p) => p.profit < 0)
      .sort((a, b) => a.profit - b.profit)
      .slice(0, 5)

    return {
      totalRev,
      totalCost,
      totalProfit: totalRev - totalCost,
      topProfits,
      topLosses,
    }
  }, [filteredSales])

  const chartsData = React.useMemo(() => {
    const websiteRevenue: Record<string, number> = {}
    const monthlyWebsiteRevenue: Record<string, Record<string, number>> = {}
    const websitesSet = new Set<string>()
    const allMonthsSet = new Set<string>()

    filteredSales.forEach((s) => {
      const web = s.website || "Other"
      const rev = parseFloat(s.revenue) || 0
      const cost = parseFloat(s.totalcost) || 0
      const net = rev - cost

      let y = now.getFullYear()
      let m = now.getMonth() + 1
      if (s.month && typeof s.month === "string") {
        const parts = s.month.split("-")
        if (parts.length >= 2) {
          y = parseInt(parts[0])
          m = parseInt(parts[1])
        }
      } else if (s.date) {
        const parts = String(s.date).split("-")
        if (parts.length >= 2) {
          y = parseInt(parts[0])
          m = parseInt(parts[1])
        }
      }
      const monthKey = `${y}-${String(m).padStart(2, "0")}`

      websiteRevenue[web] = (websiteRevenue[web] || 0) + rev
      if (!monthlyWebsiteRevenue[monthKey]) monthlyWebsiteRevenue[monthKey] = {}
      monthlyWebsiteRevenue[monthKey][web] =
        (monthlyWebsiteRevenue[monthKey][web] || 0) + net

      websitesSet.add(web)
      allMonthsSet.add(monthKey)
    })

    const websites = Array.from(websitesSet).sort()
    const months = Array.from(allMonthsSet).sort()
    const palette = [
      "#6366f1",
      "#10b981",
      "#ec4899",
      "#eab308",
      "#3b82f6",
      "#a855f7",
      "#f97316",
      "#06b6d4",
    ]

    const lineLabels = months.map((mKey) => {
      const [y, mo] = mKey.split("-")
      return `${THAI_SHORT_MONTHS[parseInt(mo) - 1] || mo} ${
        parseInt(y) + 543
      }`
    })

    return {
      barData: {
        labels: websites,
        datasets: [
          {
            label: "รายรับรวม (฿)",
            data: websites.map((w) => websiteRevenue[w] || 0),
            backgroundColor: websites.map(
              (_, i) => palette[i % palette.length]
            ),
            borderRadius: 6,
          },
        ],
      },
      pieData: {
        labels: websites,
        datasets: [
          {
            data: websites.map((w) => websiteRevenue[w] || 0),
            backgroundColor: websites.map(
              (_, i) => palette[i % palette.length]
            ),
            borderWidth: 2,
            borderColor: "#151d2f",
          },
        ],
      },
      lineData: {
        labels: lineLabels,
        datasets: websites.map((w, i) => ({
          label: w,
          data: months.map((mKey) => monthlyWebsiteRevenue[mKey]?.[w] || 0),
          borderColor: palette[i % palette.length],
          backgroundColor: palette[i % palette.length] + "33",
          tension: 0.35,
          fill: true,
        })),
      },
    }
  }, [filteredSales])

  const autoFillFinDetails = async (mId: string, dStr: string) => {
    if (!mId || !dStr) return
    const manga = (mangaList || []).find(
      (m) => m.mangaid != null && String(m.mangaid) === String(mId)
    )
    if (manga) {
      setFinCostPerChapter(manga.costperchapter || 0)
    }

    try {
      const d = new Date(dStr)
      const count = await callGasApi<number>("COUNT_FINISHED_CHAPTERS", {
        mangaId: mId,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      })
      setFinChapters(String(count || 0))
    } catch {
      // Ignore error
    }
  }

  const handleSaveSale = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!finMangaId || !finWebsite || !finRevenue) {
      toast.error("กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน")
      return
    }

    setSubmitting(true)
    try {
      const manga = (mangaList || []).find(
        (m) => String(m.mangaid) === String(finMangaId)
      )
      const payload = {
        date: finDate,
        seriesname: manga ? manga.manganame : "",
        serieschapterid: finMangaId,
        website: finWebsite,
        chapterscount: parseFloat(finChapters) || 0,
        costperchapter: parseFloat(String(finCostPerChapter)) || 0,
        revenue: parseFloat(finRevenue) || 0,
      }

      const res = await callGasApi("ADD_MANGA_SALE", payload)
      toast.success("บันทึกยอดขายเรียบร้อย")
      onSalesChange(res.list || [], res.websites)
      setAddOpen(false)
      setFinRevenue("")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึก")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteSale = async (index: number, sale: any) => {
    if (!window.confirm("ยืนยันการลบรายการนี้?")) return
    try {
      const res = await callGasApi("DELETE_MANGA_SALE", { index, sale })
      toast.success("ลบรายการสำเร็จ")
      onSalesChange(res.list || [], res.websites)
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการลบ")
    }
  }

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return
    const lines = bulkText.trim().split("\n")
    const sales: any[] = []

    const cleanNum = (str: string) => {
      if (!str) return 0
      const cleaned = str.replace(/[฿,]/g, "").trim()
      return parseFloat(cleaned) || 0
    }

    lines.forEach((line) => {
      if (!line.trim()) return
      const cols = line.includes("\t") ? line.split("\t") : line.split(",")
      if (cols.length < 5) return
      if (cols[0].includes("วันที่") || cols[3]?.includes("เรื่อง")) return

      const dateStr = cols[0].trim()
      let day = "30",
        monthStr = "01",
        year = 2025
      const dateParts = dateStr.split("/")
      if (dateParts.length === 3) {
        day = dateParts[0].padStart(2, "0")
        monthStr = dateParts[1].padStart(2, "0")
        const yr = parseInt(dateParts[2])
        if (yr > 2500) year = yr - 543
        else if (yr === 68 || yr === 25 || yr === 1968) year = 2025
        else if (yr < 100) year = 2000 + yr
        else year = yr
      } else {
        const mParts = cols[1].split("-")
        if (mParts.length >= 2) {
          year = parseInt(mParts[0])
          if (year === 1968) year = 2025
          monthStr = mParts[1]
        }
      }
      const normalizedDate = `${year}-${monthStr.padStart(
        2,
        "0"
      )}-${day.padStart(2, "0")}`
      const monthlyTarget = cleanNum(cols[9])
      const chapters = cleanNum(cols[5])

      sales.push({
        date: normalizedDate,
        month: cols[1].trim(),
        serieschapterid: cols[2].trim(),
        seriesname: cols[3].trim(),
        chapterscount: chapters,
        category: cols[6].trim(),
        website:
          cols[7] === "websiteA.co"
            ? "ช่องทาง Readrealm"
            : cols[7] || "ช่องทาง Readrealm",
        page: (cols[8] || "Page").trim(),
        targetperchapter:
          chapters > 0 ? monthlyTarget / chapters : monthlyTarget,
        totaltarget: monthlyTarget,
        costperchapter: cleanNum(cols[11]),
        totalcost: cleanNum(cols[12]),
        revenue: monthlyTarget,
      })
    })

    if (sales.length === 0) {
      toast.error("ไม่พบข้อมูลที่ถูกต้อง กรุณาใช้ข้อมูลแบบคั่นด้วย Tab หรือ CSV")
      return
    }

    if (
      !window.confirm(
        `ตรวจพบข้อมูล ${sales.length} รายการ ต้องการนำเข้าหรือไม่?`
      )
    )
      return

    setBulkImporting(true)
    try {
      const res = await callGasApi("BULK_ADD_MANGA_SALES", { sales })
      toast.success(`นำเข้าข้อมูล ${res.count} รายการเรียบร้อย`)
      onSalesChange(res.list || [], res.websites)
      setBulkText("")
      setBulkOpen(false)
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการนำเข้าข้อมูล")
    } finally {
      setBulkImporting(false)
    }
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="space-y-6">
      {/* Top Header & Tab Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              รายงานกำไร-ขาดทุน และสถิติยอดขาย
            </h2>
            <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-xs font-mono">
              236 Series
            </Badge>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            ติดตามยอดขาย ยอดวิว และอัตราการเติบโต 7 วัน / 30 วัน ของ ReadRealm อัตโนมัติทุก 6 ชม.
          </p>
        </div>

        {/* Tab Pill Buttons */}
        <div className="flex items-center bg-[#0b1120] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("growth")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "growth"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            สถิติยอดขาย & อัตราเติบโต Multi-Platform
          </button>
          <button
            onClick={() => setActiveTab("grouped")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "grouped"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            รวมเรื่องเดียวกันข้ามแพลตฟอร์ม ({groupedTotals.total} เรื่อง)
          </button>
          <button
            onClick={() => setActiveTab("pnl")}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "pnl"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <DollarSign className="h-3.5 w-3.5 text-amber-400" />
            สมุดบันทึกต้นทุน & P&L เดิม
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: READREALM GROWTH & SALES TRACKER (6-HOUR AUTO PIPELINE) */}
      {/* ========================================================================= */}
      {activeTab === "growth" && (
        <div className="space-y-6">
          {/* Top Banner: Status & Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-[#0f172a] to-[#0b1120]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 border border-indigo-500/30">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    Multi-Platform 6-Hour Growth Pipeline (ReadRealm • Kairew • Chaply)
                  </span>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    GAS Trigger Active (ทุก 6 ชม. ตรงเวลา ไม่โดนแย่งคิว)
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  รอบบันทึกล่าสุด:{" "}
                  <span className="text-slate-200 font-mono">
                    {trackerData?.pipeline_recorded_at
                      ? new Date(trackerData.pipeline_recorded_at).toLocaleString("th-TH")
                      : "4 พ.ย. 2569 (บันทึกอัตโนมัติ)"}
                  </span>{" "}
                  • วันที่อ้างอิง:{" "}
                  <span className="text-indigo-300 font-semibold">
                    {trackerData?.date_reference || "ตามรอบที่จดเอง"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadGrowthData}
                disabled={loadingGrowth}
                className="h-8 text-xs border-slate-700 bg-[#0b1120]"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingGrowth ? "animate-spin" : ""}`} />
                โหลดข้อมูลใหม่
              </Button>
              <Button
                size="sm"
                onClick={handleTriggerPipeline}
                disabled={triggeringAction}
                className="h-8 text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <TrendingUp className={`h-3.5 w-3.5 mr-1.5 ${triggeringAction ? "animate-bounce" : ""}`} />
                {triggeringAction ? "กำลังสั่งรัน..." : "สั่งรัน Git Action อัปเดต"}
              </Button>
            </div>
          </div>

          {/* 4 KPI Cards (Dynamic according to Platform selection) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    💰 ยอดขายสะสม{platformFilter === "all" ? " (รวมทุกแพลตฟอร์ม)" : ` (${platformFilter.toUpperCase()})`}
                  </p>
                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    ฿{kpiStats.sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {platformFilter === "all" ? (
                      <>ReadRealm ฿5.77M • Kairew ฿142.8K • Chaply ฿8.66K</>
                    ) : platformFilter === "readrealm" ? (
                      <>แปลจนเมื่อย ฿4.40M • แปลแล้วแปลอีก ฿1.36M</>
                    ) : platformFilter === "kairew" ? (
                      <>นักเขียน แปลจนเมื่อย • 79 เรื่อง</>
                    ) : (
                      <>ครีเอเตอร์ แปลจนเมื่อย • 67 เรื่อง</>
                    )}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    👁️ ยอดคนอ่านสะสม{platformFilter === "all" ? " (รวมทุกแพลตฟอร์ม)" : ` (${platformFilter.toUpperCase()})`}
                  </p>
                  <p className="text-xl font-bold font-mono text-cyan-400 mt-1">
                    {kpiStats.views.toLocaleString()}{" "}
                    <span className="text-xs font-normal text-slate-400">ครั้ง</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {platformFilter === "all" ? (
                      <>ReadRealm 20.6M • Kairew 2.51M • Chaply 91.0K</>
                    ) : platformFilter === "readrealm" ? (
                      <>แปลจนเมื่อย 17.0M • แปลแล้ว 3.6M</>
                    ) : platformFilter === "kairew" ? (
                      <>เฉลี่ย 31,859 วิว/เรื่อง</>
                    ) : (
                      <>เฉลี่ย 1,359 วิว/เรื่อง</>
                    )}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                  <BookOpen className="h-5 w-5" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">📚 มังงะที่ติดตาม</p>
                  <p className="text-xl font-bold font-mono text-indigo-400 mt-1">
                    {kpiStats.comics}{" "}
                    <span className="text-xs font-normal text-slate-400">เรื่อง</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    มีตอนใหม่ 30d: <span className="text-emerald-400 font-medium">{kpiStats.active30}</span> • ขาดอัปเดต: <span className="text-amber-400 font-medium">{kpiStats.inactive30}</span>
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
                  <p className="text-xs text-slate-400">⏱️ เกณฑ์อัตราการเติบโต</p>
                  <p className="text-sm font-semibold text-amber-300 mt-1">
                    7 วัน &amp; 30 วันย้อนหลัง
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    คำนวณตามรอบวันที่จดเอง (Git JSON Timeline)
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
            </Card>
          </div>

          {/* Controls: Platform Switcher, Account Filter, Inactivity Filter, Search, Sort */}
          <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-slate-800 bg-[#0b1120]/80">
            {/* 1. Platform Switcher Row */}
            <div className="flex items-center gap-1.5 flex-wrap pb-3 border-b border-slate-800/60">
              <span className="text-xs text-slate-300 mr-1.5 font-semibold flex items-center gap-1">
                <span>🌐 แพลตฟอร์ม:</span>
              </span>
              <button
                onClick={() => { setPlatformFilter("all"); setAccountFilter("all"); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "all"
                    ? "bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-500/30"
                    : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                🌟 รวมทุกแพลตฟอร์ม ({trackerData?.total_comics || 382})
              </button>
              <button
                onClick={() => { setPlatformFilter("readrealm"); setAccountFilter("all"); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "readrealm"
                    ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                    : "bg-[#0f172a] text-blue-400 border-slate-800 hover:text-blue-300"
                }`}
              >
                📘 ReadRealm (236)
              </button>
              <button
                onClick={() => { setPlatformFilter("kairew"); setAccountFilter("all"); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "kairew"
                    ? "bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/30"
                    : "bg-[#0f172a] text-emerald-400 border-slate-800 hover:text-emerald-300"
                }`}
              >
                📗 Kairew (79)
              </button>
              <button
                onClick={() => { setPlatformFilter("chaply"); setAccountFilter("all"); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "chaply"
                    ? "bg-amber-600 text-white border-amber-500 shadow-sm shadow-amber-500/30"
                    : "bg-[#0f172a] text-amber-400 border-slate-800 hover:text-amber-300"
                }`}
              >
                📙 Chaply (67)
              </button>
            </div>

            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              {/* Account Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 mr-1 font-medium">บัญชี:</span>
                <button
                  onClick={() => setAccountFilter("all")}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                    accountFilter === "all"
                      ? "bg-slate-700 text-white border-slate-600"
                      : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  ทั้งหมด ({kpiStats.comics})
                </button>
                {(platformFilter === "all" || platformFilter === "readrealm" || platformFilter === "kairew" || platformFilter === "chaply") && (
                  <button
                    onClick={() => setAccountFilter("แปลจนเมื่อย")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                      accountFilter === "แปลจนเมื่อย" || accountFilter === "lionking"
                        ? "bg-indigo-600/30 text-indigo-300 border-indigo-500/50"
                        : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    แปลจนเมื่อย
                  </button>
                )}
                {(platformFilter === "all" || platformFilter === "readrealm") && (
                  <button
                    onClick={() => setAccountFilter("แปลแล้วแปลอีก")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                      accountFilter === "แปลแล้วแปลอีก" || accountFilter === "adieu"
                        ? "bg-purple-600/30 text-purple-300 border-purple-500/50"
                        : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    แปลแล้วแปลอีก
                  </button>
                )}
              </div>

              {/* Search & Sort */}
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="ค้นหาชื่อเรื่องมังงะ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs bg-[#0f172a] border-slate-800"
                  />
                </div>

                <select
                  className="h-8 rounded-lg border border-slate-800 bg-[#0f172a] px-2.5 text-xs text-slate-200"
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                >
                  <option value="sales">ยอดขายสูงสุด</option>
                  <option value="views">ยอดวิวสูงสุด</option>
                  <option value="inactive_desc">ขาดตอนใหม่นานสุด (&gt; 30d)</option>
                  <option value="inactive_asc">อัปเดตตอนใหม่ล่าสุด</option>
                  <option value="growth7d">อัตราโต 7 วัน</option>
                  <option value="growth30d">อัตราโต 30 วัน</option>
                </select>
              </div>
            </div>

            {/* Inactivity Filter Pills (ตัวกรองเรื่องที่ไม่มีตอนใหม่มานาน > 30 วัน) */}
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-800/60">
              <span className="text-[11px] text-slate-400 mr-1 font-medium">ตอนใหม่ล่าสุด:</span>
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "all"
                    ? "bg-slate-700 text-white border-slate-600"
                    : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                ทุกสถานะ ({kpiStats.comics})
              </button>
              <button
                onClick={() => setStatusFilter("inactive30")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "inactive30"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm shadow-amber-500/10 font-semibold"
                    : "bg-[#0f172a] text-amber-400/80 border-slate-800 hover:text-amber-300"
                }`}
              >
                <span>⚠️ ไม่มีตอนใหม่ &gt; 30 วัน</span>
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-[10px] font-mono">
                  {kpiStats.inactive30}
                </span>
              </button>
              <button
                onClick={() => setStatusFilter("active30")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "active30"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm shadow-emerald-500/10 font-semibold"
                    : "bg-[#0f172a] text-emerald-400/80 border-slate-800 hover:text-emerald-300"
                }`}
              >
                <span>⚡ มีตอนใหม่ใน 30 วัน</span>
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-[10px] font-mono">
                  {kpiStats.active30}
                </span>
              </button>
              <button
                onClick={() => setStatusFilter("inactive90")}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "inactive90"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/60 font-semibold"
                    : "bg-[#0f172a] text-rose-400/80 border-slate-800 hover:text-rose-300"
                }`}
              >
                🛑 ขาดอัปเดต &gt; 90 วัน
              </button>
            </div>
          </div>

          {/* Comics Performance Table */}
          <Card className="border-slate-800 bg-[#0f172a]/70 overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-white">
                  ตารางอันดับยอดขาย ยอดวิว และอัตราการเติบโต ({filteredComics.length} เรื่อง)
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  วันที่อ้างอิงตามรอบที่จดเอง ไม่ใช่วันที่บนเว็บ • เรียงตามยอดขายสะสม
                </p>
              </div>
            </CardHeader>
            <div className="overflow-x-auto max-h-[580px]">
              <Table>
                <TableHeader className="bg-[#0b1120] sticky top-0 z-10">
                  <TableRow className="border-slate-800">
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead className="text-center min-w-[95px]">แพลตฟอร์ม</TableHead>
                    <TableHead className="min-w-[220px]">ชื่อเรื่องมังงะ</TableHead>
                    <TableHead className="text-center">บัญชี</TableHead>
                    <TableHead className="text-right">ยอดขายรวม</TableHead>
                    <TableHead className="text-right">ยอดวิวรวม</TableHead>
                    <TableHead className="text-center">ตอน</TableHead>
                    <TableHead className="text-center min-w-[125px]">อัปเดตตอนล่าสุด</TableHead>
                    <TableHead className="text-right min-w-[130px]">
                      อัตราเติบโต 7 วัน
                    </TableHead>
                    <TableHead className="text-right min-w-[130px]">
                      อัตราเติบโต 30 วัน
                    </TableHead>
                    <TableHead className="text-center min-w-[110px]">
                      วันที่บันทึก
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComics.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-12 text-slate-500">
                        {loadingGrowth ? (
                          <div className="flex flex-col items-center gap-2">
                            <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
                            <span>กำลังโหลดข้อมูลสถิติ ReadRealm...</span>
                          </div>
                        ) : (
                          "ไม่พบข้อมูลมังงะที่ตรงกับเงื่อนไข"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredComics.map((c, idx) => {
                      const isTop3 = idx < 3
                      const rankBadge =
                        idx === 0
                          ? "🥇"
                          : idx === 1
                          ? "🥈"
                          : idx === 2
                          ? "🥉"
                          : `#${idx + 1}`

                      const g7Pct = c.growth_7d?.sales_growth_pct || 0
                      const g7Delta = c.growth_7d?.sales_delta || 0
                      const g30Pct = c.growth_30d?.sales_growth_pct || 0
                      const g30Delta = c.growth_30d?.sales_delta || 0

                      return (
                        <TableRow
                          key={c.comic_id || idx}
                          className="border-slate-800/60 hover:bg-[#151d2f]/50 transition-colors"
                        >
                          <TableCell className="text-center font-mono font-medium text-xs">
                            {isTop3 ? (
                              <span className="text-base">{rankBadge}</span>
                            ) : (
                              <span className="text-slate-400">{rankBadge}</span>
                            )}
                          </TableCell>

                          {/* Platform Badge */}
                          <TableCell className="text-center">
                            <Badge
                              className={`text-[10px] font-semibold border ${
                                c.platform === "kairew"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : c.platform === "chaply"
                                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                                  : "bg-blue-500/10 text-blue-400 border-blue-500/30"
                              }`}
                            >
                              {c.platform === "kairew" ? "Kairew" : c.platform === "chaply" ? "Chaply" : "ReadRealm"}
                            </Badge>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold text-slate-100 hover:text-indigo-300 transition-colors line-clamp-1">
                                {c.subject}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                ID: {c.comic_id}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="text-center">
                            <Badge
                              className={`text-[10px] font-normal border ${
                                c.account === "แปลจนเมื่อย"
                                  ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                                  : "bg-purple-500/10 text-purple-400 border-purple-500/30"
                              }`}
                            >
                              {c.account}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right font-mono font-bold text-xs text-emerald-400">
                            ฿
                            {(c.total_sales || 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>

                          <TableCell className="text-right font-mono text-xs text-cyan-300">
                            {(c.total_views || 0).toLocaleString()}
                          </TableCell>

                          <TableCell className="text-center font-mono text-xs text-slate-300">
                            {c.chapters_count || 0}
                          </TableCell>

                          {/* Last Chapter Update / Inactivity Badge */}
                          <TableCell className="text-center">
                            {c.days_inactive != null ? (
                              <div className="flex flex-col items-center">
                                <Badge
                                  className={`text-[10px] font-mono px-2 py-0.5 border ${
                                    c.days_inactive > 90
                                      ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                      : c.days_inactive > 30
                                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30 font-medium"
                                      : c.days_inactive <= 7
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-medium"
                                      : "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
                                  }`}
                                >
                                  {c.days_inactive === 0
                                    ? "วันนี้"
                                    : c.days_inactive > 365
                                    ? `> 1 ปี (${c.days_inactive}d)`
                                    : `${c.days_inactive} วันก่อน`}
                                </Badge>
                                {c.last_chapter_updated_at && (
                                  <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                                    {c.last_chapter_updated_at.substring(0, 10)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 font-mono">-</span>
                            )}
                          </TableCell>

                          {/* 7-Day Growth */}
                          <TableCell className="text-right">
                            {trackerData?.has_7d_baseline ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`text-xs font-mono font-semibold flex items-center ${
                                    g7Pct >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {g7Pct >= 0 ? (
                                    <ArrowUpRight className="h-3 w-3 inline mr-0.5" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3 inline mr-0.5" />
                                  )}
                                  {g7Pct > 0 ? `+${g7Pct}%` : `${g7Pct}%`}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {g7Delta >= 0 ? `+฿${g7Delta}` : `฿${g7Delta}`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 font-mono">-</span>
                            )}
                          </TableCell>

                          {/* 30-Day Growth */}
                          <TableCell className="text-right">
                            {trackerData?.has_30d_baseline ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`text-xs font-mono font-semibold flex items-center ${
                                    g30Pct >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {g30Pct >= 0 ? (
                                    <ArrowUpRight className="h-3 w-3 inline mr-0.5" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3 inline mr-0.5" />
                                  )}
                                  {g30Pct > 0 ? `+${g30Pct}%` : `${g30Pct}%`}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {g30Delta >= 0 ? `+฿${g30Delta}` : `฿${g30Delta}`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 font-mono">-</span>
                            )}
                          </TableCell>

                          <TableCell className="text-center font-mono text-[11px] text-slate-400">
                            {c.recorded_at
                              ? new Date(c.recorded_at).toLocaleDateString("th-TH")
                              : trackerData?.date_reference || "-"}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CROSS-PLATFORM GROUPED TITLES (READREALM + KAIREW + CHAPLY) */}
      {/* ========================================================================= */}
      {activeTab === "grouped" && (
        <div className="space-y-6">
          {/* Header Summary Banner */}
          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 via-[#0d1527] to-[#0f172a] p-5 shadow-lg shadow-cyan-950/20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      จัดกลุ่มเรื่องเดียวกันข้ามแพลตฟอร์ม (Cross-Platform Unified Titles)
                      <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[10px]">
                        {groupedTotals.total} เรื่องที่ตรงกัน
                      </Badge>
                    </h3>
                    <p className="text-xs text-slate-400">
                      รวมยอดขายและยอดวิวเฉพาะเรื่องที่เผยแพร่ซ้ำข้ามแพลตฟอร์ม (ReadRealm, Kairew, Chaply) โดยคัดเรื่องที่ไม่ตรงกันออก
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">เรื่องที่ตรงกันทั้งหมด</span>
                <div className="text-xl font-bold text-white mt-1 flex items-baseline gap-1.5">
                  {groupedTotals.total} <span className="text-xs text-cyan-400 font-normal">เรื่อง</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  ครบ 3 เว็บ: {groupedTotals.p3} | 2 เว็บ: {groupedTotals.p2}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">ยอดขายรวมสะสม (Combined Sales)</span>
                <div className="text-xl font-bold text-emerald-400 mt-1">
                  ฿{groupedTotals.sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  ReadRealm + Kairew
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">ยอดคนอ่านรวม (Combined Views)</span>
                <div className="text-xl font-bold text-indigo-400 mt-1">
                  {groupedTotals.views.toLocaleString()} <span className="text-xs text-indigo-300 font-normal">วิว</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  จาก 3 แพลตฟอร์ม
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">ความครอบคลุม 3 แพลตฟอร์ม</span>
                <div className="text-xl font-bold text-amber-400 mt-1">
                  {((groupedTotals.p3 / groupedTotals.total) * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  64 เรื่องลงครบทั้ง RR, KW, CH
                </div>
              </div>
            </div>
          </div>

          {/* Controls: Search, Platform Filter, Sort */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0d1322] p-3 rounded-xl border border-slate-800">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  value={groupedSearch}
                  onChange={(e) => setGroupedSearch(e.target.value)}
                  placeholder="ค้นหาชื่อเรื่อง..."
                  className="pl-8 h-9 text-xs bg-[#0b101d] border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg"
                />
              </div>

              {/* Platform Filter Chips */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setGroupedPlatFilter("all")}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "all"
                      ? "bg-cyan-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  ทั้งหมด ({groupedTotals.total})
                </button>
                <button
                  onClick={() => setGroupedPlatFilter("3")}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "3"
                      ? "bg-indigo-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  ครบ 3 แพลตฟอร์ม ({groupedTotals.p3})
                </button>
                <button
                  onClick={() => setGroupedPlatFilter("2")}
                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "2"
                      ? "bg-purple-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  2 แพลตฟอร์ม ({groupedTotals.p2})
                </button>
              </div>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">เรียงตาม:</span>
              <select
                value={groupedSortBy}
                onChange={(e) => setGroupedSortBy(e.target.value as any)}
                className="h-9 px-3 text-xs bg-[#0b101d] border border-slate-700 text-slate-200 rounded-lg focus:outline-hidden focus:border-cyan-500"
              >
                <option value="sales">ยอดขายรวมสูงสุด ⭐</option>
                <option value="views">ยอดคนอ่านรวมสูงสุด 👁️</option>
                <option value="eps">จำนวนตอนสูงสุด 📖</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <Card className="border-slate-800 bg-[#0d1322] shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-[#0b101d]/90">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="w-12 text-slate-400 text-xs">#</TableHead>
                    <TableHead className="text-slate-300 text-xs font-semibold min-w-[220px]">
                      ชื่อเรื่อง (มังงะ)
                    </TableHead>
                    <TableHead className="text-slate-300 text-xs font-semibold min-w-[140px]">
                      แพลตฟอร์ม
                    </TableHead>
                    <TableHead className="text-right text-slate-300 text-xs font-semibold min-w-[160px]">
                      ยอดขายรวม (฿)
                    </TableHead>
                    <TableHead className="text-right text-slate-300 text-xs font-semibold min-w-[160px]">
                      ยอดวิวรวม (ครั้ง)
                    </TableHead>
                    <TableHead className="text-center text-slate-300 text-xs font-semibold min-w-[80px]">
                      ตอนสูงสุด
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroupedComics.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-slate-500 text-xs">
                        ไม่พบข้อมูลเรื่องที่ตรงกับเงื่อนไขการค้นหา
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredGroupedComics.map((g, idx) => (
                      <TableRow
                        key={g.key}
                        className="border-slate-800/60 hover:bg-slate-800/30 transition-colors"
                      >
                        <TableCell className="text-slate-400 text-xs font-mono">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-100 text-xs leading-snug">
                            {g.title}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {g.readrealm.exists && (
                              <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30 text-[10px] px-1.5 py-0">
                                RR
                              </Badge>
                            )}
                            {g.kairew.exists && (
                              <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30 text-[10px] px-1.5 py-0">
                                KW
                              </Badge>
                            )}
                            {g.chaply.exists && (
                              <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[10px] px-1.5 py-0">
                                CH
                              </Badge>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono ml-0.5">
                              ({g.platform_count})
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-bold text-emerald-400 text-xs font-mono">
                            ฿{g.total_sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {g.readrealm.exists && <span>RR: ฿{g.readrealm.sales.toLocaleString("en-US", { maximumFractionDigits: 0 })} </span>}
                            {g.kairew.exists && <span>| KW: ฿{g.kairew.sales.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold text-slate-200 text-xs font-mono">
                            {g.total_views.toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {g.readrealm.exists && <span>RR: {g.readrealm.views.toLocaleString()} </span>}
                            {g.kairew.exists && <span>| KW: {g.kairew.views.toLocaleString()} </span>}
                            {g.chaply.exists && <span>| CH: {g.chaply.views.toLocaleString()}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs text-slate-300">
                          {g.max_eps}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TRADITIONAL MANUAL P&L LEDGER & CHARTS */}
      {/* ========================================================================= */}
      {activeTab === "pnl" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white">
                สมุดบันทึกยอดขายประจำเดือน (MangaSales Ledger)
              </h3>
              <p className="text-xs text-slate-400">
                บันทึกยอดขายและต้นทุนรายเรื่องแบบระบุเอง
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> บันทึกยอดขายประจำเดือน
              </Button>
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <Upload className="h-4 w-4" /> นำเข้าข้อมูลจำนวนมาก
              </Button>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">รายได้รวม</p>
                <p className="text-2xl font-bold text-indigo-400 mt-1">
                  {summary.totalRev.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                <DollarSign className="h-6 w-6" />
              </div>
            </Card>

            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">ต้นทุนรวม</p>
                <p className="text-2xl font-bold text-red-400 mt-1">
                  {summary.totalCost.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
                <TrendingDown className="h-6 w-6" />
              </div>
            </Card>

            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">กำไรสุทธิ</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    summary.totalProfit >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {summary.totalProfit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <TrendingUp className="h-6 w-6" />
              </div>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">📈 แนวโน้มรายได้รายเดือน</CardTitle>
                <div className="flex gap-2">

                  <select
                    className="h-8 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs text-slate-100"
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                  >
                    <option value="all">ปี: ทั้งหมด</option>
                    {years.map((y) => (
                      <option key={y} value={String(y)}>
                        {y + 543}
                      </option>
                    ))}
                  </select>
                </div>
              </CardHeader>
              <CardContent className="h-[280px]">
                <Line
                  data={chartsData.lineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: "#cbd5e1" } } },
                    scales: {
                      x: { ticks: { color: "#94a3b8" } },
                      y: { ticks: { color: "#94a3b8" } },
                    },
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🍰 สัดส่วนรายได้</CardTitle>
              </CardHeader>
              <CardContent className="h-[280px] flex items-center justify-center">
                <Doughnut
                  data={chartsData.pieData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "65%",
                    plugins: {
                      legend: { position: "bottom", labels: { color: "#cbd5e1" } },
                    },
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Ranking & Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" /> อันดับมังงะ (กำไร / ขาดทุน)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-emerald-400">
                      🏆 5 อันดับกำไรสูงสุด
                    </p>
                    {summary.topProfits.length === 0 ? (
                      <p className="text-slate-500 text-xs">ไม่มีข้อมูลกำไร</p>
                    ) : (
                      summary.topProfits.map((item, idx) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900/50 border border-slate-800"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-bold text-slate-400">{idx + 1}.</span>
                            <span className="truncate text-slate-200">{item.name}</span>
                          </div>
                          <span className="font-semibold text-emerald-400 shrink-0">
                            +฿{item.profit.toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-red-400">
                      🔻 5 อันดับขาดทุนสูงสุด
                    </p>
                    {summary.topLosses.length === 0 ? (
                      <p className="text-slate-500 text-xs">ไม่มีรายการขาดทุน</p>
                    ) : (
                      summary.topLosses.map((item, idx) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900/50 border border-slate-800"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-bold text-slate-400">{idx + 1}.</span>
                            <span className="truncate text-slate-200">{item.name}</span>
                          </div>
                          <span className="font-semibold text-red-400 shrink-0">
                            ฿{item.profit.toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">📊 รายรับตามช่องทาง</CardTitle>
              </CardHeader>
              <CardContent className="h-[280px]">
                <Bar
                  data={chartsData.barData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { color: "#94a3b8" } },
                      y: { ticks: { color: "#94a3b8" } },
                    },
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sales Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">รายการยอดขายประจำเดือน</CardTitle>
                <p className="text-xs text-slate-400">
                  ทั้งหมด {filteredSales.length} รายการ
                </p>
              </div>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>เรื่อง</TableHead>
                    <TableHead>ช่องทาง</TableHead>
                    <TableHead className="text-right">จำนวนตอน</TableHead>
                    <TableHead className="text-right">ต้นทุน/ตอน</TableHead>
                    <TableHead className="text-right">ต้นทุนรวม</TableHead>
                    <TableHead className="text-right">ยอดขาย</TableHead>
                    <TableHead className="text-right">กำไร/ขาดทุน</TableHead>
                    <TableHead className="text-center w-16">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-slate-500">
                        ไม่พบข้อมูลในรอบที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSales.map((sale, idx) => {
                      const rev = parseFloat(sale.revenue) || 0
                      const cost = parseFloat(sale.totalcost) || 0
                      const profit = rev - cost
                      return (
                        <TableRow key={sale._rowIndex || idx}>
                          <TableCell className="text-xs text-slate-400">
                            {sale.date ? sale.date.split("T")[0] : "-"}
                          </TableCell>
                          <TableCell className="font-medium text-slate-200">
                            {sale.seriesname}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {sale.website}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{sale.chapterscount}</TableCell>
                          <TableCell className="text-right">
                            {parseFloat(sale.costperchapter || 0).toLocaleString()} ฿
                          </TableCell>
                          <TableCell className="text-right text-red-400">
                            {cost.toLocaleString()} ฿
                          </TableCell>
                          <TableCell className="text-right text-indigo-400 font-semibold">
                            {rev.toLocaleString()} ฿
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${
                              profit >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {profit > 0 ? "+" : ""}
                            {profit.toLocaleString()} ฿
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => handleDeleteSale(sale._rowIndex, sale)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* Add Sale Modal */}
      <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกยอดขายประจำเดือน</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSale} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>วันที่บันทึก *</Label>
              <Input
                type="date"
                value={finDate}
                onChange={(e) => {
                  setFinDate(e.target.value)
                  if (finMangaId) autoFillFinDetails(finMangaId, e.target.value)
                }}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>มังงะ *</Label>
              <SearchableSelect
                options={(mangaList || []).map((m) => ({
                  value: String(m.mangaid),
                  label: m.manganame,
                }))}
                value={finMangaId}
                onChange={(val) => {
                  setFinMangaId(val)
                  autoFillFinDetails(val, finDate)
                }}
                placeholder="เลือกมังงะ..."
                searchPlaceholder="ค้นหามังงะ..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>เว็บไซต์ / ช่องทาง *</Label>
              <SearchableSelect
                options={combinedWebsites.map((w) => ({ value: w, label: w }))}
                value={finWebsite}
                onChange={setFinWebsite}
                placeholder="-- เลือกช่องทาง --"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>จำนวนตอนที่ทำ (ออโต้)</Label>
                <Input
                  value={finChapters}
                  onChange={(e) => setFinChapters(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ต้นทุนต่อตอน</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={finCostPerChapter}
                  onChange={(e) => setFinCostPerChapter(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>ยอดขาย (บาท) *</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={finRevenue}
                onChange={(e) => setFinRevenue(e.target.value)}
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={submitting}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Modal */}
      <Dialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>นำเข้าข้อมูลจำนวนมาก (Bulk Import)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-slate-400">
              วางข้อมูลดิบ (Tab-separated หรือ CSV) ในช่องด้านล่าง ระบบจะคำนวณกำไรและจัดหมวดหมู่ช่องทางให้อัตโนมัติ
            </p>
            <Textarea
              rows={12}
              placeholder="ตัวอย่าง: 30/3/25	2025-03	SJP-03	เสาจักรพรรดิ...	01-06	6	แอ็กชัน...	websiteA.co	Page	1,800	10,800	300	1,800"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="font-mono text-xs"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkOpen(false)}
                disabled={bulkImporting}
              >
                ยกเลิก
              </Button>
              <Button onClick={handleBulkImport} disabled={bulkImporting}>
                {bulkImporting ? "กำลังนำเข้า..." : "เริ่มนำเข้าข้อมูล"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

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
import { THAI_MONTHS, THAI_SHORT_MONTHS, getChapterCount } from "@/lib/utils"
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
  const [monthFilter, setMonthFilter] = React.useState(
    String(now.getMonth() + 1)
  )
  const [yearFilter, setYearFilter] = React.useState("all")

  // Add Sale Modal
  const [addOpen, setAddOpen] = React.useState(false)
  const [finDate, setFinDate] = React.useState(
    now.toISOString().split("T")[0]
  )
  const [finMangaId, setFinMangaId] = React.useState("")
  const [finWebsite, setFinWebsite] = React.useState("")
  const [finChapters, setFinChapters] = React.useState("0")
  const [finCostPerChapter, setFinCostPerChapter] = React.useState<
    string | number
  >(0)
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
    if (monthFilter !== "all" || yearFilter !== "all") {
      list = list.filter((s) => {
        if (!s.date) return false
        const d = new Date(s.date)
        if (isNaN(d.getTime())) return false
        const mMatch =
          monthFilter === "all" || String(d.getMonth() + 1) === monthFilter
        const yMatch =
          yearFilter === "all" || String(d.getFullYear()) === yearFilter
        return mMatch && yMatch
      })
    }
    list.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    return list
  }, [salesList, monthFilter, yearFilter])

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

  // Charts Data
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
      if (s.date && String(s.date).includes("T")) {
        const dt = new Date(s.date)
        y = dt.getUTCFullYear()
        m = dt.getUTCMonth() + 1
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

  // Auto-fill chapters & cost when Manga or Date changes
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

  const handleAddSale = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!finMangaId || !finWebsite || !finRevenue) {
      toast.warning("กรุณากรอกข้อมูลให้ครบถ้วน")
      return
    }
    setSubmitting(true)
    try {
      const manga = (mangaList || []).find(
        (m) => m.mangaid != null && String(m.mangaid) === String(finMangaId)
      )
      const chapters = getChapterCount(finChapters, true)
      const costPer = parseFloat(String(finCostPerChapter)) || 0
      const rev = parseFloat(finRevenue) || 0

      const payload = {
        date: finDate,
        seriesname: manga ? manga.manganame : "",
        serieschapterid: finMangaId,
        chapterscount: chapters,
        chaptersrange: finChapters,
        costperchapter: costPer,
        totalcost: chapters * costPer,
        revenue: rev,
        website: finWebsite,
      }

      const res = await callGasApi("ADD_MANGA_SALE", payload)
      toast.success("บันทึกยอดขายเรียบร้อย")
      onSalesChange(res.list || [])
      setAddOpen(false)
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึกยอดขาย")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteSale = async (sale: any, idx: number) => {
    if (!window.confirm("ยืนยันการลบรายการยอดขายนี้หรือไม่?")) return
    try {
      const rowIndex = sale._rowIndex !== undefined ? sale._rowIndex : idx
      const res = await callGasApi("DELETE_MANGA_SALE", { index: rowIndex })
      toast.success("ลบรายการเรียบร้อย")
      onSalesChange(res.list || [])
    } catch (err: any) {
      toast.error(err.message || "ลบรายการไม่สำเร็จ")
    }
  }

  const handleBulkImport = async () => {
    const text = bulkText.trim()
    if (!text) {
      toast.warning("กรุณาวางข้อมูลก่อนกดนำเข้า")
      return
    }

    const lines = text.split("\n")
    const sales: any[] = []
    let delimiter = "\t"
    const sample = lines.slice(0, 5).filter((l) => l.trim())
    if (sample.length > 0) {
      const tabs = (sample[0].match(/\t/g) || []).length
      const commas = (sample[0].match(/,/g) || []).length
      if (commas > tabs) delimiter = ","
    }

    const parseLine = (line: string) => {
      const result: string[] = []
      let cur = ""
      let inQuote = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') inQuote = !inQuote
        else if (char === delimiter && !inQuote) {
          result.push(cur.trim())
          cur = ""
        } else cur += char
      }
      result.push(cur.trim())
      return result.map((s) =>
        s.replace(/^"|"$/g, "").replace(/""/g, '"').trim()
      )
    }

    const cleanNum = (str: string) => {
      if (!str) return 0
      let cleaned = str.replace(/,/g, "").trim()
      if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
        cleaned = "-" + cleaned.substring(1, cleaned.length - 1)
      }
      return parseFloat(cleaned) || 0
    }

    lines.forEach((line) => {
      if (!line.trim()) return
      const cols = parseLine(line)
      if (cols.length < 10) return
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">
            รายงานกำไร-ขาดทุน (P&L Report)
          </h2>
          <p className="text-sm text-slate-400">
            ติดตามต้นทุนและยอดขายรายเดือน (อ้างอิงจากข้อมูล MangaSales)
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

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">📈 แนวโน้มรายได้รายเดือน</CardTitle>
            <div className="flex gap-2">
              <select
                className="h-8 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs text-slate-100"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
              >
                <option value="all">เดือน: ทั้งหมด</option>
                {THAI_MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
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

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">📊 รายรับแยกตามช่องทาง</CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <Bar
              data={chartsData.barData}
              options={{
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { color: "#94a3b8" } },
                  y: { ticks: { color: "#cbd5e1" } },
                },
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-400" />
              อันดับมังงะ (กำไร / ขาดทุน)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-emerald-400 mb-2">
                Top 5 Profit
              </h4>
              <div className="space-y-1.5 text-xs">
                {summary.topProfits.length === 0 ? (
                  <p className="text-slate-500">ไม่มีข้อมูลกำไร</p>
                ) : (
                  summary.topProfits.map((p, i) => (
                    <div
                      key={p.name}
                      className="flex justify-between border-b border-[#1a2337] pb-1"
                    >
                      <span className="truncate pr-2">
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-emerald-400 font-semibold shrink-0">
                        +{p.profit.toLocaleString()} ฿
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-red-400 mb-2">
                Top 5 Loss
              </h4>
              <div className="space-y-1.5 text-xs">
                {summary.topLosses.length === 0 ? (
                  <p className="text-slate-500">ไม่มีข้อมูลขาดทุน</p>
                ) : (
                  summary.topLosses.map((p, i) => (
                    <div
                      key={p.name}
                      className="flex justify-between border-b border-[#1a2337] pb-1"
                    >
                      <span className="truncate pr-2">
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-red-400 font-semibold shrink-0">
                        {p.profit.toLocaleString()} ฿
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เดือน / เรื่อง</TableHead>
              <TableHead className="text-center">จำนวนตอน</TableHead>
              <TableHead className="text-right">ต้นทุน/ตอน</TableHead>
              <TableHead className="text-right">ต้นทุนรวม</TableHead>
              <TableHead className="text-right">ยอดขาย</TableHead>
              <TableHead className="text-right">กำไร/ขาดทุน</TableHead>
              <TableHead className="text-center w-20">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSales.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-12 text-slate-400"
                >
                  ไม่มีข้อมูลรายการยอดขาย
                </TableCell>
              </TableRow>
            ) : (
              filteredSales.map((s, idx) => {
                const rev = parseFloat(s.revenue) || 0
                const cost = parseFloat(s.totalcost) || 0
                const profit = rev - cost
                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="font-semibold text-slate-100">
                        {s.seriesname}
                      </div>
                      <div className="text-xs text-slate-400">
                        {s.date
                          ? new Date(s.date).toLocaleDateString("th-TH")
                          : "-"}{" "}
                        • {s.website || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {s.chapterscount}
                    </TableCell>
                    <TableCell className="text-right">
                      {(parseFloat(s.costperchapter) || 0).toLocaleString()} ฿
                    </TableCell>
                    <TableCell className="text-right">
                      {cost.toLocaleString()} ฿
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {rev.toLocaleString()} ฿
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={profit >= 0 ? "success" : "destructive"}>
                        {profit >= 0 ? "+" : ""}
                        {profit.toLocaleString()} ฿
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteSale(s, idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add Monthly Sale Modal */}
      <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกยอดขายประจำเดือน</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSale} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>วันที่บันทึก *</Label>
              <Input
                type="date"
                value={finDate}
                onChange={(e) => {
                  setFinDate(e.target.value)
                  autoFillFinDetails(finMangaId, e.target.value)
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

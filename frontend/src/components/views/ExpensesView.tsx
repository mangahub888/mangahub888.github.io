import * as React from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js"
import { Bar, Doughnut } from "react-chartjs-2"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  THAI_MONTHS,
  getChapterCount,
  isStepDone,
  parseQueueDate,
} from "@/lib/utils"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Receipt,
  DollarSign,
  Copy,
  Check,
  Download,
  Settings2,
  Users,
  BookOpen,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  UserX,
} from "lucide-react"

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
)

export interface ExpenseRates {
  uploadRate: number
  extractRate: number
  translateSpecialName: string
  translateSpecialRate: number
  translateNormalRate: number
  typesetSpecialName: string
  typesetSpecialRate: number
  typesetNormalRate: number
  supportName: string
  supportAmount: number
}

const DEFAULT_RATES: ExpenseRates = {
  uploadRate: 10,
  extractRate: 10,
  translateSpecialName: "Pratchaya",
  translateSpecialRate: 100,
  translateNormalRate: 25,
  typesetSpecialName: "Tilly",
  typesetSpecialRate: 45,
  typesetNormalRate: 40,
  supportName: "KIKKUK",
  supportAmount: 1500,
}

const STORAGE_RATES_KEY = "mangahub_expense_rates_v1"
const STORAGE_EXCLUDE_KEY = "mangahub_exclude_apt_phum_v1"

function loadSavedRates(): ExpenseRates {
  try {
    const raw = localStorage.getItem(STORAGE_RATES_KEY)
    if (raw) {
      return { ...DEFAULT_RATES, ...JSON.parse(raw) }
    }
  } catch (e) {
    console.error("Failed to load saved rates:", e)
  }
  return DEFAULT_RATES
}

function saveRates(rates: ExpenseRates) {
  localStorage.setItem(STORAGE_RATES_KEY, JSON.stringify(rates))
}

function loadSavedExcludeAptPhum(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_EXCLUDE_KEY)
    if (raw !== null) {
      return raw === "true"
    }
  } catch (e) {}
  return true // Default: exclude Apt & ภูมิ as requested
}

interface ExpensesViewProps {
  mangaList: any[]
  teamList: any[]
  passcode: string
}

interface MemberPayroll {
  name: string
  uploadChapters: number
  uploadCost: number
  extractChapters: number
  extractCost: number
  translateChapters: number
  translateCost: number
  translateRate: number
  typesetChapters: number
  typesetCost: number
  typesetRate: number
  supportCost: number
  totalCost: number
}

export function ExpensesView({
  mangaList,
  teamList,
  passcode,
}: ExpensesViewProps) {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = React.useState<string>(
    String(now.getMonth() + 1)
  )
  const [selectedYear, setSelectedYear] = React.useState<string>(
    String(now.getFullYear())
  )

  const [rates, setRates] = React.useState<ExpenseRates>(loadSavedRates)
  const [rateSettingsOpen, setRateSettingsOpen] = React.useState(false)
  const [tempRates, setTempRates] = React.useState<ExpenseRates>(rates)

  // Toggle button to exclude Apt and ภูมิ from calculation
  const [excludeAptPhum, setExcludeAptPhum] = React.useState<boolean>(
    loadSavedExcludeAptPhum
  )

  const handleToggleExcludeAptPhum = () => {
    setExcludeAptPhum((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_EXCLUDE_KEY, String(next))
      if (next) {
        toast.info("ถอดชื่อ Apt และ ภูมิ ออกจากการคำนวณแล้ว")
      } else {
        toast.info("รวมชื่อ Apt และ ภูมิ ในการคำนวณตามปกติ")
      }
      return next
    })
  }

  const isNameExcluded = React.useCallback(
    (rawName: string): boolean => {
      if (!excludeAptPhum) return false
      const clean = (rawName || "").trim().toLowerCase()
      return clean === "apt" || clean === "ภูมิ"
    },
    [excludeAptPhum]
  )

  const [activeTab, setActiveTab] = React.useState<"members" | "chapters">(
    "members"
  )
  const [copied, setCopied] = React.useState(false)
  const [workStatusFilter, setWorkStatusFilter] = React.useState<
    "all" | "completed" | "incomplete"
  >("all")

  // Queue cache loaded from GAS
  const [queueItems, setQueueItems] = React.useState<any[]>([])
  const [loadingQueue, setLoadingQueue] = React.useState(false)

  const fetchQueueData = React.useCallback(async () => {
    setLoadingQueue(true)
    try {
      const res = await callGasApi<any[]>("GET_WORK_QUEUE", {
        month: "all",
        year: "all",
        includeIncomplete: false,
      })
      setQueueItems(Array.isArray(res) ? res : [])
    } catch (err: any) {
      toast.error(err.message || "ดึงข้อมูลคิวงานไม่สำเร็จ")
    } finally {
      setLoadingQueue(false)
    }
  }, [])

  React.useEffect(() => {
    fetchQueueData()
  }, [fetchQueueData])

  // Helper: check if a step's timestamp falls in selected month and year
  const isDateInPeriod = React.useCallback(
    (dateStr: any, targetMonth: string, targetYear: string): boolean => {
      if (!dateStr) return false
      if (targetMonth === "all" && targetYear === "all") return true
      const d = parseQueueDate(dateStr)
      if (!d) return false
      const mMatch =
        targetMonth === "all" || String(d.getMonth() + 1) === targetMonth
      const yMatch = targetYear === "all" || String(d.getFullYear()) === targetYear
      return mMatch && yMatch
    },
    []
  )

  // Calculate payroll per member based on actual step completion timestamps
  const { memberPayrolls, chapterPayrolls, grandTotals } = React.useMemo(() => {
    const membersMap = new Map<string, MemberPayroll>()

    const getOrCreateMember = (rawName: string) => {
      const name = (rawName || "ไม่ระบุ").trim()
      const key = name.toLowerCase()
      let foundKey = Array.from(membersMap.keys()).find(
        (k) => k.toLowerCase() === key
      )
      if (!foundKey) {
        membersMap.set(name, {
          name,
          uploadChapters: 0,
          uploadCost: 0,
          extractChapters: 0,
          extractCost: 0,
          translateChapters: 0,
          translateCost: 0,
          translateRate: rates.translateNormalRate,
          typesetChapters: 0,
          typesetCost: 0,
          typesetRate: rates.typesetNormalRate,
          supportCost: 0,
          totalCost: 0,
        })
        foundKey = name
      }
      return membersMap.get(foundKey)!
    }

    // Initialize support payee (KIKKUK) even if no tasks
    if (rates.supportName && rates.supportAmount > 0) {
      const supportMember = getOrCreateMember(rates.supportName)
      supportMember.supportCost += rates.supportAmount
    }

    const chapPayrolls: any[] = []

    let totalUploadChapters = 0
    let totalUploadCost = 0
    let totalExtractChapters = 0
    let totalExtractCost = 0
    let totalTranslateChapters = 0
    let totalTranslateCost = 0
    let totalTypesetChapters = 0
    let totalTypesetCost = 0

    queueItems.forEach((q) => {
      // Work status filter (Optional: "all" / "completed" only / "incomplete" only)
      const isChapterComplete = isStepDone(q.poststatus)
      if (workStatusFilter === "completed" && !isChapterComplete) return
      if (workStatusFilter === "incomplete" && isChapterComplete) return

      const count = getChapterCount(q.chapter)
      const manga = mangaList.find(
        (m) =>
          m.mangaid != null &&
          q.mangaid != null &&
          String(m.mangaid) === String(q.mangaid)
      )
      const mangaName = manga ? manga.manganame : "Unknown"

      let rowUploadCost = 0
      let rowExtractCost = 0
      let rowTranslateCost = 0
      let rowTypesetCost = 0

      // 1. Upload (อัป Raw) -> 10 บาท/ตอน
      const isUploadInPeriod = isDateInPeriod(
        q.uploadtime || q.createdat,
        selectedMonth,
        selectedYear
      )
      const uploaderExcluded = isNameExcluded(q.uploadername)
      if (
        isStepDone(q.uploadstatus) &&
        q.uploadername &&
        q.uploadstatus !== "Skipped" &&
        q.uploadstatus !== "ข้าม" &&
        String(q.uploadstatus).toLowerCase() !== "skip" &&
        isUploadInPeriod &&
        !uploaderExcluded
      ) {
        const member = getOrCreateMember(q.uploadername)
        rowUploadCost = count * rates.uploadRate
        member.uploadChapters += count
        member.uploadCost += rowUploadCost
        totalUploadChapters += count
        totalUploadCost += rowUploadCost
      }

      // 2. Extract (ดึงคำ) -> 10 บาท/ตอน (ข้ามถ้า Skipped)
      const isExtractInPeriod = isDateInPeriod(
        q.extracttime || q.createdat,
        selectedMonth,
        selectedYear
      )
      const extractorExcluded = isNameExcluded(q.extractorname)
      if (
        isStepDone(q.extractstatus) &&
        q.extractorname &&
        q.extractstatus !== "Skipped" &&
        q.extractstatus !== "ข้าม" &&
        String(q.extractstatus).toLowerCase() !== "skip" &&
        isExtractInPeriod &&
        !extractorExcluded
      ) {
        const member = getOrCreateMember(q.extractorname)
        rowExtractCost = count * rates.extractRate
        member.extractChapters += count
        member.extractCost += rowExtractCost
        totalExtractChapters += count
        totalExtractCost += rowExtractCost
      }

      // 3. Translate (แปล) -> Pratchaya: 100 / อื่นๆ: 25
      const isTranslateInPeriod = isDateInPeriod(
        q.translatetime || q.createdat,
        selectedMonth,
        selectedYear
      )
      const translatorExcluded = isNameExcluded(q.translatorname)
      if (
        isStepDone(q.translatestatus) &&
        q.translatorname &&
        q.translatestatus !== "Skipped" &&
        q.translatestatus !== "ข้าม" &&
        isTranslateInPeriod &&
        !translatorExcluded
      ) {
        const member = getOrCreateMember(q.translatorname)
        const isSpecial = member.name
          .toLowerCase()
          .includes(rates.translateSpecialName.toLowerCase())
        const rate = isSpecial
          ? rates.translateSpecialRate
          : rates.translateNormalRate
        member.translateRate = rate
        rowTranslateCost = count * rate
        member.translateChapters += count
        member.translateCost += rowTranslateCost
        totalTranslateChapters += count
        totalTranslateCost += rowTranslateCost
      }

      // 4. Typeset (ลงคำ) -> Tilly: 45 / อื่นๆ: 40
      const isTypesetInPeriod = isDateInPeriod(
        q.typesettime || q.createdat,
        selectedMonth,
        selectedYear
      )
      const typesetterExcluded = isNameExcluded(q.typesettername)
      if (
        isStepDone(q.typesetstatus) &&
        q.typesettername &&
        q.typesetstatus !== "Skipped" &&
        q.typesetstatus !== "ข้าม" &&
        isTypesetInPeriod &&
        !typesetterExcluded
      ) {
        const member = getOrCreateMember(q.typesettername)
        const isSpecial = member.name
          .toLowerCase()
          .includes(rates.typesetSpecialName.toLowerCase())
        const rate = isSpecial
          ? rates.typesetSpecialRate
          : rates.typesetNormalRate
        member.typesetRate = rate
        rowTypesetCost = count * rate
        member.typesetChapters += count
        member.typesetCost += rowTypesetCost
        totalTypesetChapters += count
        totalTypesetCost += rowTypesetCost
      }

      const rowTotal =
        rowUploadCost + rowExtractCost + rowTranslateCost + rowTypesetCost

      // Only add to chapter payroll breakdown if there was activity in this period
      if (
        rowTotal > 0 ||
        (selectedMonth === "all" && selectedYear === "all")
      ) {
        chapPayrolls.push({
          queueid: q.queueid,
          createdat: q.createdat,
          mangaName,
          chapter: q.chapter,
          chapterCount: count,
          uploader:
            rowUploadCost > 0
              ? q.uploadername || "-"
              : uploaderExcluded && isStepDone(q.uploadstatus)
              ? `${q.uploadername} (ยกเว้น)`
              : "-",
          uploadCost: rowUploadCost,
          extractor:
            rowExtractCost > 0
              ? q.extractorname || "-"
              : extractorExcluded && isStepDone(q.extractstatus) && q.extractstatus !== "Skipped" && q.extractstatus !== "ข้าม" && String(q.extractstatus).toLowerCase() !== "skip"
              ? `${q.extractorname} (ยกเว้น)`
              : "-",
          extractCost: rowExtractCost,
          translator:
            rowTranslateCost > 0
              ? q.translatorname || "-"
              : translatorExcluded && isStepDone(q.translatestatus)
              ? `${q.translatorname} (ยกเว้น)`
              : "-",
          translateCost: rowTranslateCost,
          typesetter:
            rowTypesetCost > 0
              ? q.typesettername || "-"
              : typesetterExcluded && isStepDone(q.typesetstatus)
              ? `${q.typesettername} (ยกเว้น)`
              : "-",
          typesetCost: rowTypesetCost,
          totalCost: rowTotal,
        })
      }
    })

    // Compute totalCost per member
    membersMap.forEach((m) => {
      m.totalCost =
        m.uploadCost +
        m.extractCost +
        m.translateCost +
        m.typesetCost +
        m.supportCost
    })

    // Convert to sorted array (exclude members with 0 cost in this month)
    const payrollArray = Array.from(membersMap.values())
      .filter((m) => m.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost)

    const grandTotalCost =
      totalUploadCost +
      totalExtractCost +
      totalTranslateCost +
      totalTypesetCost +
      (rates.supportAmount || 0)

    return {
      memberPayrolls: payrollArray,
      chapterPayrolls: chapPayrolls,
      grandTotals: {
        totalUploadChapters,
        totalUploadCost,
        totalExtractChapters,
        totalExtractCost,
        totalTranslateChapters,
        totalTranslateCost,
        totalTypesetChapters,
        totalTypesetCost,
        totalSupportCost: rates.supportAmount || 0,
        grandTotalCost,
      },
    }
  }, [
    queueItems,
    selectedMonth,
    selectedYear,
    workStatusFilter,
    mangaList,
    rates,
    isDateInPeriod,
    isNameExcluded,
  ])

  // Doughnut Chart Data (by step)
  const stepChartData = React.useMemo(() => {
    return {
      labels: ["แปล", "ลงคำ", "ดึงคำ", "อัป Raw", "Support (KIKKUK)"],
      datasets: [
        {
          data: [
            grandTotals.totalTranslateCost,
            grandTotals.totalTypesetCost,
            grandTotals.totalExtractCost,
            grandTotals.totalUploadCost,
            grandTotals.totalSupportCost,
          ],
          backgroundColor: [
            "#ec4899", // pink (translate)
            "#f59e0b", // amber (typeset)
            "#f97316", // orange (extract)
            "#6366f1", // indigo (upload)
            "#10b981", // emerald (support)
          ],
          borderWidth: 0,
        },
      ],
    }
  }, [grandTotals])

  // Bar Chart Data (by member)
  const memberChartData = React.useMemo(() => {
    const topMembers = memberPayrolls.slice(0, 8)
    return {
      labels: topMembers.map((m) => m.name),
      datasets: [
        {
          label: "ยอดจ่ายสุทธิ (บาท)",
          data: topMembers.map((m) => m.totalCost),
          backgroundColor: "#4f46e5",
          borderRadius: 6,
        },
      ],
    }
  }, [memberPayrolls])

  // Copy Summary text for LINE / Telegram
  const handleCopySummary = () => {
    const monthName =
      selectedMonth === "all"
        ? "ทุกเดือน"
        : THAI_MONTHS[parseInt(selectedMonth, 10) - 1]
    const yearName =
      selectedYear === "all"
        ? "ทุกปี"
        : String(parseInt(selectedYear, 10) + 543)

    let text = `📊 สรุปยอดจ่ายค่าแรงประจำเดือน ${monthName} ${yearName}\n`
    text += `═════════════════════════\n`

    memberPayrolls.forEach((m, idx) => {
      text += `${idx + 1}. 👤 ${m.name}: ${m.totalCost.toLocaleString()} บาท\n`
      const details: string[] = []
      if (m.uploadCost > 0) details.push(`Raw ${m.uploadChapters} ตอน (${m.uploadCost.toLocaleString()}บ.)`)
      if (m.extractCost > 0) details.push(`ดึงคำ ${m.extractChapters} ตอน (${m.extractCost.toLocaleString()}บ.)`)
      if (m.translateCost > 0) details.push(`แปล ${m.translateChapters} ตอน (${m.translateCost.toLocaleString()}บ.)`)
      if (m.typesetCost > 0) details.push(`ลงคำ ${m.typesetChapters} ตอน (${m.typesetCost.toLocaleString()}บ.)`)
      if (m.supportCost > 0) details.push(`Support (${m.supportCost.toLocaleString()}บ.)`)
      if (details.length > 0) {
        text += `   └─ ${details.join(", ")}\n`
      }
    })

    text += `═════════════════════════\n`
    text += `💰 ยอดรวมรายจ่ายทั้งสิ้น: ${grandTotals.grandTotalCost.toLocaleString()} บาท\n`
    text += `📚 รวมตอนที่สำเร็จ: แปล ${grandTotals.totalTranslateChapters} ตอน | ลงคำ ${grandTotals.totalTypesetChapters} ตอน\n`

    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success("คัดลอกสรุปยอดจ่ายเรียบร้อยแล้ว! นำไปวางใน LINE/Telegram ได้เลย")
    setTimeout(() => setCopied(false), 3000)
  }

  // Export CSV
  const handleExportCSV = () => {
    let csv = "\uFEFFรายชื่อทีมงาน,อัป Raw (ตอน),อัป Raw (บาท),ดึงคำ (ตอน),ดึงคำ (บาท),แปล (ตอน),แปล (บาท),ลงคำ (ตอน),ลงคำ (บาท),Support (บาท),ยอดสุทธิ (บาท)\n"
    memberPayrolls.forEach((m) => {
      csv += `"${m.name}",${m.uploadChapters},${m.uploadCost},${m.extractChapters},${m.extractCost},${m.translateChapters},${m.translateCost},${m.typesetChapters},${m.typesetCost},${m.supportCost},${m.totalCost}\n`
    })
    csv += `"รวมทั้งสิ้น",${grandTotals.totalUploadChapters},${grandTotals.totalUploadCost},${grandTotals.totalExtractChapters},${grandTotals.totalExtractCost},${grandTotals.totalTranslateChapters},${grandTotals.totalTranslateCost},${grandTotals.totalTypesetChapters},${grandTotals.totalTypesetCost},${grandTotals.totalSupportCost},${grandTotals.grandTotalCost}\n`

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute(
      "download",
      `mangahub_payroll_${selectedYear}_${selectedMonth}.csv`
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว")
  }

  const handleSaveRates = (e: React.FormEvent) => {
    e.preventDefault()
    setRates(tempRates)
    saveRates(tempRates)
    setRateSettingsOpen(false)
    toast.success("บันทึกการตั้งค่าอัตราค่าแรงเรียบร้อยแล้ว")
  }

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#26334d] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                สรุปรายจ่ายรายเดือน
              </h2>
              <p className="text-xs text-slate-400">
                คำนวณค่าแรงทีมงานรายตอนตามเงื่อนไขที่กำหนดแบบอัตโนมัติ
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTempRates(rates)
              setRateSettingsOpen(true)
            }}
            className="h-9"
          >
            <Settings2 className="h-4 w-4 text-indigo-400" />
            ตั้งค่าอัตราค่าแรง
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-9"
          >
            <Download className="h-4 w-4" />
            ส่งออก CSV
          </Button>

          <Button
            size="sm"
            onClick={handleCopySummary}
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "คัดลอกแล้ว!" : "คัดลอกสรุปส่งแชท"}
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4 bg-[#111726] border-[#26334d]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <span>เลือกช่วงเวลา:</span>
            </div>

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100 font-medium"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              <option value="all">ทุกเดือน</option>
              {THAI_MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100 font-medium"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="all">ทุกปี</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y + 543}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100 font-medium"
              value={workStatusFilter}
              onChange={(e) =>
                setWorkStatusFilter(e.target.value as "all" | "completed" | "incomplete")
              }
              title="กรองตามสถานะงานของตอน"
            >
              <option value="all">สถานะตอน: ทุกสถานะ (ทุกงานที่เสร็จในเดือน)</option>
              <option value="completed">เฉพาะตอนที่โพสต์เสร็จแล้ว</option>
              <option value="incomplete">เฉพาะตอนที่ยังโพสต์ไม่เสร็จ (กำลังทำ)</option>
            </select>

            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 text-slate-300 hover:text-white"
              onClick={fetchQueueData}
              disabled={loadingQueue}
              title="ดึงข้อมูลคิวงานล่าสุดจากคลาวด์"
            >
              <RefreshCw
                className={`h-4 w-4 ${loadingQueue ? "animate-spin text-amber-400" : ""}`}
              />
            </Button>

            {/* Toggle Exclude Apt & Phum */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleToggleExcludeAptPhum}
              className={`h-9 font-medium text-xs transition-all cursor-pointer ${
                excludeAptPhum
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30"
                  : "bg-[#0b1120] text-slate-400 border-[#26334d] hover:bg-slate-800 hover:text-white"
              }`}
              title="กดเพื่อเปิด/ปิด การถอดชื่อ Apt และ ภูมิ ออกจากการคำนวณค่าแรง"
            >
              <UserX
                className={`h-4 w-4 mr-1.5 ${
                  excludeAptPhum ? "text-rose-400" : "text-slate-400"
                }`}
              />
              {excludeAptPhum ? "🚫 ถอดชื่อ Apt & ภูมิ แล้ว" : "👥 รวมชื่อ Apt & ภูมิ"}
            </Button>

            {loadingQueue && (
              <span className="text-xs text-amber-400 animate-pulse flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                กำลังโหลดข้อมูล...
              </span>
            )}
          </div>

          {/* Active Rates Rules Pill */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className="text-slate-500">เกณฑ์คำนวณ:</span>
            {excludeAptPhum && (
              <Badge variant="outline" className="bg-rose-500/15 text-rose-300 border-rose-500/40 font-medium">
                🚫 ยกเว้น: Apt & ภูมิ
              </Badge>
            )}
            <Badge variant="outline" className="bg-[#151d2f] text-slate-300 border-[#26334d]">
              อัป Raw: {rates.uploadRate}บ.
            </Badge>
            <Badge variant="outline" className="bg-[#151d2f] text-slate-300 border-[#26334d]">
              ดึงคำ: {rates.extractRate}บ.
            </Badge>
            <Badge variant="outline" className="bg-[#151d2f] text-pink-300 border-pink-500/30">
              แปล: {rates.translateSpecialName} {rates.translateSpecialRate}บ. / ทั่วไป {rates.translateNormalRate}บ.
            </Badge>
            <Badge variant="outline" className="bg-[#151d2f] text-amber-300 border-amber-500/30">
              ลงคำ: {rates.typesetSpecialName} {rates.typesetSpecialRate}บ. / ทั่วไป {rates.typesetNormalRate}บ.
            </Badge>
            <Badge variant="outline" className="bg-[#151d2f] text-emerald-300 border-emerald-500/30">
              Support: {rates.supportName} {rates.supportAmount.toLocaleString()}บ.
            </Badge>
          </div>
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Expense */}
        <Card className="p-5 border-emerald-500/30 bg-gradient-to-br from-[#111c2e] to-[#0c2222]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              💰 ยอดรวมรายจ่ายทั้งสิ้น
            </span>
            <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
              <DollarSign className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-white">
            {grandTotals.grandTotalCost.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-400">บาท</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            รวมค่าแรง {memberPayrolls.length} คน (มี Support {rates.supportAmount.toLocaleString()}บ.)
          </p>
        </Card>

        {/* Translation Total */}
        <Card className="p-5 border-pink-500/30 bg-gradient-to-br from-[#111726] to-[#1f1124]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-pink-400">
              🌐 ค่าแปลภาษา
            </span>
            <div className="rounded-lg bg-pink-500/20 p-2 text-pink-400">
              <BookOpen className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-white">
            {grandTotals.totalTranslateCost.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-400">บาท</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            สำเร็จ {grandTotals.totalTranslateChapters} ตอน
          </p>
        </Card>

        {/* Typeset Total */}
        <Card className="p-5 border-amber-500/30 bg-gradient-to-br from-[#111726] to-[#241b11]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              ✍️ ค่าลงคำ (Typeset)
            </span>
            <div className="rounded-lg bg-amber-500/20 p-2 text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-white">
            {grandTotals.totalTypesetCost.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-400">บาท</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            สำเร็จ {grandTotals.totalTypesetChapters} ตอน
          </p>
        </Card>

        {/* Raw + Extract + Support Total */}
        <Card className="p-5 border-indigo-500/30 bg-gradient-to-br from-[#111726] to-[#141530]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              🛠️ Raw + ดึงคำ + Support
            </span>
            <div className="rounded-lg bg-indigo-500/20 p-2 text-indigo-400">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-white">
            {(
              grandTotals.totalUploadCost +
              grandTotals.totalExtractCost +
              grandTotals.totalSupportCost
            ).toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-400">บาท</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Raw: {grandTotals.totalUploadCost.toLocaleString()}บ. | ดึงคำ: {grandTotals.totalExtractCost.toLocaleString()}บ.
          </p>
        </Card>
      </div>

      {/* Visual Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="p-5 border-[#26334d] bg-[#111726] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-200 mb-1">
              สัดส่วนค่าใช้จ่ายตามประเภทงาน
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              การกระจายตัวของงบประมาณค่าแรงในเดือนนี้
            </p>
          </div>
          <div className="h-56 flex items-center justify-center">
            {grandTotals.grandTotalCost > 0 ? (
              <Doughnut
                data={stepChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "bottom",
                      labels: { color: "#94a3b8", font: { size: 11 } },
                    },
                  },
                }}
              />
            ) : (
              <p className="text-xs text-slate-500">ไม่มีข้อมูลค่าใช้จ่าย</p>
            )}
          </div>
        </Card>

        <Card className="p-5 border-[#26334d] bg-[#111726] lg:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-200 mb-1">
              ยอดจ่ายสุทธิแยกตามทีมงาน (Top Earners)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              รายชื่อทีมงานที่มียอดค่าแรงสูงสุดประจำเดือน
            </p>
          </div>
          <div className="h-56">
            {memberPayrolls.length > 0 ? (
              <Bar
                data={memberChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    x: {
                      ticks: { color: "#94a3b8", font: { size: 11 } },
                      grid: { display: false },
                    },
                    y: {
                      ticks: { color: "#94a3b8", font: { size: 11 } },
                      grid: { color: "#1e293b" },
                    },
                  },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-slate-500">ไม่มีข้อมูลทีมงาน</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Tabs Switcher: Members vs Chapters */}
      <div className="flex items-center gap-2 border-b border-[#26334d] pb-2">
        <button
          onClick={() => setActiveTab("members")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === "members"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <Users className="h-4 w-4" />
          สรุปรายคน ({memberPayrolls.length} คน)
        </button>

        <button
          onClick={() => setActiveTab("chapters")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === "chapters"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          แจกแจงรายตอน ({chapterPayrolls.length} รายการ)
        </button>
      </div>

      {/* Tab 1: Member Payrolls Table */}
      {activeTab === "members" && (
        <Card className="overflow-hidden border-[#26334d]">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#0b1120] hover:bg-[#0b1120]">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead className="min-w-[160px]">รายชื่อทีมงาน</TableHead>
                <TableHead className="text-right">อัป Raw</TableHead>
                <TableHead className="text-right">ดึงคำ</TableHead>
                <TableHead className="text-right">แปล</TableHead>
                <TableHead className="text-right">ลงคำ</TableHead>
                <TableHead className="text-right">Support</TableHead>
                <TableHead className="text-right min-w-[140px] font-bold text-emerald-400">
                  ยอดสุทธิ (บาท)
                </TableHead>
                <TableHead className="text-center w-28">คัดลอก</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loadingQueue ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : memberPayrolls.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-12 text-slate-400"
                  >
                    ไม่มีข้อมูลรายจ่ายในเดือนที่เลือก
                  </TableCell>
                </TableRow>
              ) : (
                memberPayrolls.map((m, idx) => {
                  const isSpecialTrans = m.name
                    .toLowerCase()
                    .includes(rates.translateSpecialName.toLowerCase())
                  const isSpecialType = m.name
                    .toLowerCase()
                    .includes(rates.typesetSpecialName.toLowerCase())
                  const isSupportOnly =
                    m.name.toLowerCase() === rates.supportName.toLowerCase() &&
                    m.uploadCost === 0 &&
                    m.extractCost === 0 &&
                    m.translateCost === 0 &&
                    m.typesetCost === 0

                  return (
                    <TableRow key={m.name} className="hover:bg-[#151d2f]/50">
                      <TableCell className="text-center text-xs text-slate-500 font-medium">
                        {idx + 1}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-300 font-bold text-xs border border-indigo-500/30">
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                              <span>{m.name}</span>
                              {m.name.toLowerCase() === rates.supportName.toLowerCase() && (
                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                  Support
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {isSupportOnly
                                ? "ค่า Support ประจำเดือน"
                                : `${m.uploadChapters + m.extractChapters + m.translateChapters + m.typesetChapters} ขั้นตอน`}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Upload */}
                      <TableCell className="text-right">
                        {m.uploadCost > 0 ? (
                          <div>
                            <span className="font-semibold text-slate-200">
                              {m.uploadCost.toLocaleString()}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {m.uploadChapters} ตอน (@{rates.uploadRate})
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>

                      {/* Extract */}
                      <TableCell className="text-right">
                        {m.extractCost > 0 ? (
                          <div>
                            <span className="font-semibold text-slate-200">
                              {m.extractCost.toLocaleString()}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {m.extractChapters} ตอน (@{rates.extractRate})
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>

                      {/* Translate */}
                      <TableCell className="text-right">
                        {m.translateCost > 0 ? (
                          <div>
                            <span className="font-semibold text-pink-300">
                              {m.translateCost.toLocaleString()}
                            </span>
                            <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                              <span>{m.translateChapters} ตอน</span>
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${isSpecialTrans ? "bg-pink-500/20 text-pink-300 border-pink-500/30" : "bg-slate-800 text-slate-400"}`}>
                                @{m.translateRate}
                              </Badge>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>

                      {/* Typeset */}
                      <TableCell className="text-right">
                        {m.typesetCost > 0 ? (
                          <div>
                            <span className="font-semibold text-amber-300">
                              {m.typesetCost.toLocaleString()}
                            </span>
                            <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                              <span>{m.typesetChapters} ตอน</span>
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${isSpecialType ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-slate-800 text-slate-400"}`}>
                                @{m.typesetRate}
                              </Badge>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>

                      {/* Support */}
                      <TableCell className="text-right">
                        {m.supportCost > 0 ? (
                          <div>
                            <span className="font-bold text-emerald-400">
                              {m.supportCost.toLocaleString()}
                            </span>
                            <div className="text-[10px] text-emerald-500">
                              Fixed Support
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </TableCell>

                      {/* Net Total */}
                      <TableCell className="text-right font-bold text-lg text-emerald-400">
                        {m.totalCost.toLocaleString()}{" "}
                        <span className="text-xs font-normal text-slate-400">
                          บ.
                        </span>
                      </TableCell>

                      {/* Copy Button */}
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-slate-300 hover:text-white"
                          onClick={() => {
                            const line = `👤 ${m.name}: ${m.totalCost.toLocaleString()} บาท`
                            navigator.clipboard.writeText(line)
                            toast.success(`คัดลอกยอดของ ${m.name} เรียบร้อยแล้ว`)
                          }}
                          title="คัดลอกยอดคนนี้"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}

              {/* Grand Total Row */}
              {memberPayrolls.length > 0 && (
                <TableRow className="bg-[#0b1120] font-bold border-t-2 border-[#26334d]">
                  <TableCell colSpan={2} className="text-slate-200 text-sm">
                    รวมทั้งสิ้น ({memberPayrolls.length} คน)
                  </TableCell>
                  <TableCell className="text-right text-slate-300">
                    {grandTotals.totalUploadCost.toLocaleString()} บ.
                    <div className="text-[10px] text-slate-500 font-normal">
                      {grandTotals.totalUploadChapters} ตอน
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-slate-300">
                    {grandTotals.totalExtractCost.toLocaleString()} บ.
                    <div className="text-[10px] text-slate-500 font-normal">
                      {grandTotals.totalExtractChapters} ตอน
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-pink-300">
                    {grandTotals.totalTranslateCost.toLocaleString()} บ.
                    <div className="text-[10px] text-pink-400/80 font-normal">
                      {grandTotals.totalTranslateChapters} ตอน
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-amber-300">
                    {grandTotals.totalTypesetCost.toLocaleString()} บ.
                    <div className="text-[10px] text-amber-400/80 font-normal">
                      {grandTotals.totalTypesetChapters} ตอน
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-emerald-400">
                    {grandTotals.totalSupportCost.toLocaleString()} บ.
                  </TableCell>
                  <TableCell className="text-right text-xl text-emerald-400 font-extrabold">
                    {grandTotals.grandTotalCost.toLocaleString()} บ.
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Tab 2: Chapters Breakdown Table */}
      {activeTab === "chapters" && (
        <Card className="overflow-hidden border-[#26334d]">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#0b1120] hover:bg-[#0b1120]">
                <TableHead>เรื่อง / ตอน</TableHead>
                <TableHead>อัป Raw</TableHead>
                <TableHead>ดึงคำ</TableHead>
                <TableHead>แปล</TableHead>
                <TableHead>ลงคำ</TableHead>
                <TableHead className="text-right font-bold text-emerald-400">
                  รวมตอนนี้ (บาท)
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loadingQueue ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : chapterPayrolls.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-slate-400"
                  >
                    ไม่มีข้อมูลตอนในเดือนที่เลือก
                  </TableCell>
                </TableRow>
              ) : (
                chapterPayrolls.map((ch) => (
                  <TableRow key={ch.queueid} className="hover:bg-[#151d2f]/50">
                    <TableCell className="min-w-[180px]">
                      <div className="font-semibold text-slate-100">
                        {ch.mangaName}
                      </div>
                      <div className="text-xs text-slate-400">
                        ตอนที่ {ch.chapter}{" "}
                        <span className="text-[11px] text-indigo-400">
                          ({ch.chapterCount} ตอน)
                        </span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-slate-300 font-medium">
                        {ch.uploader}
                      </div>
                      {ch.uploadCost > 0 && (
                        <div className="text-[11px] text-slate-400">
                          {ch.uploadCost} บ.
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-slate-300 font-medium">
                        {ch.extractor}
                      </div>
                      {ch.extractCost > 0 && (
                        <div className="text-[11px] text-slate-400">
                          {ch.extractCost} บ.
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-pink-300 font-medium">
                        {ch.translator}
                      </div>
                      {ch.translateCost > 0 && (
                        <div className="text-[11px] text-pink-400/80">
                          {ch.translateCost} บ.
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="text-xs text-amber-300 font-medium">
                        {ch.typesetter}
                      </div>
                      {ch.typesetCost > 0 && (
                        <div className="text-[11px] text-amber-400/80">
                          {ch.typesetCost} บ.
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-bold text-slate-200">
                      {ch.totalCost.toLocaleString()}{" "}
                      <span className="text-xs font-normal text-slate-400">
                        บ.
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Rate Settings Modal */}
      <Dialog
        open={rateSettingsOpen}
        onOpenChange={(v) => !v && setRateSettingsOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-indigo-400" />
              ตั้งค่าอัตราค่าแรงต่อตอน
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveRates} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">อัป Raw (บาท/ตอน)</Label>
                <Input
                  type="number"
                  value={tempRates.uploadRate}
                  onChange={(e) =>
                    setTempRates({
                      ...tempRates,
                      uploadRate: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">ดึงคำ (บาท/ตอน)</Label>
                <Input
                  type="number"
                  value={tempRates.extractRate}
                  onChange={(e) =>
                    setTempRates({
                      ...tempRates,
                      extractRate: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-3 rounded-lg border border-pink-500/20 bg-pink-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-pink-400">
                  🌐 ค่าแปล (Translate)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    ชื่อเฉพาะ (เช่น {tempRates.translateSpecialName})
                  </Label>
                  <Input
                    value={tempRates.translateSpecialName}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        translateSpecialName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    เรทชื่อเฉพาะ (บาท/ตอน)
                  </Label>
                  <Input
                    type="number"
                    value={tempRates.translateSpecialRate}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        translateSpecialRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-slate-300">
                  เรทคนแปลทั่วไป (บาท/ตอน)
                </Label>
                <Input
                  type="number"
                  value={tempRates.translateNormalRate}
                  onChange={(e) =>
                    setTempRates({
                      ...tempRates,
                      translateNormalRate: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400">
                  ✍️ ค่าลงคำ (Typeset)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    ชื่อเฉพาะ (เช่น {tempRates.typesetSpecialName})
                  </Label>
                  <Input
                    value={tempRates.typesetSpecialName}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        typesetSpecialName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    เรทชื่อเฉพาะ (บาท/ตอน)
                  </Label>
                  <Input
                    type="number"
                    value={tempRates.typesetSpecialRate}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        typesetSpecialRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-slate-300">
                  เรทคนลงคำทั่วไป (บาท/ตอน)
                </Label>
                <Input
                  type="number"
                  value={tempRates.typesetNormalRate}
                  onChange={(e) =>
                    setTempRates({
                      ...tempRates,
                      typesetNormalRate: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-3">
              <span className="text-xs font-bold text-emerald-400">
                🛡️ ค่า Support อื่นๆ
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    ชื่อผู้รับ (เช่น {tempRates.supportName})
                  </Label>
                  <Input
                    value={tempRates.supportName}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        supportName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-300">
                    ยอดเงินต่อเดือน (บาท)
                  </Label>
                  <Input
                    type="number"
                    value={tempRates.supportAmount}
                    onChange={(e) =>
                      setTempRates({
                        ...tempRates,
                        supportAmount: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRateSettingsOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกอัตราค่าแรง</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

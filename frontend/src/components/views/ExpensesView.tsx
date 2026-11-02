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
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Send,
  Eye,
  XCircle,
  Lock,
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

  // Date mode: Calendar Month vs Custom Date Range
  const [dateMode, setDateMode] = React.useState<"calendar" | "custom">("calendar")
  const [customStartDate, setCustomStartDate] = React.useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  })
  const [customEndDate, setCustomEndDate] = React.useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })

  // Payout Claims State
  const [payoutClaims, setPayoutClaims] = React.useState<any[]>([])
  const [loadingClaims, setLoadingClaims] = React.useState(false)
  const [selectedClaimDetail, setSelectedClaimDetail] = React.useState<any | null>(null)
  const [updatingClaimId, setUpdatingClaimId] = React.useState<string | null>(null)

  // Staff Self-Claim Form state
  const [claimStaffName, setClaimStaffName] = React.useState<string>("")
  const [claimStartDate, setClaimStartDate] = React.useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  })
  const [claimEndDate, setClaimEndDate] = React.useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })
  const [claimNote, setClaimNote] = React.useState<string>("")
  const [submittingClaim, setSubmittingClaim] = React.useState(false)
  const [unclaimedViewMode, setUnclaimedViewMode] = React.useState<"summary" | "detailed">("summary")
  const [expandedStaffSet, setExpandedStaffSet] = React.useState<Set<string>>(new Set())

  const [activeTab, setActiveTab] = React.useState<"members" | "chapters" | "claims">(
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

  // Fetch Payout Claims from GAS
  const fetchPayoutClaims = React.useCallback(async () => {
    setLoadingClaims(true)
    try {
      const res = await callGasApi<any[]>("GET_PAYOUT_CLAIMS")
      setPayoutClaims(Array.isArray(res) ? res : [])
    } catch (err: any) {
      console.warn("Fetch payout claims error:", err)
    } finally {
      setLoadingClaims(false)
    }
  }, [])

  React.useEffect(() => {
    fetchPayoutClaims()
  }, [fetchPayoutClaims])

  // Helper: check if a step's timestamp falls in selected month and year or custom date range
  const isDateInPeriod = React.useCallback(
    (dateStr: any, targetMonth: string, targetYear: string): boolean => {
      if (!dateStr) return false
      const d = parseQueueDate(dateStr)
      if (!d) return false

      if (dateMode === "calendar") {
        if (targetMonth === "all" && targetYear === "all") return true
        const mMatch =
          targetMonth === "all" || String(d.getMonth() + 1) === targetMonth
        const yMatch = targetYear === "all" || String(d.getFullYear()) === targetYear
        return mMatch && yMatch
      } else {
        // Custom Date Range mode (supports arbitrary dates, e.g. 25 Sep - 31 Oct)
        let validStart = true
        let validEnd = true
        if (customStartDate) {
          const s = new Date(customStartDate + "T00:00:00")
          validStart = d.getTime() >= s.getTime()
        }
        if (customEndDate) {
          const e = new Date(customEndDate + "T23:59:59.999")
          validEnd = d.getTime() <= e.getTime()
        }
        return validStart && validEnd
      }
    },
    [dateMode, customStartDate, customEndDate]
  )


  // Set of task keys already claimed in non-rejected claims
  const claimedTaskKeys = React.useMemo(() => {
    const set = new Set<string>()
    payoutClaims.forEach((c) => {
      if (c.status === "Rejected") return
      if (!c.queueitemids) return
      try {
        let items: any[] = []
        if (typeof c.queueitemids === "string") {
          if (c.queueitemids.startsWith("[") || c.queueitemids.startsWith("{")) {
            items = JSON.parse(c.queueitemids)
          } else {
            items = c.queueitemids.split(",").map((s: string) => s.trim())
          }
        } else if (Array.isArray(c.queueitemids)) {
          items = c.queueitemids
        }
        items.forEach((it: any) => {
          if (typeof it === "string") {
            set.add(it.toLowerCase())
          } else if (it && it.queueId && it.step) {
            set.add(`${it.queueId}_${it.step}`.toLowerCase())
          }
        })
      } catch {}
    })
    return set
  }, [payoutClaims])

  // Helper to parse start/end dates from a claim (handles startdate/enddate and fallback daterange)
  const getClaimPeriod = React.useCallback(
    (claim: any): { start: Date | null; end: Date | null; label: string } => {
      let s: Date | null = null
      let e: Date | null = null

      if (claim.startdate) {
        const d = new Date(claim.startdate + "T00:00:00")
        if (!isNaN(d.getTime())) s = d
      }
      if (claim.enddate) {
        const d = new Date(claim.enddate + "T23:59:59.999")
        if (!isNaN(d.getTime())) e = d
      }

      if ((!s || !e) && claim.daterange) {
        const matches = String(claim.daterange).match(/\d{4}-\d{2}-\d{2}/g)
        if (matches && matches.length >= 2) {
          if (!s) s = new Date(matches[0] + "T00:00:00")
          if (!e) e = new Date(matches[1] + "T23:59:59.999")
        }
      }

      const startLabel = s ? s.toLocaleDateString("th-TH") : claim.startdate || "?"
      const endLabel = e ? e.toLocaleDateString("th-TH") : claim.enddate || "?"
      const label = s && e ? `${startLabel} - ${endLabel}` : claim.daterange || "รอบเบิก"

      return { start: s, end: e, label }
    },
    []
  )

  // Previous non-rejected claims for the selected staff
  const staffPreviousClaims = React.useMemo(() => {
    if (!claimStaffName) return []
    const clean = claimStaffName.trim().toLowerCase()
    return payoutClaims.filter(
      (c) => (c.staffname || "").trim().toLowerCase() === clean && c.status !== "Rejected"
    )
  }, [claimStaffName, payoutClaims])

  // Automatically initialize claimStartDate to the day after the latest claim's end date
  React.useEffect(() => {
    if (!claimStaffName) return

    let maxEndTime = 0
    let latestEndStr = ""

    staffPreviousClaims.forEach((c) => {
      const p = getClaimPeriod(c)
      if (p.end && p.end.getTime() > maxEndTime) {
        maxEndTime = p.end.getTime()
        if (c.enddate) {
          latestEndStr = c.enddate
        } else {
          const d = p.end
          latestEndStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        }
      }
    })

    if (maxEndTime > 0 && latestEndStr) {
      // Add 1 day to the previous end date
      const prevEnd = new Date(latestEndStr + "T00:00:00")
      const nextDay = new Date(prevEnd.getTime() + 86400000)
      const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`
      setClaimStartDate(nextDayStr)

      const now = new Date()
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
      if (todayStr >= nextDayStr) {
        setClaimEndDate(todayStr)
      } else {
        setClaimEndDate(nextDayStr)
      }
    } else {
      const now = new Date()
      setClaimStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`)
      setClaimEndDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`)
    }
  }, [claimStaffName, staffPreviousClaims, getClaimPeriod])

  // Check if selected [claimStartDate, claimEndDate] overlaps with any previous claim for this staff
  const dateOverlapInfo = React.useMemo(() => {
    if (!claimStaffName || !claimStartDate || !claimEndDate) {
      return { hasOverlap: false, overlappingClaim: null, invalidRange: false, prevLabel: "" }
    }

    const currentStart = new Date(claimStartDate + "T00:00:00").getTime()
    const currentEnd = new Date(claimEndDate + "T23:59:59.999").getTime()

    if (isNaN(currentStart) || isNaN(currentEnd) || currentStart > currentEnd) {
      return { hasOverlap: false, overlappingClaim: null, invalidRange: true, prevLabel: "" }
    }

    for (const c of staffPreviousClaims) {
      const p = getClaimPeriod(c)
      if (p.start && p.end) {
        const prevStart = p.start.getTime()
        const prevEnd = p.end.getTime()

        // Overlap: currentStart <= prevEnd && currentEnd >= prevStart
        if (currentStart <= prevEnd && currentEnd >= prevStart) {
          return {
            hasOverlap: true,
            overlappingClaim: c,
            invalidRange: false,
            prevLabel: p.label,
          }
        }
      }
    }

    return { hasOverlap: false, overlappingClaim: null, invalidRange: false, prevLabel: "" }
  }, [claimStaffName, claimStartDate, claimEndDate, staffPreviousClaims, getClaimPeriod])

  // Helper to toggle expand/collapse for staff inline chapters
  const toggleExpandStaff = React.useCallback((staffNameLower: string) => {
    setExpandedStaffSet((prev) => {
      const next = new Set(prev)
      if (next.has(staffNameLower)) next.delete(staffNameLower)
      else next.add(staffNameLower)
      return next
    })
  }, [])

  // All completed, unclaimed work grouped by staff member
  const allStaffUnclaimedSummary = React.useMemo(() => {
    const startBoundary = claimStartDate ? new Date(claimStartDate + "T00:00:00").getTime() : null
    const endBoundary = claimEndDate ? new Date(claimEndDate + "T23:59:59.999").getTime() : null

    const isDateInRange = (dateStr: any) => {
      if (!dateStr) return false
      const d = parseQueueDate(dateStr)
      if (!d) return false
      const t = d.getTime()
      if (startBoundary && t < startBoundary) return false
      if (endBoundary && t > endBoundary) return false
      return true
    }

    interface StaffSummaryItem {
      staffName: string
      role: string
      uploadCount: number
      uploadCost: number
      extractCount: number
      extractCost: number
      translateCount: number
      translateCost: number
      typesetCount: number
      typesetCost: number
      totalChapters: number
      totalAmount: number
      tasks: Array<{
        queueid: string
        chapter: string
        mangaName: string
        step: string
        stepLabel: string
        date: string
        rate: number
        count: number
        cost: number
      }>
    }

    const staffMap = new Map<string, StaffSummaryItem>()

    const getOrCreateStaff = (rawName: string) => {
      const cleanName = (rawName || "").trim()
      const key = cleanName.toLowerCase()
      if (!staffMap.has(key)) {
        const member = (teamList || []).find(
          (m) => (m.name || "").trim().toLowerCase() === key
        )
        staffMap.set(key, {
          staffName: cleanName,
          role: member?.role || "Staff",
          uploadCount: 0,
          uploadCost: 0,
          extractCount: 0,
          extractCost: 0,
          translateCount: 0,
          translateCost: 0,
          typesetCount: 0,
          typesetCost: 0,
          totalChapters: 0,
          totalAmount: 0,
          tasks: [],
        })
      }
      return staffMap.get(key)!
    }

    queueItems.forEach((q) => {
      const count = getChapterCount(q.chapter)
      const manga = mangaList.find(
        (m) =>
          m.mangaid != null &&
          q.mangaid != null &&
          String(m.mangaid) === String(q.mangaid)
      )
      const mangaName = manga ? manga.manganame : "Unknown"

      // 1. Upload
      if (
        q.uploadername &&
        isStepDone(q.uploadstatus) &&
        q.uploadstatus !== "Skipped" &&
        q.uploadstatus !== "ข้าม" &&
        String(q.uploadstatus).toLowerCase() !== "skip"
      ) {
        const taskDate = q.uploadtime || q.createdat || ""
        if (isDateInRange(taskDate)) {
          const key = `${q.queueid}_upload`.toLowerCase()
          if (!claimedTaskKeys.has(key)) {
            const cost = count * rates.uploadRate
            const s = getOrCreateStaff(q.uploadername)
            s.uploadCount += count
            s.uploadCost += cost
            s.totalChapters += count
            s.totalAmount += cost
            s.tasks.push({
              queueid: String(q.queueid),
              chapter: String(q.chapter),
              mangaName,
              step: "upload",
              stepLabel: "อัป Raw",
              date: taskDate,
              rate: rates.uploadRate,
              count,
              cost,
            })
          }
        }
      }

      // 2. Extract
      if (
        q.extractorname &&
        isStepDone(q.extractstatus) &&
        q.extractstatus !== "Skipped" &&
        q.extractstatus !== "ข้าม" &&
        String(q.extractstatus).toLowerCase() !== "skip"
      ) {
        const taskDate = q.extracttime || q.createdat || ""
        if (isDateInRange(taskDate)) {
          const key = `${q.queueid}_extract`.toLowerCase()
          if (!claimedTaskKeys.has(key)) {
            const cost = count * rates.extractRate
            const s = getOrCreateStaff(q.extractorname)
            s.extractCount += count
            s.extractCost += cost
            s.totalChapters += count
            s.totalAmount += cost
            s.tasks.push({
              queueid: String(q.queueid),
              chapter: String(q.chapter),
              mangaName,
              step: "extract",
              stepLabel: "ดึงคำ",
              date: taskDate,
              rate: rates.extractRate,
              count,
              cost,
            })
          }
        }
      }

      // 3. Translate
      if (
        q.translatorname &&
        isStepDone(q.translatestatus) &&
        q.translatestatus !== "Skipped" &&
        q.translatestatus !== "ข้าม"
      ) {
        const taskDate = q.translatetime || q.createdat || ""
        if (isDateInRange(taskDate)) {
          const key = `${q.queueid}_translate`.toLowerCase()
          if (!claimedTaskKeys.has(key)) {
            const cleanName = (q.translatorname || "").trim().toLowerCase()
            const isSpecial = cleanName.includes(rates.translateSpecialName.toLowerCase())
            const rate = isSpecial ? rates.translateSpecialRate : rates.translateNormalRate
            const cost = count * rate
            const s = getOrCreateStaff(q.translatorname)
            s.translateCount += count
            s.translateCost += cost
            s.totalChapters += count
            s.totalAmount += cost
            s.tasks.push({
              queueid: String(q.queueid),
              chapter: String(q.chapter),
              mangaName,
              step: "translate",
              stepLabel: "แปล",
              date: taskDate,
              rate,
              count,
              cost: count * rate,
            })
          }
        }
      }

      // 4. Typeset
      if (
        q.typesettername &&
        isStepDone(q.typesetstatus) &&
        q.typesetstatus !== "Skipped" &&
        q.typesetstatus !== "ข้าม"
      ) {
        const taskDate = q.typesettime || q.createdat || ""
        if (isDateInRange(taskDate)) {
          const key = `${q.queueid}_typeset`.toLowerCase()
          if (!claimedTaskKeys.has(key)) {
            const cleanName = (q.typesettername || "").trim().toLowerCase()
            const isSpecial = cleanName.includes(rates.typesetSpecialName.toLowerCase())
            const rate = isSpecial ? rates.typesetSpecialRate : rates.typesetNormalRate
            const cost = count * rate
            const s = getOrCreateStaff(q.typesettername)
            s.typesetCount += count
            s.typesetCost += cost
            s.totalChapters += count
            s.totalAmount += cost
            s.tasks.push({
              queueid: String(q.queueid),
              chapter: String(q.chapter),
              mangaName,
              step: "typeset",
              stepLabel: "ลงคำ",
              date: taskDate,
              rate,
              count,
              cost,
            })
          }
        }
      }
    })

    const list = Array.from(staffMap.values())
    list.sort((a, b) => b.totalAmount - a.totalAmount)
    return list
  }, [queueItems, claimedTaskKeys, claimStartDate, claimEndDate, mangaList, rates, teamList])

  // Selected staff summary
  const selectedStaffSummary = React.useMemo(() => {
    if (!claimStaffName) return null
    const clean = claimStaffName.trim().toLowerCase()
    return allStaffUnclaimedSummary.find((s) => s.staffName.toLowerCase() === clean) || null
  }, [claimStaffName, allStaffUnclaimedSummary])

  // Completed work for the selected staff (or empty if overlapping/invalid)
  const unclaimedWork = React.useMemo(() => {
    if (!claimStaffName) return []
    if (dateOverlapInfo.hasOverlap || dateOverlapInfo.invalidRange) return []
    return selectedStaffSummary?.tasks || []
  }, [claimStaffName, selectedStaffSummary, dateOverlapInfo])

  const unclaimedTotals = React.useMemo(() => {
    return {
      chapters: selectedStaffSummary?.totalChapters || 0,
      amount: selectedStaffSummary?.totalAmount || 0,
    }
  }, [selectedStaffSummary])

  // Grand totals across all staff members
  const grandTotalsAllStaff = React.useMemo(() => {
    return allStaffUnclaimedSummary.reduce(
      (acc, s) => {
        acc.uploadCount += s.uploadCount
        acc.uploadCost += s.uploadCost
        acc.extractCount += s.extractCount
        acc.extractCost += s.extractCost
        acc.translateCount += s.translateCount
        acc.translateCost += s.translateCost
        acc.typesetCount += s.typesetCount
        acc.typesetCost += s.typesetCost
        acc.totalChapters += s.totalChapters
        acc.totalAmount += s.totalAmount
        acc.totalTasks += s.tasks.length
        return acc
      },
      {
        uploadCount: 0,
        uploadCost: 0,
        extractCount: 0,
        extractCost: 0,
        translateCount: 0,
        translateCost: 0,
        typesetCount: 0,
        typesetCost: 0,
        totalChapters: 0,
        totalAmount: 0,
        totalTasks: 0,
      }
    )
  }, [allStaffUnclaimedSummary])

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!claimStaffName) {
      toast.error("กรุณาเลือกชื่อพนักงาน")
      return
    }
    if (unclaimedWork.length === 0) {
      toast.error("ไม่มีงานที่ยังไม่ได้เบิกสำหรับพนักงานคนนี้")
      return
    }

    setSubmittingClaim(true)
    try {
      const staffMember = (teamList || []).find(
        (m) => (m.name || "").trim().toLowerCase() === claimStaffName.trim().toLowerCase()
      )
      const res = await callGasApi<{ success: boolean; claimId: string; claims?: any[] }>(
        "SUBMIT_PAYOUT_CLAIM",
        {
          staffName: claimStaffName,
          role: staffMember?.role || "Staff",
          totalChapters: unclaimedTotals.chapters,
          totalAmount: unclaimedTotals.amount,
          startDate: claimStartDate,
          endDate: claimEndDate,
          dateRange: `${claimStartDate} ถึง ${claimEndDate}`,
          queueItemIds: unclaimedWork.map((t) => ({
            queueId: t.queueid,
            step: t.step,
            chapter: t.chapter,
            mangaName: t.mangaName,
            amount: t.cost,
          })),
          note: claimNote.trim(),
        }
      )

      if (res && res.success) {
        toast.success(`สร้างใบขอเบิกเงินสำเร็จ! รหัส ${res.claimId}`)
        if (res.claims) setPayoutClaims(res.claims)
        else fetchPayoutClaims()
        setClaimNote("")
      } else {
        toast.error("สร้างใบขอเบิกไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการขอเบิก")
    } finally {
      setSubmittingClaim(false)
    }
  }

  const handleUpdateClaimStatus = async (
    claimId: string,
    status: "Approved" | "Paid" | "Rejected",
    note?: string
  ) => {
    setUpdatingClaimId(claimId)
    try {
      const res = await callGasApi<{ success: boolean; claims?: any[] }>(
        "UPDATE_PAYOUT_CLAIM_STATUS",
        {
          claimId,
          status,
          note: note || "",
        }
      )
      if (res && res.success) {
        const statusLabel =
          status === "Paid" ? "ยืนยันจ่ายเงินแล้ว" : status === "Approved" ? "อนุมัติเรียบร้อย" : "ปฏิเสธคำขอแล้ว"
        toast.success(`${statusLabel} (${claimId})`)
        if (res.claims) setPayoutClaims(res.claims)
        else fetchPayoutClaims()
        if (selectedClaimDetail && selectedClaimDetail.claimid === claimId) {
          setSelectedClaimDetail((prev: any) => ({ ...prev, status }))
        }
      } else {
        toast.error("อัปเดตสถานะไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการอัปเดตสถานะ")
    } finally {
      setUpdatingClaimId(null)
    }
  }

  const pendingClaimsCount = payoutClaims.filter((c) => c.status === "Pending").length

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
            {/* Mode Switcher: Calendar Month vs Custom Date Range */}
            <div className="flex items-center p-0.5 rounded-lg bg-[#0b1120] border border-[#26334d]">
              <button
                type="button"
                onClick={() => setDateMode("calendar")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  dateMode === "calendar"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Calendar className="h-3.5 w-3.5" /> เดือนปฏิทิน
              </button>
              <button
                type="button"
                onClick={() => setDateMode("custom")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  dateMode === "custom"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" /> กำหนดช่วงวันเอง
              </button>
            </div>

            {dateMode === "calendar" ? (
              <>
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
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">จาก:</span>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-9 w-36 bg-[#0b1120] border-[#26334d] text-xs text-slate-100 px-2"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">ถึง:</span>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-9 w-36 bg-[#0b1120] border-[#26334d] text-xs text-slate-100 px-2"
                  />
                </div>

                {/* Presets */}
                <div className="flex flex-wrap items-center gap-1 pl-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCustomStartDate("2026-09-25")
                      setCustomEndDate("2026-10-31")
                      toast.info("เลือกช่วง: รอบตัดยอด 25 ก.ย. - 31 ต.ค.")
                    }}
                    className="h-8 px-2.5 text-[11px] font-semibold border-amber-500/40 bg-amber-950/20 text-amber-300 hover:bg-amber-900/30"
                  >
                    รอบตัดยอด 25 (25 ก.ย. - 31 ต.ค.)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const d = new Date()
                      setCustomStartDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`)
                      setCustomEndDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
                      toast.info("เลือกช่วง: เดือนนี้ (1 - วันนี้)")
                    }}
                    className="h-8 px-2 text-[11px] text-slate-300 hover:text-white"
                  >
                    เดือนนี้ (1-วันนี้)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const now = new Date()
                      const past = new Date(Date.now() - 30 * 86400000)
                      setCustomStartDate(`${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`)
                      setCustomEndDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`)
                      toast.info("เลือกช่วง: ย้อนหลัง 30 วัน")
                    }}
                    className="h-8 px-2 text-[11px] text-slate-300 hover:text-white"
                  >
                    ย้อนหลัง 30 วัน
                  </Button>
                </div>
              </div>
            )}

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

        <button
          onClick={() => setActiveTab("claims")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
            activeTab === "claims"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>ระบบเบิกจ่ายค่าจ้าง (Payout Claims)</span>
          {pendingClaimsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500 text-slate-950 font-bold">
              {pendingClaimsCount}
            </span>
          )}
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

      {/* 3. Payout Claims Management (ระบบตัดยอดขอเบิกเงินและอนุมัติการจ่าย) */}
      {activeTab === "claims" && (
        <div className="space-y-6">
          {/* Top Overview Cards for Claims */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4 bg-[#111726] border-[#26334d]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">ใบขอเบิกรออนุมัติ</p>
                  <p className="text-2xl font-bold text-amber-400 mt-1">
                    {pendingClaimsCount} รายการ
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Clock className="h-6 w-6" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#111726] border-[#26334d]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">อนุมัติแล้ว (รอจ่าย)</p>
                  <p className="text-2xl font-bold text-sky-400 mt-1">
                    {payoutClaims.filter((c) => c.status === "Approved").length} รายการ
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <FileText className="h-6 w-6" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#111726] border-[#26334d]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">จ่ายเงินเรียบร้อยแล้ว (Paid)</p>
                  <p className="text-2xl font-bold text-emerald-400 mt-1">
                    {payoutClaims.filter((c) => c.status === "Paid").length} รายการ
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              </div>
            </Card>
          </div>

          {/* Section 1: Staff Self-Claim (ตัดยอดขอเบิกเงิน) */}
          <Card className="bg-[#111726] border-[#26334d]">
            <CardHeader className="pb-3 border-b border-[#26334d]/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Send className="h-4 w-4 text-emerald-400" />
                    ฝั่งพนักงาน: สรุปตัดยอดงานที่ทำเสร็จ & ขอเบิกเงิน
                  </CardTitle>
                  <p className="text-xs text-slate-400 mt-1">
                    เลือกชื่อพนักงานเพื่อดึงงานที่ทำเสร็จแต่ยังไม่ได้ตัดยอดขอเบิกเงิน (ป้องกันการเบิกซ้ำ 100%)
                  </p>
                </div>
                {claimStaffName && unclaimedTotals.chapters > 0 && (
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold px-3 py-1 text-sm">
                    ยอดขอเบิก: ฿{unclaimedTotals.amount.toLocaleString()} ({unclaimedTotals.chapters} ตอน)
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <form onSubmit={handleSubmitClaim} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300 font-semibold">
                      👤 เลือกชื่อพนักงานขอเบิก:
                    </Label>
                    <select
                      className="h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 text-sm text-slate-100 font-medium"
                      value={claimStaffName}
                      onChange={(e) => setClaimStaffName(e.target.value)}
                    >
                      <option value="">-- เลือกพนักงาน --</option>
                      {(teamList || [])
                        .filter((m) => m.status === "Active")
                        .map((m) => (
                          <option key={m.memberid} value={m.name}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300 font-semibold flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                      📅 วันเริ่มต้น (Start Date):
                    </Label>
                    <Input
                      type="date"
                      value={claimStartDate}
                      onChange={(e) => setClaimStartDate(e.target.value)}
                      className="h-10 bg-[#0b1120] border-[#26334d] text-sm text-slate-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300 font-semibold flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                      📅 วันสิ้นสุด (End Date):
                    </Label>
                    <Input
                      type="date"
                      value={claimEndDate}
                      onChange={(e) => setClaimEndDate(e.target.value)}
                      className="h-10 bg-[#0b1120] border-[#26334d] text-sm text-slate-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300">
                      📝 โน้ต / บัญชีรับเงิน:
                    </Label>
                    <Input
                      placeholder="เช่น ธ.กสิกร 123-xxx-xxx"
                      value={claimNote}
                      onChange={(e) => setClaimNote(e.target.value)}
                      className="h-10 bg-[#0b1120] border-[#26334d] text-sm"
                    />
                  </div>
                </div>

                {/* Locked Past Claimed Cycles for this Staff */}
                {claimStaffName && staffPreviousClaims.length > 0 && (
                  <div className="p-3 rounded-lg border border-slate-700/60 bg-[#0b1120] text-xs space-y-2">
                    <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                      <Lock className="h-3.5 w-3.5 text-amber-400" />
                      <span>🔒 รอบการเบิกที่ผ่านมาของ {claimStaffName} (ล็อคแล้ว ห้ามเบิกซ้ำ):</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {staffPreviousClaims.map((c) => {
                        const p = getClaimPeriod(c)
                        const statusText =
                          c.status === "Paid"
                            ? "จ่ายแล้ว"
                            : c.status === "Approved"
                            ? "อนุมัติแล้ว"
                            : "รออนุมัติ"
                        const statusColor =
                          c.status === "Paid"
                            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                            : c.status === "Approved"
                            ? "border-sky-500/40 text-sky-300 bg-sky-500/10"
                            : "border-amber-500/40 text-amber-300 bg-amber-500/10"

                        return (
                          <Badge
                            key={c.claimid}
                            variant="outline"
                            className={`text-[11px] px-2.5 py-1 gap-1.5 font-medium ${statusColor}`}
                          >
                            <span>📅 {p.label}</span>
                            <span className="opacity-80 font-bold">({statusText})</span>
                          </Badge>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Date Overlap Alert */}
                {dateOverlapInfo.hasOverlap && (
                  <div className="p-3.5 rounded-lg border border-red-500/50 bg-red-950/40 text-red-200 text-xs flex items-start gap-2.5 shadow-md">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-red-100 text-sm">
                        ⚠️ ช่วงวันที่เลือกทับซ้อนกับรอบที่เบิกไปแล้ว (ไม่สามารถเบิกซ้ำได้)
                      </p>
                      <p className="text-xs text-red-300">
                        ช่วง <strong>{dateOverlapInfo.prevLabel || dateOverlapInfo.overlappingClaim?.daterange}</strong> ({dateOverlapInfo.overlappingClaim?.claimid}) ถูกล็อคไว้เพราะเบิกแล้ว กรุณาเลือกวันเริ่มต้นหลังจากรอบนี้
                      </p>
                    </div>
                  </div>
                )}

                {/* Invalid Date Range Warning */}
                {dateOverlapInfo.invalidRange && (
                  <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-950/30 text-amber-200 text-xs flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>วันเริ่มต้นต้องไม่มากกว่าวันสิ้นสุด</span>
                  </div>
                )}

                {/* Unclaimed Work Section Header with View Mode Switcher */}
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-100">
                        📋 รายการงานที่ทำเสร็จและยังไม่เคยเบิก ({grandTotalsAllStaff.totalTasks} รายการ):
                      </span>
                      {grandTotalsAllStaff.totalTasks > 0 && (
                        <span className="text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                          รวม {grandTotalsAllStaff.totalChapters} ตอน = ฿{grandTotalsAllStaff.totalAmount.toLocaleString()} บาท ({allStaffUnclaimedSummary.length} คน)
                        </span>
                      )}
                    </div>

                    {/* View Switcher: Summary by Person vs Detailed Chapter List */}
                    <div className="flex items-center p-0.5 rounded-lg bg-[#0b1120] border border-[#26334d]">
                      <button
                        type="button"
                        onClick={() => setUnclaimedViewMode("summary")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                          unclaimedViewMode === "summary"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        📊 ตารางสรุปรายคน ({allStaffUnclaimedSummary.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUnclaimedViewMode("detailed")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                          unclaimedViewMode === "detailed"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        📋 รายตอน ({claimStaffName ? `${claimStaffName} (${unclaimedWork.length})` : `ทั้งหมด (${grandTotalsAllStaff.totalTasks})`})
                      </button>
                    </div>
                  </div>

                  {allStaffUnclaimedSummary.length === 0 ? (
                    <div className="rounded-lg border border-slate-800 bg-[#0b1120] p-6 text-center text-sm text-slate-400">
                      🎉 ไม่มีงานค้างเบิกในช่วงเวลาที่เลือก (เบิกครบทั้งหมดแล้ว หรือยังไม่มีงานที่ทำเสร็จ)
                    </div>
                  ) : unclaimedViewMode === "summary" ? (
                    /* 1. PER-PERSON SUMMARY TABLE */
                    <div className="rounded-lg border border-[#26334d] overflow-hidden">
                      <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <Table>
                          <TableHeader className="bg-[#0d1322] sticky top-0 z-10">
                            <TableRow className="border-[#26334d]">
                              <TableHead className="text-xs text-slate-300 font-semibold">พนักงาน</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">อัป Raw</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">ดึงคำ</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">แปล</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">ลงคำ</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">รวมตอน</TableHead>
                              <TableHead className="text-xs text-slate-300 text-right">ยอดค้างเบิก (฿)</TableHead>
                              <TableHead className="text-xs text-slate-300 text-center">จัดการ</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allStaffUnclaimedSummary.map((s) => {
                              const isSelected = claimStaffName && claimStaffName.trim().toLowerCase() === s.staffName.toLowerCase()
                              const isExpanded = expandedStaffSet.has(s.staffName.toLowerCase())

                              return (
                                <React.Fragment key={s.staffName}>
                                  <TableRow
                                    className={`border-[#26334d]/60 text-xs transition-colors ${
                                      isSelected
                                        ? "bg-indigo-950/40 border-l-4 border-l-indigo-500"
                                        : "hover:bg-[#151d2f]/60"
                                    }`}
                                  >
                                    <TableCell className="font-bold text-slate-200">
                                      <div className="flex items-center gap-1.5">
                                        <span>{s.staffName}</span>
                                        <Badge variant="outline" className="text-[10px] border-slate-700 bg-slate-800/80">
                                          {s.role}
                                        </Badge>
                                        {isSelected && (
                                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px] px-1.5 py-0 font-bold">
                                            เลือกอยู่
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>

                                    <TableCell className="text-center text-slate-300 font-mono">
                                      {s.uploadCount > 0 ? (
                                        <div>
                                          <span className="font-semibold">{s.uploadCount} ตอน</span>
                                          <span className="block text-[10px] text-indigo-300/80">฿{s.uploadCost.toLocaleString()}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">-</span>
                                      )}
                                    </TableCell>

                                    <TableCell className="text-center text-slate-300 font-mono">
                                      {s.extractCount > 0 ? (
                                        <div>
                                          <span className="font-semibold">{s.extractCount} ตอน</span>
                                          <span className="block text-[10px] text-orange-300/80">฿{s.extractCost.toLocaleString()}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">-</span>
                                      )}
                                    </TableCell>

                                    <TableCell className="text-center text-slate-300 font-mono">
                                      {s.translateCount > 0 ? (
                                        <div>
                                          <span className="font-semibold text-pink-300">{s.translateCount} ตอน</span>
                                          <span className="block text-[10px] text-pink-300/80">฿{s.translateCost.toLocaleString()}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">-</span>
                                      )}
                                    </TableCell>

                                    <TableCell className="text-center text-slate-300 font-mono">
                                      {s.typesetCount > 0 ? (
                                        <div>
                                          <span className="font-semibold text-amber-300">{s.typesetCount} ตอน</span>
                                          <span className="block text-[10px] text-amber-300/80">฿{s.typesetCost.toLocaleString()}</span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">-</span>
                                      )}
                                    </TableCell>

                                    <TableCell className="text-center">
                                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold text-xs">
                                        {s.totalChapters} ตอน
                                      </Badge>
                                    </TableCell>

                                    <TableCell className="text-right font-bold text-emerald-400 text-sm font-mono">
                                      ฿{s.totalAmount.toLocaleString()}
                                    </TableCell>

                                    <TableCell className="text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant={isSelected ? "default" : "outline"}
                                          onClick={() => setClaimStaffName(s.staffName)}
                                          className={`h-7 px-2.5 text-[11px] font-semibold cursor-pointer ${
                                            isSelected
                                              ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                              : "border-[#26334d] text-slate-300 hover:text-white hover:bg-slate-800"
                                          }`}
                                        >
                                          {isSelected ? "✅ เลือกแล้ว" : "👤 เลือกคนนี้"}
                                        </Button>

                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => toggleExpandStaff(s.staffName.toLowerCase())}
                                          className="h-7 px-2 text-[11px] text-slate-400 hover:text-white gap-1 cursor-pointer"
                                          title="คลิกเพื่อดูรายการตอนย่อยของคนนี้"
                                        >
                                          {isExpanded ? (
                                            <>
                                              <ChevronUp className="h-3 w-3" /> ย่อ
                                            </>
                                          ) : (
                                            <>
                                              <ChevronDown className="h-3 w-3" /> ดูตอน ({s.tasks.length})
                                            </>
                                          )}
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>

                                  {/* Inline Expanded Chapters Table */}
                                  {isExpanded && (
                                    <TableRow className="bg-[#0b0f19] border-[#26334d]/60">
                                      <TableCell colSpan={8} className="p-3">
                                        <div className="rounded-md border border-[#26334d]/80 bg-[#0d1322] p-2.5 space-y-2">
                                          <div className="flex items-center justify-between text-xs text-slate-300">
                                            <span className="font-semibold text-slate-200">
                                              📖 รายละเอียดตอนค้างเบิกของ {s.staffName} ({s.tasks.length} ตอน):
                                            </span>
                                            <span className="text-emerald-400 font-bold">
                                              รวม ฿{s.totalAmount.toLocaleString()} บาท
                                            </span>
                                          </div>
                                          <div className="max-h-48 overflow-y-auto rounded border border-[#26334d]/60">
                                            <Table>
                                              <TableHeader className="bg-[#0b0f19] sticky top-0">
                                                <TableRow className="border-[#26334d]/60 text-[11px]">
                                                  <TableHead className="text-slate-400 py-1.5">เรื่อง</TableHead>
                                                  <TableHead className="text-slate-400 text-center py-1.5">ตอน</TableHead>
                                                  <TableHead className="text-slate-400 py-1.5">ขั้นตอน</TableHead>
                                                  <TableHead className="text-slate-400 text-right py-1.5">เรท (฿)</TableHead>
                                                  <TableHead className="text-slate-400 text-right py-1.5">ค่าแรง (฿)</TableHead>
                                                  <TableHead className="text-slate-400 text-right py-1.5">เวลาส่งงาน</TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {s.tasks.map((t, idx) => (
                                                  <TableRow key={`${t.queueid}_${t.step}_${idx}`} className="border-[#26334d]/40 text-xs hover:bg-[#151d2f]/40">
                                                    <TableCell className="font-medium text-slate-200 py-1.5">{t.mangaName}</TableCell>
                                                    <TableCell className="text-center font-bold text-amber-300 py-1.5">#{t.chapter}</TableCell>
                                                    <TableCell className="py-1.5">
                                                      <Badge variant="outline" className="text-[10px] border-slate-700 bg-slate-800/80">
                                                        {t.stepLabel}
                                                      </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right text-slate-400 py-1.5">฿{t.rate}</TableCell>
                                                    <TableCell className="text-right font-bold text-emerald-400 py-1.5">฿{t.cost.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-slate-500 font-mono text-[11px] py-1.5">
                                                      {t.date ? new Date(t.date).toLocaleDateString("th-TH") : "-"}
                                                    </TableCell>
                                                  </TableRow>
                                                ))}
                                              </TableBody>
                                            </Table>
                                          </div>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </React.Fragment>
                              )
                            })}
                          </TableBody>

                          {/* Grand Total Footer */}
                          <tfoot className="bg-[#0d1322] border-t-2 border-[#26334d] font-bold text-xs sticky bottom-0">
                            <TableRow className="border-transparent">
                              <TableCell className="text-slate-200">
                                รวมทั้งหมด ({allStaffUnclaimedSummary.length} คน)
                              </TableCell>
                              <TableCell className="text-center text-slate-300 font-mono">
                                <div>
                                  <span>{grandTotalsAllStaff.uploadCount} ตอน</span>
                                  <span className="block text-[10px] text-indigo-300/80">฿{grandTotalsAllStaff.uploadCost.toLocaleString()}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-slate-300 font-mono">
                                <div>
                                  <span>{grandTotalsAllStaff.extractCount} ตอน</span>
                                  <span className="block text-[10px] text-orange-300/80">฿{grandTotalsAllStaff.extractCost.toLocaleString()}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-slate-300 font-mono">
                                <div>
                                  <span className="text-pink-300">{grandTotalsAllStaff.translateCount} ตอน</span>
                                  <span className="block text-[10px] text-pink-300/80">฿{grandTotalsAllStaff.translateCost.toLocaleString()}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-slate-300 font-mono">
                                <div>
                                  <span className="text-amber-300">{grandTotalsAllStaff.typesetCount} ตอน</span>
                                  <span className="block text-[10px] text-amber-300/80">฿{grandTotalsAllStaff.typesetCost.toLocaleString()}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center text-amber-300 font-bold">
                                {grandTotalsAllStaff.totalChapters} ตอน
                              </TableCell>
                              <TableCell className="text-right text-emerald-400 font-bold text-sm font-mono">
                                ฿{grandTotalsAllStaff.totalAmount.toLocaleString()}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          </tfoot>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    /* 2. CHAPTER-BY-CHAPTER DETAILED TABLE */
                    <div className="rounded-lg border border-[#26334d] overflow-hidden max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-[#0d1322] sticky top-0 z-10">
                          <TableRow className="border-[#26334d]">
                            <TableHead className="text-xs text-slate-400">พนักงาน</TableHead>
                            <TableHead className="text-xs text-slate-400">เรื่อง</TableHead>
                            <TableHead className="text-xs text-slate-400 text-center">ตอน</TableHead>
                            <TableHead className="text-xs text-slate-400">ขั้นตอน</TableHead>
                            <TableHead className="text-xs text-slate-400 text-right">เรท (฿)</TableHead>
                            <TableHead className="text-xs text-slate-400 text-right">ค่าแรง (฿)</TableHead>
                            <TableHead className="text-xs text-slate-400 text-right">เวลาส่งงาน</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(claimStaffName ? unclaimedWork : allStaffUnclaimedSummary.flatMap((s) => s.tasks.map((t) => ({ ...t, staffName: s.staffName })))).map((t: any, idx) => (
                            <TableRow key={`${t.queueid}_${t.step}_${idx}`} className="border-[#26334d]/60 hover:bg-[#151d2f]/60 text-xs">
                              <TableCell className="font-bold text-slate-300">{t.staffName || claimStaffName}</TableCell>
                              <TableCell className="font-medium text-slate-200">{t.mangaName}</TableCell>
                              <TableCell className="text-center font-bold text-amber-300">#{t.chapter}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px] border-slate-700 bg-slate-800/80">
                                  {t.stepLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-slate-400">฿{t.rate}</TableCell>
                              <TableCell className="text-right font-bold text-emerald-400">฿{t.cost.toLocaleString()}</TableCell>
                              <TableCell className="text-right text-slate-500 font-mono text-[11px]">
                                {t.date ? new Date(t.date).toLocaleDateString("th-TH") : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Submission Action Bar */}
                  {claimStaffName ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-950/25 mt-3 shadow-md">
                      <div className="text-xs">
                        <span className="text-slate-300">👤 กำลังทำรายการเบิกให้: </span>
                        <strong className="text-slate-100 text-sm">{claimStaffName}</strong>
                        {unclaimedTotals.chapters > 0 ? (
                          <span className="text-emerald-400 font-bold ml-2">
                            (รวม {unclaimedTotals.chapters} ตอน = ฿{unclaimedTotals.amount.toLocaleString()} บาท)
                          </span>
                        ) : (
                          <span className="text-amber-300 ml-2">(ไม่มีงานค้างเบิกในช่วงนี้)</span>
                        )}
                      </div>

                      <Button
                        type="submit"
                        disabled={submittingClaim || dateOverlapInfo.hasOverlap || dateOverlapInfo.invalidRange || unclaimedWork.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-lg shadow-emerald-600/30 disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="h-4 w-4" />
                        {submittingClaim
                          ? "กำลังส่งคำขอเบิก..."
                          : dateOverlapInfo.hasOverlap
                          ? "ไม่สามารถเบิกได้ (ช่วงวันที่ทับซ้อน)"
                          : `ตัดยอดขอเบิกเงินของ ${claimStaffName} (฿${unclaimedTotals.amount.toLocaleString()} บาท)`}
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-800 bg-[#0b1120]/40 p-4 text-center text-xs text-slate-400 mt-2">
                      👈 กดปุ่ม <strong className="text-slate-200">"👤 เลือกคนนี้"</strong> ในตารางสรุปด้านบน หรือเลือกชื่อพนักงานจาก Dropdown เพื่อดำเนินการตัดยอดขอเบิกเงิน
                    </div>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Section 2: Admin Approvals (ประวัติใบขอเบิกเงิน & อนุมัติการจ่าย) */}
          <Card className="bg-[#111726] border-[#26334d]">
            <CardHeader className="pb-3 border-b border-[#26334d]/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-sky-400" />
                  ฝั่งแอดมิน: ประวัติใบขอเบิกเงิน & อนุมัติการจ่าย (Payout History & Approvals)
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchPayoutClaims}
                  disabled={loadingClaims}
                  className="h-8 text-xs text-slate-300 hover:text-white gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingClaims ? "animate-spin text-amber-400" : ""}`} />
                  รีเฟรชคำขอ
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingClaims && payoutClaims.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  กำลังโหลดข้อมูลคำขอเบิกเงิน...
                </div>
              ) : payoutClaims.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  ยังไม่มีประวัติใบขอเบิกเงินในระบบ
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-[#0d1322]">
                      <TableRow className="border-[#26334d]">
                        <TableHead className="text-xs text-slate-400">Claim ID</TableHead>
                        <TableHead className="text-xs text-slate-400">วันที่ขอ</TableHead>
                        <TableHead className="text-xs text-slate-400">พนักงาน</TableHead>
                        <TableHead className="text-xs text-slate-400">รอบเวลา</TableHead>
                        <TableHead className="text-xs text-slate-400 text-center">จำนวนตอน</TableHead>
                        <TableHead className="text-xs text-slate-400 text-right">ยอดเงิน (฿)</TableHead>
                        <TableHead className="text-xs text-slate-400 text-center">สถานะ</TableHead>
                        <TableHead className="text-xs text-slate-400 text-center">การจัดการ (แอดมิน)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payoutClaims.map((claim) => {
                        const isPending = claim.status === "Pending"
                        const isApproved = claim.status === "Approved"
                        const isPaid = claim.status === "Paid"
                        const isRejected = claim.status === "Rejected"

                        return (
                          <TableRow key={claim.claimid} className="border-[#26334d]/60 hover:bg-[#151d2f]/50 text-xs">
                            <TableCell className="font-mono text-slate-400">{claim.claimid}</TableCell>
                            <TableCell className="text-slate-300">
                              {claim.createdat ? new Date(claim.createdat).toLocaleDateString("th-TH") : "-"}
                            </TableCell>
                            <TableCell className="font-bold text-slate-200">
                              {claim.staffname}
                              <span className="block text-[10px] text-slate-400 font-normal">{claim.role}</span>
                            </TableCell>
                            <TableCell className="text-slate-300">
                              {claim.startdate && claim.enddate
                                ? `${claim.startdate} ถึง ${claim.enddate}`
                                : claim.daterange || "-"}
                            </TableCell>
                            <TableCell className="text-center font-bold text-amber-300">
                              {claim.totalchapters} ตอน
                            </TableCell>
                            <TableCell className="text-right font-bold text-emerald-400 text-sm">
                              ฿{Number(claim.totalamount || 0).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-center">
                              {isPending && (
                                <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/40 text-[10px]">
                                  🟡 รออนุมัติ
                                </Badge>
                              )}
                              {isApproved && (
                                <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/40 text-[10px]">
                                  🔵 อนุมัติแล้ว (รอจ่าย)
                                </Badge>
                              )}
                              {isPaid && (
                                <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px]">
                                  🟢 จ่ายเงินแล้ว
                                </Badge>
                              )}
                              {isRejected && (
                                <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/40 text-[10px]">
                                  🔴 ปฏิเสธ
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedClaimDetail(claim)}
                                  className="h-7 px-2 text-[11px] gap-1 text-slate-300 hover:text-white"
                                  title="ดูรายละเอียดตอนในใบขอเบิกนี้"
                                >
                                  <Eye className="h-3 w-3" /> ดูตอน
                                </Button>

                                {isPending && (
                                  <>
                                    <Button
                                      size="sm"
                                      disabled={updatingClaimId === claim.claimid}
                                      onClick={() => handleUpdateClaimStatus(claim.claimid, "Approved")}
                                      className="h-7 px-2 text-[11px] bg-sky-600 hover:bg-sky-700 text-white"
                                    >
                                      อนุมัติ
                                    </Button>
                                    <Button
                                      size="sm"
                                      disabled={updatingClaimId === claim.claimid}
                                      onClick={() => handleUpdateClaimStatus(claim.claimid, "Paid")}
                                      className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                      จ่ายแล้ว
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={updatingClaimId === claim.claimid}
                                      onClick={() => handleUpdateClaimStatus(claim.claimid, "Rejected")}
                                      className="h-7 px-2 text-[11px]"
                                    >
                                      ปฏิเสธ
                                    </Button>
                                  </>
                                )}

                                {isApproved && (
                                  <Button
                                    size="sm"
                                    disabled={updatingClaimId === claim.claimid}
                                    onClick={() => handleUpdateClaimStatus(claim.claimid, "Paid")}
                                    className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                  >
                                    ยืนยันจ่ายแล้ว
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Claim Detail Modal */}
      <Dialog open={Boolean(selectedClaimDetail)} onOpenChange={(v) => !v && setSelectedClaimDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <FileText className="h-5 w-5 text-emerald-400" />
              รายละเอียดใบขอเบิกเงิน: {selectedClaimDetail?.claimid}
            </DialogTitle>
          </DialogHeader>

          {selectedClaimDetail && (
            <div className="space-y-4 my-2 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-[#0b1120] border border-[#26334d] text-xs">
                <div>
                  <span className="text-slate-400 block">พนักงาน:</span>
                  <span className="font-bold text-slate-200">{selectedClaimDetail.staffname}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">รอบเวลา:</span>
                  <span className="font-semibold text-slate-200">
                    {selectedClaimDetail.startdate && selectedClaimDetail.enddate
                      ? `${selectedClaimDetail.startdate} ถึง ${selectedClaimDetail.enddate}`
                      : selectedClaimDetail.daterange || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">ยอดรวม:</span>
                  <span className="font-bold text-emerald-400 text-sm">
                    ฿{Number(selectedClaimDetail.totalamount || 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">สถานะ:</span>
                  <span className="font-bold">
                    {selectedClaimDetail.status === "Paid"
                      ? "🟢 จ่ายเงินแล้ว"
                      : selectedClaimDetail.status === "Approved"
                      ? "🔵 อนุมัติแล้ว"
                      : selectedClaimDetail.status === "Pending"
                      ? "🟡 รออนุมัติ"
                      : "🔴 ปฏิเสธ"}
                  </span>
                </div>
              </div>

              {selectedClaimDetail.note && (
                <div className="p-2.5 rounded-lg bg-[#0b1120]/60 border border-[#26334d] text-xs">
                  <span className="text-slate-400 font-semibold">โน้ต: </span>
                  <span className="text-slate-200">{selectedClaimDetail.note}</span>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300">
                  รายการตอนที่ขอเบิกในใบนี้:
                </span>
                <div className="rounded-lg border border-[#26334d] overflow-hidden max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader className="bg-[#0d1322] sticky top-0">
                      <TableRow className="border-[#26334d]">
                        <TableHead className="text-xs text-slate-400">เรื่อง</TableHead>
                        <TableHead className="text-xs text-slate-400 text-center">ตอน</TableHead>
                        <TableHead className="text-xs text-slate-400">ขั้นตอน</TableHead>
                        <TableHead className="text-xs text-slate-400 text-right">ค่าแรง</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        let parsed: any[] = []
                        try {
                          if (selectedClaimDetail.queueitemids) {
                            if (typeof selectedClaimDetail.queueitemids === "string") {
                              parsed = JSON.parse(selectedClaimDetail.queueitemids)
                            } else if (Array.isArray(selectedClaimDetail.queueitemids)) {
                              parsed = selectedClaimDetail.queueitemids
                            }
                          }
                        } catch {}
                        if (parsed.length === 0) {
                          return (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-xs text-slate-400 py-4">
                                ไม่มีรายการรายละเอียดตอน
                              </TableCell>
                            </TableRow>
                          )
                        }
                        return parsed.map((item, i) => (
                          <TableRow key={i} className="border-[#26334d]/60 text-xs">
                            <TableCell className="font-medium text-slate-200">
                              {item.mangaName || "Manga"}
                            </TableCell>
                            <TableCell className="text-center font-bold text-amber-300">
                              #{item.chapter}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] border-slate-700">
                                {item.step}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-bold text-emerald-400">
                              ฿{Number(item.amount || 0).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between gap-2 border-t border-[#26334d] pt-3">
            <Button variant="outline" size="sm" onClick={() => setSelectedClaimDetail(null)}>
              ปิดหน้าต่าง
            </Button>
            {selectedClaimDetail && selectedClaimDetail.status === "Pending" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleUpdateClaimStatus(selectedClaimDetail.claimid, "Approved")}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  อนุมัติ
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleUpdateClaimStatus(selectedClaimDetail.claimid, "Paid")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  ยืนยันจ่ายเงินแล้ว
                </Button>
              </div>
            )}
            {selectedClaimDetail && selectedClaimDetail.status === "Approved" && (
              <Button
                size="sm"
                onClick={() => handleUpdateClaimStatus(selectedClaimDetail.claimid, "Paid")}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
              >
                ยืนยันจ่ายเงินแล้ว
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

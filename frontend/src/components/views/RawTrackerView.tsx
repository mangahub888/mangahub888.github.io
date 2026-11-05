import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { callGasApi } from "@/api/gasClient"
import {
  isUrgentManga,
  parseChapterNumber,
  formatChapterDisplay,
  sanitizeTrackerStatus,
} from "@/lib/utils"

export { parseChapterNumber, formatChapterDisplay, sanitizeTrackerStatus }
import { toast } from "sonner"
import { AutoRawPipelineModal } from "@/components/modals/AutoRawPipelineModal"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"
import {
  Radio,
  RefreshCw,
  Plus,
  ExternalLink,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Pencil,
  Trash2,
  Send,
  Zap,
  Check,
  Globe,
  Bell,
  Play,
  ArrowRight,
  Filter,
  LayoutGrid,
  List,
  Flame,
  ArrowUpDown,
  QrCode,
  RotateCcw,
} from "lucide-react"

export interface RawTrackerItem {
  trackerid: string
  mangaid?: string | number
  manganame?: string
  url: string
  pattern?: string
  lastrawtext?: string
  lastrawcount?: number | string
  status?: string
  lastchecked?: string
  updatedat?: string
  autocheck?: boolean | string
  currentChapter?: string | number
  currentchapter?: string | number
}

interface RawTrackerViewProps {
  mangaList: any[]
  onOpenAddQueueWithManga: (mangaId: string, nextChapter?: string) => void
  onOpenKuaikanModal?: () => void
}

export function RawTrackerView({
  mangaList,
  onOpenAddQueueWithManga,
  onOpenKuaikanModal,
}: RawTrackerViewProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "urgent_new" | "new" | "current" | "error"
  >("all")
  const [viewMode, setViewMode] = React.useState<"cards" | "table">("cards")
  const [sortBy, setSortBy] = React.useState<
    "urgent_first" | "name" | "recent"
  >("urgent_first")
  const [checkingAll, setCheckingAll] = React.useState(false)
  const [singleCheckingId, setSingleCheckingId] = React.useState<string | null>(
    null
  )

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingItem, setEditingItem] = React.useState<RawTrackerItem | null>(
    null
  )

  // Auto Raw Pipeline modal state
  const [pipelineModalOpen, setPipelineModalOpen] = React.useState(false)
  const [pipelineTargetTrackerId, setPipelineTargetTrackerId] = React.useState<string | null>(null)

  // Real-time GitHub Actions Status & Auto Tracker Status
  const {
    isRawTrackerRunning,
    activeRawTrackerRun,
    latestRawTrackerRun,
    refetch: refetchActions,
  } = useGitHubActionsStatus()

  const { data: autoTrackerStatus, refetch: refetchAutoStatus } = useQuery<any>({
    queryKey: ["autoTrackerStatus"],
    queryFn: () => callGasApi("GET_AUTO_TRACKER_STATUS"),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const [triggeringPipeline, setTriggeringPipeline] = React.useState(false)

  const handleTriggerPipelineNow = async () => {
    setTriggeringPipeline(true)
    toast.loading("กำลังสั่งให้ GAS ตรวจสอบและรัน GitAction Pipeline...", { id: "trigger-pipe" })
    try {
      const res = await callGasApi("TRIGGER_RAW_TRACKER_PIPELINE", { source: "manual_ui" })
      if (res && res.success) {
        toast.success("สั่งรัน GitAction Raw Tracker Pipeline สำเร็จ!", { id: "trigger-pipe" })
        refetchActions()
        refetchAutoStatus()
      } else {
        toast.error(res?.error || "ไม่สามารถสั่งรัน Pipeline ได้", { id: "trigger-pipe" })
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการสั่งรัน Pipeline", { id: "trigger-pipe" })
    } finally {
      setTriggeringPipeline(false)
    }
  }
  const [formMangaId, setFormMangaId] = React.useState("")
  const [formMangaName, setFormMangaName] = React.useState("")
  const [formUrl, setFormUrl] = React.useState("")
  const [formPattern, setFormPattern] = React.useState("")
  const [formCurrentChapter, setFormCurrentChapter] = React.useState("")
  const [formAutoCheck, setFormAutoCheck] = React.useState(true)
  const [syncingTrackerId, setSyncingTrackerId] = React.useState<string | null>(null)

  // Test scrape state inside Modal
  const [testingScrape, setTestingScrape] = React.useState(false)
  const [testScrapeResult, setTestScrapeResult] = React.useState<{
    success: boolean
    rawText?: string
    chapterCount?: number
    error?: string
  } | null>(null)

  // Query: Fetch Raw Trackers
  const {
    data: trackers = [],
    isLoading,
    refetch,
  } = useQuery<RawTrackerItem[]>({
    queryKey: ["rawTrackersList"],
    queryFn: async () => {
      const res = await callGasApi<any>("GET_RAW_TRACKER_LIST")
      return Array.isArray(res) ? res : (res?.list || [])
    },
    staleTime: 60 * 1000,
  })

  // Open Add Modal
  const handleOpenAddModal = (manga?: any) => {
    setEditingItem(null)
    setTestScrapeResult(null)
    if (manga) {
      setFormMangaId(String(manga.mangaid || ""))
      setFormMangaName(manga.manganame || "")
      setFormUrl(manga.originalurl || "")
      setFormCurrentChapter(manga.lastchapter !== undefined ? String(manga.lastchapter) : "")
    } else {
      setFormMangaId("")
      setFormMangaName("")
      setFormUrl("")
      setFormCurrentChapter("")
    }
    setFormPattern("")
    setFormAutoCheck(true)
    setModalOpen(true)
  }

  // Open Edit Modal
  const handleOpenEditModal = (item: RawTrackerItem) => {
    setEditingItem(item)
    setTestScrapeResult(null)
    setFormMangaId(String(item.mangaid || ""))
    setFormMangaName(item.manganame || "")
    setFormUrl(item.url || "")
    setFormPattern(item.pattern || "")
    setFormCurrentChapter(String(item.currentChapter || item.currentchapter || ""))
    setFormAutoCheck(
      item.autocheck !== undefined && String(item.autocheck).toLowerCase() !== "false"
    )
    setModalOpen(true)
  }

  // Live Test Scrape Button inside modal
  const handleTestScrape = async () => {
    if (!formUrl || !formUrl.trim().startsWith("http")) {
      toast.error("กรุณาระบุ URL ต้นฉบับที่ขึ้นต้นด้วย http:// หรือ https://")
      return
    }
    setTestingScrape(true)
    setTestScrapeResult(null)
    try {
      const res = await callGasApi("SCRAPE_RAW_URL", {
        url: formUrl.trim(),
        pattern: formPattern.trim(),
      })
      if (res && res.success) {
        setTestScrapeResult({
          success: true,
          rawText: res.rawText,
          chapterCount: res.chapterCount,
        })
        toast.success(`ตรวจพบข้อความ: ${res.rawText}`)
      } else {
        setTestScrapeResult({
          success: false,
          error: res?.error || "ไม่พบข้อความจำนวนตอนในหน้านี้",
        })
        toast.error(res?.error || "ไม่พบข้อความจำนวนตอน")
      }
    } catch (err: any) {
      setTestScrapeResult({
        success: false,
        error: err.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ",
      })
      toast.error(err.message || "ดึงข้อมูลไม่สำเร็จ")
    } finally {
      setTestingScrape(false)
    }
  }

  // Save Modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formUrl.trim()) {
      toast.error("กรุณากรอกลิงก์ต้นฉบับ")
      return
    }

    const curChapStr = formCurrentChapter.trim()
    const curChapNum = parseChapterNumber(curChapStr)
    const rawCountNum = editingItem ? parseChapterNumber(editingItem.lastrawcount) : 0
    let updatedStatus = editingItem?.status || "รอตรวจสอบครั้งแรก"
    if (rawCountNum > 0 && curChapNum > 0) {
      if (rawCountNum > curChapNum) {
        const diff = Math.round((rawCountNum - curChapNum) * 100) / 100
        updatedStatus = `มีตอนใหม่ (+${diff} ตอน)`
      } else {
        updatedStatus = "เป็นปัจจุบัน"
      }
    } else if (rawCountNum > 0 && curChapNum === 0) {
      updatedStatus = `มีตอนใหม่ (+${rawCountNum} ตอน)`
    }

    const payload = {
      mangaid: formMangaId,
      manganame:
        formMangaName ||
        mangaList.find((m) => String(m.mangaid) === formMangaId)?.manganame ||
        "ไม่ระบุชื่อเรื่อง",
      url: formUrl.trim(),
      pattern: formPattern.trim(),
      autocheck: formAutoCheck,
      currentchapter: curChapStr || "0",
      ...(editingItem ? { status: sanitizeTrackerStatus(updatedStatus) } : {}),
    }

    try {
      if (editingItem) {
        await callGasApi("UPDATE_RAW_TRACKER", {
          id: editingItem.trackerid,
          data: payload,
        })
        toast.success("บันทึกการแก้ไขเรียบร้อยแล้ว")
      } else {
        await callGasApi("ADD_RAW_TRACKER", payload)
        toast.success("เพิ่มเรื่องสำหรับติดตามต้นฉบับเรียบร้อยแล้ว")
      }
      setModalOpen(false)
      refetch()
    } catch (err: any) {
      toast.error(err.message || "บันทึกไม่สำเร็จ")
    }
  }

  // Delete Tracker
  const handleDeleteTracker = async (trackerId: string, name: string) => {
    if (!confirm(`คุณต้องการยกเลิกการติดตามเรื่อง "${name}" ใช่หรือไม่?`)) return
    try {
      await callGasApi("DELETE_RAW_TRACKER", { id: trackerId })
      toast.success("ลบรายการติดตามเรียบร้อยแล้ว")
      refetch()
    } catch (err: any) {
      toast.error(err.message || "ลบไม่สำเร็จ")
    }
  }

  // Single Check
  const handleCheckSingle = async (item: RawTrackerItem) => {
    setSingleCheckingId(item.trackerid)
    try {
      const res = await callGasApi("SCRAPE_RAW_URL", {
        url: item.url,
        pattern: item.pattern,
      })
      if (res && res.success) {
        // Resolve authoritative current chapter from linked manga in mangaMap, or fallback to tracker's value
        const manga = item.mangaid ? mangaMap.get(String(item.mangaid)) : null
        let currentNum = 0
        let currentChapStr = "0"
        if (manga && manga.lastchapter !== undefined && manga.lastchapter !== null && String(manga.lastchapter).trim() !== "") {
          currentNum = parseChapterNumber(manga.lastchapter)
          currentChapStr = String(manga.lastchapter)
        } else {
          currentNum = parseChapterNumber(item.currentChapter || item.currentchapter)
          currentChapStr = String(item.currentChapter || item.currentchapter || "0")
        }

        const oldScrapedNum = parseChapterNumber(item.lastrawcount)
        const newScrapedNum = parseChapterNumber(res.chapterCount)

        // Strict calculation: A new chapter exists ONLY if newScrapedNum > currentNum
        let isChanged = false
        let diff = 0
        if (newScrapedNum > 0 && currentNum > 0) {
          if (newScrapedNum > currentNum) {
            isChanged = true
            diff = Math.round((newScrapedNum - currentNum) * 100) / 100
          } else {
            isChanged = false
            diff = 0
          }
        } else if (newScrapedNum > 0 && currentNum === 0) {
          if (oldScrapedNum > 0 && newScrapedNum > oldScrapedNum) {
            isChanged = true
            diff = Math.round((newScrapedNum - oldScrapedNum) * 100) / 100
          } else if (oldScrapedNum === 0) {
            isChanged = true
            diff = newScrapedNum
          }
        } else if (item.lastrawtext && item.lastrawtext !== res.rawText) {
          isChanged = true
          diff = 1
        }

        if (isNaN(diff) || !isFinite(diff) || diff < 0) {
          diff = isChanged ? 1 : 0
        }

        const newStatus = isChanged && diff > 0
          ? `มีตอนใหม่ (+${diff} ตอน)`
          : "เป็นปัจจุบัน"

        await callGasApi("UPDATE_RAW_TRACKER", {
          id: item.trackerid,
          data: {
            currentchapter: currentChapStr,
            lastrawtext: res.rawText || "",
            lastrawcount: newScrapedNum > 0 ? newScrapedNum : 0,
            status: sanitizeTrackerStatus(newStatus, diff),
            lastchecked: new Date().toISOString(),
            ...(isChanged ? { updatedat: new Date().toISOString() } : {}),
          },
        })

        if (isChanged && diff > 0) {
          toast.success(`🎉 ${item.manganame}: ตรวจพบตอนใหม่! (+${diff} ตอน)`)
        } else {
          toast.info(`${item.manganame}: ตอนเป็นปัจจุบันแล้ว (${res.rawText || "เป็นปัจจุบัน"})`)
        }
        refetch()
      } else {
        toast.error(`ตรวจเช็คไม่สำเร็จ: ${res?.error || "ไม่พบข้อความ"}`)
      }
    } catch (err: any) {
      toast.error(err.message || "ตรวจสอบไม่สำเร็จ")
    } finally {
      setSingleCheckingId(null)
    }
  }

  // Check All Now
  const handleCheckAll = async () => {
    setCheckingAll(true)
    toast.loading("กำลังส่งคำสั่งตรวจสอบต้นฉบับทุกเรื่องในคลาวด์...", {
      id: "check-all-trackers",
    })
    try {
      const res = await callGasApi("CHECK_ALL_RAW_TRACKERS", {
        notifyTelegram: true,
      })
      if (res && res.success) {
        const updatesNum = parseChapterNumber(res.newUpdatesCount)
        if (updatesNum > 0) {
          toast.success(
            `🎉 ตรวจเช็คเสร็จสิ้น! พบตอนใหม่ทั้งหมด ${updatesNum} เรื่อง`,
            { id: "check-all-trackers", duration: 5000 }
          )
        } else {
          toast.success("ตรวจเช็คเสร็จสิ้น: ทุกเรื่องยังเป็นปัจจุบัน", {
            id: "check-all-trackers",
          })
        }
        refetch()
      } else {
        toast.error(res?.error || "ตรวจสอบไม่สำเร็จ", { id: "check-all-trackers" })
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการตรวจสอบ", {
        id: "check-all-trackers",
      })
    } finally {
      setCheckingAll(false)
    }
  }

  // Setup 1-Hour Trigger
  const handleSetupHourlyTrigger = async () => {
    try {
      const res = await callGasApi("SETUP_HOURLY_TRACKER_TRIGGER")
      toast.success(
        res?.message || "ตั้งระบบตรวจเช็คอัตโนมัติทุกๆ 1 ชั่วโมง เรียบร้อยแล้ว!"
      )
    } catch (err: any) {
      toast.error(err.message || "ตั้งค่าทริกเกอร์ไม่สำเร็จ")
    }
  }

  // Quick Sync Single Tracker with Mangas table
  const handleSyncSingleTracker = async (item: RawTrackerItem) => {
    setSyncingTrackerId(item.trackerid)
    try {
      const res = await callGasApi("SYNC_SINGLE_RAW_TRACKER", {
        id: item.trackerid,
      })
      if (res && res.success) {
        toast.success(`ซิงก์เลขตอน "${item.manganame}" เป็นตอนที่ ${res.currentChapter} สำเร็จ (สถานะ: ${res.status})`)
        refetch()
      } else {
        toast.error(res?.error || "ซิงก์เลขตอนไม่สำเร็จ")
      }
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการซิงก์")
    } finally {
      setSyncingTrackerId(null)
    }
  }

  // Import from Manga List & Two-way sync (delete orphaned trackers & sync current chapters)
  const handleImportFromManga = async () => {
    toast.loading("กำลังซิงค์รายการติดตามและอัปเดตเลขตอนจากหน้าตั้งค่ามังงะ...", {
      id: "import-trackers",
    })
    try {
      const res: any = await callGasApi("IMPORT_FROM_MANGA_LIST")
      const del = res?.deletedCount || 0
      const add = res?.addedCount || 0
      const syn = res?.syncedCount || 0
      toast.success(
        `ซิงค์ข้อมูลมังงะเรียบร้อย (อัปเดตเลขตอน ${syn} เรื่อง, เพิ่มใหม่ ${add} เรื่อง, ลบเรื่องที่ยกเลิก ${del} เรื่อง)`,
        { id: "import-trackers" }
      )
      refetch()
    } catch (err: any) {
      toast.error(err.message || "ซิงค์ไม่สำเร็จ", { id: "import-trackers" })
    }
  }

  // Quick Action: Add to Queue with prefilled next chapter
  const handleCreateQueue = (item: RawTrackerItem) => {
    if (!item.mangaid) {
      toast.error("รายการนี้ไม่ได้เชื่อมโยงกับ MangaID ในระบบ")
      return
    }
    let nextChap = ""
    const cur = parseChapterNumber(item.currentChapter)
    if (cur > 0) {
      const nextVal = cur + 1
      nextChap = String(Number.isInteger(nextVal) ? nextVal : Math.round(nextVal * 100) / 100)
    }
    onOpenAddQueueWithManga(String(item.mangaid), nextChap)
  }

  // Manga Map for quick lookup
  const mangaMap = React.useMemo(() => {
    const map = new Map<string, any>()
    ;(mangaList || []).forEach((m) => {
      if (m.mangaid != null) map.set(String(m.mangaid), m)
    })
    return map
  }, [mangaList])

  // Urgency detection: Is the tracked manga an urgent series (เรื่องด่วน)?
  const getTrackerUrgency = React.useCallback(
    (item: RawTrackerItem) => {
      const manga =
        (item.mangaid != null ? mangaMap.get(String(item.mangaid)) : null) ||
        mangaList.find(
          (m) =>
            m.manganame &&
            item.manganame &&
            m.manganame.trim().toLowerCase() === item.manganame.trim().toLowerCase()
        )
      const isUrgent = isUrgentManga(manga)
      const currentChap = parseChapterNumber(item.currentChapter)
      const rawChap = parseChapterNumber(item.lastrawcount)

      // Strict calculation: A manga has a new chapter ONLY if rawChap > currentChap
      let hasNew = false
      let diff = 0
      if (rawChap > 0 && currentChap > 0) {
        if (rawChap > currentChap) {
          hasNew = true
          diff = Math.round((rawChap - currentChap) * 100) / 100
        } else {
          hasNew = false
          diff = 0
        }
      } else if (rawChap > 0 && currentChap === 0) {
        hasNew = true
        diff = rawChap
      } else {
        hasNew = String(item.status || "").includes("มีตอนใหม่")
        if (hasNew) {
          const match = String(item.status || "").match(/\+(\d+(?:\.\d+)?)/)
          diff = match ? parseChapterNumber(match[1]) : 1
        } else {
          diff = 0
        }
      }

      if (isNaN(diff) || !isFinite(diff) || diff < 0) {
        diff = hasNew ? 1 : 0
      }

      const isError = String(item.status || "").includes("ตรวจสอบไม่ได้")

      // Red theme applies ONLY when: Has new chapter AND is urgent manga!
      const isUrgentWithNew = hasNew && isUrgent

      // Priority score:
      // 1000+: เรื่องด่วน (สีแดง) ที่มีตอนใหม่
      // 500+: เรื่องปกติ ที่มีตอนใหม่
      // 100: เรื่องด่วน ที่เป็นปัจจุบัน
      // 50: ตรวจไม่ได้
      // 0: เรื่องปกติ ที่เป็นปัจจุบัน
      let score = 0
      if (isUrgentWithNew) {
        score = 1000 + diff
      } else if (hasNew) {
        score = 500 + diff
      } else if (isUrgent) {
        score = 100
      } else if (isError) {
        score = 50
      } else {
        score = 0
      }

      return {
        isUrgentManga: isUrgent,
        isUrgentWithNew,
        hasNew,
        isError,
        diff,
        score,
        currentChap,
        rawChap,
        manga,
      }
    },
    [mangaMap, mangaList]
  )

  // กรองเฉพาะ Tracker ที่มังงะยังคงมีอยู่ในตารางมังงะ (ตัดเรื่องที่ถูกลบออกจาก Mangas ออกอัตโนมัติ)
  const activeTrackers = React.useMemo(() => {
    if (!mangaList || mangaList.length === 0) return trackers
    return trackers.filter((t) => {
      const mId = t.mangaid != null ? String(t.mangaid).trim() : ""
      if (mId) {
        return mangaMap.has(mId)
      }
      if (t.manganame) {
        const nameLower = t.manganame.trim().toLowerCase()
        return mangaList.some(
          (m) => m.manganame && m.manganame.trim().toLowerCase() === nameLower
        )
      }
      return true
    })
  }, [trackers, mangaList, mangaMap])

  // ตรวจสอบรายการติดตามที่ซ้ำกันในระบบ (Duplicate Trackers)
  const duplicateTrackers = React.useMemo(() => {
    const seenMangaIds = new Set<string>()
    const seenUrls = new Set<string>()
    const duplicates: RawTrackerItem[] = []

    activeTrackers.forEach((t) => {
      let isDup = false
      const mId = t.mangaid != null ? String(t.mangaid).trim() : ""
      const normUrl = (t.url || "").trim().toLowerCase().replace(/\/+$/, "")

      if (mId && seenMangaIds.has(mId)) {
        isDup = true
      } else if (normUrl && seenUrls.has(normUrl)) {
        isDup = true
      }

      if (isDup) {
        duplicates.push(t)
      } else {
        if (mId) seenMangaIds.add(mId)
        if (normUrl) seenUrls.add(normUrl)
      }
    })

    return duplicates
  }, [activeTrackers])

  const duplicateIdSet = React.useMemo(() => {
    return new Set(duplicateTrackers.map((t) => t.trackerid))
  }, [duplicateTrackers])

  const [cleaningDuplicates, setCleaningDuplicates] = React.useState(false)

  // ลบรายการติดตามที่ซ้ำกัน
  const handleCleanDuplicates = async () => {
    if (!duplicateTrackers.length) return
    if (
      !confirm(
        `คุณต้องการลบรายการติดตามที่ซ้ำกัน ${duplicateTrackers.length} รายการ ใช่หรือไม่?`
      )
    )
      return

    setCleaningDuplicates(true)
    toast.loading("กำลังลบรายการติดตามที่ซ้ำกัน...", { id: "clean-dup" })
    try {
      for (const item of duplicateTrackers) {
        await callGasApi("DELETE_RAW_TRACKER", { id: item.trackerid })
      }
      toast.success(
        `ลบรายการติดตามที่ซ้ำกัน ${duplicateTrackers.length} รายการ เรียบร้อยแล้ว`,
        { id: "clean-dup" }
      )
      refetch()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการลบรายการซ้ำ", {
        id: "clean-dup",
      })
    } finally {
      setCleaningDuplicates(false)
    }
  }

  // Statistics
  const urgentWithNewCount = React.useMemo(() => {
    return activeTrackers.filter((t) => getTrackerUrgency(t).isUrgentWithNew).length
  }, [activeTrackers, getTrackerUrgency])

  const newUpdatesItems = React.useMemo(() => {
    return activeTrackers.filter((t) => getTrackerUrgency(t).hasNew)
  }, [activeTrackers, getTrackerUrgency])
  const newUpdatesCount = newUpdatesItems.length

  // Effective last check & pipeline run times
  const latestItemCheckTime = React.useMemo(() => {
    let maxTime = 0
    activeTrackers.forEach((t) => {
      if (t.lastchecked) {
        const d = new Date(t.lastchecked).getTime()
        if (!isNaN(d) && d > maxTime) maxTime = d
      }
    })
    return maxTime > 0 ? new Date(maxTime).toISOString() : null
  }, [activeTrackers])

  const effectiveLastCheckTime = autoTrackerStatus?.lastCheck?.checkedAt || latestItemCheckTime
  const effectiveLastPipelineRunTime =
    latestRawTrackerRun?.run_started_at ||
    latestRawTrackerRun?.created_at ||
    autoTrackerStatus?.lastPipelineTrigger?.lastTriggeredAt

  // Total pending chapters across all active trackers
  const totalPendingChapters = React.useMemo(() => {
    return activeTrackers.reduce((sum, t) => {
      const u = getTrackerUrgency(t)
      const diffVal = u.diff && !isNaN(u.diff) && isFinite(u.diff) ? u.diff : 1
      const count = u.hasNew ? Math.max(1, diffVal) : 0
      return sum + (isNaN(count) || !isFinite(count) ? 0 : count)
    }, 0)
  }, [activeTrackers, getTrackerUrgency])

  // Filtered trackers
  const filteredTrackers = React.useMemo(() => {
    const q = search.toLowerCase().trim()
    return activeTrackers.filter((t) => {
      // Search
      if (q) {
        const name = String(t.manganame || "").toLowerCase()
        const url = String(t.url || "").toLowerCase()
        const text = String(t.lastrawtext || "").toLowerCase()
        if (!name.includes(q) && !url.includes(q) && !text.includes(q)) {
          return false
        }
      }
      // Status filter
      if (statusFilter === "urgent_new") {
        return getTrackerUrgency(t).isUrgentWithNew
      }
      if (statusFilter === "new") {
        return getTrackerUrgency(t).hasNew
      }
      if (statusFilter === "current") {
        return !getTrackerUrgency(t).hasNew && !getTrackerUrgency(t).isError
      }
      if (statusFilter === "error") {
        return getTrackerUrgency(t).isError
      }
      return true
    })
  }, [activeTrackers, search, statusFilter, getTrackerUrgency])

  const getDomainInfo = (urlStr: string) => {
    try {
      const u = (urlStr || "").toLowerCase()
      if (u.includes("kuaikan")) {
        return {
          label: "快看漫画",
          color: "text-pink-300 bg-pink-500/10 border-pink-500/30",
        }
      }
      if (u.includes("qq.com")) {
        return {
          label: "腾讯动漫",
          color: "text-indigo-300 bg-indigo-500/10 border-indigo-500/30",
        }
      }
      if (u.includes("thunderscans")) {
        return {
          label: "ThunderScans",
          color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
        }
      }
      const host = new URL(urlStr).hostname.replace(/^www\./, "")
      return {
        label: host,
        color: "text-slate-300 bg-slate-800/80 border-slate-700",
      }
    } catch {
      return {
        label: "Web Raw",
        color: "text-slate-300 bg-slate-800/80 border-slate-700",
      }
    }
  }

  // Sorted Trackers: Urgent Manga & New Chapters at the top
  const sortedTrackers = React.useMemo(() => {
    const list = [...filteredTrackers]
    list.sort((a, b) => {
      if (sortBy === "urgent_first") {
        const uA = getTrackerUrgency(a)
        const uB = getTrackerUrgency(b)
        // Score: Urgent with new (1000+) -> New (500+) -> Urgent up-to-date (200) -> Others
        if (uA.score !== uB.score) {
          return uB.score - uA.score
        }
        // Fallback to name
        return String(a.manganame || "").localeCompare(
          String(b.manganame || ""),
          "th"
        )
      }
      if (sortBy === "name") {
        return String(a.manganame || "").localeCompare(
          String(b.manganame || ""),
          "th"
        )
      }
      if (sortBy === "recent") {
        const tA = a.lastchecked ? new Date(a.lastchecked).getTime() : 0
        const tB = b.lastchecked ? new Date(b.lastchecked).getTime() : 0
        return tB - tA
      }
      return 0
    })
    return list
  }, [filteredTrackers, sortBy, getTrackerUrgency])

  const mangaOptions = React.useMemo(
    () =>
      mangaList.map((m) => ({
        value: String(m.mangaid),
        label: `${m.manganame} (${m.status || "Ongoing"})${
          m.isurgent ? " [งานด่วน]" : ""
        }`,
      })),
    [mangaList]
  )

  const formatRelativeTime = (timeStr?: string) => {
    if (!timeStr) return "ยังไม่เคยตรวจ"
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return timeStr
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diffSec < 60) return "เมื่อสักครู่"
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ชั่วโมงที่แล้ว`
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543} ${String(
      d.getHours()
    ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  return (
    <div className="space-y-6">
      {/* ⏱️ Top Status Banner: ระบบเช็คอัตโนมัติ ทุกๆ 1 ชั่วโมง GAS Active (快看 / QQ / Thunderscans) */}
      <div className="p-3.5 px-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/60 via-[#131b2e] to-[#0e1626] shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shrink-0 mt-0.5 sm:mt-0">
            <Clock className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                ⏱️ ระบบเช็คอัตโนมัติ
              </span>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold text-[11px] px-2 py-0.5">
                <span className="relative flex h-2 w-2 mr-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                ทุกๆ 1 ชั่วโมง
              </Badge>
              <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-300 font-semibold text-[11px] px-2 py-0.5">
                GAS Active (快看 / QQ / Thunderscans)
              </Badge>
            </div>
            <div className="text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1.5">
                🔍 <strong className="text-amber-200/90">ตรวจเช็คอัปเดต RAW:</strong>{" "}
                <span className="text-amber-300 font-medium">
                  {formatRelativeTime(effectiveLastCheckTime)}
                  {effectiveLastCheckTime && (
                    <span className="text-[11px] text-slate-400 ml-1">
                      ({new Date(effectiveLastCheckTime).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })})
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-amber-300/80 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded font-normal">
                  ตรวจเว็บต้นฉบับ
                </span>
              </span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="flex items-center gap-1.5">
                🚀 <strong className="text-emerald-200/90">สั่งรันดาวน์โหลด RAW (GitAction):</strong>{" "}
                <span className="text-emerald-400 font-medium">
                  {effectiveLastPipelineRunTime
                    ? `${formatRelativeTime(effectiveLastPipelineRunTime)} (${
                        latestRawTrackerRun
                          ? `Run #${latestRawTrackerRun.run_number} ${
                              latestRawTrackerRun.conclusion === "success"
                                ? "✅ สำเร็จ"
                                : latestRawTrackerRun.status === "in_progress"
                                ? "⚡ กำลังทำงาน"
                                : latestRawTrackerRun.conclusion || ""
                            }`
                          : "Pipeline Triggered"
                      })`
                    : "ยังไม่มีประวัติการรัน"}
                </span>
                <span className="text-[10px] text-emerald-300/80 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded font-normal">
                  ดาวน์โหลดภาพดิบ
                </span>
              </span>
              {isRawTrackerRunning && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold animate-pulse text-[11px]">
                  <RefreshCw className="h-3 w-3 animate-spin" /> กำลังรันดาวน์โหลด RAW...
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTriggerPipelineNow}
            disabled={triggeringPipeline || isRawTrackerRunning}
            className="h-8 text-xs border-indigo-500/40 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-200 gap-1.5 shadow-sm cursor-pointer"
            title="สั่งให้ GitAction เริ่มกระบวนการดาวน์โหลดและเย็บภาพ RAW ทันที"
          >
            <Zap className={`h-3.5 w-3.5 text-amber-400 ${triggeringPipeline ? "animate-spin" : ""}`} />
            {triggeringPipeline ? "กำลังสั่งดาวน์โหลด..." : "สั่งรันดาวน์โหลด RAW ทันที"}
          </Button>
        </div>
      </div>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#26334d] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-600/20 text-pink-400 border border-pink-500/30">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                ติดตามต้นฉบับอัปเดต (Raw Tracker)
                {newUpdatesCount > 0 && (
                  <Badge className="bg-emerald-500 text-slate-950 font-bold px-2.5 py-0.5 text-xs animate-bounce">
                    มีตอนใหม่ {newUpdatesCount} เรื่อง!
                  </Badge>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                ระบบ Web Scraping ตรวจสอบหน้าเว็บอัตโนมัติทุก 1 ชม. (快看: 共366篇正文 / QQ: 最新话 / ThunderScans: New Chapter)
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportFromManga}
            className="h-9 border-[#26334d] bg-[#111726] hover:bg-slate-800"
            title="นำเข้ามังงะที่มี Original URL ในระบบเข้ามาติดตามอัตโนมัติ"
          >
            <Globe className="h-4 w-4 mr-1.5 text-indigo-400" />
            ซิงค์จากมังงะ
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSetupHourlyTrigger}
            className="h-9 border-[#26334d] bg-[#111726] hover:bg-slate-800 text-amber-300"
            title="ตั้งระบบ Cron Trigger ใน Google Cloud ให้ยิงตรวจเช็คอัตโนมัติทุกๆ 1 ชั่วโมง"
          >
            <Clock className="h-4 w-4 mr-1.5 text-amber-400" />
            ตั้งตรวจทุก 1 ชม.
          </Button>

          {onOpenKuaikanModal && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenKuaikanModal}
              className="h-9 border-amber-500/40 bg-amber-950/20 hover:bg-amber-900/30 text-amber-300 shadow-xs"
              title="เชื่อมต่อบัญชี KuaiKan VIP ผ่าน WeChat QR เพื่อปลดล็อคและโหลดตอนล่าสุด"
            >
              <QrCode className="h-4 w-4 mr-1.5 text-amber-400" />
              KuaiKan VIP (WeChat QR)
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => handleOpenAddModal()}
            className="h-9 bg-pink-600 hover:bg-pink-700 text-white shadow-md shadow-pink-600/20"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            เพิ่มเรื่องติดตาม
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setPipelineTargetTrackerId(null)
              setPipelineModalOpen(true)
            }}
            className="h-9 bg-gradient-to-r from-pink-600 via-rose-600 to-indigo-600 hover:from-pink-700 hover:to-indigo-700 text-white font-bold shadow-lg shadow-pink-600/30 px-3.5"
            title={`ดาวน์โหลด เย็บ 20 หน้า อัป Drive และลงคิวงานอัตโนมัติสำหรับทุกเรื่องที่มีตอนใหม่ (${totalPendingChapters} ตอน)`}
          >
            <Zap className="h-4 w-4 mr-1.5 fill-current animate-pulse text-amber-300" />
            ⚡ อัป raw & ลงคิวงานอัตโนมัติ
            {totalPendingChapters > 0 && (
              <Badge className="ml-2 bg-white text-slate-900 font-extrabold text-[10px] px-1.5 py-0 h-4">
                {totalPendingChapters}
              </Badge>
            )}
          </Button>

          <Button
            size="sm"
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="h-9 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 font-semibold"
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 ${checkingAll ? "animate-spin" : ""}`}
            />
            {checkingAll ? "กำลังสแกนทุกเรื่อง..." : "🔍 ตรวจสอบทั้งหมดทันที"}
          </Button>
        </div>
      </div>

      {/* Duplicate Tracker Warning & Cleanup Banner */}
      {duplicateTrackers.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 px-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-[#1c1917]/50 to-[#111726] shadow-md shadow-amber-950/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                ตรวจพบรายการติดตามซ้ำในระบบ ({duplicateTrackers.length} รายการ)
              </div>
              <div className="text-xs text-amber-300/70">
                มีเรื่องหรือลิงก์ต้นฉบับเดียวกันถูกบันทึกซ้ำ คุณสามารถกดปุ่มเพื่อล้างรายการที่ซ้ำออกได้ทันที
              </div>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleCleanDuplicates}
            disabled={cleaningDuplicates}
            className="h-8 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shrink-0 shadow-md shadow-amber-600/30"
          >
            {cleaningDuplicates ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            ลบรายการซ้ำ ({duplicateTrackers.length})
          </Button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Tracked */}
        <Card className="p-4 bg-[#111726] border-[#26334d]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              📡 กำลังติดตามทั้งหมด
            </span>
            <div className="rounded-lg bg-pink-500/10 p-2 text-pink-400">
              <Radio className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">
              {activeTrackers.length}
            </span>
            <span className="text-xs text-slate-400">เรื่อง</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            ดึงผ่าน Google Cloud Scraping
          </div>
        </Card>

        {/* Urgent with New Chapter (Red Theme) */}
        <Card
          onClick={() =>
            setStatusFilter(statusFilter === "urgent_new" ? "all" : "urgent_new")
          }
          className={`p-4 transition-all cursor-pointer ${
            urgentWithNewCount > 0
              ? "border-red-500/70 bg-gradient-to-br from-red-950/50 via-[#1c1116] to-[#111726] shadow-lg shadow-red-950/50 hover:border-red-400"
              : "bg-[#111726] border-[#26334d]"
          }`}
          title="คลิกเพื่อกรองเฉพาะเรื่องด่วนที่มีตอนใหม่ (สีแดง)"
        >
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                urgentWithNewCount > 0 ? "text-red-400 font-bold" : "text-slate-400"
              }`}
            >
              🔥 ด่วน & มีตอนใหม่
            </span>
            <div
              className={`rounded-lg p-2 ${
                urgentWithNewCount > 0
                  ? "bg-red-500/20 text-red-400 animate-pulse"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              <Flame className="h-4 w-4 fill-current" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                urgentWithNewCount > 0 ? "text-red-400" : "text-slate-400"
              }`}
            >
              {urgentWithNewCount}
            </span>
            <span className="text-xs text-slate-400">เรื่อง</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {urgentWithNewCount > 0
              ? "เรื่องด่วนที่ตรวจพบตอนใหม่แล้ว"
              : "ไม่มีเรื่องด่วนที่มีตอนใหม่"}
          </div>
        </Card>

        {/* New Updates */}
        <Card
          onClick={() =>
            setStatusFilter(statusFilter === "new" ? "all" : "new")
          }
          className={`p-4 transition-all cursor-pointer ${
            newUpdatesCount > 0
              ? "border-emerald-500/50 bg-gradient-to-br from-[#11241f] to-[#0c1a17] shadow-lg shadow-emerald-950/40 hover:border-emerald-400"
              : "bg-[#111726] border-[#26334d]"
          }`}
          title="คลิกเพื่อกรองเฉพาะเรื่องที่มีตอนใหม่"
        >
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                newUpdatesCount > 0 ? "text-emerald-400 font-bold" : "text-slate-400"
              }`}
            >
              🚨 มีตอนใหม่มาแล้ว!
            </span>
            <div
              className={`rounded-lg p-2 ${
                newUpdatesCount > 0
                  ? "bg-emerald-500/20 text-emerald-300 animate-pulse"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                newUpdatesCount > 0 ? "text-emerald-300" : "text-slate-400"
              }`}
            >
              {newUpdatesCount}
            </span>
            <span className="text-xs text-slate-400">เรื่อง</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {newUpdatesCount > 0
              ? "กดปุ่ม + ด้านล่างเพื่อเพิ่มเข้าคิวงานได้ทันที"
              : "ยังไม่มีตอนใหม่เพิ่มขึ้น"}
          </div>
        </Card>

        {/* Auto Checker Status */}
        <Card className="p-4 bg-[#111726] border-[#26334d]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              ⏱️ ระบบเช็คอัตโนมัติ
            </span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-slate-200">
              ทุกๆ 1 ชั่วโมง
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span>GAS Active (快看 / QQ / Thunderscans)</span>
          </div>
        </Card>
      </div>

      {/* Filter Toolbar & Sort & View Mode */}
      <Card className="p-4 bg-[#111726] border-[#26334d]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="ค้นหาชื่อเรื่อง, ลิงก์ต้นฉบับ หรือข้อความ..."
                className="pl-9 bg-[#0b1120] border-[#26334d]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Status Filter Buttons */}
            <div className="flex flex-wrap items-center rounded-lg border border-[#26334d] bg-[#0b1120] p-0.5 text-xs font-medium gap-0.5">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                  statusFilter === "all"
                    ? "bg-indigo-600 text-white font-semibold shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                ทั้งหมด ({activeTrackers.length})
              </button>
              <button
                onClick={() => setStatusFilter("urgent_new")}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === "urgent_new"
                    ? "bg-red-600 text-white font-bold shadow-md shadow-red-600/40"
                    : "text-red-400 hover:text-red-300 hover:bg-red-950/30"
                }`}
                title="กรองเฉพาะเรื่องด่วนที่มีตอนใหม่ (สีแดง)"
              >
                <Flame className="h-3.5 w-3.5 fill-current" />
                ด่วน & มีตอนใหม่ ({urgentWithNewCount})
              </button>
              <button
                onClick={() => setStatusFilter("new")}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                  statusFilter === "new"
                    ? "bg-emerald-600 text-white font-semibold shadow-xs"
                    : "text-emerald-400 hover:text-emerald-300"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                มีตอนใหม่ ({newUpdatesCount})
              </button>
              <button
                onClick={() => setStatusFilter("current")}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                  statusFilter === "current"
                    ? "bg-slate-700 text-white font-semibold shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                เป็นปัจจุบัน
              </button>
              <button
                onClick={() => setStatusFilter("error")}
                className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                  statusFilter === "error"
                    ? "bg-rose-600 text-white font-semibold shadow-xs"
                    : "text-rose-400 hover:text-rose-300"
                }`}
              >
                ตรวจสอบไม่ได้
              </button>
            </div>

            {/* Sort Selector: Urgent & New First */}
            <div className="flex items-center gap-1.5 bg-[#0b1120] border border-[#26334d] rounded-lg px-2.5 py-1 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-slate-200 border-none outline-none cursor-pointer text-xs"
              >
                <option value="urgent_first" className="bg-[#0b1120] text-slate-100">
                  🔥 เรื่องด่วน & ตอนใหม่ ขึ้นก่อน
                </option>
                <option value="name" className="bg-[#0b1120] text-slate-100">
                  🔤 ชื่อเรื่อง ก-ฮ
                </option>
                <option value="recent" className="bg-[#0b1120] text-slate-100">
                  🕒 ตรวจสอบล่าสุด
                </option>
              </select>
            </div>

            {/* View Mode Toggle: Cards vs Table */}
            <div className="flex items-center rounded-lg border border-[#26334d] bg-[#0b1120] p-0.5 text-xs">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-pink-600 text-white font-semibold shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
                title="มุมมองการ์ด (Card Grid)"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">การ์ด</span>
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  viewMode === "table"
                    ? "bg-pink-600 text-white font-semibold shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
                title="มุมมองตาราง (Table)"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">ตาราง</span>
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* TRACKERS DISPLAY: CARDS VIEW OR TABLE VIEW */}
      {viewMode === "cards" ? (
        isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card
                key={i}
                className="p-4 bg-[#111726] border-[#26334d] space-y-3"
              >
                <Skeleton className="h-6 w-3/4 bg-[#18233a]" />
                <Skeleton className="h-4 w-1/2 bg-[#18233a]" />
                <Skeleton className="h-12 w-full bg-[#18233a]" />
                <Skeleton className="h-8 w-full bg-[#18233a]" />
              </Card>
            ))}
          </div>
        ) : sortedTrackers.length === 0 ? (
          <Card className="p-12 text-center bg-[#111726] border-[#26334d]">
            <div className="flex flex-col items-center justify-center gap-2">
              <Radio className="h-10 w-10 text-slate-600" />
              <p className="text-slate-400">ไม่พบรายการติดตามที่ตรงกับเงื่อนไข</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportFromManga}
                className="mt-2 text-xs"
              >
                กดที่นี่เพื่อซิงค์มังงะทั้งหมดในระบบเข้ามาติดตาม
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedTrackers.map((item) => {
              const u = getTrackerUrgency(item)
              const domain = getDomainInfo(item.url)
              const isChecking = singleCheckingId === item.trackerid

              // Card styling: If tracked manga is urgent AND has new chapter -> ALL RED THEME!
              let cardStyle =
                "border-[#26334d] bg-[#111726] hover:border-slate-500 hover:shadow-lg"
              let borderGlow = ""
              if (u.isUrgentWithNew) {
                // RED STYLING only for เรื่องด่วนที่มีตอนใหม่
                cardStyle =
                  "border-red-500 ring-2 ring-red-500/50 bg-gradient-to-b from-red-950/50 via-[#18111e] to-[#0c101d] shadow-xl shadow-red-950/60 hover:border-red-400"
                borderGlow = "from-red-600 via-rose-500 to-red-600"
              } else if (u.hasNew) {
                cardStyle =
                  "border-emerald-500/70 bg-gradient-to-b from-emerald-950/30 via-[#111726] to-[#0c101d] ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-950/30 hover:border-emerald-400"
                borderGlow = "from-emerald-500 to-teal-500"
              } else if (u.isError) {
                cardStyle =
                  "border-amber-500/50 bg-gradient-to-b from-amber-950/20 via-[#111726] to-[#0c101d] hover:border-amber-400/70"
              }

              return (
                <Card
                  key={item.trackerid}
                  className={`relative flex flex-col justify-between overflow-hidden transition-all duration-200 ${cardStyle}`}
                >
                  {/* Top glowing accent line for urgency */}
                  {borderGlow && (
                    <div
                      className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${borderGlow}`}
                    />
                  )}

                  <CardHeader className="p-4 pb-2 space-y-2">
                    {/* Top row: Domain pill & Urgency Badge */}
                    <div className="flex items-center justify-between gap-1.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${domain.color}`}
                      >
                        {domain.label}
                      </span>

                      {/* Status / Urgency Badge */}
                      <div className="flex items-center gap-1">
                        {duplicateIdSet.has(item.trackerid) && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 bg-amber-950/40 text-amber-300 text-[10px] px-1.5 py-0.5"
                          >
                            รายการซ้ำ
                          </Badge>
                        )}
                        {u.isUrgentWithNew ? (
                          <Badge className="bg-red-600 text-white font-bold px-2.5 py-0.5 shadow-md shadow-red-600/50 animate-pulse text-[11px] flex items-center gap-1">
                            <Flame className="h-3 w-3 fill-current text-white" />
                            เรื่องด่วน (+{u.diff} ตอน)
                          </Badge>
                        ) : u.hasNew ? (
                          <Badge className="bg-emerald-600 text-white font-bold px-2.5 py-0.5 shadow-md shadow-emerald-600/30 text-[11px] flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            มีตอนใหม่ (+{u.diff} ตอน)
                          </Badge>
                        ) : u.isError ? (
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1.5 py-0.5 flex items-center gap-1"
                          >
                            <AlertCircle className="h-3 w-3" />
                            ตรวจไม่ได้
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-700 bg-slate-800/80 text-slate-300 text-[10px] px-2 py-0.5 flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            เป็นปัจจุบัน
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Manga Title & Urgent Tag */}
                    <div>
                      <div className="flex items-start justify-between gap-1.5">
                        <h3
                          className="font-bold text-sm text-white line-clamp-1 hover:text-indigo-300 transition-colors cursor-pointer"
                          title={item.manganame}
                          onClick={() => handleCreateQueue(item)}
                        >
                          {item.manganame || "ไม่ระบุชื่อเรื่อง"}
                        </h3>
                        {u.isUrgentManga && (
                          <span
                            className={`shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5 flex items-center gap-0.5 shadow-xs ${
                              u.isUrgentWithNew
                                ? "text-red-200 bg-red-600/30 border border-red-500/60"
                                : "text-slate-400 bg-slate-800 border border-slate-700"
                            }`}
                          >
                            <Flame
                              className={`h-2.5 w-2.5 fill-current ${
                                u.isUrgentWithNew ? "text-red-400" : "text-slate-400"
                              }`}
                            />
                            เรื่องด่วน
                          </span>
                        )}
                      </div>

                      {/* Source Link */}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline max-w-full truncate mt-0.5"
                        title={item.url}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.url}</span>
                      </a>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 pt-1 pb-3 space-y-2.5">
                    {/* Raw Scraped Text Box */}
                    <div className="rounded-lg bg-[#0b1120] border border-[#26334d] p-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>ข้อความล่าสุดที่ตรวจพบ:</span>
                        {parseChapterNumber(item.lastrawcount) > 0 && (
                          <span className="font-semibold text-slate-300 font-mono">
                            {formatChapterDisplay(item.lastrawcount)} ตอน
                          </span>
                        )}
                      </div>
                      <div
                        className="font-mono text-xs text-pink-300 font-semibold truncate bg-black/40 px-2 py-1 rounded border border-pink-500/20"
                        title={item.lastrawtext}
                      >
                        {item.lastrawtext || "ยังไม่เคยตรวจ"}
                      </div>
                    </div>

                    {/* Chapter Comparison Metrics */}
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#0d1322] border border-[#26334d]/60 p-2 text-center">
                      <div>
                        <span className="block text-[10px] text-slate-400">
                          ในระบบ
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-200">
                          {formatChapterDisplay(item.currentChapter)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">
                          ต้นฉบับ
                        </span>
                        <span className="font-mono text-xs font-bold text-pink-300">
                          {formatChapterDisplay(item.lastrawcount)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">
                          ผลต่าง
                        </span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            u.isUrgentWithNew
                              ? "text-red-400 animate-pulse font-extrabold"
                              : u.hasNew
                              ? "text-emerald-400 font-extrabold"
                              : "text-slate-500"
                          }`}
                        >
                          {u.hasNew && u.diff > 0 ? `+${u.diff}` : "0"}
                        </span>
                      </div>
                    </div>

                    {/* Relative timestamp */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(item.lastchecked)}
                      </span>
                      {item.autocheck && (
                        <span className="text-[10px] text-indigo-400">
                          ตรวจทุก 1 ชม.
                        </span>
                      )}
                    </div>
                  </CardContent>

                  {/* Card Footer Actions */}
                  <div className="p-4 pt-0 border-t border-[#26334d]/60 mt-auto flex items-center justify-between gap-1.5 pt-3">
                    <Button
                      size="sm"
                      onClick={() => handleCreateQueue(item)}
                      className={`h-8 flex-1 text-xs font-semibold ${
                        u.isUrgentWithNew
                          ? "bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/40"
                          : u.hasNew
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/30"
                          : "bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30"
                      }`}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      ลงคิวงาน
                    </Button>

                    {u.hasNew && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setPipelineTargetTrackerId(item.trackerid)
                          setPipelineModalOpen(true)
                        }}
                        className="h-8 px-2.5 text-xs font-bold bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-700 hover:to-indigo-700 text-white shadow-md shadow-pink-600/30"
                        title="ดาวน์โหลด เย็บ 20 หน้า อัป Drive และลงคิวงานสำหรับเรื่องนี้ทันที"
                      >
                        <Zap className="h-3.5 w-3.5 mr-1 text-amber-300 fill-current" />
                        อัป raw
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-[#26334d] hover:bg-slate-800"
                      onClick={() => handleCheckSingle(item)}
                      disabled={isChecking}
                      title="ตรวจสอบสดทันที"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-slate-300 ${
                          isChecking ? "animate-spin text-pink-400" : ""
                        }`}
                      />
                    </Button>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-[#26334d] hover:bg-slate-800"
                      onClick={() => handleSyncSingleTracker(item)}
                      disabled={syncingTrackerId === item.trackerid}
                      title="ซิงก์เลขตอนล่าสุดจากตารางมังงะ"
                    >
                      <RotateCcw
                        className={`h-3.5 w-3.5 text-indigo-300 ${
                          syncingTrackerId === item.trackerid ? "animate-spin text-indigo-400" : ""
                        }`}
                      />
                    </Button>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-[#26334d] hover:bg-slate-800"
                      onClick={() => handleOpenEditModal(item)}
                      title="แก้ไข"
                    >
                      <Pencil className="h-3.5 w-3.5 text-slate-400 hover:text-slate-200" />
                    </Button>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-[#26334d] hover:bg-rose-950/40 hover:border-rose-500/40"
                      onClick={() =>
                        handleDeleteTracker(
                          item.trackerid,
                          item.manganame || "ไม่ระบุชื่อ"
                        )
                      }
                      title="ลบรายการติดตาม"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )
      ) : (
        /* TABLE VIEW (Alternative compact mode) */
        <Card className="bg-[#111726] border-[#26334d] overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-[#0e1422] border-b border-[#26334d]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 text-center text-slate-400 font-semibold">
                    #
                  </TableHead>
                  <TableHead className="text-slate-300 font-semibold min-w-[200px]">
                    ชื่อเรื่อง / ลิงก์ต้นฉบับ
                  </TableHead>
                  <TableHead className="text-slate-300 font-semibold text-center min-w-[140px]">
                    ข้อความล่าสุดจากเว็บ
                  </TableHead>
                  <TableHead className="text-slate-300 font-semibold text-center min-w-[120px]">
                    ตอนล่าสุดในระบบ
                  </TableHead>
                  <TableHead className="text-slate-300 font-semibold text-center min-w-[160px]">
                    สถานะอัปเดต
                  </TableHead>
                  <TableHead className="text-slate-300 font-semibold min-w-[130px]">
                    ตรวจเช็คล่าสุด
                  </TableHead>
                  <TableHead className="text-right text-slate-300 font-semibold min-w-[180px]">
                    การดำเนินการ
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-[#26334d]/60">
                      <TableCell colSpan={7} className="py-4">
                        <Skeleton className="h-6 w-full bg-[#18233a]" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : sortedTrackers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-slate-400"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Radio className="h-8 w-8 text-slate-600" />
                        <p>ไม่พบรายการติดตามที่ตรงกับเงื่อนไข</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleImportFromManga}
                          className="mt-2 text-xs"
                        >
                          กดที่นี่เพื่อซิงค์มังงะทั้งหมดในระบบเข้ามาติดตาม
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedTrackers.map((item, index) => {
                    const u = getTrackerUrgency(item)
                    const isChecking = singleCheckingId === item.trackerid

                    let rowBg = "hover:bg-[#151d2f]/50"
                    if (u.isUrgentWithNew) {
                      rowBg = "bg-red-950/25 hover:bg-red-950/35 border-l-4 border-l-red-500"
                    } else if (u.hasNew) {
                      rowBg = "bg-emerald-950/20 hover:bg-emerald-950/30 border-l-4 border-l-emerald-500"
                    } else if (u.isError) {
                      rowBg = "bg-amber-950/15 hover:bg-amber-950/25 border-l-4 border-l-amber-500"
                    }

                    return (
                      <TableRow
                        key={item.trackerid}
                        className={`border-b border-[#26334d]/60 transition-colors ${rowBg}`}
                      >
                        <TableCell className="text-center text-xs text-slate-500 font-mono">
                          {index + 1}
                        </TableCell>

                        {/* Manga Name & Source URL */}
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                              <span>{item.manganame || "ไม่ระบุชื่อเรื่อง"}</span>
                              {duplicateIdSet.has(item.trackerid) && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/50 bg-amber-950/40 text-amber-300 text-[10px] px-1.5 py-0.5"
                                >
                                  รายการซ้ำ
                                </Badge>
                              )}
                              {u.isUrgentManga && (
                                <span
                                  className={`text-[10px] font-bold rounded px-1.5 py-0.5 flex items-center gap-0.5 shadow-xs ${
                                    u.isUrgentWithNew
                                      ? "text-red-200 bg-red-600/30 border border-red-500/60"
                                      : "text-slate-400 bg-slate-800 border border-slate-700"
                                  }`}
                                >
                                  <Flame
                                    className={`h-2.5 w-2.5 fill-current ${
                                      u.isUrgentWithNew ? "text-red-400" : "text-slate-400"
                                    }`}
                                  />
                                  เรื่องด่วน
                                </span>
                              )}
                              {u.hasNew && (
                                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                              )}
                            </div>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 hover:underline max-w-[320px] truncate"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.url}</span>
                            </a>
                          </div>
                        </TableCell>

                        {/* Last Raw Scraped Text */}
                        <TableCell className="text-center">
                          {item.lastrawtext ? (
                            <div className="inline-flex flex-col items-center">
                              <span
                                className="font-mono text-xs px-2.5 py-1 rounded-md bg-[#0b1120] text-pink-300 border border-pink-500/30 font-semibold shadow-xs max-w-[280px] truncate"
                                title={item.lastrawtext}
                              >
                                {item.lastrawtext}
                              </span>
                              {parseChapterNumber(item.lastrawcount) > 0 && (
                                <span className="text-[10px] text-slate-400 mt-0.5">
                                  ({formatChapterDisplay(item.lastrawcount)} ตอน)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">
                              รอตรวจสอบครั้งแรก
                            </span>
                          )}
                        </TableCell>

                        {/* Current Chapter in System */}
                        <TableCell className="text-center">
                          <span className="font-mono text-xs text-slate-300 font-semibold">
                            ตอนที่ {formatChapterDisplay(item.currentChapter)}
                          </span>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center">
                          {u.isUrgentWithNew ? (
                            <Badge className="bg-red-600 text-white font-bold px-2.5 py-1 shadow-md shadow-red-600/40 animate-pulse text-xs">
                              <Flame className="h-3 w-3 mr-1 fill-current" />
                              เรื่องด่วน (+{u.diff} ตอน)
                            </Badge>
                          ) : u.hasNew ? (
                            <Badge className="bg-emerald-600 text-white font-bold px-3 py-1 shadow-md shadow-emerald-600/30 text-xs">
                              <Sparkles className="h-3 w-3 mr-1" />
                              มีตอนใหม่ (+{u.diff} ตอน)
                            </Badge>
                          ) : u.isError ? (
                            <Badge
                              variant="destructive"
                              className="text-[11px] px-2 py-0.5"
                            >
                              <AlertCircle className="h-3 w-3 mr-1" />
                              {sanitizeTrackerStatus(item.status)}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-[#151d2f] text-slate-300 border-[#26334d] text-xs"
                            >
                              <Check className="h-3 w-3 mr-1 text-emerald-400" />
                              {sanitizeTrackerStatus(item.status, u.diff)}
                            </Badge>
                          )}
                        </TableCell>

                        {/* Last Checked */}
                        <TableCell className="text-xs text-slate-400">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-slate-500" />
                            <span>{formatRelativeTime(item.lastchecked)}</span>
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-8 text-xs font-semibold ${
                                u.isUrgentWithNew
                                  ? "bg-red-600 text-white hover:bg-red-700 border-red-500 shadow-md shadow-red-600/40"
                                  : u.hasNew
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-500 shadow-md shadow-emerald-600/30"
                                  : "text-indigo-300 border-indigo-500/30 hover:bg-indigo-600/20"
                              }`}
                              onClick={() => handleCreateQueue(item)}
                              title="เปิดแบบฟอร์มเพิ่มตอนใหม่นี้เข้าสู่คิวงานทันที"
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              ลงคิว
                            </Button>

                            {u.hasNew && (
                              <Button
                                size="sm"
                                className="h-8 px-2 text-xs font-bold bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-700 hover:to-indigo-700 text-white shadow-xs"
                                onClick={() => {
                                  setPipelineTargetTrackerId(item.trackerid)
                                  setPipelineModalOpen(true)
                                }}
                                title="ดาวน์โหลด เย็บ 20 หน้า อัป Drive และลงคิวงานสำหรับเรื่องนี้ทันที"
                              >
                                <Zap className="h-3 w-3 mr-1 text-amber-300 fill-current" />
                                อัป raw
                              </Button>
                            )}

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-slate-400 hover:text-white"
                              onClick={() => handleCheckSingle(item)}
                              disabled={isChecking}
                              title="สแกนต้นฉบับเรื่องนี้ทันที"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${
                                  isChecking ? "animate-spin text-amber-400" : ""
                                }`}
                              />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-indigo-400 hover:text-white"
                              onClick={() => handleSyncSingleTracker(item)}
                              disabled={syncingTrackerId === item.trackerid}
                              title="ซิงก์เลขตอนล่าสุดจากตารางมังงะ"
                            >
                              <RotateCcw
                                className={`h-3.5 w-3.5 ${
                                  syncingTrackerId === item.trackerid ? "animate-spin text-indigo-400" : ""
                                }`}
                              />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-slate-400 hover:text-white"
                              onClick={() => handleOpenEditModal(item)}
                              title="แก้ไขลิงก์ / รูปแบบ"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-slate-400 hover:text-rose-400"
                              onClick={() =>
                                handleDeleteTracker(
                                  item.trackerid,
                                  item.manganame || ""
                                )
                              }
                              title="ยกเลิกการติดตามเรื่องนี้"
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
          </div>
        </Card>
      )}

      {/* Add / Edit Tracker Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-xl bg-[#0f172a] border-[#26334d] text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-white font-bold">
              <Radio className="h-5 w-5 text-pink-400" />
              {editingItem ? "แก้ไขรายการติดตามต้นฉบับ" : "เพิ่มเรื่องติดตามต้นฉบับใหม่"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveModal} className="space-y-4 mt-2">
            {/* Select Manga from System */}
            <div className="space-y-1.5">
              <Label>เชื่อมโยงกับมังงะในระบบ</Label>
              <SearchableSelect
                options={mangaOptions}
                value={formMangaId}
                onChange={(id) => {
                  setFormMangaId(id)
                  const m = mangaList.find((x) => String(x.mangaid) === id)
                  if (m) {
                    setFormMangaName(m.manganame)
                    if (m.originalurl && !formUrl) {
                      setFormUrl(m.originalurl)
                    }
                    if (m.lastchapter !== undefined) {
                      setFormCurrentChapter(String(m.lastchapter))
                    }
                  }
                }}
                placeholder="เลือกเรื่องมังงะ..."
              />
            </div>

            {/* Custom Name (if not in manga list) */}
            <div className="space-y-1.5">
              <Label>ชื่อเรื่องที่ต้องการแสดง</Label>
              <Input
                placeholder="เช่น ข้าคือจอมวายร้ายผู้ยิ่งใหญ่"
                value={formMangaName}
                onChange={(e) => setFormMangaName(e.target.value)}
                className="bg-[#0b1120] border-[#26334d]"
              />
            </div>

            {/* Current Chapter in System */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>เลขตอนล่าสุดในระบบ (Current Chapter)</Label>
                {formMangaId && (
                  <button
                    type="button"
                    onClick={() => {
                      const m = mangaList.find((x) => String(x.mangaid) === formMangaId)
                      if (m && m.lastchapter !== undefined) {
                        setFormCurrentChapter(String(m.lastchapter))
                        toast.info(`ดึงเลขตอนล่าสุด ${m.lastchapter} จากตารางมังงะแล้ว`)
                      }
                    }}
                    className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    ดึงค่าจากตารางมังงะ
                  </button>
                )}
              </div>
              <Input
                type="number"
                step="any"
                placeholder="เช่น 120"
                value={formCurrentChapter}
                onChange={(e) => setFormCurrentChapter(e.target.value)}
                className="bg-[#0b1120] border-[#26334d] font-mono text-xs"
              />
            </div>

            {/* Raw URL */}
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>🔗 ลิงก์หน้าเว็บต้นฉบับ (Raw URL) *</span>
                <span className="text-[11px] text-slate-400">
                  เช่น https://www.kuaikanmanhua.com/web/topic/12602/
                </span>
              </Label>
              <Input
                placeholder="https://www.kuaikanmanhua.com/web/topic/..."
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                required
                className="bg-[#0b1120] border-[#26334d] font-mono text-xs"
              />
            </div>

            {/* Pattern / Regex */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>รูปแบบการดึงข้อความ (Pattern / Regex)</Label>
                <span className="text-[11px] text-slate-500">
                  เว้นว่างไว้จะใช้ค่าอัตโนมัติ (Kuaikan / QQ)
                </span>
              </div>
              <Input
                placeholder="เว้นว่างไว้เพื่อใช้อัตโนมัติ หรือใส่เช่น 共(\d+)个内容"
                value={formPattern}
                onChange={(e) => setFormPattern(e.target.value)}
                className="bg-[#0b1120] border-[#26334d] font-mono text-xs"
              />
              <div className="flex flex-wrap gap-1 mt-1 text-[11px]">
                <span className="text-slate-500">พรีเซ็ตแนะนำ:</span>
                <button
                  type="button"
                  onClick={() => setFormPattern("共(\\d+)篇正文")}
                  className="text-pink-400 hover:underline cursor-pointer"
                >
                  [快看: 共(\d+)篇正文]
                </button>
                <button
                  type="button"
                  onClick={() => setFormPattern("")}
                  className="text-indigo-400 hover:underline cursor-pointer"
                >
                  [ac.qq: 最新话 (อัตโนมัติ)]
                </button>
                <button
                  type="button"
                  onClick={() => setFormPattern("")}
                  className="text-emerald-400 hover:underline cursor-pointer"
                >
                  [ThunderScans: New Chapter (อัตโนมัติ)]
                </button>
                <button
                  type="button"
                  onClick={() => setFormPattern("")}
                  className="text-slate-400 hover:underline cursor-pointer"
                >
                  [ล้างเป็นค่าอัตโนมัติ (แนะนำ)]
                </button>
              </div>
            </div>

            {/* Live Test Scrape Button & Result Preview */}
            <div className="rounded-xl border border-[#26334d] bg-[#0b1120] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  ทดสอบดึงข้อความเดี๋ยวนี้ (Live Scrape Test)
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestScrape}
                  disabled={testingScrape || !formUrl}
                  className="h-7 text-xs bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-600/30"
                >
                  {testingScrape ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  {testingScrape ? "กำลังยิง Scrape..." : "ทดสอบยิงดึง"}
                </Button>
              </div>

              {testScrapeResult && (
                <div
                  className={`rounded-lg p-2.5 text-xs ${
                    testScrapeResult.success
                      ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/40 border border-rose-500/40 text-rose-300"
                  }`}
                >
                  {testScrapeResult.success ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <div>
                        <span>ตรวจพบข้อความ: </span>
                        <code className="font-bold bg-black/40 px-1.5 py-0.5 rounded text-white font-mono">
                          {testScrapeResult.rawText}
                        </code>
                        <span className="ml-1 text-slate-300">
                          (ตีความได้: {parseChapterNumber(testScrapeResult.chapterCount)} ตอน)
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span>{testScrapeResult.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Auto Check Checkbox */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="autoCheckCheck"
                checked={formAutoCheck}
                onChange={(e) => setFormAutoCheck(e.target.checked)}
                className="h-4 w-4 rounded border-[#26334d] bg-[#0b1120] text-indigo-600"
              />
              <label
                htmlFor="autoCheckCheck"
                className="text-xs text-slate-300 cursor-pointer"
              >
                เปิดให้ระบบตรวจเช็คอัตโนมัติทุกๆ 1 ชั่วโมง
              </label>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="border-[#26334d]"
              >
                ยกเลิก
              </Button>
              <Button
                type="submit"
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                {editingItem ? "บันทึกการแก้ไข" : "บันทึกและเริ่มติดตาม"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Auto Raw Pipeline Modal */}
      <AutoRawPipelineModal
        open={pipelineModalOpen}
        onClose={() => setPipelineModalOpen(false)}
        initialTrackerId={pipelineTargetTrackerId}
        onSuccess={() => {
          refetch()
        }}
      />
    </div>
  )
}

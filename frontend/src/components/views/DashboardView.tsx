import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  THAI_MONTHS,
  getChapterCount,
  getQueueCurrentStep,
  getQueueItemDate,
  getThaiDayName,
  isStepDone,
  isUrgentManga,
  parseQueueDate,
  timeSince,
} from "@/lib/utils"
import {
  BookOpen,
  Clock,
  CheckCircle2,
  Flame,
  Calendar as CalendarIcon,
  RefreshCw,
  ClipboardList,
  Send,
} from "lucide-react"
import { KuaikanCoinWarningBanner } from "@/components/ui/KuaikanCoinWarningBanner"

interface DashboardViewProps {
  mangaList: any[]
  queueList: any[]
  isLoading: boolean
  onSwitchToQueue: (searchTerm?: string) => void
  onOpenUpdateQueue: (queueItem: any) => void
  onManualRefresh: () => void
  onSwitchToConnectors?: () => void
}

export function DashboardView({
  mangaList,
  queueList,
  isLoading,
  onSwitchToQueue,
  onOpenUpdateQueue,
  onManualRefresh,
  onSwitchToConnectors,
}: DashboardViewProps) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  // Stats calculation
  const stats = React.useMemo(() => {
    const totalSeries = mangaList.length

    // คิวงานที่ค้างอยู่: คำนวณเฉพาะ งานแปล+ลงคำ = 1
    // (คิวงานที่ยังแปลหรือลงคำไม่เสร็จ โดยงานแปล+ลงคำนับเป็น 1 ตอน/คิว ไม่นับซ้ำ 2 ครั้ง)
    let pendingTranslateAndTypeset = 0
    const activeQueue: any[] = []
    const allowedPendingSteps = ["upload", "extract", "translate", "typeset"]

    queueList.forEach((q) => {
      if (isStepDone(q.poststatus)) return
      const stepKey = getQueueCurrentStep(q)
      // แสดงเฉพาะ อัป raw, ดึงคำ, แปล, ลงคำ
      if (allowedPendingSteps.includes(stepKey)) {
        activeQueue.push(q)
      }

      const transDone = isStepDone(q.translatestatus)
      const typesetDone = isStepDone(q.typesetstatus)
      if (!transDone || !typesetDone) {
        pendingTranslateAndTypeset += getChapterCount(q.chapter)
      }
    })

    // เรียงงานด่วนขึ้นก่อน
    activeQueue.sort((a, b) => {
      const mangaA = mangaList.find((m) => String(m.mangaid) === String(a.mangaid))
      const mangaB = mangaList.find((m) => String(m.mangaid) === String(b.mangaid))
      const urgA = isUrgentManga(mangaA) ? 1 : 0
      const urgB = isUrgentManga(mangaB) ? 1 : 0
      if (urgA !== urgB) return urgB - urgA
      return (b.queueid || 0) - (a.queueid || 0)
    })

    // โพสต์แล้ว: งานที่ขั้นตอนโพสต์เสร็จสิ้นทั้งหมดในระบบ
    let postedTotal = 0
    queueList.forEach((q) => {
      if (isStepDone(q.poststatus)) {
        postedTotal += getChapterCount(q.chapter)
      }
    })

    // งานที่อยู่ในขั้นตอนสถานะรอpublished: ตรวจ/ลงเว็บเสร็จแล้ว รอ published
    let waitPostCount = 0
    queueList.forEach((q) => {
      if (isStepDone(q.poststatus)) return
      const postSt = String(q.poststatus || "").trim()
      const isPublishDone = isStepDone(q.publishstatus)
      if (isPublishDone || postSt === "กำลังทำ") {
        waitPostCount += getChapterCount(q.chapter)
      }
    })

    return {
      totalSeries,
      pendingTranslateAndTypeset,
      postedTotal,
      waitPostCount,
      activeQueue,
    }
  }, [mangaList, queueList])

  // Calendar calculation
  const calendarData = React.useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    let firstDayIndex = firstDay.getDay() - 1
    if (firstDayIndex < 0) firstDayIndex = 6 // Monday start

    const daysInMonth = lastDay.getDate()
    // Monthly overview only shows translate and typeset (excluded extract per user requirement)
    const allowedMonthlySteps = ["translate", "typeset"]

    const getMonthlyTaskPriority = (q: any) => {
      const manga = mangaList.find(
        (m) => m.mangaid != null && q.mangaid != null && String(m.mangaid) === String(q.mangaid)
      )
      const urgent = isUrgentManga(manga)
      const stepKey = getQueueCurrentStep(q)

      if (stepKey === "translate") return urgent ? 1 : 2
      if (stepKey === "typeset") {
        const isDoing = String(q.typesetstatus || "").trim() === "กำลังทำ"
        return isDoing ? 3 : 4
      }
      return 5
    }

    const cells: Array<{
      day: number | null
      isToday?: boolean
      items: any[]
      moreCount: number
    }> = []

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ day: null, items: [], moreCount: 0 })
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const isToday =
        day === now.getDate() &&
        month === now.getMonth() &&
        year === now.getFullYear()

      const queueItemsOnDay = queueList.filter((q) => {
        const qDate = getQueueItemDate(q)
        if (!qDate) return false
        const isSameDay =
          qDate.getDate() === day &&
          qDate.getMonth() === month &&
          qDate.getFullYear() === year
        if (!isSameDay) return false
        const stepKey = getQueueCurrentStep(q)
        return allowedMonthlySteps.includes(stepKey)
      })

      queueItemsOnDay.sort((a, b) => {
        const pA = getMonthlyTaskPriority(a)
        const pB = getMonthlyTaskPriority(b)
        if (pA !== pB) return pA - pB
        const mangaA = mangaList.find(
          (m) => m.mangaid != null && a.mangaid != null && String(m.mangaid) === String(a.mangaid)
        )
        const mangaB = mangaList.find(
          (m) => m.mangaid != null && b.mangaid != null && String(m.mangaid) === String(b.mangaid)
        )
        const urgA = isUrgentManga(mangaA) ? 1 : 0
        const urgB = isUrgentManga(mangaB) ? 1 : 0
        if (urgA !== urgB) return urgB - urgA
        return (a.queueid || 0) - (b.queueid || 0)
      })

      const MAX_DISPLAY = 5
      cells.push({
        day,
        isToday,
        items: queueItemsOnDay.slice(0, MAX_DISPLAY),
        moreCount: Math.max(0, queueItemsOnDay.length - MAX_DISPLAY),
      })
    }

    // Prior month backlog (วันที่ 0) - Only tasks created before this month that are incomplete
    const dayZeroItems = queueList.filter((q) => {
      const qDate = getQueueItemDate(q)
      if (!qDate) return false
      const isBeforeThisMonth =
        qDate.getFullYear() < year ||
        (qDate.getFullYear() === year && qDate.getMonth() < month)
      if (!isBeforeThisMonth) return false
      if (isStepDone(q.poststatus)) return false
      const stepKey = getQueueCurrentStep(q)
      return allowedMonthlySteps.includes(stepKey)
    })

    dayZeroItems.sort((a, b) => {
      const pA = getMonthlyTaskPriority(a)
      const pB = getMonthlyTaskPriority(b)
      if (pA !== pB) return pA - pB
      const mangaA = mangaList.find(
        (m) => m.mangaid != null && a.mangaid != null && String(m.mangaid) === String(a.mangaid)
      )
      const mangaB = mangaList.find(
        (m) => m.mangaid != null && b.mangaid != null && String(m.mangaid) === String(b.mangaid)
      )
      const urgA = isUrgentManga(mangaA) ? 1 : 0
      const urgB = isUrgentManga(mangaB) ? 1 : 0
      if (urgA !== urgB) return urgB - urgA
      return (a.queueid || 0) - (b.queueid || 0)
    })

    return { cells, dayZeroItems }
  }, [year, month, mangaList, queueList])

  const calendarCells = calendarData.cells
  const dayZeroItems = calendarData.dayZeroItems

  const stepThaiNames: Record<string, string> = {
    upload: "อัป Raw",
    extract: "ดึงคำ",
    translate: "แปล",
    typeset: "ลงคำ",
    publish: "ตรวจ/ลงเว็บ",
    post: "โพสต์",
    finished: "เสร็จแล้ว",
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">หน้าแรก</h1>
        <p className="text-sm text-slate-400">
          ภาพรวมระบบและการปล่อยมังงะ (Smart Dashboard)
        </p>
      </div>

      {/* KuaiKan Insufficient Coins Warning Banner */}
      <KuaikanCoinWarningBanner
        onNavigateConnectors={onSwitchToConnectors}
        compact={false}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">มังงะทั้งหมด</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-white mt-1">
                {stats.totalSeries}
              </p>
            )}
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
            <BookOpen className="h-6 w-6" />
          </div>
        </Card>

        <Card
          onClick={() => onSwitchToQueue()}
          className="p-5 flex items-center justify-between cursor-pointer hover:border-amber-500/50 transition-colors"
          title="คลิกเพื่อไปที่หน้ารายการคิวงาน"
        >
          <div>
            <p className="text-xs font-medium text-slate-400">คิวงานที่ค้างอยู่</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-amber-300 mt-1">
                {stats.pendingTranslateAndTypeset}
              </p>
            )}
            <p className="text-[11px] text-slate-500 mt-0.5">งานแปล + ลงคำ</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <Clock className="h-6 w-6" />
          </div>
        </Card>

        <Card
          onClick={() => onSwitchToQueue()}
          className="p-5 flex items-center justify-between cursor-pointer hover:border-emerald-500/50 transition-colors"
          title="คลิกเพื่อไปที่หน้ารายการคิวงาน"
        >
          <div>
            <p className="text-xs font-medium text-slate-400">โพสต์แล้ว</p>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-emerald-400 mt-1">
                {stats.postedTotal}
              </p>
            )}
            <p className="text-[11px] text-slate-500 mt-0.5">เสร็จสิ้นในระบบ</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        </Card>

        <Card
          onClick={() => onSwitchToQueue()}
          className="p-5 flex items-center justify-between cursor-pointer hover:border-sky-500/50 transition-colors"
          title="คลิกเพื่อไปที่หน้ารายการคิวงาน (งานสถานะรอpublished)"
        >
          <div>
            <p className="text-xs font-medium text-slate-400">
              งานสถานะรอpublished
            </p>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold text-sky-400 mt-1">
                {stats.waitPostCount}
              </p>
            )}
            <p className="text-[11px] text-slate-500 mt-0.5">
              ตรวจ/ลงเว็บเสร็จแล้ว รอ published
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
            <Send className="h-6 w-6" />
          </div>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Monthly Release Schedule */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarIcon className="h-5 w-5 text-indigo-400" />
              ตารางงานประจำเดือน (Monthly Overview)
            </CardTitle>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onManualRefresh}
                className="h-8 gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <span className="text-sm font-medium text-slate-400">
                {THAI_MONTHS[month]} {year + 543}
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Color Guide */}
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#26334d] bg-[#0b1120]/60 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-xs bg-red-500/30 border-l-2 border-red-500 inline-block" />
                <span className="text-red-300 font-medium">🔥 รอแปล (ด่วน)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-xs bg-amber-500/30 border-l-2 border-amber-400 inline-block" />
                <span className="text-amber-200">รอแปล (ปกติ)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-xs bg-emerald-500/30 border-l-2 border-emerald-500 inline-block" />
                <span className="text-emerald-300 font-medium">
                  รอลงคำ / ลงคำ
                </span>
              </span>
            </div>

            {/* วันที่ 0: งานค้างจากเดือนก่อน */}
            {!isLoading && dayZeroItems.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 mb-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500 text-slate-950 font-black text-xs shadow-xs">
                      0
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-amber-200">
                      วันที่ 0: งานค้างจากเดือนก่อน
                    </span>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10 text-[10px] px-1.5 py-0">
                      {dayZeroItems.length} ตอนค้าง
                    </Badge>
                  </div>
                  <span className="text-[11px] text-amber-300/80">
                    งานเดือนก่อนๆ ที่ยังไม่เสร็จ (รอแปล / รอลงคำ) • คลิกเพื่อไปยังคิวงาน
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {dayZeroItems.map((q) => {
                    const manga = mangaList.find(
                      (m) =>
                        m.mangaid != null &&
                        q.mangaid != null &&
                        String(m.mangaid) === String(q.mangaid)
                    )
                    const fullName = manga ? manga.manganame : "Unknown"
                    let displayName = fullName
                    if (displayName.length > 20) {
                      displayName = displayName.substring(0, 20) + "..."
                    }
                    const searchKeyword = displayName
                      .replace(/\.\.\.+$/, "")
                      .replace(/…+$/, "")
                      .trim()
                    const urgent = isUrgentManga(manga)
                    const stepKey = getQueueCurrentStep(q)

                    let badgeStyle =
                      "bg-slate-800 text-slate-200 border-l-2 border-slate-400"
                    if (stepKey === "translate") {
                      badgeStyle = urgent
                        ? "bg-red-500/25 text-red-200 border-l-2 border-red-500 font-medium"
                        : "bg-amber-500/25 text-amber-200 border-l-2 border-amber-400"
                    } else if (stepKey === "typeset") {
                      const isDoing =
                        String(q.typesetstatus || "").trim() === "กำลังทำ"
                      badgeStyle = isDoing
                        ? "bg-emerald-500/30 text-emerald-200 border-l-2 border-emerald-500 font-medium"
                        : "bg-emerald-500/20 text-emerald-300 border-l-2 border-emerald-400"
                    }

                    return (
                      <div
                        key={q.queueid}
                        onClick={() => onSwitchToQueue(searchKeyword)}
                        title={`${fullName} ตอนที่ ${q.chapter} (${stepThaiNames[stepKey] || stepKey})`}
                        className={`truncate rounded px-2 py-1 text-xs cursor-pointer hover:opacity-85 transition-opacity ${badgeStyle}`}
                      >
                        {urgent ? "🔥 " : ""}
                        {displayName} #{q.chapter}
                        <span className="ml-1 opacity-75 text-[10px]">({stepThaiNames[stepKey] || stepKey})</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((d) => (
                  <div
                    key={d}
                    className="py-1.5 text-center text-xs font-semibold text-slate-400 bg-[#0d1322] rounded-md"
                  >
                    {d}
                  </div>
                ))}

                {calendarCells.map((cell, idx) => {
                  if (cell.day === null) {
                    return (
                      <div
                        key={`pad-${idx}`}
                        className="min-h-[96px] rounded-lg bg-[#0b0f19]/40 border border-transparent"
                      />
                    )
                  }

                  return (
                    <div
                      key={`day-${cell.day}`}
                      className={`min-h-[96px] rounded-lg border p-1.5 flex flex-col gap-1 ${
                        cell.isToday
                          ? "border-indigo-500 bg-indigo-950/20"
                          : "border-[#1a2337] bg-[#0d1322]/60"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-300 px-0.5">
                        <span>{cell.day}</span>
                        {cell.isToday && (
                          <span className="text-[10px] text-indigo-400 font-bold">
                            วันนี้
                          </span>
                        )}
                      </div>

                      <div className="space-y-1">
                        {cell.items.map((q) => {
                          const manga = mangaList.find(
                            (m) =>
                              m.mangaid != null &&
                              q.mangaid != null &&
                              String(m.mangaid) === String(q.mangaid)
                          )
                          const fullName = manga ? manga.manganame : "Unknown"
                          let displayName = fullName
                          if (displayName.length > 18) {
                            displayName = displayName.substring(0, 18) + "..."
                          }
                          const searchKeyword = displayName
                            .replace(/\.\.\.+$/, "")
                            .replace(/…+$/, "")
                            .trim()
                          const urgent = isUrgentManga(manga)
                          const stepKey = getQueueCurrentStep(q)

                          let badgeStyle =
                            "bg-slate-800 text-slate-200 border-l-2 border-slate-400"
                          if (stepKey === "translate") {
                            badgeStyle = urgent
                              ? "bg-red-500/20 text-red-200 border-l-2 border-red-500 font-medium"
                              : "bg-amber-500/20 text-amber-200 border-l-2 border-amber-400"
                          } else if (stepKey === "typeset") {
                            const isDoing =
                              String(q.typesetstatus || "").trim() === "กำลังทำ"
                            badgeStyle = isDoing
                              ? "bg-emerald-500/25 text-emerald-200 border-l-2 border-emerald-500 font-medium"
                              : "bg-emerald-500/15 text-emerald-300 border-l-2 border-emerald-400"
                          } else if (stepKey === "extract") {
                            badgeStyle =
                              "bg-orange-500/20 text-orange-200 border-l-2 border-orange-400"
                          }

                          return (
                            <div
                              key={q.queueid}
                              onClick={() => onSwitchToQueue(searchKeyword)}
                              title={`${fullName} ตอนที่ ${q.chapter}`}
                              className={`truncate rounded px-1.5 py-0.5 text-[11px] cursor-pointer hover:opacity-85 transition-opacity ${badgeStyle}`}
                            >
                              {urgent ? "🔥 " : ""}
                              {displayName} #{q.chapter}
                            </div>
                          )
                        })}

                        {cell.moreCount > 0 && (
                          <div
                            onClick={() => onSwitchToQueue()}
                            className="text-[10px] text-slate-400 text-center cursor-pointer hover:text-indigo-300"
                          >
                            +อีก {cell.moreCount} รายการ
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Pending Works */}
        <Card className="flex flex-col max-h-[680px]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-amber-400" />
              งานที่รอดำเนินการ ({stats.activeQueue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-y-auto space-y-2.5 flex-1">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))
            ) : stats.activeQueue.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-8">
                ไม่มีงานค้าง ยอดเยี่ยมมาก! 🎉
              </p>
            ) : (
              stats.activeQueue.map((q) => {
                const manga = mangaList.find(
                  (m) =>
                    m.mangaid != null &&
                    q.mangaid != null &&
                    String(m.mangaid) === String(q.mangaid)
                )
                const mangaName = manga ? manga.manganame : "มังงะไม่ทราบชื่อ"
                const urgent = isUrgentManga(manga)
                const stepKey = getQueueCurrentStep(q)
                const currentStep = stepThaiNames[stepKey] || "กำลังรอเริ่ม"

                return (
                  <div
                    key={q.queueid}
                    onClick={() => onOpenUpdateQueue(q)}
                    className="rounded-lg border border-[#26334d] bg-[#0d1322] p-3 hover:border-indigo-500/50 hover:bg-[#1c273e]/50 transition-all cursor-pointer space-y-1"
                  >
                    <div className="font-medium text-sm text-slate-100 flex items-center justify-between gap-2">
                      <span className="truncate">
                        {urgent && "🔥 "}
                        {mangaName} - ตอนที่ {q.chapter}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        ขั้นตอนนี้:{" "}
                        <strong className="text-indigo-300">
                          {currentStep}
                        </strong>
                      </span>
                      <span>
                        {q.createdat ? timeSince(q.createdat) : ""}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

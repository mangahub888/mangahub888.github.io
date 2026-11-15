import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { isUrgentManga, isTranslatePayoutExcluded, timeSince } from "@/lib/utils"
import { callGasApi, DEFAULT_GAS_URL, getGasUrl, setGasUrl } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Link2,
  RotateCcw,
  FileText,
  Users,
  Coins,
  CheckCircle2,
  Loader2,
  Search,
} from "lucide-react"

interface MangaSettingsViewProps {
  mangaList: any[]
  onOpenAddManga: () => void
  onOpenEditManga: (manga: any) => void
  onMangaChange: (newManga: any[]) => void
  onQueueChange: (newQueue: any[]) => void
}

export function MangaSettingsView({
  mangaList,
  onOpenAddManga,
  onOpenEditManga,
  onMangaChange,
  onQueueChange,
}: MangaSettingsViewProps) {
  const [gasUrlInput, setGasUrlInput] = React.useState(getGasUrl())
  const [updatingPayoutId, setUpdatingPayoutId] = React.useState<string | number | null>(null)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [filterPayout, setFilterPayout] = React.useState<"all" | "excluded" | "included">("all")

  const handleToggleExcludePayout = async (manga: any) => {
    const mangaId = manga.mangaid
    const currentExcluded = isTranslatePayoutExcluded(manga)
    const newExcluded = !currentExcluded
    setUpdatingPayoutId(mangaId)

    // Optimistic update
    const updatedList = mangaList.map((m) =>
      String(m.mangaid) === String(mangaId)
        ? { ...m, excludetranslatepayout: newExcluded, ExcludeTranslatePayout: newExcluded }
        : m
    )
    onMangaChange(updatedList)

    try {
      const payload = {
        ...manga,
        excludetranslatepayout: newExcluded,
      }
      const res = await callGasApi("UPDATE_MANGA", {
        id: mangaId,
        data: payload,
      })
      if (Array.isArray(res)) {
        onMangaChange(res)
      }
      toast.success(
        newExcluded
          ? `ตั้งค่า "${manga.manganame}": ไม่เข้าเกณฑ์นับยอดเบิกจ่ายแล้ว`
          : `ตั้งค่า "${manga.manganame}": นับยอดเบิกจ่ายตามปกติแล้ว`
      )
    } catch (err: any) {
      // Revert optimistic update
      onMangaChange(mangaList)
      toast.error(err.message || "เกิดข้อผิดพลาดในการอัปเดตเกณฑ์เบิกจ่าย")
    } finally {
      setUpdatingPayoutId(null)
    }
  }

  const filteredMangaList = React.useMemo(() => {
    return mangaList.filter((m) => {
      const q = searchQuery.trim().toLowerCase()
      const matchQuery =
        !q ||
        (m.manganame && m.manganame.toLowerCase().includes(q)) ||
        (m.originalname && m.originalname.toLowerCase().includes(q)) ||
        (m.slug && m.slug.toLowerCase().includes(q)) ||
        (m.scangroup && m.scangroup.toLowerCase().includes(q))

      if (!matchQuery) return false

      const isExcluded = isTranslatePayoutExcluded(m)
      if (filterPayout === "excluded") return isExcluded
      if (filterPayout === "included") return !isExcluded
      return true
    })
  }, [mangaList, searchQuery, filterPayout])

  const totalExcluded = React.useMemo(() => {
    return mangaList.filter((m) => isTranslatePayoutExcluded(m)).length
  }, [mangaList])

  const handleDeleteManga = async (id: string) => {
    if (!window.confirm("ยืนยันการลบมังงะเรื่องนี้หรือไม่? ข้อมูลจะถูกลบถาวร"))
      return
    try {
      const res = await callGasApi("DELETE_MANGA", { id })
      toast.success("ลบข้อมูลมังงะเรียบร้อยแล้ว")
      onMangaChange(Array.isArray(res) ? res : [])
    } catch (err: any) {
      toast.error(err.message || "ลบข้อมูลไม่สำเร็จ")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">จัดการข้อมูลมังงะ</h2>
          <p className="text-sm text-slate-400">
            เพิ่ม ลบ หรือแก้ไขข้อมูลมังงะในระบบ (v2.0 - Slug & Auto-Update Active)
          </p>
        </div>
        <Button onClick={onOpenAddManga}>
          <Plus className="h-4 w-4" /> เพิ่มมังงะใหม่
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0f172a]/70 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="ค้นหาชื่อเรื่อง, Slug, หรือชื่อค่าย..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-[#0b1120] border-slate-700 text-sm placeholder:text-slate-500"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            type="button"
            variant={filterPayout === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPayout("all")}
            className="text-xs h-8"
          >
            ทั้งหมด ({mangaList.length})
          </Button>
          <Button
            type="button"
            variant={filterPayout === "included" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPayout("included")}
            className={`text-xs h-8 ${
              filterPayout === "included"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "text-emerald-400 hover:text-emerald-300 border-emerald-500/30"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            นับยอดปกติ ({mangaList.length - totalExcluded})
          </Button>
          <Button
            type="button"
            variant={filterPayout === "excluded" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPayout("excluded")}
            className={`text-xs h-8 ${
              filterPayout === "excluded"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "text-amber-400 hover:text-amber-300 border-amber-500/40"
            }`}
          >
            <Coins className="h-3.5 w-3.5 mr-1" />
            ไม่นับยอดเบิกจ่าย ({totalExcluded})
          </Button>
        </div>
      </div>

      {/* Manga Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ชื่อมังงะ</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead>วันปล่อยดิบ</TableHead>
              <TableHead>ตอนล่าสุด</TableHead>
              <TableHead>Google Docs รวมแปล</TableHead>
              <TableHead className="text-center min-w-[170px] bg-amber-500/5">
                <span className="flex items-center justify-center gap-1 text-amber-300 font-semibold">
                  <Coins className="h-3.5 w-3.5" /> เกณฑ์เบิกจ่าย (แปล)
                </span>
              </TableHead>
              <TableHead>อัปเดตล่าสุด</TableHead>
              <TableHead className="text-center w-28">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMangaList.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-12 text-slate-400"
                >
                  {searchQuery || filterPayout !== "all"
                    ? "ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา/ตัวกรอง"
                    : "ไม่มีข้อมูลแสดงผล"}
                </TableCell>
              </TableRow>
            ) : (
              filteredMangaList.map((m) => {
                const urgent = isUrgentManga(m)
                const excludeTranslate = isTranslatePayoutExcluded(m)
                const scanGroup = m.scangroup || m.ScanGroup || ""
                return (
                  <TableRow key={m.mangaid}>
                    <TableCell>
                      <div className="font-semibold text-slate-100 flex items-center gap-1.5 flex-wrap">
                        {urgent && <span>🔥</span>}
                        <span>{m.manganame || "Untitled"}</span>
                        {scanGroup && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-purple-950/60 border border-purple-500/40 px-1.5 py-0.5 text-[10px] font-medium text-purple-300"
                            title={`ค่ายแปลต้นฉบับ: ${scanGroup}`}
                          >
                            <Users className="h-2.5 w-2.5 text-purple-400" />
                            {scanGroup}
                          </span>
                        )}
                        {excludeTranslate && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-amber-950/80 border border-amber-500/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 shadow-sm"
                            title="เรื่องนี้ไม่เข้าเกณฑ์นับยอดเบิกจ่ายของการแปล"
                          >
                            <Coins className="h-2.5 w-2.5 text-amber-400" />
                            ไม่นับยอดแปล
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
                        {m.originalurl ? (
                          <a
                            href={m.originalurl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-400 hover:underline"
                          >
                            {m.originalname || "Link"}{" "}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          m.originalname || "-"
                        )}
                        {m.translationdocurl && (
                          <a
                            href={m.translationdocurl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-800/50"
                            title="เปิด Google Docs เก็บงานแปลทุกตอน"
                          >
                            <FileText className="h-3 w-3" />
                            Docs รวมแปล
                            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-amber-300">
                      {m.slug || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.status === "Ongoing" ? "success" : "secondary"
                        }
                      >
                        {m.status || "Ongoing"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-300">
                      {m.releaseday && m.releaseday !== "None"
                        ? m.releaseday
                        : "-"}
                    </TableCell>
                    <TableCell className="font-medium">
                      Ch. {m.lastchapter || "0"}
                    </TableCell>
                    <TableCell>
                      {m.translationdocurl ? (
                        <a
                          href={m.translationdocurl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 hover:text-blue-300 transition-colors"
                          title={m.translationdocurl}
                        >
                          <FileText className="h-3.5 w-3.5 text-blue-400" />
                          เปิด Docs
                          <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpenEditManga(m)}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-400 transition-colors"
                          title="คลิกเพื่อแก้ไขและใส่ลิงก์ Google Docs"
                        >
                          <Plus className="h-3 w-3" /> เพิ่มลิงก์ Docs
                        </button>
                      )}
                    </TableCell>

                    {/* Quick Toggle เกณฑ์เบิกจ่าย */}
                    <TableCell className="text-center bg-amber-500/5">
                      <button
                        type="button"
                        disabled={updatingPayoutId === m.mangaid}
                        onClick={() => handleToggleExcludePayout(m)}
                        title={
                          excludeTranslate
                            ? "ขณะนี้: ไม่นับยอดเบิกจ่าย (คลิกเพื่อเปลี่ยนเป็นนับยอดปกติ)"
                            : "ขณะนี้: นับยอดปกติ (คลิกเพื่อยกเว้นการนับยอดเบิกจ่าย)"
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border shadow-sm ${
                          excludeTranslate
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/60 hover:bg-amber-500/30 hover:border-amber-400"
                            : "bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white hover:border-slate-500"
                        }`}
                      >
                        {updatingPayoutId === m.mangaid ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                        ) : excludeTranslate ? (
                          <Coins className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span>
                          {updatingPayoutId === m.mangaid
                            ? "กำลังบันทึก..."
                            : excludeTranslate
                            ? "ไม่นับยอดเบิกจ่าย"
                            : "นับยอดปกติ"}
                        </span>
                      </button>
                    </TableCell>

                    <TableCell className="text-xs text-slate-400">
                      <div>{timeSince(m.lastupdated)}</div>
                      {m.lastupdated && (
                        <div className="text-[11px] text-slate-500">
                          {new Date(m.lastupdated).toLocaleDateString("th-TH")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onOpenEditManga(m)}
                          title="แก้ไขข้อมูลมังงะ"
                        >
                          <Pencil className="h-3.5 w-3.5 text-indigo-400" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDeleteManga(String(m.mangaid))}
                          title="ลบมังงะ"
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

      {/* GAS API URL Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-indigo-400" />
            ตั้งค่า GAS API URL (Web App Endpoint)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-400">
            ใช้สำหรับเปลี่ยนลิงก์เชื่อมต่อกรณีที่มีการ Deploy Web App ใหม่บน Google Apps Script
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Input
              type="url"
              value={gasUrlInput}
              onChange={(e) => setGasUrlInput(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="flex-1 text-xs font-mono"
            />
            <Button
              size="sm"
              onClick={() => {
                setGasUrl(gasUrlInput)
                toast.success("บันทึก GAS API URL เรียบร้อยแล้ว")
              }}
            >
              บันทึก URL
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setGasUrlInput(DEFAULT_GAS_URL)
                setGasUrl(DEFAULT_GAS_URL)
                toast.info("คืนค่าเป็น URL เริ่มต้นแล้ว")
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> ค่าเริ่มต้น
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

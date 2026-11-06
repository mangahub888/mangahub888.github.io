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
import { isUrgentManga, timeSince } from "@/lib/utils"
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
            เพิ่ม ลบ หรือแก้ไขข้อมูลมังงะในระบบ (v2.0 - Slug & Auto-Update
            Active)
          </p>
        </div>
        <Button onClick={onOpenAddManga}>
          <Plus className="h-4 w-4" /> เพิ่มมังงะใหม่
        </Button>
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
              <TableHead>อัปเดตล่าสุด</TableHead>
              <TableHead className="text-center w-28">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mangaList.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-12 text-slate-400"
                >
                  ไม่มีข้อมูลแสดงผล
                </TableCell>
              </TableRow>
            ) : (
              mangaList.map((m) => {
                const urgent = isUrgentManga(m)
                return (
                  <TableRow key={m.mangaid}>
                    <TableCell>
                      <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                        {urgent && <span>🔥</span>}
                        {m.manganame || "Untitled"}
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
                        >
                          <Pencil className="h-3.5 w-3.5 text-indigo-400" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDeleteManga(String(m.mangaid))}
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

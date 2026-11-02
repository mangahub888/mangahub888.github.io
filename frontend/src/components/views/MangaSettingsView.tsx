import * as React from "react"
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
import { isUrgentManga, timeSince } from "@/lib/utils"
import { callGasApi, DEFAULT_GAS_URL, getGasUrl, setGasUrl } from "@/api/gasClient"
import { toast } from "sonner"
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  Play,
  Database,
  Link2,
  RotateCcw,
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
  const [triggerLoading, setTriggerLoading] = React.useState(false)
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

  const handleCreateMoveTrigger = async () => {
    setTriggerLoading(true)
    try {
      const res = await callGasApi("CREATE_MOVE_PENDING_TRIGGER")
      toast.success(res.message || "ตั้งเวลาย้ายงานค้างเรียบร้อย")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    } finally {
      setTriggerLoading(false)
    }
  }

  const handleManualMovePending = async () => {
    if (
      !window.confirm(
        "ระบบจะย้ายงานที่ยังโพสต์ไม่เสร็จทั้งหมดจากเดือนก่อนๆ มาเป็นเดือนปัจจุบัน ยืนยันหรือไม่?"
      )
    )
      return
    setTriggerLoading(true)
    try {
      const res = await callGasApi("MOVE_PENDING_QUEUE")
      toast.success(res.message || "ย้ายงานค้างเรียบร้อย")
      if (res.queue) onQueueChange(res.queue)
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    } finally {
      setTriggerLoading(false)
    }
  }

  const handleCreateAutoQueueTrigger = async () => {
    setTriggerLoading(true)
    try {
      const res = await callGasApi("CREATE_AUTO_QUEUE_TRIGGER")
      toast.success(res.message || "ตั้งเวลาคิวงานอัตโนมัติเรียบร้อย")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    } finally {
      setTriggerLoading(false)
    }
  }

  const handleInitSheets = async () => {
    setTriggerLoading(true)
    try {
      await callGasApi("INIT_SHEETS")
      toast.success("ตรวจสอบและสร้างหัวตารางใน Google Sheets เรียบร้อยแล้ว!")
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด")
    } finally {
      setTriggerLoading(false)
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
              <TableHead>อัปเดตล่าสุด</TableHead>
              <TableHead className="text-center w-28">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mangaList.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
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
                      <div className="text-xs text-slate-400 mt-0.5">
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

      {/* System Triggers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            ⚙️ ตั้งค่าระบบอัตโนมัติ (System Triggers & Database)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2 rounded-xl border border-[#26334d] bg-[#0d1322] p-4">
            <h4 className="font-semibold text-sm text-slate-100">
              ย้ายงานค้างอัตโนมัติ
            </h4>
            <p className="text-xs text-slate-400">
              ย้ายงานที่ยังโพสต์ไม่เสร็จจากเดือนก่อนๆ มายังเดือนปัจจุบันโดยอัตโนมัติทุกวัน
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm"
                onClick={handleCreateMoveTrigger}
                disabled={triggerLoading}
              >
                <Clock className="h-3.5 w-3.5" /> ตั้งเวลาออโต้ (03:00 น.)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleManualMovePending}
                disabled={triggerLoading}
              >
                <Play className="h-3.5 w-3.5" /> รันเดี๋ยวนี้ (Manual)
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-[#26334d] bg-[#0d1322] p-4">
            <h4 className="font-semibold text-sm text-slate-100">
              คิวงานอัตโนมัติ (MangaList) <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">ปิดใช้งานแล้ว</Badge>
            </h4>
            <p className="text-xs text-slate-400">
              ระบบเพิ่มมังงะเข้าคิวงานตามวันปล่อยดิบ (Release Day) ถูกปิดใช้งานแล้ว (กดเพื่อลบ Trigger เก่า)
            </p>
            <div className="pt-2">
              <Button
                size="sm"
                onClick={handleCreateAutoQueueTrigger}
                disabled={triggerLoading}
              >
                <Clock className="h-3.5 w-3.5" /> ลบ Trigger อัตโนมัติ (ปิดใช้งาน)
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-[#26334d] bg-[#0d1322] p-4">
            <h4 className="font-semibold text-sm text-slate-100">
              เตรียมตาราง Google Sheets
            </h4>
            <p className="text-xs text-slate-400">
              สร้างแท็บตารางและคอลัมน์มาตรฐานทั้งหมดใน Google Sheet ใหม่อัตโนมัติ
            </p>
            <div className="pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleInitSheets}
                disabled={triggerLoading}
              >
                <Database className="h-3.5 w-3.5 text-emerald-400" />
                สร้าง/ตรวจสอบ Sheets ทั้งหมด
              </Button>
            </div>
          </div>

          <div className="md:col-span-3 space-y-2 rounded-xl border border-[#26334d] bg-[#0d1322] p-4">
            <Label className="flex items-center gap-1.5 font-semibold text-sm text-slate-100">
              <Link2 className="h-4 w-4 text-indigo-400" />
              ตั้งค่า GAS API URL (Web App Endpoint)
            </Label>
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

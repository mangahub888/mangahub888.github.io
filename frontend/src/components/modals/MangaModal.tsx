import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { RELEASE_DAYS, isUrgentManga } from "@/lib/utils"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import { Bell, Flame, Link as LinkIcon, FileText, ExternalLink } from "lucide-react"

const mangaSchema = z.object({
  manganame: z.string().min(1, "กรุณาระบุชื่อมังงะ (ภาษาไทย)"),
  originalname: z.string().optional(),
  originalurl: z.string().optional(),
  slug: z.string().optional(),
  translationdocurl: z.string().optional(),
  status: z.string().default("Ongoing"),
  lastchapter: z.union([z.string(), z.number()]).default("0"),
  costperchapter: z.union([z.string(), z.number()]).default(0),
  lockedtranslator: z.string().optional(),
  needsextract: z.boolean().default(true),
  notifyonadd: z.boolean().default(false),
  isurgent: z.boolean().default(false),
})

type MangaFormValues = z.infer<typeof mangaSchema>

interface MangaModalProps {
  open: boolean
  onClose: () => void
  editItem?: any | null
  teamList: any[]
  onSuccess: (updatedList: any[], newMangaId?: string | number) => void
}

export function MangaModal({
  open,
  onClose,
  editItem,
  teamList,
  onSuccess,
}: MangaModalProps) {
  const [selectedDays, setSelectedDays] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MangaFormValues>({
    resolver: zodResolver(mangaSchema),
    defaultValues: {
      manganame: "",
      originalname: "",
      originalurl: "",
      slug: "",
      translationdocurl: "",
      status: "Ongoing",
      lastchapter: "0",
      costperchapter: 0,
      lockedtranslator: "",
      needsextract: true,
      notifyonadd: false,
      isurgent: false,
    },
  })

  React.useEffect(() => {
    if (open) {
      if (editItem) {
        reset({
          manganame: editItem.manganame || "",
          originalname: editItem.originalname || "",
          originalurl: editItem.originalurl || "",
          slug: editItem.slug || "",
          translationdocurl: editItem.translationdocurl || editItem.TranslationDocUrl || "",
          status: editItem.status || "Ongoing",
          lastchapter: editItem.lastchapter ?? "0",
          costperchapter: editItem.costperchapter ?? 0,
          lockedtranslator: editItem.lockedtranslator || "",
          needsextract:
            editItem.needsextract === undefined
              ? true
              : editItem.needsextract === true ||
                String(editItem.needsextract).toLowerCase() === "true",
          notifyonadd:
            editItem.notifyonadd === true ||
            String(editItem.notifyonadd).toLowerCase() === "true",
          isurgent: isUrgentManga(editItem),
        })
        if (editItem.releaseday && editItem.releaseday !== "None") {
          setSelectedDays(
            String(editItem.releaseday)
              .split(",")
              .map((d: string) => d.trim())
              .filter(Boolean)
          )
        } else {
          setSelectedDays([])
        }
      } else {
        reset({
          manganame: "",
          originalname: "",
          originalurl: "",
          slug: "",
          status: "Ongoing",
          lastchapter: "0",
          costperchapter: 0,
          lockedtranslator: "",
          needsextract: true,
          notifyonadd: false,
          isurgent: false,
        })
        setSelectedDays([])
      }
    }
  }, [open, editItem, reset])

  const translatorOptions = React.useMemo(() => {
    const active = (teamList || []).filter(
      (m) =>
        m.status === "Active" &&
        (m.role === "Translator" || m.role === "Multi-role")
    )
    return [
      { value: "", label: "-- ไม่มีการล็อคคนแปล --" },
      ...active.map((m) => ({ value: m.name, label: m.name })),
    ]
  }, [teamList])

  const toggleDay = (dayVal: string) => {
    setSelectedDays((prev) =>
      prev.includes(dayVal)
        ? prev.filter((d) => d !== dayVal)
        : [...prev, dayVal]
    )
  }

  const onSubmit = async (values: MangaFormValues) => {
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        releaseday: selectedDays.length > 0 ? selectedDays.join(", ") : "None",
      }

      if (editItem?.mangaid) {
        const updatedList = await callGasApi("UPDATE_MANGA", {
          id: editItem.mangaid,
          data: payload,
        })
        toast.success("อัปเดตข้อมูลมังงะเรียบร้อยแล้ว")
        onSuccess(Array.isArray(updatedList) ? updatedList : [])
      } else {
        const res = await callGasApi("ADD_MANGA", payload)
        toast.success("เพิ่มมังงะใหม่เรียบร้อยแล้ว")
        onSuccess(res.list || [], res.mangaId)
      }
      onClose()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล")
    } finally {
      setSubmitting(false)
    }
  }

  const lockedTranslator = watch("lockedtranslator") || ""
  const needsExtract = watch("needsextract")
  const notifyOnAdd = watch("notifyonadd")
  const isUrgent = watch("isurgent")

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {editItem ? "แก้ไขข้อมูลมังงะ" : "เพิ่มมังงะใหม่"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          {/* CRITICAL SLUG FIELD */}
          <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4 space-y-2">
            <Label className="text-amber-300 font-semibold flex items-center gap-1.5 text-base">
              <LinkIcon className="h-4 w-4" /> Manga Slug (ID สำหรับอัปเดตเว็บ)
            </Label>
            <Input
              placeholder="เช่น solo-leveling"
              className="border-amber-500/50 bg-[#0b0f19]"
              {...register("slug")}
            />
            <p className="text-xs text-amber-300/80">
              ⚠️ จำเป็น: ต้องตรงกับ ID บนเว็บเพื่อให้ระบบอัปเดตตอนให้อัตโนมัติเมื่อ Publish/Post
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>ชื่อมังงะ (ภาษาไทย) *</Label>
            <Input placeholder="เช่น วันพีซ" {...register("manganame")} />
            {errors.manganame && (
              <p className="text-xs text-red-400">{errors.manganame.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>ชื่อต้นฉบับ (อังกฤษ/ญี่ปุ่น)</Label>
              <Input placeholder="เช่น One Piece" {...register("originalname")} />
            </div>
            <div className="space-y-1.5">
              <Label>URL ต้นฉบับ</Label>
              <Input placeholder="https://..." {...register("originalurl")} />
            </div>
          </div>

          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-blue-300 font-medium">
                <FileText className="h-4 w-4 text-blue-400" />
                Google Docs เก็บงานแปล (ทุกตอน)
              </Label>
              {watch("translationdocurl") && (
                <a
                  href={watch("translationdocurl")}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 font-medium"
                >
                  เปิดไฟล์ Docs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <Input
              placeholder="https://docs.google.com/document/d/.../edit"
              className="border-blue-500/40 bg-[#0b1120] text-sm focus:border-blue-400"
              {...register("translationdocurl")}
            />
            <p className="text-[11px] text-slate-400">
              ลิงก์ Google Docs กลางสำหรับรวบรวมงานแปลทุกตอนของเรื่องนี้ (1 เรื่อง ต่อ 1 ลิ้งก์)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>สถานะ</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                {...register("status")}
              >
                <option value="Ongoing">กำลังอ่าน (Ongoing)</option>
                <option value="Completed">จบแล้ว (Completed)</option>
                <option value="Drop">ดอง/เลิกอ่าน (Drop)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>ตอนที่ทำถึง</Label>
              <Input type="number" step="any" {...register("lastchapter")} />
            </div>
            <div className="space-y-1.5">
              <Label>ต้นทุนต่อตอน (บาท)</Label>
              <Input type="number" step="0.01" {...register("costperchapter")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>ผู้แปลหลัก (Auto-select)</Label>
            <SearchableSelect
              options={translatorOptions}
              value={lockedTranslator}
              onChange={(val) => setValue("lockedtranslator", val)}
              placeholder="-- ไม่มีการล็อคคนแปล --"
              searchPlaceholder="ค้นหาคนแปล..."
            />
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 rounded-lg border border-[#26334d] bg-[#0b1120] p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={needsExtract}
                onChange={(e) => setValue("needsextract", e.target.checked)}
                className="h-4 w-4 accent-indigo-500 rounded"
              />
              <span className="text-sm text-slate-200 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-indigo-400" />
                ต้องดึงคำ (Requires Text Extraction)
              </span>
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnAdd}
                onChange={(e) => setValue("notifyonadd", e.target.checked)}
                className="h-4 w-4 accent-orange-500 rounded"
              />
              <span className="text-sm font-medium text-orange-300 flex items-center gap-1.5">
                <Bell className="h-4 w-4" />
                แจ้งเตือน Telegram เมื่อเพิ่มคิวงาน
              </span>
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setValue("isurgent", e.target.checked)}
                className="h-4 w-4 accent-red-500 rounded"
              />
              <span className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                <Flame className="h-4 w-4" />
                งานด่วน (Urgent) — แสดงชื่อเรื่องเป็นสีแดงในหน้าจัดการคิวงาน
              </span>
            </label>
          </div>

          {/* Release Days */}
          <div className="space-y-2">
            <Label>วันปล่อยดิบ (Release Day)</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-[#26334d] bg-[#0b1120] p-3">
              {RELEASE_DAYS.map((day) => {
                const checked = selectedDays.includes(day.value)
                return (
                  <label
                    key={day.value}
                    className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDay(day.value)}
                      className="h-4 w-4 accent-indigo-500 rounded"
                    />
                    {day.label}
                  </label>
                )
              })}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
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
  )
}

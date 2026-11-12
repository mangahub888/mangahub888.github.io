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
import {
  Bell,
  Flame,
  Link as LinkIcon,
  FileText,
  ExternalLink,
  Users,
  RefreshCw,
  Search,
} from "lucide-react"
import { ComixUrlSearchDialog } from "@/components/modals/ComixUrlSearchDialog"

const mangaSchema = z.object({
  manganame: z.string().min(1, "กรุณาระบุชื่อมังงะ (ภาษาไทย)"),
  originalname: z.string().optional(),
  originalurl: z.string().optional(),
  slug: z.string().optional(),
  translationdocurl: z.string().optional(),
  scangroup: z.string().optional(),
  status: z.string().default("Ongoing"),
  lastchapter: z.union([z.string(), z.number()]).default("0"),
  costperchapter: z.union([z.string(), z.number()]).default(0),
  lockedtranslator: z.string().optional(),
  lockedtypesetter: z.string().optional(),
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
  const [comixGroups, setComixGroups] = React.useState<
    Array<{ id: string; name: string }>
  >([])
  const [loadingGroups, setLoadingGroups] = React.useState(false)
  const [comixSearchOpen, setComixSearchOpen] = React.useState(false)

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
      scangroup: "",
      status: "Ongoing",
      lastchapter: "0",
      costperchapter: 0,
      lockedtranslator: "",
      needsextract: true,
      notifyonadd: false,
      isurgent: false,
    },
  })

  // ดึงรายชื่อค่ายแปลแบบรายครั้งเมื่อผู้ใช้กดปุ่ม
  const fetchGroupsFromUrl = async (targetUrl: string) => {
    const clean = (targetUrl || "").trim()
    if (!clean) {
      toast.error("กรุณาวางลิงก์ในช่อง URL ต้นฉบับก่อนกดดึงชื่อค่ายแปล")
      return
    }
    setLoadingGroups(true)
    try {
      const res = await callGasApi<any>("GET_COMIX_GROUPS", { url: clean })
      if (res && res.success && Array.isArray(res.groups) && res.groups.length > 0) {
        setComixGroups(res.groups)
        toast.success(`ดึงรายชื่อค่ายแปลมาใส่ Dropdown แล้ว (${res.groups.length} ค่าย)`)
      } else {
        toast.error(res?.error || "ไม่พบรายชื่อค่ายแปลจากลิงก์นี้ (คุณสามารถพิมพ์ชื่อค่ายเองได้)")
      }
    } catch (err: any) {
      toast.error(err.message || "ดึงข้อมูลค่ายแปลไม่สำเร็จ")
    } finally {
      setLoadingGroups(false)
    }
  }

  const handleSelectComixItem = (item: {
    url: string
    title: string
    alt_titles?: string[]
    chapter_count?: number
    status?: string
    origin?: string
    cover?: string
  }) => {
    // 1. Set URL
    setValue("originalurl", item.url, { shouldDirty: true, shouldValidate: true })

    // 2. Set original name if empty
    if (!watch("originalname")) {
      setValue("originalname", item.title, { shouldDirty: true })
    }

    // 3. Set manganame if empty
    if (!watch("manganame")) {
      setValue("manganame", item.title, { shouldDirty: true })
    }

    // 4. Set lastchapter if empty or "0"
    const currentChap = watch("lastchapter")
    if (!currentChap || currentChap === "0") {
      setValue("lastchapter", String(item.chapter_count || "0"), { shouldDirty: true })
    }

    // 5. Generate slug if empty
    if (!watch("slug")) {
      let cleanSlug = ""
      const comixMatch = item.url.match(/comix\.to\/title\/[a-z0-9]+-(.+)/i)
      const mgekoMatch = item.url.match(/mgeko\.cc\/manga\/(?:[a-z0-9]+-)?([^/]+)/i)
      if (comixMatch && comixMatch[1]) {
        cleanSlug = comixMatch[1].toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      } else if (mgekoMatch && mgekoMatch[1]) {
        cleanSlug = mgekoMatch[1].toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      } else {
        cleanSlug = item.title.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      }
      if (cleanSlug) {
        setValue("slug", cleanSlug, { shouldDirty: true })
      }
    }

    // 6. Automatically trigger scan group fetching if Comix URL
    if (item.url.includes("comix.to")) {
      fetchGroupsFromUrl(item.url)
    }

    toast.success(`เลือก "${item.title}" เรียบร้อยแล้ว (ใส่ URL ต้นฉบับสำเร็จ)`)
  }

  React.useEffect(() => {
    if (open) {
      setComixGroups([])
      if (editItem) {
        const initUrl = editItem.originalurl || ""
        reset({
          manganame: editItem.manganame || "",
          originalname: editItem.originalname || "",
          originalurl: initUrl,
          slug: editItem.slug || "",
          translationdocurl:
            editItem.translationdocurl || editItem.TranslationDocUrl || "",
          scangroup: editItem.scangroup || editItem.ScanGroup || "",
          status: editItem.status || "Ongoing",
          lastchapter: editItem.lastchapter ?? "0",
          costperchapter: editItem.costperchapter ?? 0,
          lockedtranslator: editItem.lockedtranslator || "",
          lockedtypesetter: editItem.lockedtypesetter ?? "Tilly",
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
          translationdocurl: "",
          scangroup: "",
          status: "Ongoing",
          lastchapter: "0",
          costperchapter: 0,
          lockedtranslator: "",
          lockedtypesetter: "Tilly",
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

  const typesetterOptions = React.useMemo(() => {
    const active = (teamList || []).filter(
      (m) =>
        m.status === "Active" &&
        (m.role === "Editor/Typesetter" || m.role === "Multi-role")
    )
    const names = active.map((m) => m.name)
    if (!names.includes("Tilly")) names.unshift("Tilly")
    return [
      { value: "", label: "-- ไม่มีการล็อคคนลงคำ --" },
      ...names.map((n) => ({ value: n, label: n })),
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
  const lockedTypesetter = watch("lockedtypesetter") || ""
  const needsExtract = watch("needsextract")
  const notifyOnAdd = watch("notifyonadd")
  const isUrgent = watch("isurgent")

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {editItem ? "แก้ไขข้อมูลมังงะ" : "เปิดโปรเจคใหม่ / เพิ่มมังงะใหม่"}
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
              <div className="flex items-center justify-between">
                <Label>URL ต้นฉบับ</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setComixSearchOpen(true)}
                  className="h-6 px-2 text-[11px] border-violet-500/40 bg-violet-950/30 text-violet-300 hover:bg-violet-900/50 hover:text-white cursor-pointer"
                >
                  <Search className="h-3 w-3 mr-1 text-violet-400" />
                  ค้นหาจาก Comix
                </Button>
              </div>
              <div className="flex gap-1.5">
                <Input placeholder="https://..." {...register("originalurl")} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setComixSearchOpen(true)}
                  title="กดเพื่อค้นหา URL จาก Comix"
                  className="shrink-0 h-10 px-3 border-violet-500/40 bg-violet-950/30 text-violet-300 hover:bg-violet-900/50 hover:text-white cursor-pointer font-medium"
                >
                  <Search className="h-4 w-4 sm:mr-1.5 text-violet-400" />
                  <span className="hidden sm:inline">ค้นหาต้นฉบับ</span>
                </Button>
              </div>
            </div>
          </div>

          {/* GROUP SCANNER FIELD (พิมพ์เอง หรือ กดดึงชื่อค่ายมาใส่ Dropdown แบบรายครั้ง) */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3.5 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-purple-300 font-medium">
                <Users className="h-4 w-4 text-purple-400" />
                ค่ายแปลต้นฉบับ / Group Scanner (พิมพ์เอง หรือดึงจากลิงก์)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingGroups}
                onClick={() => fetchGroupsFromUrl(watch("originalurl") || "")}
                className="h-7 px-2.5 text-xs border-purple-500/40 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40 hover:text-white cursor-pointer shrink-0"
              >
                <RefreshCw
                  className={`h-3 w-3 mr-1.5 ${loadingGroups ? "animate-spin" : ""}`}
                />
                {loadingGroups
                  ? "กำลังดึงรายชื่อค่าย..."
                  : "ดึงชื่อค่ายมาใส่ Dropdown"}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                placeholder="พิมพ์ชื่อค่ายเอง (เว้นว่างได้หากไม่ระบุ)"
                className="border-purple-500/40 bg-[#0b1120] text-sm focus:border-purple-400"
                {...register("scangroup")}
              />
              <select
                className="h-10 rounded-lg border border-purple-500/40 bg-[#0b1120] px-3 py-1.5 text-xs text-purple-200 disabled:opacity-50"
                value={
                  comixGroups.some(
                    (g) =>
                      g.name.toLowerCase() ===
                      (watch("scangroup") || "").trim().toLowerCase()
                  )
                    ? watch("scangroup") || ""
                    : ""
                }
                disabled={comixGroups.length === 0}
                onChange={(e) => {
                  if (e.target.value !== "") {
                    setValue("scangroup", e.target.value, { shouldDirty: true })
                  }
                }}
              >
                <option value="">
                  {comixGroups.length > 0
                    ? `-- เลือกค่ายแปลจากที่ดึงมา (${comixGroups.length} ค่าย) --`
                    : "-- กดปุ่มด้านบนเพื่อดึงรายชื่อค่ายใส่ Dropdown --"}
                </option>
                {comixGroups.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[11px] text-slate-400">
              สามารถพิมพ์ชื่อค่ายแปลเองในช่องซ้ายได้เลย หรือวางลิงก์เรื่องในช่อง{" "}
              <span className="text-slate-300">URL ต้นฉบับ</span> แล้วกดปุ่ม{" "}
              <span className="text-purple-300 font-medium">
                ดึงชื่อค่ายมาใส่ Dropdown
              </span>{" "}
              เพื่อเลือกแบบรายครั้งได้ครับ
            </p>
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

          <div className="space-y-1.5">
            <Label>ผู้ลงคำหลัก (Auto-select)</Label>
            <SearchableSelect
              options={typesetterOptions}
              value={lockedTypesetter}
              onChange={(val) => setValue("lockedtypesetter", val)}
              placeholder="-- ไม่มีการล็อคคนลงคำ --"
              searchPlaceholder="ค้นหาคนลงคำ..."
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

    <ComixUrlSearchDialog
      open={comixSearchOpen}
      onClose={() => setComixSearchOpen(false)}
      initialQuery={watch("originalname") || watch("manganame") || ""}
      onSelect={handleSelectComixItem}
    />
  </>
  )
}

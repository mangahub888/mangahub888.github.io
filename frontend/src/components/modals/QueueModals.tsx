import * as React from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { callGasApi } from "@/api/gasClient"
import { toast } from "sonner"
import { Plus } from "lucide-react"

// ==========================================
// 1. ADD QUEUE MODAL
// ==========================================
interface AddQueueModalProps {
  open: boolean
  onClose: () => void
  mangaList: any[]
  teamList: any[]
  onOpenAddManga: () => void
  preselectedMangaId?: string
  preselectedChapter?: string
  onSuccess: (queue: any[], manga?: any[]) => void
}

export function AddQueueModal({
  open,
  onClose,
  mangaList,
  teamList,
  onOpenAddManga,
  preselectedMangaId,
  preselectedChapter,
  onSuccess,
}: AddQueueModalProps) {
  const [mangaId, setMangaId] = React.useState("")
  const [chapter, setChapter] = React.useState("")
  const [costPerChapter, setCostPerChapter] = React.useState<string | number>(0)
  const [uploaderName, setUploaderName] = React.useState("")
  const [rawLinkInput, setRawLinkInput] = React.useState("")
  const [extractorName, setExtractorName] = React.useState("")
  const [extractLinkInput, setExtractLinkInput] = React.useState("")
  const [translatorName, setTranslatorName] = React.useState("")
  const [typesetterName, setTypesetterName] = React.useState("")
  const [publisherName, setPublisherName] = React.useState("")
  const [workLink, setWorkLink] = React.useState("")
  const [note, setNote] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      if (!preselectedMangaId) {
        setMangaId("")
        setCostPerChapter(0)
        setUploaderName("")
        setRawLinkInput("")
        setExtractorName("")
        setExtractLinkInput("")
        setTranslatorName("")
        setTypesetterName("")
        setPublisherName("")
        setWorkLink("")
        setNote("")
      }
      setChapter(preselectedChapter || "")
    }
  }, [open, preselectedMangaId, preselectedChapter])

  React.useEffect(() => {
    if (preselectedMangaId) {
      handleMangaChange(String(preselectedMangaId))
    }
  }, [preselectedMangaId, mangaList])

  const handleMangaChange = (id: string) => {
    setMangaId(id)
    const manga = (mangaList || []).find(
      (m) => m.mangaid != null && String(m.mangaid) === String(id)
    )
    if (manga) {
      setCostPerChapter(manga.costperchapter || 0)
      if (manga.lockedtranslator) {
        setTranslatorName(manga.lockedtranslator)
      }
    } else {
      setCostPerChapter(0)
    }
  }

  const mangaOptions = React.useMemo(
    () =>
      (mangaList || []).map((m) => ({
        value: String(m.mangaid),
        label: m.manganame,
      })),
    [mangaList]
  )

  const teamOptions = React.useMemo(
    () => [
      { value: "", label: "-- เลือกผู้รับผิดชอบ --" },
      ...(teamList || []).map((m) => ({
        value: m.name,
        label: `${m.name}${m.role ? ` (${m.role})` : ""}`,
      })),
    ],
    [teamList]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mangaId || !chapter.trim()) {
      toast.warning("กรุณาเลือกมังงะและระบุตอนที่")
      return
    }

    setSubmitting(true)
    try {
      const manga = (mangaList || []).find(
        (m) => m.mangaid != null && String(m.mangaid) === String(mangaId)
      )
      const needsExtract = manga
        ? manga.needsextract === true || String(manga.needsextract) === "true"
        : true

      let combinedLinks = workLink.trim()
      if (rawLinkInput.trim()) {
        combinedLinks +=
          (combinedLinks ? "\n" : "") + `[อัป Raw] ${rawLinkInput.trim()}`
      }
      if (extractLinkInput.trim()) {
        combinedLinks +=
          (combinedLinks ? "\n" : "") + `[ดึงคำ] ${extractLinkInput.trim()}`
      }

      // Sync cost if changed
      if (
        manga &&
        parseFloat(String(costPerChapter)) !==
          parseFloat(String(manga.costperchapter || 0))
      ) {
        callGasApi("UPDATE_MANGA", {
          id: mangaId,
          data: { ...manga, costperchapter: costPerChapter },
        }).catch(() => {})
      }

      const payload = {
        mangaid: mangaId,
        chapter: chapter.trim(),
        uploadstatus: "รอเริ่ม",
        uploadername: uploaderName,
        extractstatus: needsExtract ? "รอเริ่ม" : "Skipped",
        extractorname: extractorName,
        translatestatus: "รอเริ่ม",
        translatorname: translatorName,
        typesetstatus: "รอเริ่ม",
        typesettername: typesetterName,
        publishstatus: "รอเริ่ม",
        publishername: publisherName,
        poststatus: "รอเริ่ม",
        worklink: combinedLinks,
        note: note.trim(),
      }

      const res = await callGasApi("ADD_QUEUE", payload)
      toast.success("✅ เพิ่มคิวงานเรียบร้อยแล้ว")
      onSuccess(res.queue || [], res.manga)
      onClose()
    } catch (err: any) {
      toast.error(err.message || "การเพิ่มคิวงานล้มเหลว")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">เพิ่มคิวงานใหม่</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>เลือกมังงะ *</Label>
              <div className="flex gap-2">
                <SearchableSelect
                  options={mangaOptions}
                  value={mangaId}
                  onChange={handleMangaChange}
                  placeholder="-- เลือกมังงะ --"
                  searchPlaceholder="ค้นหามังงะ..."
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={onOpenAddManga}
                  title="เพิ่มมังงะใหม่"
                  className="shrink-0 h-10 w-10"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>ตอนที่ *</Label>
              <Input
                placeholder="เช่น 123 หรือ 1-10"
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>ต้นทุนต่อตอน</Label>
              <Input
                type="number"
                step="0.01"
                value={costPerChapter}
                onChange={(e) => setCostPerChapter(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>🔼 ผู้อัปโหลด Raw</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <SearchableSelect
                options={teamOptions}
                value={uploaderName}
                onChange={setUploaderName}
                placeholder="-- เลือกผู้รับผิดชอบ --"
              />
              <Input
                placeholder="ลิงก์ Raw (เช่น https://...)"
                value={rawLinkInput}
                onChange={(e) => setRawLinkInput(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>📝 ผู้ดึงคำ (Extractor)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <SearchableSelect
                options={teamOptions}
                value={extractorName}
                onChange={setExtractorName}
                placeholder="-- เลือกผู้รับผิดชอบ --"
              />
              <Input
                placeholder="ลิงก์ดึงคำ (เช่น https://...)"
                value={extractLinkInput}
                onChange={(e) => setExtractLinkInput(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>🌐 ผู้แปล (Translator)</Label>
              <SearchableSelect
                options={teamOptions}
                value={translatorName}
                onChange={setTranslatorName}
                placeholder="-- เลือกผู้รับผิดชอบ --"
              />
            </div>

            <div className="space-y-1.5">
              <Label>✍️ ผู้ลงคำ (Typesetter)</Label>
              <SearchableSelect
                options={teamOptions}
                value={typesetterName}
                onChange={setTypesetterName}
                placeholder="-- เลือกผู้รับผิดชอบ --"
              />
            </div>

            <div className="space-y-1.5">
              <Label>📤 ผู้เผยแพร่ (Publisher)</Label>
              <SearchableSelect
                options={teamOptions}
                value={publisherName}
                onChange={setPublisherName}
                placeholder="-- เลือกผู้รับผิดชอบ --"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>🔗 ลิงก์งาน (Work Link)</Label>
            <Input
              placeholder="https://..."
              value={workLink}
              onChange={(e) => setWorkLink(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>📌 หมายเหตุ</Label>
            <Textarea
              rows={2}
              placeholder="หมายเหตุเพิ่มเติม..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
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
              {submitting ? "กำลังบันทึก..." : "บันทึกคิวงาน"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ==========================================
// 2. UPDATE FULL QUEUE MODAL
// ==========================================
interface UpdateQueueModalProps {
  open: boolean
  onClose: () => void
  item: any | null
  mangaList: any[]
  teamList: any[]
  onSuccess: (queue: any[]) => void
}

export function UpdateQueueModal({
  open,
  onClose,
  item,
  mangaList,
  teamList,
  onSuccess,
}: UpdateQueueModalProps) {
  const [chapter, setChapter] = React.useState("")
  const [costPerChapter, setCostPerChapter] = React.useState<string | number>(0)
  const [uploadStatus, setUploadStatus] = React.useState("รอเริ่ม")
  const [uploaderName, setUploaderName] = React.useState("")
  const [rawLink, setRawLink] = React.useState("")

  const [extractStatus, setExtractStatus] = React.useState("รอเริ่ม")
  const [extractorName, setExtractorName] = React.useState("")
  const [extractLink, setExtractLink] = React.useState("")

  const [translateStatus, setTranslateStatus] = React.useState("รอเริ่ม")
  const [translatorName, setTranslatorName] = React.useState("")

  const [typesetStatus, setTypesetStatus] = React.useState("รอเริ่ม")
  const [typesetterName, setTypesetterName] = React.useState("")

  const [publishStatus, setPublishStatus] = React.useState("รอเริ่ม")
  const [publisherName, setPublisherName] = React.useState("")

  const [postStatus, setPostStatus] = React.useState("รอเริ่ม")
  const [posterName, setPosterName] = React.useState("")

  const [workLink, setWorkLink] = React.useState("")
  const [note, setNote] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const manga = React.useMemo(() => {
    if (!item) return null
    return (mangaList || []).find(
      (m) => m.mangaid != null && String(m.mangaid) === String(item.mangaid)
    )
  }, [item, mangaList])

  React.useEffect(() => {
    if (open && item) {
      setChapter(item.chapter || "")
      setCostPerChapter(manga?.costperchapter ?? 0)
      setUploadStatus(item.uploadstatus || "รอเริ่ม")
      setUploaderName(item.uploadername || "")
      setRawLink("")

      setExtractStatus(item.extractstatus || "รอเริ่ม")
      setExtractorName(item.extractorname || "")
      setExtractLink("")

      setTranslateStatus(item.translatestatus || "รอเริ่ม")
      setTranslatorName(item.translatorname || "")

      setTypesetStatus(item.typesetstatus || "รอเริ่ม")
      setTypesetterName(item.typesettername || "")

      setPublishStatus(item.publishstatus || "รอเริ่ม")
      setPublisherName(item.publishername || "")

      setPostStatus(item.poststatus || "รอเริ่ม")
      setPosterName(item.postername || "")

      setWorkLink(item.worklink || "")
      setNote(item.note || "")
    }
  }, [open, item, manga])

  const teamOptions = React.useMemo(
    () => [
      { value: "", label: "-- เลือกผู้รับผิดชอบ --" },
      ...(teamList || []).map((m) => ({
        value: m.name,
        label: `${m.name}${m.role ? ` (${m.role})` : ""}`,
      })),
    ],
    [teamList]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!item) return
    setSubmitting(true)

    try {
      let finalWorkLink = workLink.trim()
      if (rawLink.trim()) {
        finalWorkLink = (finalWorkLink + "\n[อัป Raw] " + rawLink.trim()).trim()
      }
      if (extractLink.trim()) {
        finalWorkLink = (finalWorkLink + "\n[ดึงคำ] " + extractLink.trim()).trim()
      }

      if (
        manga &&
        parseFloat(String(costPerChapter)) !==
          parseFloat(String(manga.costperchapter || 0))
      ) {
        callGasApi("UPDATE_MANGA", {
          id: manga.mangaid,
          data: { ...manga, costperchapter: costPerChapter },
        }).catch(() => {})
      }

      const updateData = {
        chapter,
        uploadstatus: uploadStatus,
        extractstatus: extractStatus,
        translatestatus: translateStatus,
        typesetstatus: typesetStatus,
        publishstatus: publishStatus,
        poststatus: postStatus,
        uploadername: uploaderName,
        extractorname: extractorName,
        translatorname: translatorName,
        typesettername: typesetterName,
        publishername: publisherName,
        postername: posterName,
        worklink: finalWorkLink,
        note,
      }

      const res = await callGasApi("UPDATE_FULL_QUEUE_ITEM", {
        queueId: item.queueid,
        updateData,
      })
      toast.success("บันทึกการแก้ไขเรียบร้อย")
      onSuccess(res.queue || [])
      onClose()
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการอัปเดต")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">แก้ไขรายละเอียดงาน</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>มังงะ</Label>
              <Input
                value={manga ? manga.manganame : "มังงะไม่ทราบชื่อ"}
                readOnly
                className="opacity-70 cursor-not-allowed"
              />
            </div>
            <div className="space-y-1.5">
              <Label>ตอนที่</Label>
              <Input
                value={chapter}
                onChange={(e) => setChapter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>ต้นทุนต่อตอน</Label>
              <Input
                type="number"
                step="0.01"
                value={costPerChapter}
                onChange={(e) => setCostPerChapter(e.target.value)}
              />
            </div>
          </div>

          <hr className="border-[#26334d]" />

          {/* Step rows */}
          <div className="space-y-3">
            {/* Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
              <div className="space-y-1">
                <Label>🔼 อัป Raw</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={uploadStatus}
                  onChange={(e) => setUploadStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1.5 sm:pt-5">
                <SearchableSelect
                  options={teamOptions}
                  value={uploaderName}
                  onChange={setUploaderName}
                />
                <Input
                  placeholder="เพิ่มลิงก์ Raw ใหม่ (ถ้ามี)"
                  value={rawLink}
                  onChange={(e) => setRawLink(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Extract */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
              <div className="space-y-1">
                <Label>📝 ดึงคำ</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={extractStatus}
                  onChange={(e) => setExtractStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                  <option value="Skipped">ข้าม (Skipped)</option>
                  <option value="skip">ข้าม (skip)</option>
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1.5 sm:pt-5">
                <SearchableSelect
                  options={teamOptions}
                  value={extractorName}
                  onChange={setExtractorName}
                />
                <Input
                  placeholder="เพิ่มลิงก์ดึงคำใหม่ (ถ้ามี)"
                  value={extractLink}
                  onChange={(e) => setExtractLink(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Translate */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <div className="space-y-1">
                <Label>🌐 แปล</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={translateStatus}
                  onChange={(e) => setTranslateStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <SearchableSelect
                  options={teamOptions}
                  value={translatorName}
                  onChange={setTranslatorName}
                />
              </div>
            </div>

            {/* Typeset */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <div className="space-y-1">
                <Label>✍️ ลงคำ</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={typesetStatus}
                  onChange={(e) => setTypesetStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <SearchableSelect
                  options={teamOptions}
                  value={typesetterName}
                  onChange={setTypesetterName}
                />
              </div>
            </div>

            {/* Publish */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <div className="space-y-1">
                <Label>📤 เผยแพร่</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={publishStatus}
                  onChange={(e) => setPublishStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <SearchableSelect
                  options={teamOptions}
                  value={publisherName}
                  onChange={setPublisherName}
                />
              </div>
            </div>

            {/* Post */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <div className="space-y-1">
                <Label>✉️ โพสต์</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
                  value={postStatus}
                  onChange={(e) => setPostStatus(e.target.value)}
                >
                  <option value="รอเริ่ม">รอเริ่ม</option>
                  <option value="กำลังทำ">กำลังทำ</option>
                  <option value="เสร็จแล้ว">เสร็จแล้ว</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <SearchableSelect
                  options={teamOptions}
                  value={posterName}
                  onChange={setPosterName}
                />
              </div>
            </div>
          </div>

          <hr className="border-[#26334d]" />

          <div className="space-y-1.5">
            <Label>🔗 ลิงก์งานหลัก (Work Link)</Label>
            <Textarea
              rows={3}
              placeholder="https://..."
              value={workLink}
              onChange={(e) => setWorkLink(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>📌 หมายเหตุ</Label>
            <Textarea
              rows={2}
              placeholder="หมายเหตุเพิ่มเติม..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
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
              {submitting ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ==========================================
// 3. STEP QUICK UPDATE MODAL
// ==========================================
interface StepUpdateModalProps {
  open: boolean
  onClose: () => void
  queueItem: any | null
  step: string
  teamList: any[]
  onOptimisticUpdate: (updatedItem: any) => void
  onSuccess: (serverQueue: any[]) => void
  onRollback: () => void
}

export function StepUpdateModal({
  open,
  onClose,
  queueItem,
  step,
  teamList,
  onOptimisticUpdate,
  onSuccess,
  onRollback,
}: StepUpdateModalProps) {
  const [status, setStatus] = React.useState("รอเริ่ม")
  const [assignee, setAssignee] = React.useState("")
  const [link, setLink] = React.useState("")
  const [note, setNote] = React.useState("")

  const stepLabels: Record<string, string> = {
    upload: "🔼 อัปโหลด Raw",
    extract: "📝 ดึงคำ (Extractor)",
    translate: "🌐 แปล (Translator)",
    typeset: "✍️ ลงคำ (Typesetter)",
    publish: "📤 เผยแพร่ (Publisher)",
    post: "📮 โพสต์ (Post)",
  }

  const roleMapping: Record<string, string[]> = {
    upload: ["Raw Provider/Uploader", "Multi-role"],
    extract: ["Cleaner/Draft", "Multi-role"],
    translate: ["Translator", "Multi-role"],
    typeset: ["Editor/Typesetter", "Multi-role"],
    publish: ["Raw Provider/Uploader", "Multi-role"],
    post: ["Poster", "Multi-role"],
  }

  const assigneeFieldMap: Record<string, string> = {
    upload: "uploadername",
    extract: "extractorname",
    translate: "translatorname",
    typeset: "typesettername",
    publish: "publishername",
    post: "postername",
  }

  React.useEffect(() => {
    if (open && queueItem && step) {
      const statusField = step.toLowerCase() + "status"
      const nameField = assigneeFieldMap[step.toLowerCase()]
      setStatus(queueItem[statusField] || "รอเริ่ม")
      setAssignee(queueItem[nameField] || "")
      setLink("")
      setNote("")
    }
  }, [open, queueItem, step])

  const filteredTeamOptions = React.useMemo(() => {
    const allowed = roleMapping[step.toLowerCase()] || []
    const matching = (teamList || []).filter(
      (m) =>
        allowed.length === 0 ||
        allowed.includes(m.role) ||
        m.name === assignee
    )
    const listToUse = matching.length > 0 ? matching : teamList || []
    return [
      { value: "", label: "-- เลือกผู้รับผิดชอบ --" },
      ...listToUse.map((m) => ({
        value: m.name,
        label: `${m.name}${m.role ? ` (${m.role})` : ""}`,
      })),
    ]
  }, [teamList, step, assignee])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!queueItem || !step) return

    const stepLower = step.toLowerCase()
    const statusField = stepLower + "status"
    const nameField = assigneeFieldMap[stepLower]
    const timeField = stepLower + "time"

    const optimistic = {
      ...queueItem,
      [statusField]: status,
      [nameField]: assignee,
      ...(status === "เสร็จแล้ว" ? { [timeField]: new Date().toISOString() } : {}),
      ...(stepLower === "publish" &&
      status === "เสร็จแล้ว" &&
      (!queueItem.poststatus || String(queueItem.poststatus).trim() === "")
        ? { poststatus: "รอเริ่ม" }
        : {}),
    }

    onOptimisticUpdate(optimistic)
    onClose()
    toast.loading("กำลังบันทึกสถานะ...", { id: "step-update" })

    try {
      const res = await callGasApi("UPDATE_QUEUE_STEP", {
        queueId: queueItem.queueid,
        step,
        status,
        assignee,
        link: link.trim(),
        note: note.trim(),
      })
      toast.success("✅ บันทึกสำเร็จ", { id: "step-update" })
      if (res.queue) {
        onSuccess(res.queue)
      }
    } catch (err: any) {
      onRollback()
      toast.error(err.message || "การบันทึกล้มเหลว", { id: "step-update" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">
            อัปเดต: {stepLabels[step] || step}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>📊 สถานะ</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-[#26334d] bg-[#0b1120] px-3 py-2 text-sm text-slate-100"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="รอเริ่ม">⏸️ รอเริ่ม</option>
              <option value="กำลังทำ">⚙️ กำลังทำ</option>
              <option value="เสร็จแล้ว">✅ เสร็จแล้ว</option>
              {step === "extract" && (
                <React.Fragment>
                  <option value="Skipped">⏭️ ข้าม (Skipped)</option>
                  <option value="skip">⏭️ ข้าม (skip)</option>
                </React.Fragment>
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>👤 ผู้รับผิดชอบ</Label>
            <SearchableSelect
              options={filteredTeamOptions}
              value={assignee}
              onChange={setAssignee}
              placeholder="-- เลือกผู้รับผิดชอบ --"
            />
          </div>

          <div className="space-y-1.5">
            <Label>🔗 ลิงก์งาน (ถ้ามี)</Label>
            <Input
              type="url"
              placeholder="https://..."
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <p className="text-xs text-slate-400">
              ลิงก์จะแสดงในคอลัมน์ของขั้นตอนนี้โดยอัตโนมัติ
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>📝 หมายเหตุ (ถ้ามี)</Label>
            <Textarea
              rows={2}
              placeholder="หมายเหตุเพิ่มเติม..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit">บันทึก</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

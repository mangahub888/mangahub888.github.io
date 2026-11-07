import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import comixRawData from "@/data/comix_project_ideas_latest.json"
import {
  Search,
  Globe,
  ExternalLink,
  Check,
  X,
  BookOpen,
  Flame,
  ArrowRight,
  Sparkles,
} from "lucide-react"

export interface ComixSearchItem {
  id: string
  title: string
  alt_titles?: string[]
  url: string
  cover?: string
  chapter_count?: number
  latest_chapter_text?: string
  status?: string
  origin?: string
  score?: number
  genres?: string[]
  views_count?: number
  views_text?: string
}

interface ComixUrlSearchDialogProps {
  open: boolean
  onClose: () => void
  initialQuery?: string
  onSelect: (item: {
    url: string
    title: string
    alt_titles?: string[]
    chapter_count?: number
    status?: string
    origin?: string
    cover?: string
  }) => void
}

export function ComixUrlSearchDialog({
  open,
  onClose,
  initialQuery = "",
  onSelect,
}: ComixUrlSearchDialogProps) {
  const [query, setQuery] = React.useState("")
  const [originFilter, setOriginFilter] = React.useState<string>("all")
  const [manualUrl, setManualUrl] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Load items from comix dataset
  const allItems: ComixSearchItem[] = React.useMemo(() => {
    return ((comixRawData as any)?.items || []) as ComixSearchItem[]
  }, [])

  // Sync initial query when opened
  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery.trim())
      setOriginFilter("all")
      setManualUrl("")
      // Auto focus search input after animation
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [open, initialQuery])

  // Detect direct URL in search query
  const isDirectUrl = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q.startsWith("http") && (q.includes("comix.to") || q.includes("/title/"))
  }, [query])

  // Filter items
  const filteredItems = React.useMemo(() => {
    const q = query.trim().toLowerCase()

    let list = allItems

    // Filter by origin if selected
    if (originFilter !== "all") {
      list = list.filter((item) =>
        item.origin ? item.origin.toUpperCase().includes(originFilter) : false
      )
    }

    if (!q) {
      // If query is empty, return top 30
      return list.slice(0, 30)
    }

    return list.filter((item) => {
      if (item.title && item.title.toLowerCase().includes(q)) return true
      if (item.id && item.id.toLowerCase().includes(q)) return true
      if (item.url && item.url.toLowerCase().includes(q)) return true
      if (
        Array.isArray(item.alt_titles) &&
        item.alt_titles.some((alt) =>
          String(alt).toLowerCase().includes(q)
        )
      ) {
        return true
      }
      if (
        Array.isArray(item.genres) &&
        item.genres.some((g) => String(g).toLowerCase().includes(q))
      ) {
        return true
      }
      return false
    })
  }, [allItems, query, originFilter])

  const handleApplyDirectUrl = (urlToUse: string, fallbackTitle?: string) => {
    const cleanUrl = urlToUse.trim()
    if (!cleanUrl) return
    onSelect({
      url: cleanUrl,
      title: fallbackTitle || "Comix Manga",
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden bg-[#0e1320] border-violet-500/30 shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-violet-500/20 bg-gradient-to-r from-violet-950/40 via-[#13192b] to-[#0e1320]">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400">
                <Globe className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  ค้นหา URL จาก Comix.to
                  <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[10px] px-1.5 py-0 font-normal">
                    {allItems.length} เรื่องในระบบ
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  ค้นหาชื่อเรื่องเพื่อดึง URL ต้นฉบับไปใส่ในโปรเจคใหม่ได้ทันทีในคลิกเดียว
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Search Box */}
          <div className="mt-3.5 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-violet-400" />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="พิมพ์ชื่อเรื่อง (ไทย / อังกฤษ / ชื่อเดิม) หรือวางลิงก์ Comix..."
                className="pl-9 pr-9 h-10 bg-[#090d16] border-violet-500/40 focus:border-violet-400 text-sm placeholder:text-slate-500 text-slate-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Origin Quick Filters */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 mr-1">ประเภท:</span>
                {[
                  { id: "all", label: "ทั้งหมด" },
                  { id: "KR", label: "KR (Manhwa)" },
                  { id: "JP", label: "JP (Manga)" },
                  { id: "CN", label: "CN (Manhua)" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setOriginFilter(opt.id)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors cursor-pointer ${
                      originFilter === opt.id
                        ? "bg-violet-600 text-white font-medium"
                        : "bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                {query.trim() ? (
                  <span>ผลการค้นหา {filteredItems.length} เรื่อง</span>
                ) : (
                  <span>แนะนำยอดนิยม ({filteredItems.length})</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Direct URL Detected Banner */}
        {isDirectUrl && (
          <div className="p-3 bg-violet-950/60 border-b border-violet-500/40 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-violet-200 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                ตรวจพบลิงก์ Comix.to ในช่องค้นหา
              </p>
              <p className="text-[11px] text-violet-300/80 truncate font-mono">
                {query.trim()}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => handleApplyDirectUrl(query)}
              className="bg-violet-600 hover:bg-violet-500 text-white text-xs h-7 px-3 shrink-0"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              ใช้ URL นี้ทันที
            </Button>
          </div>
        )}

        {/* Results Scroll Area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 min-h-[240px] max-h-[50vh]">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700/60 mx-auto flex items-center justify-center text-slate-500">
                <Search className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-300">
                  ไม่พบเรื่องที่ตรงกับ &ldquo;{query}&rdquo; ในระบบแคช
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  คุณสามารถเปิดค้นหาโดยตรงบน Comix.to แล้วคัดลอก URL มาวางได้เลย
                </p>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
                <a
                  href={`https://comix.to/search?q=${encodeURIComponent(query)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 hover:text-white text-xs transition-colors"
                >
                  <Globe className="h-3.5 w-3.5" />
                  เปิดค้นหา &ldquo;{query}&rdquo; บน Comix.to
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {/* Manual URL Input */}
              <div className="mt-4 pt-4 border-t border-slate-800 max-w-md mx-auto text-left space-y-2">
                <label className="text-xs text-slate-400 block font-medium">
                  หรือวาง URL ของเรื่องจาก Comix.to ที่นี่:
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://comix.to/title/..."
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    className="h-8 text-xs bg-[#090d16] border-slate-700"
                  />
                  <Button
                    size="sm"
                    disabled={!manualUrl.trim()}
                    onClick={() => handleApplyDirectUrl(manualUrl)}
                    className="h-8 px-3 text-xs bg-violet-600 hover:bg-violet-500 text-white shrink-0"
                  >
                    นำไปใช้
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isKr = item.origin?.includes("KR")
              const isJp = item.origin?.includes("JP") || item.origin === "Manga"
              const isCn = item.origin?.includes("CN")

              return (
                <div
                  key={item.id || item.url}
                  className="group relative flex gap-3 p-2.5 sm:p-3 rounded-lg border border-slate-800/80 bg-slate-900/40 hover:bg-violet-950/20 hover:border-violet-500/40 transition-all duration-200"
                >
                  {/* Thumbnail Cover */}
                  <div className="w-14 h-20 sm:w-16 sm:h-22 shrink-0 rounded overflow-hidden bg-slate-950 border border-slate-800 relative">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt={item.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          e.currentTarget.style.display = "none"
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <BookOpen className="h-5 w-5" />
                      </div>
                    )}

                    {/* Chapter pill overlay */}
                    {item.chapter_count !== undefined && (
                      <span className="absolute bottom-0 inset-x-0 bg-black/80 text-[9px] text-center font-mono text-emerald-400 py-0.5 truncate">
                        {item.chapter_count} ตอน
                      </span>
                    )}
                  </div>

                  {/* Info Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <Badge
                          className={`text-[9px] px-1.5 py-0 border font-medium ${
                            isKr
                              ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                              : isCn
                              ? "bg-rose-500/10 text-rose-300 border-rose-500/30"
                              : "bg-blue-500/10 text-blue-300 border-blue-500/30"
                          }`}
                        >
                          {item.origin || "Manga"}
                        </Badge>

                        {item.status && (
                          <span
                            className={`text-[9px] px-1.5 py-0 rounded font-medium ${
                              item.status === "Completed"
                                ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {item.status}
                          </span>
                        )}

                        {item.views_text && (
                          <span className="text-[10px] text-amber-400 font-mono flex items-center gap-0.5 ml-auto">
                            <Flame className="h-2.5 w-2.5 fill-amber-400" />
                            {item.views_text}
                          </span>
                        )}
                      </div>

                      {/* Main Title */}
                      <h4
                        className="text-xs sm:text-sm font-semibold text-slate-100 group-hover:text-violet-300 transition-colors line-clamp-1"
                        title={item.title}
                      >
                        {item.title}
                      </h4>

                      {/* Alt Titles Preview (if any) */}
                      {Array.isArray(item.alt_titles) &&
                        item.alt_titles.length > 0 && (
                          <p
                            className="text-[11px] text-slate-400 truncate mt-0.5"
                            title={item.alt_titles.join(" / ")}
                          >
                            ชื่ออื่น: {item.alt_titles[0]}
                            {item.alt_titles.length > 1 &&
                              ` (${item.alt_titles.length} ชื่อ)`}
                          </p>
                        )}

                      {/* URL Preview */}
                      <p className="text-[10px] text-violet-400/80 font-mono truncate mt-1">
                        {item.url}
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-slate-800/60">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-[11px] text-slate-400 hover:text-violet-300 transition-colors font-medium"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        เปิดดูใน Comix.to
                      </a>

                      <Button
                        size="sm"
                        onClick={() => {
                          onSelect(item)
                          onClose()
                        }}
                        className="h-7 px-3 text-xs bg-violet-600 hover:bg-violet-500 text-white font-medium cursor-pointer shadow-sm transition-all"
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        เลือก URL นี้
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0a0d16] border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px]">
            💡 ลิงก์ Comix.to จะถูกใส่ลงในช่อง &ldquo;URL ต้นฉบับ&rdquo; ทันที
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 px-3 text-xs text-slate-400 hover:text-white"
          >
            ยกเลิก
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

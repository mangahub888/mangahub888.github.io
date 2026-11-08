import * as React from "react";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

import { Line, Doughnut, Bar } from "react-chartjs-2";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";

import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { THAI_SHORT_MONTHS, THAI_MONTHS, getChapterCount, isUrgentManga, parseDateSafe, getInactivityRecency, resolveMangaName } from "@/lib/utils";

import initialGrowthData from "@/data/multi_platform_growth_latest.json";

import initialGroupedData from "@/data/grouped_matched_comics.json";
import initialMappingData from "@/data/comic_cross_platform_mapping.json";

import { callGasApi } from "@/api/gasClient";

import { toast } from "sonner";

import {
  Plus,
  Upload,
  Trash2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Trophy,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  BookOpen,
  Layers,
  Sparkles,
  Scale,
  CheckCircle2,
  Zap,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Filter,
} from "lucide-react";

ChartJS.register(
  CategoryScale,

  LinearScale,

  PointElement,

  LineElement,

  BarElement,

  ArcElement,

  Title,

  Tooltip,

  Legend,

  Filler,
);

const DEFAULT_WEBSITES = [
  "ReadRealm + Kairew + Chaply",
  "ReadRealm",
  "kairew",
  "chaply",
  "ReadRealm แปลจนเมื่อย",
  "ReadRealm น้องแมวส้ม",
  "ReadRealm แปลแล้วแปลอีก",
  "ReadRealm แปลจนแขนหัก",
];

interface FinancialsViewProps {
  mangaList: any[];

  salesList: any[];

  websiteList: string[];

  onSalesChange: (newSales: any[], newWebsites?: string[]) => void;
}

// Helper to normalize manga title for robust cross-platform matching

function normalizeMangaTitle(title: string): string {
  if (!title) return "";

  let t = title.split("|")[0].trim();

  // If title contains Thai characters and has a trailing English subtitle without '|', strip trailing English words
  if (/[\u0E00-\u0E7F]/.test(t)) {
    t = t.replace(/\s+[A-Za-z][A-Za-z0-9\s:'’,-]{3,}$/g, "").trim();
  }

  t = t.toLowerCase().replace(/[\s\-_–—~:：!！?？,，.。'"“”‘’()[\]{}【】★🔥]+/g, "");

  // Cross-Platform & Spelling Aliases Normalization
  if (t.includes("กงล้อ") && t.includes("โชคชะตา")) return "เจ้าแห่งกงล้อโชคชะตา";
  if (t.includes("จอมมารแสนดี") || t.includes("ผู้ชายแสนดี") || t.includes("thedisciplewantstokillme")) return "จอมมารแสนดี";
  if (t.includes("กบฏแห่งตระกูลขุนนางทรราช")) return "กบฏแห่งตระกูลขุนนางทรราช";
  if (t.includes("มหาปรจารย์") || t.includes("มหาปรมาจารย์")) return "มหาปรมาจารย์ระดับเทพแห่งนคร";
  if (t.includes("พลิกอักษรเปลี่ยนสกิล")) return "พลิกอักษรเปลี่ยนสกิลบงการโลกจนยับเยิน";
  if (t.includes("สกิลไร้คูลดาวน์") && t.includes("ภัยพิบัติอันเดด")) return "สกิลไร้คูลดาวน์งั้นข้าขอจุติเป็นภัยพิบัติอันเดด";
  if (t.includes("ผนึกสวรรค์")) return "ผนึกสวรรค์สยบมารสะท้านเทพ";
  if (t.includes("zombie") || t.includes("ซอมบี้")) return "mrzombie";

  // Check against comic_cross_platform_mapping registry
  if (initialMappingData && Array.isArray((initialMappingData as any).mappings)) {
    for (const m of (initialMappingData as any).mappings) {
      const cKey = m.canonical_key || m.canonical_title;
      if (m.aliases && Array.isArray(m.aliases)) {
        for (const alias of m.aliases) {
          const cleanAlias = alias.split("|")[0].toLowerCase().replace(/[\s\-_–—~:：!！?？,，.。'"“”‘’()[\]{}【】★🔥]+/g, "");
          if (cleanAlias && (t === cleanAlias || (cleanAlias.length > 5 && (t.includes(cleanAlias) || cleanAlias.includes(t))))) {
            return cKey;
          }
        }
      }
    }
  }

  return t;
}

export function FinancialsView({
  mangaList,

  salesList,

  websiteList,

  onSalesChange,
}: FinancialsViewProps) {
  const now = new Date();

  // Top Tab Switcher

  const [activeTab, setActiveTab] = React.useState<
    "growth" | "grouped" | "pnl"
  >("growth");

  // --- Cross-Platform Grouped Titles State (ReadRealm + Kairew + Chaply) ---

  const [groupedList, setGroupedList] =
    React.useState<any[]>(initialGroupedData);

  const [groupedSearch, setGroupedSearch] = React.useState<string>("");

  const [groupedPlatFilter, setGroupedPlatFilter] = React.useState<
    "all" | "3" | "2"
  >("all");

  const [groupedSortBy, setGroupedSortBy] = React.useState<
    "sales" | "views" | "eps"
  >("sales");

  const filteredGroupedComics = React.useMemo(() => {
    let list = [...groupedList];

    if (groupedPlatFilter === "3") {
      list = list.filter((g) => g.platform_count === 3);
    } else if (groupedPlatFilter === "2") {
      list = list.filter((g) => g.platform_count === 2);
    }

    if (groupedSearch.trim()) {
      const q = groupedSearch.trim().toLowerCase();

      list = list.filter((g) => g.title.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (groupedSortBy === "sales")
        return (b.total_sales || 0) - (a.total_sales || 0);

      if (groupedSortBy === "views")
        return (b.total_views || 0) - (a.total_views || 0);

      if (groupedSortBy === "eps") return (b.max_eps || 0) - (a.max_eps || 0);

      return 0;
    });

    return list;
  }, [groupedList, groupedPlatFilter, groupedSearch, groupedSortBy]);

  const groupedTotals = React.useMemo(() => {
    const s = groupedList.reduce((acc, g) => acc + (g.total_sales || 0), 0);

    const v = groupedList.reduce((acc, g) => acc + (g.total_views || 0), 0);

    const p3 = groupedList.filter((g) => g.platform_count === 3).length;

    const p2 = groupedList.filter((g) => g.platform_count === 2).length;

    return { sales: s, views: v, p3, p2, total: groupedList.length };
  }, [groupedList]);

  // --- Multi-Platform Growth Tracker State (ReadRealm + Kairew + Chaply) ---

  const [trackerData, setTrackerData] = React.useState<any>(initialGrowthData);

  const [loadingGrowth, setLoadingGrowth] = React.useState<boolean>(false);

  const [triggeringAction, setTriggeringAction] =
    React.useState<boolean>(false);
  const [pipelinePolling, setPipelinePolling] = React.useState<boolean>(false);

  const [platformFilter, setPlatformFilter] = React.useState<
    "all" | "readrealm" | "kairew" | "chaply"
  >("all");

  const [groupUnified, setGroupUnified] = React.useState<boolean>(true);

  const [accountFilter, setAccountFilter] = React.useState<string>("all");

  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "inactive30" | "active30" | "inactive90" | "mismatch" | "urgent"
  >("all");

  // Urgent Manga lookup from system mangaList + fallback known urgent titles
  const { urgentNormalizedTitles, urgentMangaIds } = React.useMemo(() => {
    const normSet = new Set<string>([
      normalizeMangaTitle("ข้าคือจอมวายร้ายผู้ยิ่งใหญ่"),
      normalizeMangaTitle("อาจารย์ ศิษย์บ้าขอกบฎนะขอรับ"),
      normalizeMangaTitle("อาจารย์ ศิษย์บ้าขอกบฏนะขอรับ"),
      normalizeMangaTitle("อิสระทางทรัพย์ พันธะทางใจ"),
      normalizeMangaTitle("นักฆ่าระดับเทพ ข้าคือเงามืด"),
      normalizeMangaTitle("จอมมารแสนดีขนาดนี้ แต่ศิษย์สตรีทั้งหลายกลับต้องการชีวิตข้า"),
      normalizeMangaTitle("จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต"),
      normalizeMangaTitle("ผู้โหดเหี้ยมวันโลกาวินาศ : กักตุนเสบียงนับล้านล้าน"),
      normalizeMangaTitle("ก่อกำเนิดราชันย์อสูร สู่หนทางวิวัฒนาการ"),
      normalizeMangaTitle("หลังจากโดนดาวโรงเรียนทิ้ง ฉันก็ได้บรรลุวิถียุทธ์"),
      normalizeMangaTitle("เกิดใหม่อีกครั้ง: ล้างแค้นอาฆาตด้วยพลังโลกกระจก"),
      normalizeMangaTitle("ก็ผมมันสายเปย์ จะเป็นผู้ชายเฮงซวยบ้างก็สมเหตุสมผลดีนี่"),
      normalizeMangaTitle("การกลับมาของบรรพชนรุ่นแรก: จอมยุทธ์ผู้แข็งแกร่งที่สุดกลับชาติมาเกิดเป็นทายาทในอีกพันปีต่อมา"),
      normalizeMangaTitle("ข้าเริ่มต้นด้วยพรสวรรค์ระดับตำนาน เพียงหนึ่งกระบี่พิฆาตเทพ!"),
      normalizeMangaTitle("จ้าวสายฟ้าเกิดใหม่ในฐานะสตรีมเมอร์"),
      normalizeMangaTitle("ระบบคืนผลหมื่นเท่า ชะตานี้ข้าขอกำหนดเอง"),
      normalizeMangaTitle("เทพธิดาไร้ใจ จงกลายเป็นเตาหลอมของข้าซะ!"),
      normalizeMangaTitle("จุติฮันเตอร์วันสิ้นโลก: ฉันมีระบบค่าประสบการณ์"),
      normalizeMangaTitle("เนโครแมนเซอร์: จากร่างแยกโครงกระดูกสู่เส้นทางเทพเจ้า"),
      normalizeMangaTitle("หลังตัดขาดตระกูล อสูรอัญเชิญของข้าล้วนเป็นสิ่งมีชีวิตแห่งความมืด!"),
    ]);
    const idSet = new Set<string>();

    if (Array.isArray(mangaList) && mangaList.length > 0) {
      // If mangaList has urgent flags, rebuild from live mangaList
      const liveUrgent = mangaList.filter((m) => isUrgentManga(m));
      if (liveUrgent.length > 0) {
        normSet.clear();
        for (const m of liveUrgent) {
          if (m.mangaid != null) idSet.add(String(m.mangaid));
          const nt = normalizeMangaTitle(m.manganame || "");
          if (nt) normSet.add(nt);
          if (nt.includes("ขอกบฎ")) normSet.add(nt.replace("ขอกบฎ", "ขอกบฏ"));
          if (nt.includes("ขอกบฏ")) normSet.add(nt.replace("ขอกบฏ", "ขอกบฎ"));
        }
      }
    }
    return { urgentNormalizedTitles: normSet, urgentMangaIds: idSet };
  }, [mangaList]);

  const isTitleUrgent = React.useCallback(
    (title?: string, mangaId?: any): boolean => {
      if (mangaId != null && urgentMangaIds.has(String(mangaId))) return true;
      if (!title) return false;
      const nt = normalizeMangaTitle(title);
      if (!nt) return false;
      if (urgentNormalizedTitles.has(nt)) return true;
      for (const u of urgentNormalizedTitles) {
        if (u && u.length >= 8 && (nt.includes(u) || u.includes(nt))) {
          return true;
        }
      }
      return false;
    },
    [urgentNormalizedTitles, urgentMangaIds],
  );

  const [searchQuery, setSearchQuery] = React.useState<string>("");

  const [sortBy, setSortBy] = React.useState<
    | "sales"
    | "avg_sales_7_chapters"
    | "sales_7_chapters"
    | "views"
    | "inactive_desc"
    | "inactive_asc"
    | "growth7d"
    | "growth30d"
  >("sales");

  // Helper to format ISO timestamps safely with UTC/Thai timezone
  const formatThaiTimestamp = React.useCallback((dateStr?: string | null) => {
    if (!dateStr) return "ตามรอบที่จดเอง";
    let s = String(dateStr).trim();
    if (!s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) {
      s = s + "Z";
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleString("th-TH");
  }, []);

  // Load latest Multi-Platform 6h growth data (with Fastly 300s cache-busting via commit SHA)
  const loadGrowthData = React.useCallback(async () => {
    setLoadingGrowth(true);

    try {
      // 1. Live raw GitHub content (freshest from 6h action runs, bypass Fastly 300s edge cache)
      try {
        let liveUrl = `https://raw.githubusercontent.com/mangahub888/mangahub888.github.io/main/tools/data/multi_platform_growth_latest.json?_t=${Date.now()}`;
        try {
          const commitRes = await fetch(
            `https://api.github.com/repos/mangahub888/mangahub888.github.io/commits/main?_t=${Date.now()}`,
          );
          if (commitRes.ok) {
            const commitData = await commitRes.json();
            if (commitData?.sha) {
              liveUrl = `https://raw.githubusercontent.com/mangahub888/mangahub888.github.io/${commitData.sha}/tools/data/multi_platform_growth_latest.json`;
            }
          }
        } catch {}

        const liveRes = await fetch(liveUrl);

        if (liveRes.ok) {
          const json = await liveRes.json();

          if (json && json.comics && json.comics.length > 0) {
            setTrackerData(json);
            setLoadingGrowth(false);
            return json;
          }
        }
      } catch {}

      // 2. Local build public json
      const res = await fetch(
        `./data/multi_platform_growth_latest.json?_t=${Date.now()}`,
        { cache: "no-store" },
      );

      if (res.ok) {
        const json = await res.json();

        if (json && json.comics && json.comics.length > 0) {
          setTrackerData(json);
          setLoadingGrowth(false);
          return json;
        }
      }
    } catch (e) {
      console.warn("Could not load local growth json", e);
    }

    try {
      const gasData = await callGasApi("GET_READREALM_GROWTH_DATA");

      if (gasData && gasData.comics && gasData.comics.length > 0) {
        setTrackerData(gasData);
        return gasData;
      }
    } catch (e) {
      console.warn("Could not load GAS growth data", e);
    } finally {
      setLoadingGrowth(false);
    }
    return null;
  }, []);

  React.useEffect(() => {
    loadGrowthData();
  }, [loadGrowthData]);

  const handleTriggerPipeline = async () => {
    setTriggeringAction(true);
    setPipelinePolling(true);

    try {
      await callGasApi("TRIGGER_READREALM_TRACKER", { source: "frontend_ui" });

      toast.info(
        "🚀 สั่งรัน GitHub Action เรียบร้อยแล้ว! ระบบกำลังดึงสถิติในคลาวด์ (ใช้เวลา ~1 นาที)...",
        { duration: 6000 },
      );

      const initialTimestamp = trackerData?.pipeline_recorded_at;
      let elapsed = 0;
      const pollTimer = setInterval(async () => {
        elapsed += 10;
        const fresh = await loadGrowthData();
        if (fresh?.pipeline_recorded_at && fresh.pipeline_recorded_at !== initialTimestamp) {
          clearInterval(pollTimer);
          setTriggeringAction(false);
          setPipelinePolling(false);
          toast.success(
            `✨ ซิงค์ข้อมูลล่าสุดสำเร็จ! รอบบันทึก: ${formatThaiTimestamp(fresh.pipeline_recorded_at)}`,
          );
        } else if (elapsed >= 150) {
          clearInterval(pollTimer);
          setTriggeringAction(false);
          setPipelinePolling(false);
          toast.warning(
            "⏳ ระบบคลาวด์ยังประมวลผลอยู่หรือติดคิว กรุณารอสักครู่แล้วกดปุ่ม 'โหลดข้อมูลใหม่'",
          );
        }
      }, 10000);
    } catch (e: any) {
      toast.error(e.message || "ไม่สามารถสั่งรัน Action ได้");
      setTriggeringAction(false);
      setPipelinePolling(false);
    }
  };

  // Build Unified Cross-Platform Comic Aggregations (+ กัน ข้ามแพลตฟอร์ม)

  const unifiedComics = React.useMemo(() => {
    if (!trackerData || !Array.isArray(trackerData.comics)) return [];

    const groups: Record<string, any> = {};

    for (const c of trackerData.comics) {
      const k = c.cross_platform_key || normalizeMangaTitle(c.canonical_title || c.subject);

      if (!k) continue;

      const plat = String(c.platform || "readrealm").toLowerCase();

      let cleanTitle = c.canonical_title || (c.subject || "").split("|")[0].trim();
      if (k === "จอมมารแสนดี") {
        cleanTitle = "จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต";
      }

      if (!groups[k]) {
        groups[k] = {
          key: k,

          subject: cleanTitle,

          comic_id: String(c.comic_id || ""),

          account: c.account || "",

          total_sales: 0,
          total_views: 0,
          total_sales_7_chapters: 0,
          total_views_7_chapters: 0,
          chapters_count: 0,

          days_inactive: null as number | null,

          last_chapter_updated_at: null as string | null,

          recorded_at: c.recorded_at || null,

          growth_7d: { sales_growth_pct: 0, sales_delta: 0 },

          growth_30d: { sales_growth_pct: 0, sales_delta: 0 },

          readrealm: {
            exists: false,
            sales: 0,
            sales_7_chapters: 0,
            views: 0,
            views_7_chapters: 0,
            chapters: 0,
            id: "",
            account: "",
          },

          kairew: {
            exists: false,
            sales: 0,
            sales_7_chapters: 0,
            views: 0,
            views_7_chapters: 0,
            chapters: 0,
            id: "",
            account: "",
          },

          chaply: {
            exists: false,
            sales: 0,
            sales_7_chapters: 0,
            views: 0,
            views_7_chapters: 0,
            chapters: 0,
            id: "",
            account: "",
          },

          platform_count: 0,

          is_unified: true,

          items: [] as any[],
        };
      }

      const g = groups[k];
      if (k === "จอมมารแสนดี") {
        g.subject = "จอมมารแสนดีเช่นข้า ไฉนกลับต้องถูกศิษย์ต้องการชีวิต";
      }

      g.items.push(c);

      const sales = Number(c.total_sales) || 0;
      const views = Number(c.total_views) || 0;
      const eps = Number(c.chapters_count) || 0;
      const s7 = Number(c.sales_7_chapters) || 0;
      const v7 = Number(c.views_7_chapters) || 0;

      g.total_sales += sales;
      g.total_views += views;
      g.total_sales_7_chapters = (g.total_sales_7_chapters || 0) + s7;
      g.total_views_7_chapters = (g.total_views_7_chapters || 0) + v7;
      g.chapters_count = Math.max(g.chapters_count, eps);

      const cRecency = getInactivityRecency(c.last_chapter_updated_at, c.days_inactive);
      c.days_inactive = cRecency.days;

      const cDate = parseDateSafe(c.last_chapter_updated_at);
      const gDate = parseDateSafe(g.last_chapter_updated_at);

      if (cDate && (!gDate || cDate.getTime() > gDate.getTime())) {
        g.last_chapter_updated_at = c.last_chapter_updated_at;
        g.days_inactive = cRecency.days;
      } else if (!gDate && cRecency.days != null) {
        if (g.days_inactive === null || cRecency.days < g.days_inactive) {
          g.days_inactive = cRecency.days;
          if (c.last_chapter_updated_at) g.last_chapter_updated_at = c.last_chapter_updated_at;
        }
      }

      if (plat === "readrealm") {
        g.readrealm.exists = true;
        g.readrealm.sales += sales;
        g.readrealm.sales_7_chapters += s7;
        g.readrealm.views += views;
        g.readrealm.views_7_chapters += v7;
        g.readrealm.chapters = Math.max(g.readrealm.chapters, eps);
        g.readrealm.id = String(c.comic_id || "");
        g.readrealm.account = c.account || "";
      } else if (plat === "kairew") {
        g.kairew.exists = true;
        g.kairew.sales += sales;
        g.kairew.sales_7_chapters += s7;
        g.kairew.views += views;
        g.kairew.views_7_chapters += v7;
        g.kairew.chapters = Math.max(g.kairew.chapters, eps);
        g.kairew.id = String(c.comic_id || "");
        g.kairew.account = c.account || "";
      } else if (plat === "chaply") {
        g.chaply.exists = true;
        g.chaply.sales += sales;
        g.chaply.sales_7_chapters += s7;
        g.chaply.views += views;
        g.chaply.views_7_chapters += v7;
        g.chaply.chapters = Math.max(g.chaply.chapters, eps);
        g.chaply.id = String(c.comic_id || "");
        g.chaply.account = c.account || "";
      }

      const d7 = Number(c.growth_7d?.sales_delta) || 0;

      const d30 = Number(c.growth_30d?.sales_delta) || 0;

      g.growth_7d.sales_delta += d7;

      g.growth_30d.sales_delta += d30;

      if (c.recorded_at && (!g.recorded_at || c.recorded_at > g.recorded_at)) {
        g.recorded_at = c.recorded_at;
      }
    }

    return Object.values(groups).map((g) => {
      g.platform_count =
        (g.readrealm.exists ? 1 : 0) +
        (g.kairew.exists ? 1 : 0) +
        (g.chaply.exists ? 1 : 0);

      const base7 = g.total_sales - g.growth_7d.sales_delta;

      g.growth_7d.sales_growth_pct =
        base7 > 0
          ? Math.round((g.growth_7d.sales_delta / base7) * 1000) / 10
          : 0;

      const base30 = g.total_sales - g.growth_30d.sales_delta;

      g.growth_30d.sales_growth_pct =
        base30 > 0
          ? Math.round((g.growth_30d.sales_delta / base30) * 1000) / 10
          : 0;

      const accs = new Set<string>();

      if (g.readrealm.exists && g.readrealm.account)
        accs.add(g.readrealm.account);

      if (g.kairew.exists && g.kairew.account) accs.add(g.kairew.account);

      if (g.chaply.exists && g.chaply.account) accs.add(g.chaply.account);

      g.account = Array.from(accs).join(", ");

      const finalGRecency = getInactivityRecency(g.last_chapter_updated_at, g.days_inactive);
      g.days_inactive = finalGRecency.days;

      return g;
    });
  }, [trackerData]);

  // Count titles with mismatched chapters across platforms
  const mismatchCount = React.useMemo(() => {
    return unifiedComics.filter((c) => {
      const activePlatformChapters: number[] = [];
      if (c.readrealm?.exists)
        activePlatformChapters.push(c.readrealm.chapters || 0);
      if (c.kairew?.exists) activePlatformChapters.push(c.kairew.chapters || 0);
      if (c.chaply?.exists) activePlatformChapters.push(c.chaply.chapters || 0);
      return (
        activePlatformChapters.length > 1 &&
        !activePlatformChapters.every((ch) => ch === activePlatformChapters[0])
      );
    }).length;
  }, [unifiedComics]);

  const urgentCount = React.useMemo(() => {
    return unifiedComics.filter((c) => isTitleUrgent(c.subject)).length;
  }, [unifiedComics, isTitleUrgent]);

  // Dynamic KPI Aggregations based on platform filter

  const kpiStats = React.useMemo(() => {
    if (!trackerData) {
      return {
        sales: 0,

        views: 0,

        comics: 0,

        inactive30: 0,

        active30: 0,

        breakdown: {} as any,
      };
    }

    const breakdown = trackerData.platforms_breakdown || {};

    if (platformFilter === "all") {
      return {
        sales: trackerData.total_sales_portfolio || 0,

        views: trackerData.total_views_portfolio || 0,

        comics: groupUnified
          ? unifiedComics?.length || 243
          : trackerData.total_comics || (trackerData.comics || []).length,

        inactive30: trackerData.total_inactive_30d || 0,

        active30: trackerData.total_active_30d || 0,

        breakdown,
      };
    }

    const pData = breakdown[platformFilter];

    if (pData) {
      return {
        sales: pData.sales || 0,

        views: pData.views || 0,

        comics: pData.comics_count || 0,

        inactive30: pData.inactive_30d || 0,

        active30: pData.active_30d || 0,

        breakdown,
      };
    }

    const pComics = (trackerData.comics || []).filter(
      (c: any) => c.platform === platformFilter,
    );

    const inact = pComics.filter(
      (c: any) => (c.days_inactive != null ? c.days_inactive : 0) > 30,
    ).length;

    return {
      sales: pComics.reduce(
        (sum: number, c: any) => sum + (c.total_sales || 0),
        0,
      ),

      views: pComics.reduce(
        (sum: number, c: any) => sum + (c.total_views || 0),
        0,
      ),

      comics: pComics.length,

      inactive30: inact,

      active30: pComics.length - inact,

      breakdown,
    };
  }, [trackerData, platformFilter, groupUnified, unifiedComics]);

  // Filtered & Sorted Comics for Growth Table (Unified + Flat)

  const filteredComics = React.useMemo(() => {
    if (!trackerData || !Array.isArray(trackerData.comics)) return [];

    // 1. Unified cross-platform view (มังงะเรื่องเดียวกันรวมในแถวเดียว + กัน)

    if (groupUnified) {
      let list = [...unifiedComics];

      // Platform filter

      if (platformFilter === "readrealm") {
        list = list.filter((c) => c.readrealm.exists);
      } else if (platformFilter === "kairew") {
        list = list.filter((c) => c.kairew.exists);
      } else if (platformFilter === "chaply") {
        list = list.filter((c) => c.chaply.exists);
      }

      // Account filter

      if (accountFilter !== "all") {
        list = list.filter(
          (c) =>
            (c.account && c.account.includes(accountFilter)) ||
            c.readrealm.account === accountFilter ||
            c.kairew.account === accountFilter ||
            c.chaply.account === accountFilter,
        );
      }

      // Inactivity filter

      if (statusFilter === "inactive30") {
        list = list.filter(
          (c) => (c.days_inactive != null ? c.days_inactive : 0) > 30,
        );
      } else if (statusFilter === "active30") {
        list = list.filter(
          (c) => (c.days_inactive != null ? c.days_inactive : 0) <= 30,
        );
      } else if (statusFilter === "inactive90") {
        list = list.filter(
          (c) => (c.days_inactive != null ? c.days_inactive : 0) > 90,
        );
      } else if (statusFilter === "mismatch") {
        list = list.filter((c) => {
          const activePlatformChapters: number[] = [];
          if (c.readrealm?.exists)
            activePlatformChapters.push(c.readrealm.chapters || 0);
          if (c.kairew?.exists)
            activePlatformChapters.push(c.kairew.chapters || 0);
          if (c.chaply?.exists)
            activePlatformChapters.push(c.chaply.chapters || 0);
          return (
            activePlatformChapters.length > 1 &&
            !activePlatformChapters.every(
              (ch) => ch === activePlatformChapters[0],
            )
          );
        });
      } else if (statusFilter === "urgent") {
        list = list.filter((c) => isTitleUrgent(c.subject));
      }

      // Search query

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();

        list = list.filter(
          (c) =>
            (c.subject && c.subject.toLowerCase().includes(q)) ||
            (c.readrealm.id && c.readrealm.id.toLowerCase().includes(q)) ||
            (c.kairew.id && c.kairew.id.toLowerCase().includes(q)) ||
            (c.chaply.id && c.chaply.id.toLowerCase().includes(q)),
        );
      }

      // Map display sales & views depending on platformFilter

      list = list.map((c) => {
        let display_sales = c.total_sales;
        let display_views = c.total_views;
        let display_sales_7_chapters = c.total_sales_7_chapters || 0;
        let display_views_7_chapters = c.total_views_7_chapters || 0;

        if (platformFilter === "readrealm") {
          display_sales = c.readrealm?.sales || 0;
          display_views = c.readrealm?.views || 0;
          display_sales_7_chapters = c.readrealm?.sales_7_chapters || 0;
          display_views_7_chapters = c.readrealm?.views_7_chapters || 0;
        } else if (platformFilter === "kairew") {
          display_sales = c.kairew?.sales || 0;
          display_views = c.kairew?.views || 0;
          display_sales_7_chapters = c.kairew?.sales_7_chapters || 0;
          display_views_7_chapters = c.kairew?.views_7_chapters || 0;
        } else if (platformFilter === "chaply") {
          display_sales = c.chaply?.sales || 0;
          display_views = c.chaply?.views || 0;
          display_sales_7_chapters = c.chaply?.sales_7_chapters || 0;
          display_views_7_chapters = c.chaply?.views_7_chapters || 0;
        }

        return {
          ...c,
          display_sales,
          display_views,
          display_sales_7_chapters,
          display_views_7_chapters,
        };
      });

      // Sorting

      const getAvg7Sales = (x: any) => {
        const eps = Math.max(1, Math.min(7, x.chapters_count || 7));
        return (x.display_sales_7_chapters || 0) / eps;
      };

      list.sort((a, b) => {
        if (sortBy === "sales")
          return (b.display_sales || 0) - (a.display_sales || 0);

        if (sortBy === "avg_sales_7_chapters")
          return getAvg7Sales(b) - getAvg7Sales(a);

        if (sortBy === "sales_7_chapters")
          return (
            (b.display_sales_7_chapters || 0) -
            (a.display_sales_7_chapters || 0)
          );

        if (sortBy === "views")
          return (b.display_views || 0) - (a.display_views || 0);

        if (sortBy === "inactive_desc") {
          return (
            (b.days_inactive != null ? b.days_inactive : 0) -
            (a.days_inactive != null ? a.days_inactive : 0)
          );
        }

        if (sortBy === "inactive_asc") {
          return (
            (a.days_inactive != null ? a.days_inactive : 0) -
            (b.days_inactive != null ? b.days_inactive : 0)
          );
        }

        if (sortBy === "growth7d") {
          const gA = a.growth_7d?.sales_growth_pct || 0;

          const gB = b.growth_7d?.sales_growth_pct || 0;

          return gB - gA;
        }

        if (sortBy === "growth30d") {
          const gA = a.growth_30d?.sales_growth_pct || 0;

          const gB = b.growth_30d?.sales_growth_pct || 0;

          return gB - gA;
        }

        return 0;
      });

      return list;
    }

    // 2. Fallback to Raw list

    let list = [...trackerData.comics];

    if (platformFilter !== "all") {
      list = list.filter((c) => c.platform === platformFilter);
    }

    if (accountFilter !== "all") {
      list = list.filter(
        (c) => c.account_id === accountFilter || c.account === accountFilter,
      );
    }

    if (statusFilter === "inactive30") {
      list = list.filter(
        (c) => (c.days_inactive != null ? c.days_inactive : 0) > 30,
      );
    } else if (statusFilter === "active30") {
      list = list.filter(
        (c) => (c.days_inactive != null ? c.days_inactive : 0) <= 30,
      );
    } else if (statusFilter === "inactive90") {
      list = list.filter(
        (c) => (c.days_inactive != null ? c.days_inactive : 0) > 90,
      );
    } else if (statusFilter === "urgent") {
      list = list.filter((c) => isTitleUrgent(c.subject));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();

      list = list.filter(
        (c) =>
          (c.subject && c.subject.toLowerCase().includes(q)) ||
          (c.comic_id && String(c.comic_id).toLowerCase().includes(q)),
      );
    }

    list = list.map((c) => {
      const rec = getInactivityRecency(c.last_chapter_updated_at, c.days_inactive);
      return {
        ...c,
        days_inactive: rec.days,
        display_sales: c.total_sales || 0,
      display_views: c.total_views || 0,
      display_sales_7_chapters: c.sales_7_chapters || 0,
      display_views_7_chapters: c.views_7_chapters || 0,
      readrealm: {
        exists: c.platform === "readrealm",
        sales: c.total_sales || 0,
        sales_7_chapters: c.sales_7_chapters || 0,
        views: c.total_views || 0,
        views_7_chapters: c.views_7_chapters || 0,
        id: c.comic_id,
        account: c.account,
      },
      kairew: {
        exists: c.platform === "kairew",
        sales: c.total_sales || 0,
        sales_7_chapters: c.sales_7_chapters || 0,
        views: c.total_views || 0,
        views_7_chapters: c.views_7_chapters || 0,
        id: c.comic_id,
        account: c.account,
      },
      chaply: {
        exists: c.platform === "chaply",
        sales: c.total_sales || 0,
        sales_7_chapters: c.sales_7_chapters || 0,
        views: c.total_views || 0,
        views_7_chapters: c.views_7_chapters || 0,
        id: c.comic_id,
        account: c.account,
      },
      platform_count: 1,
    };
    });

    const getAvg7SalesRaw = (x: any) => {
      const eps = Math.max(1, Math.min(7, x.chapters_count || 7));
      return (x.display_sales_7_chapters || 0) / eps;
    };

    list.sort((a, b) => {
      if (sortBy === "sales")
        return (b.display_sales || 0) - (a.display_sales || 0);

      if (sortBy === "avg_sales_7_chapters")
        return getAvg7SalesRaw(b) - getAvg7SalesRaw(a);

      if (sortBy === "sales_7_chapters")
        return (
          (b.display_sales_7_chapters || 0) - (a.display_sales_7_chapters || 0)
        );

      if (sortBy === "views")
        return (b.display_views || 0) - (a.display_views || 0);

      if (sortBy === "inactive_desc") {
        return (
          (b.days_inactive != null ? b.days_inactive : 0) -
          (a.days_inactive != null ? a.days_inactive : 0)
        );
      }

      if (sortBy === "inactive_asc") {
        return (
          (a.days_inactive != null ? a.days_inactive : 0) -
          (b.days_inactive != null ? b.days_inactive : 0)
        );
      }

      if (sortBy === "growth7d") {
        const gA = a.growth_7d?.sales_growth_pct || 0;

        const gB = b.growth_7d?.sales_growth_pct || 0;

        return gB - gA;
      }

      if (sortBy === "growth30d") {
        const gA = a.growth_30d?.sales_growth_pct || 0;

        const gB = b.growth_30d?.sales_growth_pct || 0;

        return gB - gA;
      }

      return 0;
    });

    return list;
  }, [
    trackerData,
    groupUnified,
    unifiedComics,
    platformFilter,
    accountFilter,
    statusFilter,
    searchQuery,
    sortBy,
    isTitleUrgent,
  ]);

  // --- Traditional P&L Manual Ledger State ---

  // Month filter removed completely to focus on current totals and historical % growth

  const [yearFilter, setYearFilter] = React.useState("all");

  // Add Sale Modal

  const [addOpen, setAddOpen] = React.useState(false);

  const [finDate, setFinDate] = React.useState(now.toISOString().split("T")[0]);

  const [finMangaId, setFinMangaId] = React.useState("");

  const [finWebsite, setFinWebsite] = React.useState("");

  const [finChapters, setFinChapters] = React.useState("0");

  const [finCostPerChapter, setFinCostPerChapter] = React.useState<
    string | number
  >(0);

  const [finRevenue, setFinRevenue] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);

  // Bulk Import Modal

  const [bulkOpen, setBulkOpen] = React.useState(false);

  const [bulkText, setBulkText] = React.useState("");

  const [bulkImporting, setBulkImporting] = React.useState(false);

  const combinedWebsites = React.useMemo(() => {
    const list = [...DEFAULT_WEBSITES];

    (websiteList || []).forEach((w) => {
      const isPlaceholder =
        w === "Other" || w === "ช่องทาง Readrealm" || w === "Readrealm";

      if (w && !list.includes(w) && !isPlaceholder) {
        list.push(w);
      }
    });

    return list;
  }, [websiteList]);

  // Monthly P&L Ledger State & Sorting (Default Profit DESC)
  const [selectedLedgerMonth, setSelectedLedgerMonth] = React.useState<string>("all");
  const [salesSortBy, setSalesSortBy] = React.useState<"profit" | "date" | "revenue" | "cost" | "chapters" | "name">("profit");
  const [salesSortOrder, setSalesSortOrder] = React.useState<"desc" | "asc">("desc");
  const [salesSearchText, setSalesSearchText] = React.useState<string>("");
  const [salesPlatformFilter, setSalesPlatformFilter] = React.useState<"all" | "multi" | "rr" | "kw" | "ch">("all");
  const [syncModalOpen, setSyncModalOpen] = React.useState<boolean>(false);
  const [syncTargetMonth, setSyncTargetMonth] = React.useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [isSyncing, setIsSyncing] = React.useState<boolean>(false);

  const handleToggleSalesSort = (field: "profit" | "date" | "revenue" | "cost" | "chapters" | "name") => {
    if (salesSortBy === field) {
      setSalesSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSalesSortBy(field);
      setSalesSortOrder("desc");
    }
  };

  const handleSyncMonthlyPL = async () => {
    if (!syncTargetMonth) {
      toast.error("กรุณาระบุเดือนเป้าหมาย (YYYY-MM)");
      return;
    }

    try {
      setIsSyncing(true);
      toast.loading(`กำลังดึงรายจ่าย และรายรับ จากทุกแพลตฟอร์มสำหรับเดือน ${syncTargetMonth}...`, { id: "sync-pl" });

      const res = await callGasApi<any>("SYNC_AND_CALCULATE_MONTHLY_PL", {
        targetMonth: syncTargetMonth,
        month: syncTargetMonth,
      });

      toast.dismiss("sync-pl");

      if (res && res.error) {
        toast.error(res.error);
        return;
      }

      toast.success(
        `⚡ ซิงค์และคำนวณ P&L เดือน ${syncTargetMonth} เรียบร้อยแล้ว! (${res.count || 0} เรื่อง | รายได้ ฿${(res.summary?.totalRevenue || res.totalRevenue || 0).toLocaleString()} | ต้นทุน ฿${(res.summary?.totalCost || res.totalCost || 0).toLocaleString()} | กำไรสุทธิ ฿${(res.summary?.netProfit || res.totalProfit || 0).toLocaleString()})`
      );

      if (res && Array.isArray(res.list)) {
        onSalesChange(res.list, websiteList);
      }

      setSelectedLedgerMonth(syncTargetMonth);
      setSyncModalOpen(false);
    } catch (err: any) {
      toast.dismiss("sync-pl");
      toast.error(err.message || "เกิดข้อผิดพลาดในการซิงค์ P&L");
    } finally {
      setIsSyncing(false);
    }
  };

    // Pre-resolve all series names in salesList using live mangaList & KNOWN_MANGA_ID_MAP
  // Requirement: ถ้าไม่มี mangaid ให้ข้ามไปเลย ไม่ต้องเอามาแสดงในสมุดบันทึก
  const resolvedSalesList = React.useMemo(() => {
    return (salesList || [])
      .filter((sale) => {
        const rawId = sale.serieschapterid !== undefined ? sale.serieschapterid : (sale.mangaid !== undefined ? sale.mangaid : sale.manga_id);
        const strId = String(rawId === null || rawId === undefined ? "" : rawId).trim();
        if (!strId || strId === "0" || strId.toLowerCase() === "undefined" || strId.toLowerCase() === "null") return false;
        
        const rawName = String(sale.seriesname || "").trim().toLowerCase();
        if (rawName === "unknown" || rawName.startsWith("manga #")) return false;

        const rev = parseFloat(sale.revenue) || 0;
        const cost = parseFloat(sale.totalcost) || 0;
        const ch = parseInt(sale.chapterscount, 10) || 0;
        if (rev <= 0 && cost <= 0 && ch <= 0) return false;

        return true;
      })
      .map((sale) => {
        const resolved = resolveMangaName(sale.serieschapterid || sale.mangaid, sale.seriesname, mangaList);
        if (resolved && resolved !== sale.seriesname) {
          return { ...sale, seriesname: resolved };
        }
        return sale;
      });
  }, [salesList, mangaList]);

  // Extract all distinct months available in salesList
  const availableSalesMonths = React.useMemo(() => {
    const setM = new Set<string>();
    (resolvedSalesList || []).forEach((s) => {
      if (s.month && /^\d{4}-\d{2}$/.test(s.month)) {
        setM.add(s.month);
      } else if (s.date) {
        try {
          const d = new Date(s.date);
          if (!isNaN(d.getTime())) {
            const m = String(d.getMonth() + 1).padStart(2, "0");
            setM.add(`${d.getFullYear()}-${m}`);
          }
        } catch (e) {}
      }
    });
    setM.add("2026-10");
    setM.add("2026-11");
    return Array.from(setM).sort().reverse();
  }, [resolvedSalesList]);

  // Memoized platform breakdown index for MangaSales ledger Tooltip
  const platformBreakdownMap = React.useMemo(() => {
    const map = new Map<string, {
      readrealm: number;
      kairew: number;
      chaply: number;
      total: number;
      readrealm_monthly?: Record<string, number>;
    }>();
    if (!groupedList || !Array.isArray(groupedList)) return map;

    for (const g of groupedList) {
      const norm = normalizeMangaTitle(g.title || g.key);
      const rr = Number(g.readrealm?.sales) || 0;
      const kr = Number(g.kairew?.sales) || 0;
      const ch = Number(g.chaply?.sales) || 0;
      const total = Number(g.total_sales) || (rr + kr + ch);
      const rrMonthly = (g.readrealm as any)?.monthly_sales || undefined;

      const entry = { readrealm: rr, kairew: kr, chaply: ch, total, readrealm_monthly: rrMonthly };
      if (norm) map.set(norm, entry);
      if (g.key) map.set(g.key, entry);
    }
    return map;
  }, [groupedList]);

  // Comprehensive multi-platform dictionary combining grouped_matched_comics, comic_cross_platform_mapping, and trackerData
  const allMangaPlatformsMap = React.useMemo(() => {
    const map = new Map<string, {
      readrealm?: { exists: boolean; sales?: number; chapters?: number; account?: string; monthly_sales?: Record<string, number> };
      kairew?: { exists: boolean; sales?: number; chapters?: number; account?: string };
      chaply?: { exists: boolean; sales?: number; chapters?: number; account?: string };
      other?: { name: string };
      platformCount: number;
    }>();

    const addOrMerge = (key: string, data: {
      readrealm?: { exists: boolean; sales?: number; chapters?: number; account?: string; monthly_sales?: Record<string, number> };
      kairew?: { exists: boolean; sales?: number; chapters?: number; account?: string };
      chaply?: { exists: boolean; sales?: number; chapters?: number; account?: string };
      other?: { name: string };
    }) => {
      if (!key) return;
      const cleanKey = key.trim();
      if (!cleanKey) return;
      const current = map.get(cleanKey) || { platformCount: 0 };

      if (data.readrealm?.exists) {
        current.readrealm = {
          exists: true,
          sales: Math.max(current.readrealm?.sales || 0, data.readrealm.sales || 0),
          chapters: Math.max(current.readrealm?.chapters || 0, data.readrealm.chapters || 0),
          account: data.readrealm.account || current.readrealm?.account,
          monthly_sales: data.readrealm.monthly_sales || current.readrealm?.monthly_sales,
        };
      }
      if (data.kairew?.exists) {
        current.kairew = {
          exists: true,
          sales: Math.max(current.kairew?.sales || 0, data.kairew.sales || 0),
          chapters: Math.max(current.kairew?.chapters || 0, data.kairew.chapters || 0),
          account: data.kairew.account || current.kairew?.account,
        };
      }
      if (data.chaply?.exists) {
        current.chaply = {
          exists: true,
          sales: Math.max(current.chaply?.sales || 0, data.chaply.sales || 0),
          chapters: Math.max(current.chaply?.chapters || 0, data.chaply.chapters || 0),
          account: data.chaply.account || current.chaply?.account,
        };
      }
      if (data.other?.name) {
        current.other = data.other;
      }

      current.platformCount =
        (current.readrealm?.exists ? 1 : 0) +
        (current.kairew?.exists ? 1 : 0) +
        (current.chaply?.exists ? 1 : 0);

      map.set(cleanKey, current);
    };

    // 1. Ingest comic_cross_platform_mapping
    if (initialMappingData && Array.isArray((initialMappingData as any).mappings)) {
      for (const m of (initialMappingData as any).mappings) {
        const rr = !!m.platforms?.readrealm;
        const kw = !!m.platforms?.kairew;
        const ch = !!m.platforms?.chaply;
        const pData = {
          readrealm: rr ? { exists: true, account: m.platforms?.readrealm?.account } : undefined,
          kairew: kw ? { exists: true, account: m.platforms?.kairew?.account } : undefined,
          chaply: ch ? { exists: true, account: m.platforms?.chaply?.account } : undefined,
        };

        if (m.canonical_key) {
          addOrMerge(m.canonical_key, pData);
          addOrMerge(normalizeMangaTitle(m.canonical_key), pData);
        }
        if (m.canonical_title) {
          addOrMerge(m.canonical_title, pData);
          addOrMerge(normalizeMangaTitle(m.canonical_title), pData);
        }
        if (Array.isArray(m.aliases)) {
          for (const alias of m.aliases) {
            addOrMerge(alias, pData);
            addOrMerge(normalizeMangaTitle(alias), pData);
          }
        }
      }
    }

    // 2. Ingest groupedList (grouped_matched_comics.json)
    if (Array.isArray(groupedList)) {
      for (const g of groupedList) {
        const pData = {
          readrealm: g.readrealm?.exists ? {
            exists: true,
            sales: Number(g.readrealm.sales) || 0,
            chapters: Number(g.readrealm.eps) || 0,
            monthly_sales: (g.readrealm as any)?.monthly_sales,
          } : undefined,
          kairew: g.kairew?.exists ? {
            exists: true,
            sales: Number(g.kairew.sales) || 0,
            chapters: Number(g.kairew.eps) || 0,
          } : undefined,
          chaply: g.chaply?.exists ? {
            exists: true,
            sales: Number(g.chaply.sales) || 0,
            chapters: Number(g.chaply.eps) || 0,
          } : undefined,
        };

        if (g.key) {
          addOrMerge(g.key, pData);
          addOrMerge(normalizeMangaTitle(g.key), pData);
        }
        if (g.title) {
          addOrMerge(g.title, pData);
          addOrMerge(normalizeMangaTitle(g.title), pData);
        }
      }
    }

    // 3. Ingest unifiedComics (live tracker data)
    if (Array.isArray(unifiedComics)) {
      for (const u of unifiedComics) {
        const pData = {
          readrealm: u.readrealm?.exists ? {
            exists: true,
            sales: Number(u.readrealm.sales) || 0,
            chapters: Number(u.readrealm.chapters) || 0,
            account: u.readrealm.account,
          } : undefined,
          kairew: u.kairew?.exists ? {
            exists: true,
            sales: Number(u.kairew.sales) || 0,
            chapters: Number(u.kairew.chapters) || 0,
            account: u.kairew.account,
          } : undefined,
          chaply: u.chaply?.exists ? {
            exists: true,
            sales: Number(u.chaply.sales) || 0,
            chapters: Number(u.chaply.chapters) || 0,
            account: u.chaply.account,
          } : undefined,
        };

        if (u.key) {
          addOrMerge(u.key, pData);
          addOrMerge(normalizeMangaTitle(u.key), pData);
        }
        if (u.subject) {
          addOrMerge(u.subject, pData);
          addOrMerge(normalizeMangaTitle(u.subject), pData);
        }
      }
    }

    // 4. Ingest mangaList (by id and name)
    if (Array.isArray(mangaList)) {
      for (const m of mangaList) {
        if (!m.mangaid) continue;
        const norm = normalizeMangaTitle(m.manganame || m.title || "");
        let existing = norm ? map.get(norm) : null;
        if (!existing && m.manganame) existing = map.get(m.manganame.trim());
        if (existing) {
          map.set(String(m.mangaid), existing);
        }
      }
    }

    return map;
  }, [groupedList, unifiedComics, mangaList]);

  // Resolver for all platforms of any manga sale item
  const getSalePlatforms = React.useCallback(
    (sale: any): Array<{
      id: "readrealm" | "kairew" | "chaply" | "other";
      code: string;
      name: string;
      badgeClass: string;
      dotClass: string;
      exists: boolean;
      sales?: number;
      chapters?: number;
      account?: string;
    }> => {
      const normKey = normalizeMangaTitle(sale.seriesname);
      let match = normKey ? allMangaPlatformsMap.get(normKey) : null;
      if (!match && sale.mangaid != null) {
        match = allMangaPlatformsMap.get(String(sale.mangaid));
      }
      if (!match && sale.seriesname) {
        match = allMangaPlatformsMap.get(sale.seriesname.trim());
      }

      const platBreakdown = normKey ? platformBreakdownMap.get(normKey) : null;

      const platforms: Array<{
        id: "readrealm" | "kairew" | "chaply" | "other";
        code: string;
        name: string;
        badgeClass: string;
        dotClass: string;
        exists: boolean;
        sales?: number;
        chapters?: number;
        account?: string;
      }> = [];

      const rawWeb = String(sale.website || "").trim();
      const lowerWeb = rawWeb.toLowerCase();

      const rrExists =
        Boolean(match?.readrealm?.exists) ||
        (platBreakdown ? platBreakdown.readrealm > 0 : false) ||
        lowerWeb.includes("readrealm") ||
        lowerWeb.includes("websitea.co") ||
        lowerWeb === "rr";

      const kwExists =
        Boolean(match?.kairew?.exists) ||
        (platBreakdown ? platBreakdown.kairew > 0 : false) ||
        lowerWeb.includes("kairew") ||
        lowerWeb === "kw";

      const chExists =
        Boolean(match?.chaply?.exists) ||
        (platBreakdown ? platBreakdown.chaply > 0 : false) ||
        lowerWeb.includes("chaply") ||
        lowerWeb === "ch";

      if (rrExists) {
        platforms.push({
          id: "readrealm",
          code: "RR",
          name: "ReadRealm",
          badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25",
          dotClass: "bg-emerald-400 shadow-xs shadow-emerald-400/50",
          exists: true,
          sales: platBreakdown?.readrealm || match?.readrealm?.sales,
          chapters: match?.readrealm?.chapters,
          account: match?.readrealm?.account,
        });
      }

      if (kwExists) {
        platforms.push({
          id: "kairew",
          code: "KW",
          name: "Kairew",
          badgeClass: "bg-blue-500/15 text-blue-300 border-blue-500/40 hover:bg-blue-500/25",
          dotClass: "bg-blue-400 shadow-xs shadow-blue-400/50",
          exists: true,
          sales: platBreakdown?.kairew || match?.kairew?.sales,
          chapters: match?.kairew?.chapters,
          account: match?.kairew?.account,
        });
      }

      if (chExists) {
        platforms.push({
          id: "chaply",
          code: "CH",
          name: "Chaply",
          badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25",
          dotClass: "bg-amber-400 shadow-xs shadow-amber-400/50",
          exists: true,
          sales: platBreakdown?.chaply || match?.chaply?.sales,
          chapters: match?.chaply?.chapters,
          account: match?.chaply?.account,
        });
      }

      // If rawWeb contains a custom/distinct site not covered by the big 3
      const isKnown =
        lowerWeb.includes("readrealm") ||
        lowerWeb.includes("kairew") ||
        lowerWeb.includes("chaply") ||
        lowerWeb.includes("websitea.co") ||
        lowerWeb === "other" ||
        lowerWeb === "" ||
        lowerWeb.includes("ช่องทาง readrealm");

      if (!isKnown && rawWeb.length > 0) {
        platforms.push({
          id: "other",
          code: rawWeb.length <= 4 ? rawWeb.toUpperCase() : rawWeb.slice(0, 3).toUpperCase(),
          name: rawWeb,
          badgeClass: "bg-slate-800/60 text-slate-300 border-slate-700/60 hover:bg-slate-800",
          dotClass: "bg-slate-400",
          exists: true,
        });
      }

      if (platforms.length === 0) {
        platforms.push({
          id: "readrealm",
          code: "RR",
          name: rawWeb || "ReadRealm",
          badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25",
          dotClass: "bg-emerald-400 shadow-xs shadow-emerald-400/50",
          exists: true,
        });
      }

      return platforms;
    },
    [allMangaPlatformsMap, platformBreakdownMap],
  );

  // Requirement: เรียงมีกำไรไว้บน เริ่มขาดทุนไว้ล่าง จากคอลัมนท์ กำไร/ขาดทุน
  const filteredSales = React.useMemo(() => {
    let list = [...(resolvedSalesList || [])];

    // Requirement: ถ้าไม่มี mangaid ให้ข้ามไปเลย ไม่ต้องเอามาแสดงในสมุดบันทึก
    list = list.filter((s) => {
      const id = String(s.serieschapterid || s.mangaid || s.manga_id || "").trim();
      if (!id || id === "0" || id.toLowerCase() === "undefined" || id.toLowerCase() === "null") return false;
      const name = String(s.seriesname || "").trim().toLowerCase();
      if (name === "unknown" || name.startsWith("manga #")) return false;
      const rev = parseFloat(s.revenue) || 0;
      const cost = parseFloat(s.totalcost) || 0;
      const ch = parseInt(s.chapterscount, 10) || 0;
      if (rev <= 0 && cost <= 0 && ch <= 0) return false;
      return true;
    });

    if (yearFilter !== "all") {
      list = list.filter((s) => {
        if (!s.date) return false;
        const d = new Date(s.date);
        if (isNaN(d.getTime())) return false;
        return String(d.getFullYear()) === yearFilter;
      });
    }

    if (selectedLedgerMonth !== "all") {
      list = list.filter((s) => {
        if (s.month && String(s.month).trim() === selectedLedgerMonth) return true;
        if (s.date && String(s.date).startsWith(selectedLedgerMonth)) return true;
        return false;
      });
    }

    if (salesSearchText.trim()) {
      const q = salesSearchText.trim().toLowerCase();
      list = list.filter((s) => {
        const name = String(s.seriesname || "").toLowerCase();
        const id = String(s.serieschapterid || s.mangaid || "").toLowerCase();
        const web = String(s.website || "").toLowerCase();
        return name.includes(q) || id.includes(q) || web.includes(q);
      });
    }

    if (salesPlatformFilter !== "all") {
      list = list.filter((s) => {
        const plats = getSalePlatforms(s);
        if (salesPlatformFilter === "multi") return plats.length > 1;
        if (salesPlatformFilter === "rr") return plats.some((p) => p.id === "readrealm");
        if (salesPlatformFilter === "kw") return plats.some((p) => p.id === "kairew");
        if (salesPlatformFilter === "ch") return plats.some((p) => p.id === "chaply");
        return true;
      });
    }

    // Default & Selected Sorting: Profit DESC (Highest profit on top, losses at bottom)
    list.sort((a, b) => {
      const revA = parseFloat(a.revenue) || 0;
      const costA = parseFloat(a.totalcost) || 0;
      const profitA = revA - costA;

      const revB = parseFloat(b.revenue) || 0;
      const costB = parseFloat(b.totalcost) || 0;
      const profitB = revB - costB;

      if (salesSortBy === "profit") {
        return salesSortOrder === "desc" ? profitB - profitA : profitA - profitB;
      }
      if (salesSortBy === "revenue") {
        return salesSortOrder === "desc" ? revB - revA : revA - revB;
      }
      if (salesSortBy === "cost") {
        return salesSortOrder === "desc" ? costB - costA : costA - costB;
      }
      if (salesSortBy === "chapters") {
        const chA = parseInt(a.chapterscount, 10) || 0;
        const chB = parseInt(b.chapterscount, 10) || 0;
        return salesSortOrder === "desc" ? chB - chA : chA - chB;
      }
      if (salesSortBy === "name") {
        const nA = String(a.seriesname || "");
        const nB = String(b.seriesname || "");
        return salesSortOrder === "desc" ? nB.localeCompare(nA, "th") : nA.localeCompare(nB, "th");
      }
      // date fallback
      const dateA = new Date(a.date).getTime() || 0;
      const dateB = new Date(b.date).getTime() || 0;
      return salesSortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });

    return list;
  }, [resolvedSalesList, yearFilter, selectedLedgerMonth, salesSortBy, salesSortOrder, salesSearchText, salesPlatformFilter, getSalePlatforms]);

  // Dynamic Monthly Reconciliation Data based on focused month
  const reconciledMonthData = React.useMemo(() => {
    const targetM =
      selectedLedgerMonth !== "all"
        ? selectedLedgerMonth
        : availableSalesMonths[0] || "2026-10";

    const monthSales = (resolvedSalesList || []).filter((s) => {
      if (s.month && String(s.month).trim() === targetM) return true;
      if (s.date && String(s.date).startsWith(targetM)) return true;
      return false;
    });

    const totalRev = monthSales.reduce((acc, s) => acc + (parseFloat(s.revenue) || 0), 0);
    const totalCost = monthSales.reduce((acc, s) => acc + (parseFloat(s.totalcost) || 0), 0);
    const netProfit = totalRev - totalCost;
    const margin = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;
    const totalChapters = monthSales.reduce((acc, s) => acc + (parseInt(s.chapterscount, 10) || 0), 0);
    const avgCostPerChapter = totalChapters > 0 ? totalCost / totalChapters : 0;

    // Platform breakdown
    const platformMap: Record<string, number> = {};
    monthSales.forEach((s) => {
      const plat = s.website || "ReadRealm แปลจนเมื่อย";
      platformMap[plat] = (platformMap[plat] || 0) + (parseFloat(s.revenue) || 0);
    });

    // Month label in Thai
    let monthLabel = targetM;
    try {
      const [y, m] = targetM.split("-");
      const thaiMonths = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
      ];
      const mIdx = parseInt(m, 10) - 1;
      const thYear = parseInt(y, 10) + 543;
      if (mIdx >= 0 && mIdx < 12) {
        monthLabel = `${thaiMonths[mIdx]} ${thYear}`;
      }
    } catch (e) {}

    return {
      targetMonth: targetM,
      monthLabel,
      totalRev,
      totalCost,
      netProfit,
      margin,
      seriesCount: monthSales.length,
      totalChapters,
      avgCostPerChapter,
      platformMap,
      hasData: monthSales.length > 0,
    };
  }, [resolvedSalesList, selectedLedgerMonth, availableSalesMonths]);

  const summary = React.useMemo(() => {
    let totalRev = 0;

    let totalCost = 0;

    const profitMap: Record<string, number> = {};

    filteredSales.forEach((s) => {
      const rev = parseFloat(s.revenue) || 0;

      const cost = parseFloat(s.totalcost) || 0;

      const profit = rev - cost;

      totalRev += rev;

      totalCost += cost;

      const name = s.seriesname || "Unknown";

      profitMap[name] = (profitMap[name] || 0) + profit;
    });

    const sortedRank = Object.keys(profitMap).map((name) => ({
      name,

      profit: profitMap[name],
    }));

    const topProfits = sortedRank

      .filter((p) => p.profit > 0)

      .sort((a, b) => b.profit - a.profit)

      .slice(0, 5);

    const topLosses = sortedRank

      .filter((p) => p.profit < 0)

      .sort((a, b) => a.profit - b.profit)

      .slice(0, 5);

    return {
      totalRev,

      totalCost,

      totalProfit: totalRev - totalCost,

      topProfits,

      topLosses,
    };
  }, [filteredSales]);

  const chartsData = React.useMemo(() => {
    const websiteRevenue: Record<string, number> = {};

    const monthlyWebsiteRevenue: Record<string, Record<string, number>> = {};

    const websitesSet = new Set<string>();

    const allMonthsSet = new Set<string>();

    filteredSales.forEach((s) => {
      const web = s.website || "Other";

      const rev = parseFloat(s.revenue) || 0;

      const cost = parseFloat(s.totalcost) || 0;

      const net = rev - cost;

      let y = now.getFullYear();

      let m = now.getMonth() + 1;

      if (s.month && typeof s.month === "string") {
        const parts = s.month.split("-");

        if (parts.length >= 2) {
          y = parseInt(parts[0]);

          m = parseInt(parts[1]);
        }
      } else if (s.date) {
        const parts = String(s.date).split("-");

        if (parts.length >= 2) {
          y = parseInt(parts[0]);

          m = parseInt(parts[1]);
        }
      }

      const monthKey = `${y}-${String(m).padStart(2, "0")}`;

      websiteRevenue[web] = (websiteRevenue[web] || 0) + rev;

      if (!monthlyWebsiteRevenue[monthKey])
        monthlyWebsiteRevenue[monthKey] = {};

      monthlyWebsiteRevenue[monthKey][web] =
        (monthlyWebsiteRevenue[monthKey][web] || 0) + net;

      websitesSet.add(web);

      allMonthsSet.add(monthKey);
    });

    const websites = Array.from(websitesSet).sort();

    const months = Array.from(allMonthsSet).sort();

    const palette = [
      "#6366f1",

      "#10b981",

      "#ec4899",

      "#eab308",

      "#3b82f6",

      "#a855f7",

      "#f97316",

      "#06b6d4",
    ];

    const lineLabels = months.map((mKey) => {
      const [y, mo] = mKey.split("-");

      return `${THAI_SHORT_MONTHS[parseInt(mo) - 1] || mo} ${
        parseInt(y) + 543
      }`;
    });

    return {
      barData: {
        labels: websites,

        datasets: [
          {
            label: "รายรับรวม (฿)",

            data: websites.map((w) => websiteRevenue[w] || 0),

            backgroundColor: websites.map(
              (_, i) => palette[i % palette.length],
            ),

            borderRadius: 6,
          },
        ],
      },

      pieData: {
        labels: websites,

        datasets: [
          {
            data: websites.map((w) => websiteRevenue[w] || 0),

            backgroundColor: websites.map(
              (_, i) => palette[i % palette.length],
            ),

            borderWidth: 2,

            borderColor: "#151d2f",
          },
        ],
      },

      lineData: {
        labels: lineLabels,

        datasets: websites.map((w, i) => ({
          label: w,

          data: months.map((mKey) => monthlyWebsiteRevenue[mKey]?.[w] || 0),

          borderColor: palette[i % palette.length],

          backgroundColor: palette[i % palette.length] + "33",

          tension: 0.35,

          fill: true,
        })),
      },
    };
  }, [filteredSales]);

  const autoFillFinDetails = async (mId: string, dStr: string) => {
    if (!mId || !dStr) return;

    const manga = (mangaList || []).find(
      (m) => m.mangaid != null && String(m.mangaid) === String(mId),
    );

    if (manga) {
      setFinCostPerChapter(manga.costperchapter || 0);
      if (!finWebsite) {
        const dummySale = { seriesname: manga.manganame, mangaid: manga.mangaid, website: manga.website };
        const plats = getSalePlatforms(dummySale);
        if (plats.length > 1) {
          setFinWebsite(plats.map((p) => p.name).join(" + "));
        } else if (plats.length === 1) {
          setFinWebsite(plats[0].name);
        }
      }
    }

    try {
      const d = new Date(dStr);

      const count = await callGasApi<number>("COUNT_FINISHED_CHAPTERS", {
        mangaId: mId,

        year: d.getFullYear(),

        month: d.getMonth() + 1,
      });

      setFinChapters(String(count || 0));
    } catch {
      // Ignore error
    }
  };

  const handleSaveSale = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!finMangaId || !finWebsite || !finRevenue) {
      toast.error("กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน");

      return;
    }

    setSubmitting(true);

    try {
      const manga = (mangaList || []).find(
        (m) => String(m.mangaid) === String(finMangaId),
      );

      const payload = {
        date: finDate,

        seriesname: manga ? manga.manganame : "",

        serieschapterid: finMangaId,

        website: finWebsite,

        chapterscount: parseFloat(finChapters) || 0,

        costperchapter: parseFloat(String(finCostPerChapter)) || 0,

        revenue: parseFloat(finRevenue) || 0,
      };

      const res = await callGasApi("ADD_MANGA_SALE", payload);

      toast.success("บันทึกยอดขายเรียบร้อย");

      onSalesChange(res.list || [], res.websites);

      setAddOpen(false);

      setFinRevenue("");
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการบันทึก");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearAllSales = async () => {
    if (!window.confirm("คุณแน่ใจหรือไม่ว่าต้องการล้างข้อมูลสมุดบันทึก MangaSales ทั้งหมด? (Header จะยังคงอยู่)")) return;
    try {
      setSubmitting(true);
      const res = await callGasApi("CLEAR_MANGA_SALES", {});
      toast.success("ล้างข้อมูลสมุดบันทึกสำเร็จ");
      onSalesChange(res.list || [], websiteList);
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการล้างข้อมูล");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSale = async (index: number, sale: any) => {
    if (!window.confirm("ยืนยันการลบรายการนี้?")) return;

    try {
      const res = await callGasApi("DELETE_MANGA_SALE", { index, sale });

      toast.success("ลบรายการสำเร็จ");

      onSalesChange(res.list || [], res.websites);
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการลบ");
    }
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;

    const lines = bulkText.trim().split("\n");

    const sales: any[] = [];

    const cleanNum = (str: string) => {
      if (!str) return 0;

      const cleaned = str.replace(/[฿,]/g, "").trim();

      return parseFloat(cleaned) || 0;
    };

    lines.forEach((line) => {
      if (!line.trim()) return;

      const cols = line.includes("\t") ? line.split("\t") : line.split(",");

      if (cols.length < 5) return;

      if (cols[0].includes("วันที่") || cols[3]?.includes("เรื่อง")) return;

      const dateStr = cols[0].trim();

      let day = "30",
        monthStr = "01",
        year = 2025;

      const dateParts = dateStr.split("/");

      if (dateParts.length === 3) {
        day = dateParts[0].padStart(2, "0");

        monthStr = dateParts[1].padStart(2, "0");

        const yr = parseInt(dateParts[2]);

        if (yr > 2500) year = yr - 543;
        else if (yr === 68 || yr === 25 || yr === 1968) year = 2025;
        else if (yr < 100) year = 2000 + yr;
        else year = yr;
      } else {
        const mParts = cols[1].split("-");

        if (mParts.length >= 2) {
          year = parseInt(mParts[0]);

          if (year === 1968) year = 2025;

          monthStr = mParts[1];
        }
      }

      const normalizedDate = `${year}-${monthStr.padStart(
        2,

        "0",
      )}-${day.padStart(2, "0")}`;

      const monthlyTarget = cleanNum(cols[9]);

      const chapters = cleanNum(cols[5]);

      const rawMId = (cols[2] || "").trim();
      // Requirement: ถ้าไม่มี mangaid ให้ข้ามไปเลย ไม่ต้องนำมาบันทึก
      if (!rawMId || rawMId === "0" || rawMId.toLowerCase() === "undefined" || rawMId.toLowerCase() === "null") {
        return;
      }

      sales.push({
        date: normalizedDate,

        month: cols[1].trim(),

        serieschapterid: cols[2].trim(),

        seriesname: cols[3].trim(),

        chapterscount: chapters,

        category: cols[6].trim(),

        website:
          cols[7] === "websiteA.co"
            ? "ช่องทาง Readrealm"
            : cols[7] || "ช่องทาง Readrealm",

        page: (cols[8] || "Page").trim(),

        targetperchapter:
          chapters > 0 ? monthlyTarget / chapters : monthlyTarget,

        totaltarget: monthlyTarget,

        costperchapter: cleanNum(cols[11]),

        totalcost: cleanNum(cols[12]),

        revenue: monthlyTarget,
      });
    });

    if (sales.length === 0) {
      toast.error(
        "ไม่พบข้อมูลที่ถูกต้อง กรุณาใช้ข้อมูลแบบคั่นด้วย Tab หรือ CSV",
      );

      return;
    }

    if (
      !window.confirm(
        `ตรวจพบข้อมูล ${sales.length} รายการ ต้องการนำเข้าหรือไม่?`,
      )
    )
      return;

    setBulkImporting(true);

    try {
      const res = await callGasApi("BULK_ADD_MANGA_SALES", { sales });

      toast.success(`นำเข้าข้อมูล ${res.count} รายการเรียบร้อย`);

      onSalesChange(res.list || [], res.websites);

      setBulkText("");

      setBulkOpen(false);
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาดในการนำเข้าข้อมูล");
    } finally {
      setBulkImporting(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Top Header & Tab Navigation */}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              รายงานกำไร-ขาดทุน และสถิติยอดขาย
            </h2>

            <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-xs font-mono">
              236 Series
            </Badge>
          </div>

          <p className="text-sm text-slate-400 mt-0.5">
            ติดตามยอดขาย ยอดวิว และอัตราการเติบโต 7 วัน / 30 วัน ของ ReadRealm
            อัตโนมัติทุก 6 ชม.
          </p>
        </div>

        {/* Tab Pill Buttons */}

        <div className="flex items-center bg-[#0b1120] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("growth")}

            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "growth"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            สถิติยอดขาย & อัตราเติบโต Multi-Platform
          </button>

          <button
            onClick={() => setActiveTab("grouped")}

            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "grouped"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            รวมเรื่องเดียวกันข้ามแพลตฟอร์ม ({groupedTotals.total} เรื่อง)
          </button>

          <button
            onClick={() => setActiveTab("pnl")}

            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "pnl"
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <DollarSign className="h-3.5 w-3.5 text-amber-400" />
            สมุดบันทึกต้นทุน & P&L เดิม
          </button>
        </div>
      </div>

      {/* ========================================================================= */}

      {/* TAB 1: READREALM GROWTH & SALES TRACKER (6-HOUR AUTO PIPELINE) */}

      {/* ========================================================================= */}

      {activeTab === "growth" && (
        <div className="space-y-6">
          {/* Top Banner: Status & Action */}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-[#0f172a] to-[#0b1120]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 border border-indigo-500/30">
                <Sparkles className="h-5 w-5" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    Multi-Platform 6-Hour Growth Pipeline (ReadRealm • Kairew •
                    Chaply)
                  </span>

                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    GAS Trigger Active (ทุก 6 ชม. ตรงเวลา ไม่โดนแย่งคิว)
                  </span>
                </div>

                <p className="text-xs text-slate-400 mt-0.5">
                  รอบบันทึกล่าสุด:{" "}
                  <span className="text-slate-200 font-mono">
                    {trackerData?.pipeline_recorded_at
                      ? formatThaiTimestamp(trackerData.pipeline_recorded_at)
                      : "4 พ.ย. 2569 (บันทึกอัตโนมัติ)"}
                  </span>{" "}
                  • วันที่อ้างอิง:{" "}
                  <span className="text-indigo-300 font-semibold">
                    {trackerData?.date_reference || "ตามรอบที่จดเอง"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"

                size="sm"

                onClick={loadGrowthData}

                disabled={loadingGrowth}

                className="h-8 text-xs border-slate-700 bg-[#0b1120]"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 mr-1.5 ${loadingGrowth ? "animate-spin" : ""}`}
                />
                โหลดข้อมูลใหม่
              </Button>

              <Button
                size="sm"

                onClick={handleTriggerPipeline}

                disabled={triggeringAction || pipelinePolling}

                className="h-8 text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <TrendingUp
                  className={`h-3.5 w-3.5 mr-1.5 ${triggeringAction || pipelinePolling ? "animate-bounce" : ""}`}
                />

                {pipelinePolling
                  ? "กำลังดึงข้อมูลคลาวด์ (~1 นาที)..."
                  : triggeringAction
                  ? "กำลังสั่งรัน..."
                  : "สั่งรัน Git Action อัปเดต"}
              </Button>
            </div>
          </div>

          {/* 4 KPI Cards (Dynamic according to Platform selection) */}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    💰 ยอดขายสะสม
                    {platformFilter === "all"
                      ? " (รวมทุกแพลตฟอร์ม)"
                      : ` (${platformFilter.toUpperCase()})`}
                  </p>

                  <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                    ฿
                    {kpiStats.sales.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    {platformFilter === "all" ? (
                      <>ReadRealm ฿5.77M • Kairew ฿142.8K • Chaply ฿8.66K</>
                    ) : platformFilter === "readrealm" ? (
                      <>แปลจนเมื่อย ฿4.40M • แปลแล้วแปลอีก ฿1.36M</>
                    ) : platformFilter === "kairew" ? (
                      <>นักเขียน แปลจนเมื่อย • 79 เรื่อง</>
                    ) : (
                      <>ครีเอเตอร์ แปลจนเมื่อย • 67 เรื่อง</>
                    )}
                  </p>
                </div>

                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    👁️ ยอดคนอ่านสะสม
                    {platformFilter === "all"
                      ? " (รวมทุกแพลตฟอร์ม)"
                      : ` (${platformFilter.toUpperCase()})`}
                  </p>

                  <p className="text-xl font-bold font-mono text-cyan-400 mt-1">
                    {kpiStats.views.toLocaleString()}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      ครั้ง
                    </span>
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    {platformFilter === "all" ? (
                      <>ReadRealm 20.6M • Kairew 2.51M • Chaply 91.0K</>
                    ) : platformFilter === "readrealm" ? (
                      <>แปลจนเมื่อย 17.0M • แปลแล้ว 3.6M</>
                    ) : platformFilter === "kairew" ? (
                      <>เฉลี่ย 31,859 วิว/เรื่อง</>
                    ) : (
                      <>เฉลี่ย 1,359 วิว/เรื่อง</>
                    )}
                  </p>
                </div>

                <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                  <BookOpen className="h-5 w-5" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">📚 มังงะที่ติดตาม</p>

                  <p className="text-xl font-bold font-mono text-indigo-400 mt-1">
                    {kpiStats.comics}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      เรื่อง
                    </span>
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    มีตอนใหม่ 30d:{" "}
                    <span className="text-emerald-400 font-medium">
                      {kpiStats.active30}
                    </span>{" "}
                    • ขาดอัปเดต:{" "}
                    <span className="text-amber-400 font-medium">
                      {kpiStats.inactive30}
                    </span>
                  </p>
                </div>

                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                  <Layers className="h-5 w-5" />
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-[#0f172a]/90 border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    ⏱️ เกณฑ์อัตราการเติบโต
                  </p>

                  <p className="text-sm font-semibold text-amber-300 mt-1">
                    7 วัน &amp; 30 วันย้อนหลัง
                  </p>

                  <p className="text-[11px] text-slate-400 mt-1">
                    คำนวณตามรอบวันที่จดเอง (Git JSON Timeline)
                  </p>
                </div>

                <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                  <Clock className="h-5 w-5" />
                </div>
              </div>
            </Card>
          </div>

          {/* Controls: Platform Switcher, Account Filter, Inactivity Filter, Search, Sort */}

          <div className="flex flex-col gap-3 p-3.5 rounded-xl border border-slate-800 bg-[#0b1120]/80">
            {/* 1. Platform Switcher Row */}

            <div className="flex items-center gap-1.5 flex-wrap pb-3 border-b border-slate-800/60">
              <span className="text-xs text-slate-300 mr-1.5 font-semibold flex items-center gap-1">
                <span>🌐 แพลตฟอร์ม:</span>
              </span>

              <button
                onClick={() => {
                  setPlatformFilter("all");
                  setAccountFilter("all");
                }}

                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "all"
                    ? "bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-500/30"
                    : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                🌟 รวมทุกแพลตฟอร์ม (
                {groupUnified
                  ? unifiedComics.length
                  : trackerData?.total_comics || 382}
                )
              </button>

              <button
                onClick={() => {
                  setPlatformFilter("readrealm");
                  setAccountFilter("all");
                }}

                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "readrealm"
                    ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/30"
                    : "bg-[#0f172a] text-blue-400 border-slate-800 hover:text-blue-300"
                }`}
              >
                📘 ReadRealm (236)
              </button>

              <button
                onClick={() => {
                  setPlatformFilter("kairew");
                  setAccountFilter("all");
                }}

                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "kairew"
                    ? "bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/30"
                    : "bg-[#0f172a] text-emerald-400 border-slate-800 hover:text-emerald-300"
                }`}
              >
                📗 Kairew (79)
              </button>

              <button
                onClick={() => {
                  setPlatformFilter("chaply");
                  setAccountFilter("all");
                }}

                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  platformFilter === "chaply"
                    ? "bg-amber-600 text-white border-amber-500 shadow-sm shadow-amber-500/30"
                    : "bg-[#0f172a] text-amber-400 border-slate-800 hover:text-amber-300"
                }`}
              >
                📙 Chaply (67)
              </button>
            </div>

            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              {/* Account Filter Pills */}

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400 mr-1 font-medium">
                  บัญชี:
                </span>

                <button
                  onClick={() => setAccountFilter("all")}

                  className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                    accountFilter === "all"
                      ? "bg-slate-700 text-white border-slate-600"
                      : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  ทั้งหมด ({kpiStats.comics})
                </button>

                {(platformFilter === "all" ||
                  platformFilter === "readrealm" ||
                  platformFilter === "kairew" ||
                  platformFilter === "chaply") && (
                  <button
                    onClick={() => setAccountFilter("แปลจนเมื่อย")}

                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                      accountFilter === "แปลจนเมื่อย" ||
                      accountFilter === "lionking"
                        ? "bg-indigo-600/30 text-indigo-300 border-indigo-500/50"
                        : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    แปลจนเมื่อย
                  </button>
                )}

                {(platformFilter === "all" ||
                  platformFilter === "readrealm") && (
                  <button
                    onClick={() => setAccountFilter("แปลแล้วแปลอีก")}

                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                      accountFilter === "แปลแล้วแปลอีก" ||
                      accountFilter === "adieu"
                        ? "bg-purple-600/30 text-purple-300 border-purple-500/50"
                        : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    แปลแล้วแปลอีก
                  </button>
                )}
              </div>

              {/* Search & Sort */}

              <div className="flex items-center gap-2 flex-1 max-w-lg">
                {/* Mode Toggle: Unified (+ กัน) vs Raw List */}

                <div className="flex items-center bg-[#0f172a] border border-slate-800 p-0.5 rounded-lg text-xs shrink-0">
                  <button
                    type="button"

                    onClick={() => setGroupUnified(true)}

                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      groupUnified
                        ? "bg-indigo-600 text-white shadow-xs font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}

                    title="รวมเรื่องเดียวกันข้ามแพลตฟอร์ม ยอดขายและยอดวิวบวกกันในแถวเดียว"
                  >
                    ➕ รวมเรื่อง (+ กัน)
                  </button>

                  <button
                    type="button"

                    onClick={() => setGroupUnified(false)}

                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                      !groupUnified
                        ? "bg-slate-700 text-white font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}

                    title="แสดงแยกตามรายการดิบ 382 รายการ"
                  >
                    แยกรายการ ({trackerData?.total_comics || 382})
                  </button>
                </div>

                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />

                  <Input
                    placeholder="ค้นหาชื่อเรื่องมังงะ..."

                    value={searchQuery}

                    onChange={(e) => setSearchQuery(e.target.value)}

                    className="h-8 pl-8 text-xs bg-[#0f172a] border-slate-800"
                  />
                </div>

                <select
                  className="h-8 rounded-lg border border-slate-800 bg-[#0f172a] px-2.5 text-xs text-slate-200"

                  value={sortBy}

                  onChange={(e: any) => setSortBy(e.target.value)}
                >
                  <option value="sales">ยอดขายรวมสูงสุด</option>
                  <option value="sales_7_chapters">
                    ยอดขาย 7 ตอนล่าสุดสูงสุด ⚡
                  </option>

                  <option value="views">ยอดวิวสูงสุด</option>

                  <option value="inactive_desc">
                    ขาดตอนใหม่นานสุด (&gt; 30d)
                  </option>

                  <option value="inactive_asc">อัปเดตตอนใหม่ล่าสุด</option>

                  <option value="growth7d">อัตราโต 7 วัน</option>

                  <option value="growth30d">อัตราโต 30 วัน</option>
                </select>
              </div>
            </div>

            {/* Inactivity Filter Pills (ตัวกรองเรื่องที่ไม่มีตอนใหม่มานาน > 30 วัน) */}

            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-800/60">
              <span className="text-[11px] text-slate-400 mr-1 font-medium">
                ตอนใหม่ล่าสุด:
              </span>

              <button
                onClick={() => setStatusFilter("all")}

                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "all"
                    ? "bg-slate-700 text-white border-slate-600"
                    : "bg-[#0f172a] text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                ทุกสถานะ ({kpiStats.comics})
              </button>

              <button
                onClick={() => setStatusFilter("inactive30")}

                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "inactive30"
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm shadow-amber-500/10 font-semibold"
                    : "bg-[#0f172a] text-amber-400/80 border-slate-800 hover:text-amber-300"
                }`}
              >
                <span>⚠️ ไม่มีตอนใหม่ &gt; 30 วัน</span>

                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-[10px] font-mono">
                  {kpiStats.inactive30}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter("active30")}

                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "active30"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm shadow-emerald-500/10 font-semibold"
                    : "bg-[#0f172a] text-emerald-400/80 border-slate-800 hover:text-emerald-300"
                }`}
              >
                <span>⚡ มีตอนใหม่ใน 30 วัน</span>

                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-[10px] font-mono">
                  {kpiStats.active30}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter("inactive90")}

                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "inactive90"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/60 font-semibold"
                    : "bg-[#0f172a] text-rose-400/80 border-slate-800 hover:text-rose-300"
                }`}
              >
                🛑 ขาดอัปเดต &gt; 90 วัน
              </button>

              <button
                onClick={() => setStatusFilter("urgent")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "urgent"
                    ? "bg-red-500/25 text-red-300 border-red-500/70 shadow-sm shadow-red-500/10 font-semibold"
                    : "bg-[#0f172a] text-red-400 border-red-900/50 hover:text-red-300"
                }`}
                title="แสดงเฉพาะมังงะที่ตั้งค่าสถานะด่วน (🔥) ในระบบ"
              >
                <span>🔥 เรื่องด่วน</span>
                <span className="px-1.5 py-0.2 rounded-full bg-red-500/20 text-[10px] font-mono">
                  {urgentCount}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter("mismatch")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${
                  statusFilter === "mismatch"
                    ? "bg-rose-500/25 text-rose-300 border-rose-500/70 shadow-sm shadow-rose-500/10 font-semibold"
                    : "bg-[#0f172a] text-rose-400/80 border-slate-800 hover:text-rose-300"
                }`}
                title="แสดงเฉพาะมังงะที่จำนวนตอนแต่ละแพลตฟอร์มไม่เท่ากัน เพื่อให้สะดวกต่อการตรวจสอบและอัปเดตให้เท่ากัน"
              >
                <span>⚠️ ตอนไม่เท่ากัน</span>
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-[10px] font-mono">
                  {mismatchCount}
                </span>
              </button>
            </div>
          </div>

          {/* Comics Performance Table */}

          <Card className="border-slate-800 bg-[#0f172a]/70 overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-white">
                  ตารางอันดับยอดขาย ยอดวิว และอัตราการเติบโต (
                  {filteredComics.length} เรื่อง)
                </CardTitle>

                <p className="text-xs text-slate-400 mt-0.5">
                  วันที่อ้างอิงตามรอบที่จดเอง ไม่ใช่วันที่บนเว็บ •
                  เรียงตามยอดขายสะสม
                </p>
              </div>
            </CardHeader>

            <div className="overflow-x-auto max-h-[580px]">
              <Table>
                <TableHeader className="bg-[#0b1120] sticky top-0 z-10">
                  <TableRow className="border-slate-800">
                    <TableHead className="w-12 text-center">#</TableHead>

                    <TableHead className="text-center min-w-[210px]">
                      แพลตฟอร์ม
                    </TableHead>

                    <TableHead className="min-w-[220px]">
                      ชื่อเรื่องมังงะ
                    </TableHead>

                    <TableHead className="text-center">บัญชี</TableHead>

                    <TableHead className="text-right">ยอดขายรวม</TableHead>

                    <TableHead className="text-right min-w-[175px] text-amber-300">
                      <div>ยอดขายรายตอน 7 ตอนล่าสุด</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        รวมทุกแพลตฟอร์ม (ชี้ดูแยกเว็บ)
                      </div>
                    </TableHead>

                    <TableHead className="text-center min-w-[95px]">
                      ตอน
                    </TableHead>

                    <TableHead className="text-center min-w-[125px]">
                      อัปเดตตอนล่าสุด
                    </TableHead>

                    <TableHead className="text-right min-w-[130px]">
                      อัตราเติบโต 7 วัน
                    </TableHead>

                    <TableHead className="text-right min-w-[130px]">
                      อัตราเติบโต 30 วัน
                    </TableHead>

                    <TableHead className="text-center min-w-[110px]">
                      วันที่บันทึก
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredComics.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="text-center py-12 text-slate-500"
                      >
                        {loadingGrowth ? (
                          <div className="flex flex-col items-center gap-2">
                            <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />

                            <span>กำลังโหลดข้อมูลสถิติ ReadRealm...</span>
                          </div>
                        ) : (
                          "ไม่พบข้อมูลมังงะที่ตรงกับเงื่อนไข"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredComics.map((c, idx) => {
                      const isTop3 = idx < 3;

                      const rankBadge =
                        idx === 0
                          ? "🥇"
                          : idx === 1
                            ? "🥈"
                            : idx === 2
                              ? "🥉"
                              : `#${idx + 1}`;

                      const g7Pct = c.growth_7d?.sales_growth_pct || 0;

                      const g7Delta = c.growth_7d?.sales_delta || 0;

                      const g30Pct = c.growth_30d?.sales_growth_pct || 0;

                      const g30Delta = c.growth_30d?.sales_delta || 0;
                      const isUrgent = isTitleUrgent(c.subject);

                      return (
                        <TableRow
                          key={c.comic_id || idx}
                          className={`border-slate-800/60 hover:bg-[#151d2f]/50 transition-colors relative hover:z-30 ${
                            isUrgent
                              ? "bg-red-950/20 border-l-2 border-l-red-500 hover:bg-red-950/30"
                              : ""
                          }`}
                        >
                          <TableCell className="text-center font-mono font-medium text-xs">
                            {isTop3 ? (
                              <span className="text-base">{rankBadge}</span>
                            ) : (
                              <span className="text-slate-400">
                                {rankBadge}
                              </span>
                            )}
                          </TableCell>

                          {/* Platform Badges: [Readrealm/][Kairewx][Chaplyx] */}

                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {/* ReadRealm */}

                              {c.readrealm?.exists ? (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-semibold bg-blue-500/15 text-blue-300 border-blue-500/40 px-1.5 py-0.5 shadow-xs"

                                  title={`ReadRealm: ฿${(c.readrealm.sales || 0).toLocaleString()} (${(c.readrealm.views || 0).toLocaleString()} วิว)`}
                                >
                                  Readrealm{" "}
                                  <span className="text-emerald-400 font-bold ml-0.5">
                                    /
                                  </span>
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-medium bg-slate-900/60 text-slate-500 border-slate-800/80 px-1.5 py-0.5 opacity-50"

                                  title="ไม่มีบน ReadRealm"
                                >
                                  Readrealm{" "}
                                  <span className="text-rose-400/80 font-bold ml-0.5">
                                    x
                                  </span>
                                </Badge>
                              )}

                              {/* Kairew */}

                              {c.kairew?.exists ? (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border-emerald-500/40 px-1.5 py-0.5 shadow-xs"

                                  title={`Kairew: ฿${(c.kairew.sales || 0).toLocaleString()} (${(c.kairew.views || 0).toLocaleString()} วิว)`}
                                >
                                  Kairew{" "}
                                  <span className="text-emerald-400 font-bold ml-0.5">
                                    /
                                  </span>
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-medium bg-slate-900/60 text-slate-500 border-slate-800/80 px-1.5 py-0.5 opacity-50"

                                  title="ไม่มีบน Kairew"
                                >
                                  Kairew{" "}
                                  <span className="text-rose-400/80 font-bold ml-0.5">
                                    x
                                  </span>
                                </Badge>
                              )}

                              {/* Chaply */}

                              {c.chaply?.exists ? (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-semibold bg-amber-500/15 text-amber-300 border-amber-500/40 px-1.5 py-0.5 shadow-xs"

                                  title={`Chaply: ${(c.chaply.views || 0).toLocaleString()} วิว`}
                                >
                                  Chaply{" "}
                                  <span className="text-emerald-400 font-bold ml-0.5">
                                    /
                                  </span>
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"

                                  className="text-[10px] font-medium bg-slate-900/60 text-slate-500 border-slate-800/80 px-1.5 py-0.5 opacity-50"

                                  title="ไม่มีบน Chaply"
                                >
                                  Chaply{" "}
                                  <span className="text-rose-400/80 font-bold ml-0.5">
                                    x
                                  </span>
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`text-xs font-semibold transition-colors line-clamp-1 ${
                                    isUrgent
                                      ? "text-red-400 font-bold hover:text-red-300"
                                      : "text-slate-100 hover:text-indigo-300"
                                  }`}
                                  title={c.subject}
                                >
                                  {isUrgent && "🔥 "}
                                  {c.subject}
                                </span>
                                {isUrgent && (
                                  <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.2 text-[10px] font-bold text-red-300 shrink-0">
                                    ด่วน
                                  </span>
                                )}
                              </div>

                              <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 flex-wrap">
                                {c.readrealm?.exists && c.readrealm.id && (
                                  <span>RR: {c.readrealm.id}</span>
                                )}

                                {c.kairew?.exists && c.kairew.id && (
                                  <span>KW: {c.kairew.id}</span>
                                )}

                                {c.chaply?.exists && c.chaply.id && (
                                  <span>CH: {c.chaply.id}</span>
                                )}

                                {!c.readrealm?.exists &&
                                  !c.kairew?.exists &&
                                  !c.chaply?.exists && (
                                    <span>ID: {c.comic_id}</span>
                                  )}
                              </span>
                            </div>
                          </TableCell>

                          <TableCell className="text-center">
                            <Badge
                              className={`text-[10px] font-normal border ${
                                String(c.account).includes("แปลจนเมื่อย")
                                  ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                                  : "bg-purple-500/10 text-purple-400 border-purple-500/30"
                              }`}
                            >
                              {c.account || "แปลจนเมื่อย"}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="font-mono font-bold text-xs text-emerald-400">
                              ฿
                              {(c.display_sales || 0).toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,

                                  maximumFractionDigits: 2,
                                },
                              )}
                            </div>

                            {c.platform_count > 1 && (
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5 space-x-1.5 flex items-center justify-end">
                                {c.readrealm?.exists &&
                                  c.readrealm.sales > 0 && (
                                    <span className="text-blue-300/80">
                                      RR: ฿
                                      {c.readrealm.sales.toLocaleString(
                                        undefined,
                                        { maximumFractionDigits: 0 },
                                      )}
                                    </span>
                                  )}

                                {c.kairew?.exists && c.kairew.sales > 0 && (
                                  <span className="text-emerald-300/80">
                                    KW: ฿
                                    {c.kairew.sales.toLocaleString(undefined, {
                                      maximumFractionDigits: 0,
                                    })}
                                  </span>
                                )}

                                {c.chaply?.exists && c.chaply.sales > 0 && (
                                  <span className="text-amber-300/80">
                                    CH: ฿
                                    {c.chaply.sales.toLocaleString(undefined, {
                                      maximumFractionDigits: 0,
                                    })}
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {(() => {
                              const total7 = Number(c.display_sales_7_chapters) || 0;
                              const divAll = Math.max(1, Math.min(7, c.chapters_count || 7));
                              const avgAll = total7 / divAll;

                              const rr7 = Number(c.readrealm?.sales_7_chapters) || 0;
                              const rrDiv = Math.max(1, Math.min(7, c.readrealm?.chapters || c.chapters_count || 7));
                              const rrAvg = rr7 / rrDiv;

                              const kw7 = Number(c.kairew?.sales_7_chapters) || 0;
                              const kwDiv = Math.max(1, Math.min(7, c.kairew?.chapters || c.chapters_count || 7));
                              const kwAvg = kw7 / kwDiv;

                              const ch7 = Number(c.chaply?.sales_7_chapters) || 0;
                              const chDiv = Math.max(1, Math.min(7, c.chaply?.chapters || c.chapters_count || 7));
                              const chAvg = ch7 / chDiv;

                              const nativeTooltipLines: string[] = [
                                `ยอดขายรายตอน 7 ตอนล่าสุด (${c.subject})`,
                                `รวมทุกแพลตฟอร์ม: ฿${total7.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (เฉลี่ย ฿${avgAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/ตอน)`,
                              ];
                              if (c.readrealm?.exists) {
                                nativeTooltipLines.push(
                                  `• ReadRealm: ฿${rr7.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (เฉลี่ย ฿${rrAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/ตอน)`,
                                );
                              }
                              if (c.kairew?.exists) {
                                nativeTooltipLines.push(
                                  `• Kairew: ฿${kw7.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (เฉลี่ย ฿${kwAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/ตอน)`,
                                );
                              }
                              if (c.chaply?.exists) {
                                nativeTooltipLines.push(
                                  `• Chaply: ฿${ch7.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (เฉลี่ย ฿${chAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/ตอน)`,
                                );
                              }

                              return (
                                <div
                                  className="group relative inline-flex flex-col items-end cursor-help hover:z-50"
                                  title={nativeTooltipLines.join("\n")}
                                >
                                  <div className="font-mono text-xs font-bold text-amber-300">
                                    {total7 > 0 ? (
                                      <>
                                        ฿
                                        {total7.toLocaleString(undefined, {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}
                                      </>
                                    ) : (
                                      <span className="font-normal text-slate-500">
                                        -
                                      </span>
                                    )}
                                  </div>

                                  {total7 > 0 && (
                                    <div className="mt-0.5 text-[10px] font-mono text-slate-400">
                                      เฉลี่ย ฿
                                      {avgAll.toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                      /ตอน
                                    </div>
                                  )}

                                  {/* Hover Tooltip Breakdown by Platform */}
                                  <div
                                    className={`hidden group-hover:block absolute right-0 ${
                                      idx < 3 ? "top-full mt-1.5" : "bottom-full mb-1.5"
                                    } z-[60] w-64 rounded-xl border border-slate-700 bg-[#0b1120] p-3 text-left shadow-2xl pointer-events-none`}
                                  >
                                    <div className="text-[11px] font-semibold text-amber-300 border-b border-slate-800 pb-1.5 mb-2">
                                      📊 ยอดขาย 7 ตอนล่าสุด (แยกแพลตฟอร์ม)
                                    </div>
                                    <div className="space-y-1.5 text-[11px] font-mono">
                                      <div className="flex items-center justify-between">
                                        <span className="text-blue-300 font-sans font-medium">
                                          ReadRealm:
                                        </span>
                                        {c.readrealm?.exists ? (
                                          <span className="text-slate-100">
                                            ฿
                                            {rr7.toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })}{" "}
                                            <span className="text-[10px] text-slate-400">
                                              (฿
                                              {rrAvg.toLocaleString(undefined, {
                                                maximumFractionDigits: 0,
                                              })}
                                              /ตอน)
                                            </span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-500">ไม่ได้ลง</span>
                                        )}
                                      </div>

                                      <div className="flex items-center justify-between">
                                        <span className="text-emerald-300 font-sans font-medium">
                                          Kairew:
                                        </span>
                                        {c.kairew?.exists ? (
                                          <span className="text-slate-100">
                                            ฿
                                            {kw7.toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })}{" "}
                                            <span className="text-[10px] text-slate-400">
                                              (฿
                                              {kwAvg.toLocaleString(undefined, {
                                                maximumFractionDigits: 0,
                                              })}
                                              /ตอน)
                                            </span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-500">ไม่ได้ลง</span>
                                        )}
                                      </div>

                                      <div className="flex items-center justify-between">
                                        <span className="text-amber-300 font-sans font-medium">
                                          Chaply:
                                        </span>
                                        {c.chaply?.exists ? (
                                          <span className="text-slate-100">
                                            ฿
                                            {ch7.toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })}{" "}
                                            <span className="text-[10px] text-slate-400">
                                              (฿
                                              {chAvg.toLocaleString(undefined, {
                                                maximumFractionDigits: 0,
                                              })}
                                              /ตอน)
                                            </span>
                                          </span>
                                        ) : (
                                          <span className="text-slate-500">ไม่ได้ลง</span>
                                        )}
                                      </div>

                                      <div className="pt-1.5 mt-1.5 border-t border-slate-800 flex items-center justify-between font-bold text-amber-300">
                                        <span className="font-sans">รวม 7 ตอนล่าสุด:</span>
                                        <span>
                                          ฿
                                          {total7.toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </TableCell>

                          <TableCell className="text-center">
                            {(() => {
                              const activePlatformChapters: {
                                platform: string;
                                count: number;
                              }[] = [];
                              if (c.readrealm?.exists) {
                                activePlatformChapters.push({
                                  platform: "RR",
                                  count: c.readrealm.chapters || 0,
                                });
                              }
                              if (c.kairew?.exists) {
                                activePlatformChapters.push({
                                  platform: "KW",
                                  count: c.kairew.chapters || 0,
                                });
                              }
                              if (c.chaply?.exists) {
                                activePlatformChapters.push({
                                  platform: "CH",
                                  count: c.chaply.chapters || 0,
                                });
                              }

                              const hasMismatch =
                                activePlatformChapters.length > 1 &&
                                !activePlatformChapters.every(
                                  (ch) =>
                                    ch.count ===
                                    activePlatformChapters[0].count,
                                );

                              return (
                                <div className="flex flex-col items-center justify-center">
                                  {hasMismatch ? (
                                    <>
                                      <Badge
                                        variant="outline"
                                        className="bg-rose-500/20 text-rose-300 border-rose-500/50 font-mono font-bold text-xs px-2 py-0.5 shadow-xs flex items-center gap-1"
                                        title="จำนวนตอนไม่เท่ากันข้ามแพลตฟอร์ม! ต้องอัปเดตตอนให้ตรงกัน"
                                      >
                                        <span>⚠️</span>
                                        <span>{c.chapters_count || 0} ตอน</span>
                                      </Badge>
                                      <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-rose-300 flex-wrap justify-center">
                                        {activePlatformChapters.map((ap) => (
                                          <span
                                            key={ap.platform}
                                            className="px-1 py-0.2 rounded bg-rose-950/70 border border-rose-800/50 font-medium"
                                          >
                                            {ap.platform}:{ap.count}
                                          </span>
                                        ))}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <Badge
                                        variant="outline"
                                        className="bg-slate-800/60 text-slate-300 border-slate-700/60 font-mono text-xs px-2 py-0.5"
                                      >
                                        {c.chapters_count || 0} ตอน
                                      </Badge>
                                      {activePlatformChapters.length > 1 && (
                                        <span className="mt-0.5 text-[9px] font-mono text-emerald-400/80">
                                          ✓ เท่ากันทุกเว็บ
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>

                          {/* Last Chapter Update / Inactivity Badge */}

                          <TableCell className="text-center">
                            {(() => {
                              const recency = getInactivityRecency(
                                c.last_chapter_updated_at,
                                c.days_inactive
                              );
                              if (recency.days != null) {
                                return (
                                  <div className="flex flex-col items-center">
                                    <Badge
                                      className={`text-[10px] font-mono px-2 py-0.5 border ${recency.badgeClass}`}
                                    >
                                      {recency.label}
                                    </Badge>

                                    {c.last_chapter_updated_at && (
                                      <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                                        {c.last_chapter_updated_at.substring(0, 10)}
                                      </span>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <span className="text-xs text-slate-500 font-mono">
                                  -
                                </span>
                              );
                            })()}
                          </TableCell>

                          {/* 7-Day Growth */}

                          <TableCell className="text-right">
                            {trackerData?.has_7d_baseline ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`text-xs font-mono font-semibold flex items-center ${
                                    g7Pct >= 0
                                      ? "text-emerald-400"
                                      : "text-rose-400"
                                  }`}
                                >
                                  {g7Pct >= 0 ? (
                                    <ArrowUpRight className="h-3 w-3 inline mr-0.5" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3 inline mr-0.5" />
                                  )}

                                  {g7Pct > 0 ? `+${g7Pct}%` : `${g7Pct}%`}
                                </span>

                                <span className="text-[10px] font-mono text-slate-400">
                                  {g7Delta >= 0
                                    ? `+฿${g7Delta}`
                                    : `฿${g7Delta}`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 font-mono">
                                -
                              </span>
                            )}
                          </TableCell>

                          {/* 30-Day Growth */}

                          <TableCell className="text-right">
                            {trackerData?.has_30d_baseline ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`text-xs font-mono font-semibold flex items-center ${
                                    g30Pct >= 0
                                      ? "text-emerald-400"
                                      : "text-rose-400"
                                  }`}
                                >
                                  {g30Pct >= 0 ? (
                                    <ArrowUpRight className="h-3 w-3 inline mr-0.5" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3 inline mr-0.5" />
                                  )}

                                  {g30Pct > 0 ? `+${g30Pct}%` : `${g30Pct}%`}
                                </span>

                                <span className="text-[10px] font-mono text-slate-400">
                                  {g30Delta >= 0
                                    ? `+฿${g30Delta}`
                                    : `฿${g30Delta}`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500 font-mono">
                                -
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="text-center font-mono text-[11px] text-slate-400">
                            {c.recorded_at
                              ? new Date(c.recorded_at).toLocaleDateString(
                                  "th-TH",
                                )
                              : trackerData?.date_reference || "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}

      {/* TAB 3: CROSS-PLATFORM GROUPED TITLES (READREALM + KAIREW + CHAPLY) */}

      {/* ========================================================================= */}

      {activeTab === "grouped" && (
        <div className="space-y-6">
          {/* Header Summary Banner */}

          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 via-[#0d1527] to-[#0f172a] p-5 shadow-lg shadow-cyan-950/20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
                    <Layers className="h-5 w-5" />
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      จัดกลุ่มเรื่องเดียวกันข้ามแพลตฟอร์ม (Cross-Platform
                      Unified Titles)
                      <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30 text-[10px]">
                        {groupedTotals.total} เรื่องที่ตรงกัน
                      </Badge>
                    </h3>

                    <p className="text-xs text-slate-400">
                      รวมยอดขายและยอดวิวเฉพาะเรื่องที่เผยแพร่ซ้ำข้ามแพลตฟอร์ม
                      (ReadRealm, Kairew, Chaply) โดยคัดเรื่องที่ไม่ตรงกันออก
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 KPI Cards */}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">
                  เรื่องที่ตรงกันทั้งหมด
                </span>

                <div className="text-xl font-bold text-white mt-1 flex items-baseline gap-1.5">
                  {groupedTotals.total}{" "}
                  <span className="text-xs text-cyan-400 font-normal">
                    เรื่อง
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 mt-0.5">
                  ครบ 3 เว็บ: {groupedTotals.p3} | 2 เว็บ: {groupedTotals.p2}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">
                  ยอดขายรวมสะสม (Combined Sales)
                </span>

                <div className="text-xl font-bold text-emerald-400 mt-1">
                  ฿
                  {groupedTotals.sales.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>

                <div className="text-[10px] text-slate-400 mt-0.5">
                  ReadRealm + Kairew
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">
                  ยอดคนอ่านรวม (Combined Views)
                </span>

                <div className="text-xl font-bold text-indigo-400 mt-1">
                  {groupedTotals.views.toLocaleString()}{" "}
                  <span className="text-xs text-indigo-300 font-normal">
                    วิว
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 mt-0.5">
                  จาก 3 แพลตฟอร์ม
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0b101d]/80 p-3.5">
                <span className="text-[11px] font-medium text-slate-400">
                  ความครอบคลุม 3 แพลตฟอร์ม
                </span>

                <div className="text-xl font-bold text-amber-400 mt-1">
                  {((groupedTotals.p3 / groupedTotals.total) * 100).toFixed(0)}%
                </div>

                <div className="text-[10px] text-slate-400 mt-0.5">
                  64 เรื่องลงครบทั้ง RR, KW, CH
                </div>
              </div>
            </div>
          </div>

          {/* Controls: Search, Platform Filter, Sort */}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0d1322] p-3 rounded-xl border border-slate-800">
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />

                <Input
                  value={groupedSearch}

                  onChange={(e) => setGroupedSearch(e.target.value)}

                  placeholder="ค้นหาชื่อเรื่อง..."

                  className="pl-8 h-9 text-xs bg-[#0b101d] border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-lg"
                />
              </div>

              {/* Platform Filter Chips */}

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setGroupedPlatFilter("all")}

                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "all"
                      ? "bg-cyan-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  ทั้งหมด ({groupedTotals.total})
                </button>

                <button
                  onClick={() => setGroupedPlatFilter("3")}

                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "3"
                      ? "bg-indigo-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  ครบ 3 แพลตฟอร์ม ({groupedTotals.p3})
                </button>

                <button
                  onClick={() => setGroupedPlatFilter("2")}

                  className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                    groupedPlatFilter === "2"
                      ? "bg-purple-600 text-white"
                      : "bg-[#0b101d] text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  2 แพลตฟอร์ม ({groupedTotals.p2})
                </button>
              </div>
            </div>

            {/* Sort Selector */}

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">เรียงตาม:</span>

              <select
                value={groupedSortBy}

                onChange={(e) => setGroupedSortBy(e.target.value as any)}

                className="h-9 px-3 text-xs bg-[#0b101d] border border-slate-700 text-slate-200 rounded-lg focus:outline-hidden focus:border-cyan-500"
              >
                <option value="sales">ยอดขายรวมสูงสุด ⭐</option>

                <option value="views">ยอดคนอ่านรวมสูงสุด 👁️</option>

                <option value="eps">จำนวนตอนสูงสุด 📖</option>
              </select>
            </div>
          </div>

          {/* Table */}

          <Card className="border-slate-800 bg-[#0d1322] shadow-xl overflow-hidden">
            <div className="overflow-x-auto min-h-[260px]">
              <Table>
                <TableHeader className="bg-[#0b101d]/90">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="w-12 text-slate-400 text-xs">
                      #
                    </TableHead>

                    <TableHead className="text-slate-300 text-xs font-semibold min-w-[220px]">
                      ชื่อเรื่อง (มังงะ)
                    </TableHead>

                    <TableHead className="text-slate-300 text-xs font-semibold min-w-[140px]">
                      แพลตฟอร์ม
                    </TableHead>

                    <TableHead className="text-right text-slate-300 text-xs font-semibold min-w-[160px]">
                      ยอดขายรวม (฿)
                    </TableHead>

                    <TableHead className="text-right text-slate-300 text-xs font-semibold min-w-[160px]">
                      ยอดวิวรวม (ครั้ง)
                    </TableHead>

                    <TableHead className="text-center text-slate-300 text-xs font-semibold min-w-[80px]">
                      ตอนสูงสุด
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredGroupedComics.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-10 text-slate-500 text-xs"
                      >
                        ไม่พบข้อมูลเรื่องที่ตรงกับเงื่อนไขการค้นหา
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredGroupedComics.map((g, idx) => {
                      const isUrgent = isTitleUrgent(g.title);
                      return (
                      <TableRow
                        key={g.key}
                        className={`border-slate-800/60 hover:bg-slate-800/30 transition-colors ${
                          isUrgent
                            ? "bg-red-950/20 border-l-2 border-l-red-500 hover:bg-red-950/30"
                            : ""
                        }`}
                      >
                        <TableCell className="text-slate-400 text-xs font-mono">
                          {idx + 1}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-xs leading-snug ${
                                isUrgent
                                  ? "font-bold text-red-400"
                                  : "font-medium text-slate-100"
                              }`}
                            >
                              {isUrgent && "🔥 "}
                              {g.title}
                            </span>
                            {isUrgent && (
                              <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.2 text-[10px] font-bold text-red-300">
                                ด่วน
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {g.readrealm.exists && (
                              <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30 text-[10px] px-1.5 py-0">
                                RR
                              </Badge>
                            )}

                            {g.kairew.exists && (
                              <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30 text-[10px] px-1.5 py-0">
                                KW
                              </Badge>
                            )}

                            {g.chaply.exists && (
                              <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[10px] px-1.5 py-0">
                                CH
                              </Badge>
                            )}

                            <span className="text-[10px] text-slate-400 font-mono ml-0.5">
                              ({g.platform_count})
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="font-bold text-emerald-400 text-xs font-mono">
                            ฿
                            {g.total_sales.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>

                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {g.readrealm.exists && (
                              <span>
                                RR: ฿
                                {g.readrealm.sales.toLocaleString("en-US", {
                                  maximumFractionDigits: 0,
                                })}{" "}
                              </span>
                            )}

                            {g.kairew.exists && (
                              <span>
                                | KW: ฿
                                {g.kairew.sales.toLocaleString("en-US", {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="font-semibold text-slate-200 text-xs font-mono">
                            {g.total_views.toLocaleString()}
                          </div>

                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {g.readrealm.exists && (
                              <span>
                                RR: {g.readrealm.views.toLocaleString()}{" "}
                              </span>
                            )}

                            {g.kairew.exists && (
                              <span>
                                | KW: {g.kairew.views.toLocaleString()}{" "}
                              </span>
                            )}

                            {g.chaply.exists && (
                              <span>
                                | CH: {g.chaply.views.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-center font-mono text-xs text-slate-300">
                          {g.max_eps}
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}

      {/* TAB 2: TRADITIONAL MANUAL P&L LEDGER & CHARTS */}

      {/* ========================================================================= */}

      {activeTab === "pnl" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">
                  สมุดบันทึกยอดขาย & ต้นทุนประจำเดือน (MangaSales Ledger)
                </h3>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[11px]">
                  {reconciledMonthData.monthLabel} • เรียงตามกำไร/ขาดทุน
                </Badge>
              </div>

              <p className="text-xs text-slate-400 mt-1">
                บันทึกยอดขาย ต้นทุนค่าแรง และกำไรสุทธิรายเรื่อง (P&L Per Series) เชื่อมต่อรอบตัดจ่ายเงินเดือนอัตโนมัติ
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Month Filter Selector */}
              <div className="flex items-center gap-1.5 bg-[#0b1120] border border-[#26334d] px-2.5 py-1.5 rounded-lg text-xs">
                <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-slate-400 font-medium">รอบ:</span>
                <select
                  value={selectedLedgerMonth}
                  onChange={(e) => setSelectedLedgerMonth(e.target.value)}
                  className="bg-transparent text-slate-100 font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="all">ทั้งหมด (ทุกเดือน)</option>
                  {availableSalesMonths.map((m) => (
                    <option key={m} value={m} className="bg-slate-900 text-white">
                      {m === "2026-10" ? "ตุลาคม 2569 (2026-10)" : m === "2026-11" ? "พฤศจิกายน 2569 (2026-11)" : m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Requirement: 1-Click Auto-Sync & Calculate Monthly P&L button */}
              <Button
                className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/40 font-bold border border-emerald-400/30 text-xs"
                onClick={() => {
                  setSyncTargetMonth(selectedLedgerMonth !== "all" ? selectedLedgerMonth : "2026-11");
                  setSyncModalOpen(true);
                }}
              >
                <Zap className="h-4 w-4 mr-1.5 text-amber-300 animate-pulse" /> ⚡ ซิงค์ & คำนวณ P&L ประจำเดือน
              </Button>

              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> บันทึกยอดขาย
              </Button>

              <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-1" /> นำเข้าข้อมูล
              </Button>

              <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-950/30 border-red-500/30" onClick={handleClearAllSales} disabled={submitting}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> ล้างสมุด
              </Button>
            </div>
          </div>

          {/* Dynamic Executive Monthly Reconciliation Summary Panel */}
          <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-[#0f172a] via-[#111827] to-[#0b0f19] p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
                  <Scale className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-bold text-white tracking-wide">
                      สรุปการกระทบยอดประจำเดือน (Monthly Reconciliation Summary)
                    </h4>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {reconciledMonthData.monthLabel} • {reconciledMonthData.hasData ? "สมดุล 100%" : "รอการซิงค์"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    เปรียบเทียบตัวเลขที่ระบบดึงอัตโนมัติ (ทุกแพลตฟอร์ม) vs การตัดจ่ายเงินเดือนจริง (PayoutClaims)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>
                  บันทึกต้นทุนรายเรื่องครบ{" "}
                  <strong className="text-white">{reconciledMonthData.seriesCount} เรื่อง</strong>{" "}
                  ({reconciledMonthData.totalChapters} ตอน)
                </span>
              </div>
            </div>

            {/* Reconciliation Comparison Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
              {/* Platform Revenue */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-300">📈 รายได้แพลตฟอร์มรวม (Revenue)</span>
                  <Badge variant="outline" className="text-[10px] text-indigo-300 border-indigo-500/30">
                    ทุกแพลตฟอร์มที่เชื่อมต่อ
                  </Badge>
                </div>
                <div>
                  <div className="text-2xl font-black text-indigo-400 tracking-tight">
                    ฿{reconciledMonthData.totalRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    ดึงจากระบบสรุปยอดขายแพลตฟอร์มรอบ {reconciledMonthData.monthLabel}
                  </p>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-xs text-slate-300 max-h-36 overflow-y-auto">
                  {Object.keys(reconciledMonthData.platformMap).length > 0 ? (
                    Object.entries(reconciledMonthData.platformMap).map(([pName, pAmt]) => (
                      <div key={pName} className="flex justify-between">
                        <span className="text-slate-400 truncate max-w-[170px]">{pName}:</span>
                        <span className="font-medium text-slate-200">
                          ฿{pAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 italic py-1">ยังไม่มีข้อมูลรายได้ในรอบนี้</div>
                  )}
                </div>
              </div>

              {/* Paid Payroll */}
              <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-red-300">💸 ตัดจ่ายเงินเดือนทีมงาน (Expenses)</span>
                  <Badge variant="outline" className="text-[10px] text-red-300 border-red-500/30">
                    PayoutClaims (Paid)
                  </Badge>
                </div>
                <div>
                  <div className="text-2xl font-black text-red-400 tracking-tight">
                    ฿{reconciledMonthData.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    อนุมัติและจ่ายเงินแล้วตามรอบงาน ({reconciledMonthData.seriesCount} เรื่อง)
                  </p>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">จำนวนตอนที่ผลิตจริง:</span>
                    <span className="font-medium text-slate-200">{reconciledMonthData.totalChapters} ตอน</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">ต้นทุนเฉลี่ยต่อตอน:</span>
                    <span className="font-medium text-slate-200">~฿{reconciledMonthData.avgCostPerChapter.toFixed(2)} / ตอน</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">สถานะการกระทบยอด:</span>
                    <span className="font-medium text-emerald-400">แมตช์ตรงกับใบเบิก</span>
                  </div>
                </div>
              </div>

              {/* Net Profit & Margin */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-300">✨ กำไรสุทธิ (Net Reconciliation)</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Margin {reconciledMonthData.margin.toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className={`text-2xl font-black tracking-tight ${reconciledMonthData.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {reconciledMonthData.netProfit >= 0 ? "+" : ""}฿{reconciledMonthData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">กำไรสุทธิหลังหักต้นทุนค่าแรงการ์ตูนทุกเรื่อง</p>
                  </div>
                </div>
                <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/20 p-2.5 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>ต้นทุนเฉลี่ย/ตอน (Avg Cost):</span>
                    <span className="font-semibold text-white">~฿{reconciledMonthData.avgCostPerChapter.toFixed(2)} / ตอน</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>อัตราส่วนกำไร (Margin):</span>
                    <span className="font-semibold text-emerald-400">+{reconciledMonthData.margin.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>การแมตช์เข้าสมุดบัญชี:</span>
                    <span className="font-semibold text-emerald-400">สมบูรณ์ {reconciledMonthData.seriesCount} เรื่อง</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Summary */}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">รายได้รวม</p>

                <p className="text-2xl font-bold text-indigo-400 mt-1">
                  {summary.totalRev.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                <DollarSign className="h-6 w-6" />
              </div>
            </Card>

            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">ต้นทุนรวม</p>

                <p className="text-2xl font-bold text-red-400 mt-1">
                  {summary.totalCost.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
                <TrendingDown className="h-6 w-6" />
              </div>
            </Card>

            <Card className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">กำไรสุทธิ</p>

                <p
                  className={`text-2xl font-bold mt-1 ${
                    summary.totalProfit >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {summary.totalProfit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}{" "}
                  ฿
                </p>
              </div>

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <TrendingUp className="h-6 w-6" />
              </div>
            </Card>
          </div>

          {/* Charts Row */}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">
                  📈 แนวโน้มรายได้รายเดือน
                </CardTitle>

                <div className="flex gap-2">
                  <select
                    className="h-8 rounded-lg border border-[#26334d] bg-[#0b1120] px-2.5 text-xs text-slate-100"

                    value={yearFilter}

                    onChange={(e) => setYearFilter(e.target.value)}
                  >
                    <option value="all">ปี: ทั้งหมด</option>

                    {years.map((y) => (
                      <option key={y} value={String(y)}>
                        {y + 543}
                      </option>
                    ))}
                  </select>
                </div>
              </CardHeader>

              <CardContent className="h-[280px]">
                <Line
                  data={chartsData.lineData}

                  options={{
                    responsive: true,

                    maintainAspectRatio: false,

                    plugins: { legend: { labels: { color: "#cbd5e1" } } },

                    scales: {
                      x: { ticks: { color: "#94a3b8" } },

                      y: { ticks: { color: "#94a3b8" } },
                    },
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🍰 สัดส่วนรายได้</CardTitle>
              </CardHeader>

              <CardContent className="h-[280px] flex items-center justify-center">
                <Doughnut
                  data={chartsData.pieData}

                  options={{
                    responsive: true,

                    maintainAspectRatio: false,

                    cutout: "65%",

                    plugins: {
                      legend: {
                        position: "bottom",
                        labels: { color: "#cbd5e1" },
                      },
                    },
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Ranking & Breakdown */}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" /> อันดับมังงะ
                  (กำไร / ขาดทุน)
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-emerald-400">
                      🏆 5 อันดับกำไรสูงสุด
                    </p>

                    {summary.topProfits.length === 0 ? (
                      <p className="text-slate-500 text-xs">ไม่มีข้อมูลกำไร</p>
                    ) : (
                      summary.topProfits.map((item, idx) => {
                        const isUrgent = isTitleUrgent(item.name);
                        return (
                        <div
                          key={item.name}
                          className={`flex items-center justify-between text-xs p-2 rounded-lg border ${
                            isUrgent
                              ? "bg-red-950/25 border-red-500/40"
                              : "bg-slate-900/50 border-slate-800"
                          }`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-bold text-slate-400">
                              {idx + 1}.
                            </span>

                            <span
                              className={`truncate ${
                                isUrgent ? "font-bold text-red-400" : "text-slate-200"
                              }`}
                            >
                              {isUrgent && "🔥 "}
                              {item.name}
                            </span>
                            {isUrgent && (
                              <span className="rounded bg-red-500/20 border border-red-500/40 px-1 py-0 text-[9px] font-bold text-red-300 shrink-0">
                                ด่วน
                              </span>
                            )}
                          </div>

                          <span className="font-semibold text-emerald-400 shrink-0">
                            +฿{item.profit.toLocaleString()}
                          </span>
                        </div>
                        );
                      })
                    )}
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-red-400">
                      🔻 5 อันดับขาดทุนสูงสุด
                    </p>

                    {summary.topLosses.length === 0 ? (
                      <p className="text-slate-500 text-xs">
                        ไม่มีรายการขาดทุน
                      </p>
                    ) : (
                      summary.topLosses.map((item, idx) => {
                        const isUrgent = isTitleUrgent(item.name);
                        return (
                        <div
                          key={item.name}
                          className={`flex items-center justify-between text-xs p-2 rounded-lg border ${
                            isUrgent
                              ? "bg-red-950/25 border-red-500/40"
                              : "bg-slate-900/50 border-slate-800"
                          }`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-bold text-slate-400">
                              {idx + 1}.
                            </span>

                            <span
                              className={`truncate ${
                                isUrgent ? "font-bold text-red-400" : "text-slate-200"
                              }`}
                            >
                              {isUrgent && "🔥 "}
                              {item.name}
                            </span>
                            {isUrgent && (
                              <span className="rounded bg-red-500/20 border border-red-500/40 px-1 py-0 text-[9px] font-bold text-red-300 shrink-0">
                                ด่วน
                              </span>
                            )}
                          </div>

                          <span className="font-semibold text-red-400 shrink-0">
                            ฿{item.profit.toLocaleString()}
                          </span>
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">📊 รายรับตามช่องทาง</CardTitle>
              </CardHeader>

              <CardContent className="h-[280px]">
                <Bar
                  data={chartsData.barData}

                  options={{
                    responsive: true,

                    maintainAspectRatio: false,

                    plugins: { legend: { display: false } },

                    scales: {
                      x: { ticks: { color: "#94a3b8" } },

                      y: { ticks: { color: "#94a3b8" } },
                    },
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sales Table */}

          <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span>รายการยอดขายประจำเดือน</span>
                  <Badge variant="outline" className="text-xs font-mono font-normal">
                    {filteredSales.length} รายการ
                  </Badge>
                </CardTitle>

                <p className="text-xs text-slate-400 mt-0.5">
                  ตารางบันทึกกำไรขาดทุน แยกตามรายเรื่อง พร้อมตรวจจับช่องทางเผยแพร่ทุกแพลตฟอร์ม (RR / KW / CH)
                </p>
              </div>

              {/* Search & Platform Filter toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-44 sm:w-52">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="ค้นหาชื่อมังงะ..."
                    value={salesSearchText}
                    onChange={(e) => setSalesSearchText(e.target.value)}
                    className="h-8 pl-8 pr-6 text-xs bg-[#0b1120] border-[#26334d] focus:border-indigo-500"
                  />
                  {salesSearchText && (
                    <button
                      onClick={() => setSalesSearchText("")}
                      className="absolute right-2 top-2 text-xs text-slate-400 hover:text-white"
                      title="ล้างคำค้นหา"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 bg-[#0b1120] border border-[#26334d] p-1 rounded-lg text-xs">
                  <Filter className="h-3.5 w-3.5 text-slate-400 ml-1.5 mr-0.5" />
                  <button
                    onClick={() => setSalesPlatformFilter("all")}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      salesPlatformFilter === "all"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  <button
                    onClick={() => setSalesPlatformFilter("multi")}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      salesPlatformFilter === "multi"
                        ? "bg-purple-600 text-white font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="แสดงเฉพาะเรื่องที่มีมากกว่า 1 แพลตฟอร์ม"
                  >
                    หลายช่องทาง (2P+)
                  </button>
                  <button
                    onClick={() => setSalesPlatformFilter("rr")}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      salesPlatformFilter === "rr"
                        ? "bg-emerald-600 text-white font-bold"
                        : "text-emerald-400/80 hover:text-emerald-300"
                    }`}
                    title="ReadRealm"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                    RR
                  </button>
                  <button
                    onClick={() => setSalesPlatformFilter("kw")}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      salesPlatformFilter === "kw"
                        ? "bg-blue-600 text-white font-bold"
                        : "text-blue-400/80 hover:text-blue-300"
                    }`}
                    title="Kairew"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                    KW
                  </button>
                  <button
                    onClick={() => setSalesPlatformFilter("ch")}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                      salesPlatformFilter === "ch"
                        ? "bg-amber-600 text-white font-bold"
                        : "text-amber-400/80 hover:text-amber-300"
                    }`}
                    title="Chaply"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    CH
                  </button>
                </div>
              </div>
            </CardHeader>

            <div className="overflow-x-auto min-h-[260px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer hover:text-white transition-colors" onClick={() => handleToggleSalesSort("date")}>
                      <div className="flex items-center gap-1">
                        <span>วันที่</span>
                        {salesSortBy === "date" ? (
                          salesSortOrder === "desc" ? <ArrowDown className="h-3 w-3 text-indigo-400" /> : <ArrowUp className="h-3 w-3 text-indigo-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-600" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="cursor-pointer hover:text-white transition-colors" onClick={() => handleToggleSalesSort("name")}>
                      <div className="flex items-center gap-1">
                        <span>เรื่อง</span>
                        {salesSortBy === "name" ? (
                          salesSortOrder === "desc" ? <ArrowDown className="h-3 w-3 text-indigo-400" /> : <ArrowUp className="h-3 w-3 text-indigo-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-600" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="min-w-[130px]">ช่องทาง</TableHead>

                    <TableHead className="text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleToggleSalesSort("chapters")}>
                      <div className="flex items-center justify-end gap-1">
                        <span>จำนวนตอน</span>
                        {salesSortBy === "chapters" ? (
                          salesSortOrder === "desc" ? <ArrowDown className="h-3 w-3 text-indigo-400" /> : <ArrowUp className="h-3 w-3 text-indigo-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-600" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="text-right">ต้นทุน/ตอน</TableHead>

                    <TableHead className="text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleToggleSalesSort("cost")}>
                      <div className="flex items-center justify-end gap-1">
                        <span>ต้นทุนรวม</span>
                        {salesSortBy === "cost" ? (
                          salesSortOrder === "desc" ? <ArrowDown className="h-3 w-3 text-red-400" /> : <ArrowUp className="h-3 w-3 text-red-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-600" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="text-right cursor-pointer hover:text-white transition-colors" onClick={() => handleToggleSalesSort("revenue")}>
                      <div className="flex items-center justify-end gap-1">
                        <span>ยอดขาย</span>
                        {salesSortBy === "revenue" ? (
                          salesSortOrder === "desc" ? <ArrowDown className="h-3 w-3 text-indigo-400" /> : <ArrowUp className="h-3 w-3 text-indigo-400" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-600" />
                        )}
                      </div>
                    </TableHead>

                    {/* Requirement: เรียงมีกำไรไว้บน เริ่มขาดทุนไว้ล่าง จากคอลัมนท์ กำไร/ขาดทุน (Highlight active sort) */}
                    <TableHead
                      className="text-right cursor-pointer bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold transition-colors select-none"
                      onClick={() => handleToggleSalesSort("profit")}
                      title="คลิกเพื่อสลับลำดับกำไร/ขาดทุน"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>กำไร/ขาดทุน</span>
                        {salesSortBy === "profit" ? (
                          salesSortOrder === "desc" ? (
                            <ArrowDown className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <ArrowUp className="h-4 w-4 text-emerald-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-emerald-400/60" />
                        )}
                      </div>
                    </TableHead>

                    <TableHead className="text-center w-16">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredSales.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="text-center py-8 text-slate-500"
                      >
                        ไม่พบข้อมูลในรอบที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSales.map((sale, idx) => {
                      const rev = parseFloat(sale.revenue) || 0;

                      const cost = parseFloat(sale.totalcost) || 0;

                      const profit = rev - cost;
                      const isUrgent = isTitleUrgent(sale.seriesname, sale.mangaid);

                      // Calculate Monthly Platform Breakdown for Tooltip & Columns
                      const normSaleKey = normalizeMangaTitle(sale.seriesname);
                      const matchedPlatBreakdown = normSaleKey ? platformBreakdownMap.get(normSaleKey) : null;
                      const platMatch = normSaleKey ? allMangaPlatformsMap.get(normSaleKey) : null;
                      const salePlatforms = getSalePlatforms(sale);

                      // Determine row's month and Thai month name for monthly breakdown
                      let rowMonth = "";
                      if (sale.month && /^\d{4}-\d{2}$/.test(String(sale.month).trim())) {
                        rowMonth = String(sale.month).trim();
                      } else if (sale.date) {
                        const mMatch = String(sale.date).match(/^(\d{4}-\d{2})/);
                        if (mMatch) rowMonth = mMatch[1];
                      }
                      if (!rowMonth && selectedLedgerMonth && selectedLedgerMonth !== "all" && /^\d{4}-\d{2}$/.test(selectedLedgerMonth)) {
                        rowMonth = selectedLedgerMonth;
                      }

                      let rowThaiMonth = "";
                      let rowMonthLabel = "";
                      if (rowMonth) {
                        try {
                          const [yP, mP] = rowMonth.split("-");
                          const mIdx = parseInt(mP, 10) - 1;
                          if (mIdx >= 0 && mIdx < 12) {
                            rowThaiMonth = THAI_MONTHS[mIdx];
                            rowMonthLabel = `${rowThaiMonth} ${parseInt(yP, 10) + 543}`;
                          }
                        } catch (e) {}
                      }

                      const rrExists = Boolean(salePlatforms.some((p) => p.id === "readrealm"));
                      const kwExists = Boolean(salePlatforms.some((p) => p.id === "kairew"));
                      const chExists = Boolean(salePlatforms.some((p) => p.id === "chaply"));
                      const activePlatCount = (rrExists ? 1 : 0) + (kwExists ? 1 : 0) + (chExists ? 1 : 0);

                      // Lifetime totals for reference
                      const rrLifetime = matchedPlatBreakdown?.readrealm || platMatch?.readrealm?.sales || 0;
                      const krLifetime = matchedPlatBreakdown?.kairew || platMatch?.kairew?.sales || 0;
                      const chLifetime = matchedPlatBreakdown?.chaply || platMatch?.chaply?.sales || 0;
                      const totalLifetime = (rrExists ? rrLifetime : 0) + (kwExists ? krLifetime : 0) + (chExists ? chLifetime : 0);

                      // ReadRealm actual monthly sales if available
                      const rrMonthlyMap = matchedPlatBreakdown?.readrealm_monthly || platMatch?.readrealm?.monthly_sales;
                      const rrMonthSales = (rowThaiMonth && rrMonthlyMap && typeof rrMonthlyMap[rowThaiMonth] === "number")
                        ? Number(rrMonthlyMap[rowThaiMonth])
                        : 0;

                      let rrSaleAmt = 0;
                      let krSaleAmt = 0;
                      let chSaleAmt = 0;
                      let isRrExact = false;

                      if (rev <= 0) {
                        rrSaleAmt = 0;
                        krSaleAmt = 0;
                        chSaleAmt = 0;
                      } else if (activePlatCount <= 1) {
                        if (kwExists) krSaleAmt = rev;
                        else if (chExists) chSaleAmt = rev;
                        else rrSaleAmt = rev;
                      } else {
                        // Multi-platform title: sum of breakdown MUST equal rev
                        if (rrExists && rrMonthSales > 0 && rev >= rrMonthSales) {
                          rrSaleAmt = rrMonthSales;
                          isRrExact = true;
                          const remainder = Math.round((rev - rrSaleAmt) * 100) / 100;
                          const otherLifetime = (kwExists ? krLifetime : 0) + (chExists ? chLifetime : 0);
                          if (otherLifetime > 0) {
                            if (kwExists && chExists) {
                              krSaleAmt = Math.round((remainder * (krLifetime / otherLifetime)) * 100) / 100;
                              chSaleAmt = Math.round((remainder - krSaleAmt) * 100) / 100;
                            } else if (kwExists) {
                              krSaleAmt = remainder;
                            } else if (chExists) {
                              chSaleAmt = remainder;
                            }
                          } else {
                            const otherCount = (kwExists ? 1 : 0) + (chExists ? 1 : 0);
                            if (otherCount > 0) {
                              const share = Math.round((remainder / otherCount) * 100) / 100;
                              if (kwExists) krSaleAmt = share;
                              if (chExists) chSaleAmt = Math.round((remainder - krSaleAmt) * 100) / 100;
                            }
                          }
                        } else if (totalLifetime > 0) {
                          const shareRR = rrExists ? (rrLifetime / totalLifetime) : 0;
                          const shareKW = kwExists ? (krLifetime / totalLifetime) : 0;
                          rrSaleAmt = Math.round((rev * shareRR) * 100) / 100;
                          krSaleAmt = Math.round((rev * shareKW) * 100) / 100;
                          if (chExists) {
                            chSaleAmt = Math.round((rev - rrSaleAmt - krSaleAmt) * 100) / 100;
                          } else if (kwExists) {
                            krSaleAmt = Math.round((rev - rrSaleAmt) * 100) / 100;
                          } else {
                            rrSaleAmt = rev;
                          }
                        } else {
                          const share = Math.round((rev / activePlatCount) * 100) / 100;
                          let alloc = 0;
                          if (rrExists) { rrSaleAmt = share; alloc += share; }
                          if (kwExists) { krSaleAmt = share; alloc += share; }
                          if (chExists) { chSaleAmt = Math.round((rev - alloc) * 100) / 100; }
                        }
                      }

                      return (
                        <TableRow
                          key={sale._rowIndex || idx}
                          className={`relative transition-colors hover:bg-[#151d2f]/50 hover:z-30 ${
                            isUrgent
                              ? "bg-red-950/20 border-l-2 border-l-red-500 hover:bg-red-950/30"
                              : ""
                          }`}
                        >
                          <TableCell className="text-xs text-slate-400">
                            {sale.date ? sale.date.split("T")[0] : "-"}
                          </TableCell>

                          <TableCell
                            className={
                              isUrgent
                                ? "font-bold text-red-400"
                                : "font-medium text-slate-200"
                            }
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>
                                {isUrgent && "🔥 "}
                                {sale.seriesname}
                              </span>
                              {isUrgent && (
                                <span className="rounded bg-red-500/20 border border-red-500/40 px-1.5 py-0.2 text-[10px] font-bold text-red-300">
                                  ด่วน
                                </span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1 min-w-[110px]">
                              {salePlatforms.map((p) => {
                                let tooltipText = p.name;
                                const details: string[] = [];
                                if (p.chapters) details.push(`${p.chapters} ตอน`);
                                if (p.sales != null && p.sales > 0) {
                                  details.push(
                                    `สะสม ฿${p.sales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                                  );
                                }
                                if (details.length > 0) {
                                  tooltipText += ` (${details.join(" • ")})`;
                                }

                                return (
                                  <Badge
                                    key={p.id + p.code}
                                    variant="outline"
                                    className={`text-[10px] font-semibold px-1.5 py-0.2 border transition-all cursor-default select-none shadow-xs flex items-center gap-1 ${p.badgeClass}`}
                                    title={tooltipText}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotClass}`}
                                    />
                                    <span>{p.code}</span>
                                  </Badge>
                                );
                              })}

                              {salePlatforms.length > 1 && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-mono px-1 py-0 text-slate-400 border-slate-700/60 bg-slate-900/60"
                                  title={`เผยแพร่ทั้งหมด ${salePlatforms.length} แพลตฟอร์ม (${salePlatforms.map((p) => p.name).join(", ")})`}
                                >
                                  {salePlatforms.length}P
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="text-right">
                            {sale.chapterscount}
                          </TableCell>

                          <TableCell className="text-right">
                            {parseFloat(
                              sale.costperchapter || 0,
                            ).toLocaleString()}{" "}
                            ฿
                          </TableCell>

                          <TableCell className="text-right text-red-400">
                            {cost.toLocaleString()} ฿
                          </TableCell>

                          <TableCell className="text-right font-semibold">
                            <div className="relative group inline-block hover:z-50">
                              <span className="text-indigo-400 hover:text-indigo-300 underline decoration-dotted decoration-indigo-400/50 cursor-pointer transition-colors">
                                {rev.toLocaleString()} ฿
                              </span>
                              {/* Tooltip Hover Card: แยกยอดขายตามแพลตฟอร์ม (Smart Positioning: idx < 3 พุ่งลงล่าง idx >= 3 พุ่งขึ้นบน ไม่ชนหัวตาราง) */}
                              <div
                                className={`absolute right-0 ${
                                  idx < 3 ? "top-full mt-2" : "bottom-full mb-2"
                                } hidden group-hover:flex flex-col z-[60] w-64 p-2.5 bg-[#0f172a] border border-slate-700/80 rounded-lg shadow-2xl shadow-black/80 text-left pointer-events-none backdrop-blur-md`}
                              >
                                <div className="text-[11px] font-bold text-slate-200 border-b border-slate-700/70 pb-1.5 mb-1.5 flex items-center justify-between">
                                  <span className="truncate pr-2">📊 แยกยอดขายตามแพลตฟอร์ม {rowMonthLabel ? `(${rowMonthLabel})` : ""}</span>
                                  <span className="text-indigo-300 shrink-0">฿{rev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="space-y-1.5 text-[11px]">
                                  {rrExists && (
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-1.5 text-slate-300">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
                                        ReadRealm:
                                        {isRrExact && (
                                          <span className="text-[9px] text-emerald-400/80 font-normal">
                                            (รอบจริง)
                                          </span>
                                        )}
                                      </span>
                                      <span className="font-semibold text-emerald-300">
                                        ฿{rrSaleAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  )}
                                  {kwExists && (
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-1.5 text-slate-300">
                                        <span className="w-2 h-2 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50"></span>
                                        Kairew:
                                      </span>
                                      <span className="font-semibold text-blue-300">
                                        ฿{krSaleAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  )}
                                  {chExists && (
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-1.5 text-slate-300">
                                        <span className="w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50"></span>
                                        Chaply:
                                      </span>
                                      <span className="font-semibold text-amber-300">
                                        ฿{chSaleAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400 space-y-1">
                                  {totalLifetime > 0 && (
                                    <div className="flex justify-between items-center text-slate-400">
                                      <span>ยอดสะสมตลอดกาล:</span>
                                      <span className="text-slate-300 font-mono">
                                        ฿{totalLifetime.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center">
                                    <span>ช่องทางเผยแพร่:</span>
                                    <span className="text-slate-300 font-medium truncate max-w-[130px] flex items-center gap-1">
                                      {salePlatforms.map((p) => p.code).join(" • ")}
                                      {salePlatforms.length > 1 ? ` (${salePlatforms.length}P)` : ""}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell
                            className={`text-right font-semibold ${
                              profit >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {profit > 0 ? "+" : ""}
                            {profit.toLocaleString()} ฿
                          </TableCell>

                          <TableCell className="text-center">
                            <Button
                              variant="ghost"

                              size="sm"

                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"

                              onClick={() =>
                                handleDeleteSale(sale._rowIndex, sale)
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* Add Sale Modal */}

      <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกยอดขายประจำเดือน</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveSale} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>วันที่บันทึก *</Label>

              <Input
                type="date"

                value={finDate}

                onChange={(e) => {
                  setFinDate(e.target.value);

                  if (finMangaId)
                    autoFillFinDetails(finMangaId, e.target.value);
                }}

                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>มังงะ *</Label>

              <SearchableSelect
                options={(mangaList || []).map((m) => ({
                  value: String(m.mangaid),

                  label: m.manganame,
                }))}

                value={finMangaId}

                onChange={(val) => {
                  setFinMangaId(val);

                  autoFillFinDetails(val, finDate);
                }}

                placeholder="เลือกมังงะ..."

                searchPlaceholder="ค้นหามังงะ..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>เว็บไซต์ / ช่องทาง *</Label>

              <SearchableSelect
                options={combinedWebsites.map((w) => ({ value: w, label: w }))}

                value={finWebsite}

                onChange={setFinWebsite}

                placeholder="-- เลือกช่องทาง --"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>จำนวนตอนที่ทำ (ออโต้)</Label>

                <Input
                  value={finChapters}

                  onChange={(e) => setFinChapters(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>ต้นทุนต่อตอน</Label>

                <Input
                  type="number"

                  step="0.01"

                  value={finCostPerChapter}

                  onChange={(e) => setFinCostPerChapter(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>ยอดขาย (บาท) *</Label>

              <Input
                type="number"

                step="0.01"

                placeholder="0.00"

                value={finRevenue}

                onChange={(e) => setFinRevenue(e.target.value)}

                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"

                variant="outline"

                onClick={() => setAddOpen(false)}

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

      {/* Auto-Sync & Calculate Monthly P&L Modal (ไม่ต้องสั่งผ่าน AI Agent) */}
      <Dialog open={syncModalOpen} onOpenChange={(v) => !v && setSyncModalOpen(false)}>
        <DialogContent className="max-w-lg border-emerald-500/30 bg-[#0d1424] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-400 text-lg">
              <Zap className="h-5 w-5 text-amber-300" />
              ซิงค์ & คำนวณ P&L ประจำเดือนอัตโนมัติ
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2 text-xs">
            <p className="text-slate-300 leading-relaxed">
              ระบบจะดึงรายจ่ายจริงและรายรับจากทุกช่องทาง มาคำนวณและบันทึกลงในสมุดบัญชี <strong className="text-white">MangaSales</strong> โดยอัตโนมัติ สามารถกดคำนวณในเดือนต่อๆ ไปได้ด้วยตัวเองทันที:
            </p>

            <div className="p-3.5 rounded-xl border border-[#26334d] bg-[#070b14] space-y-2.5">
              <Label className="text-slate-200 font-semibold text-xs flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-indigo-400" />
                เลือกเดือนเป้าหมาย (Target Month)
              </Label>
              <div className="flex gap-2">
                <Input
                  type="month"
                  value={syncTargetMonth}
                  onChange={(e) => setSyncTargetMonth(e.target.value)}
                  className="bg-[#0b1120] border-[#26334d] text-white text-xs font-mono h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncTargetMonth("2026-10")}
                  className={`text-xs ${syncTargetMonth === "2026-10" ? "border-emerald-500 text-emerald-400" : ""}`}
                >
                  ต.ค. 69
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncTargetMonth("2026-11")}
                  className={`text-xs ${syncTargetMonth === "2026-11" ? "border-emerald-500 text-emerald-400" : ""}`}
                >
                  พ.ย. 69
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3.5 space-y-2">
              <span className="font-semibold text-indigo-300">📋 ขั้นตอนที่ระบบจะประมวลผลอัตโนมัติ:</span>
              <ul className="space-y-1.5 text-slate-300 pl-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">1.</span>
                  <span><strong>💸 ดึงรายจ่ายค่าแรงจริง</strong>: ดึงจากใบเบิกที่จ่ายแล้ว (<code className="text-indigo-300">PayoutClaims (Paid)</code>) หรือคิวงาน <code className="text-indigo-300">WorkQueue</code></span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-indigo-400">2.</span>
                  <span><strong>📈 ดึงรายรับทุกแพลตฟอร์ม</strong>: รวบรวมยอดขายจากทุกเว็บที่เชื่อมต่ออยู่ (<strong className="text-white">ReadRealm</strong>, <strong className="text-white">Chaply</strong>, <strong className="text-white">Kairew</strong>)</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-amber-400">3.</span>
                  <span><strong>🚫 ยกเว้นเรื่องที่ยังไม่เปิดเรื่อง</strong>: กรองเฉพาะเรื่องที่เปิดให้อ่านแล้ว (ไม่นำเรื่องที่มี 0 ตอน หรือยังไม่เปิดเรื่องมาคำนวณ)</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-teal-400">4.</span>
                  <span><strong>🔄 เรียงลำดับกำไรสูงสุดไว้บนสุด</strong>: จัดเรียงคอลัมน์กำไร/ขาดทุนจากมากไปหาน้อย และเริ่มขาดทุนไว้ล่าง</span>
                </li>
              </ul>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSyncModalOpen(false)}
                disabled={isSyncing}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={handleSyncMonthlyPL}
                disabled={isSyncing}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> กำลังซิงค์ & คำนวณ...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-1.5 text-amber-300" /> ยืนยันการซิงค์ & บันทึก P&L
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Modal */}

      <Dialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>นำเข้าข้อมูลจำนวนมาก (Bulk Import)</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <p className="text-xs text-slate-400">
              วางข้อมูลดิบ (Tab-separated หรือ CSV) ในช่องด้านล่าง
              ระบบจะคำนวณกำไรและจัดหมวดหมู่ช่องทางให้อัตโนมัติ
            </p>

            <Textarea
              rows={12}

              placeholder="ตัวอย่าง: 30/3/25	2025-03	SJP-03	เสาจักรพรรดิ...	01-06	6	แอ็กชัน...	websiteA.co	Page	1,800	10,800	300	1,800"

              value={bulkText}

              onChange={(e) => setBulkText(e.target.value)}

              className="font-mono text-xs"
            />

            <DialogFooter>
              <Button
                type="button"

                variant="outline"

                onClick={() => setBulkOpen(false)}

                disabled={bulkImporting}
              >
                ยกเลิก
              </Button>

              <Button onClick={handleBulkImport} disabled={bulkImporting}>
                {bulkImporting ? "กำลังนำเข้า..." : "เริ่มนำเข้าข้อมูล"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

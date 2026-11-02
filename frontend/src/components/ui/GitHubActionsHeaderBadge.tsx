import * as React from "react"
import { RefreshCw, ExternalLink, Activity } from "lucide-react"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"

export function GitHubActionsHeaderBadge() {
  const {
    isAnyRunning,
    isKuaikanRunning,
    activeKuaikanRun,
    latestActiveRun,
    latestKuaikanRun,
  } = useGitHubActionsStatus()

  // 1. If KuaiKan Auto-Purchaser is currently running
  if (isKuaikanRunning && activeKuaikanRun) {
    return (
      <a
        href={activeKuaikanRun.html_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-bold shadow-md shadow-emerald-500/10 animate-pulse transition-all cursor-pointer"
        title={`GitHub Actions: KuaiKan Auto-Purchaser กำลังรันอยู่ (Run #${activeKuaikanRun.run_number}) • คลิกเพื่อดู Log สด`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <RefreshCw className="h-3 w-3 animate-spin text-emerald-300" />
        <span>GitAction: กำลังรัน (KuaiKan)</span>
        <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
    )
  }

  // 2. If another pipeline is running (e.g. Raw Tracker or Deploy)
  if (isAnyRunning && latestActiveRun) {
    const shortName = latestActiveRun.name.includes("Raw")
      ? "Raw Tracker"
      : latestActiveRun.name.includes("Thunder")
      ? "Thunder"
      : latestActiveRun.name.includes("Deploy")
      ? "Deploy"
      : "Pipeline"

    return (
      <a
        href={latestActiveRun.html_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/50 text-xs font-bold shadow-md shadow-sky-500/10 animate-pulse transition-all cursor-pointer"
        title={`GitHub Actions: ${latestActiveRun.name} กำลังรันอยู่ (Run #${latestActiveRun.run_number}) • คลิกเพื่อดู Log`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
        </span>
        <RefreshCw className="h-3 w-3 animate-spin text-sky-300" />
        <span>GitAction: กำลังรัน ({shortName})</span>
        <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
    )
  }

  // 3. Standby State (Idle)
  const lastRunInfo = latestKuaikanRun
    ? `รันล่าสุด: KuaiKan #${latestKuaikanRun.run_number} (${
        latestKuaikanRun.conclusion === "success"
          ? "สำเร็จ ✅"
          : latestKuaikanRun.conclusion || "-"
      })`
    : "ไม่มีข้อมูลประวัติการรันล่าสุด"

  return (
    <a
      href={
        latestKuaikanRun?.html_url ||
        "https://github.com/mangahub888/mangahub888.github.io/actions"
      }
      target="_blank"
      rel="noreferrer"
      className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/80 hover:border-slate-600 text-xs font-medium transition-all cursor-pointer"
      title={`GitHub Actions: สแตนด์บาย • ${lastRunInfo} (คลิกเพื่อดู Actions Tab)`}
    >
      <span className="h-2 w-2 rounded-full bg-emerald-500/60 inline-block" />
      <span className="text-slate-300">⚪ GitAction: สแตนด์บาย</span>
    </a>
  )
}

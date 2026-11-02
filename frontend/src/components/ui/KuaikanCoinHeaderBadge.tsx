import * as React from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Crown, RefreshCw } from "lucide-react"
import { useKuaikanCoinAlert } from "@/lib/kuaikanCoinAlert"
import { useGitHubActionsStatus } from "@/lib/useGitHubActionsStatus"

interface KuaikanCoinHeaderBadgeProps {
  onClick: () => void
}

export function KuaikanCoinHeaderBadge({ onClick }: KuaikanCoinHeaderBadgeProps) {
  const { hasAlert, alertInfo, sessionData, vipInfo, isVip, coinBalance } = useKuaikanCoinAlert()
  const { isKuaikanRunning, activeKuaikanRun } = useGitHubActionsStatus()

  // 1. If active emergency alert (insufficient coins or VIP required)
  if (hasAlert) {
    const isVipAlert = Boolean(
      alertInfo?.vipRequired ||
      (alertInfo?.message && (alertInfo.message.includes("VIP Early Access") || alertInfo.message.includes("抢先看") || alertInfo.message.includes("สมาชิก KuaiKan VIP")))
    )

    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={onClick}
        className={
          isVipAlert
            ? "bg-gradient-to-r from-purple-600 via-indigo-600 to-amber-600 hover:from-purple-700 hover:to-amber-700 text-white font-extrabold text-xs gap-1.5 shadow-lg shadow-purple-600/30 animate-pulse cursor-pointer border border-purple-400/40"
            : "bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 hover:from-rose-700 hover:to-amber-700 text-white font-extrabold text-xs gap-1.5 shadow-lg shadow-rose-600/30 animate-pulse cursor-pointer border border-rose-400/40"
        }
        title={
          isVipAlert
            ? "คำเตือน: ตรวจพบตอนติด VIP Early Access ต้องใช้สมาชิก VIP! คลิกเพื่อดูรายละเอียด"
            : "คำเตือนฉุกเฉิน: ตรวจพบเหรียญ KuaiKan หมด! คลิกเพื่อดูรายละเอียด"
        }
      >
        {isVipAlert ? (
          <Crown className="h-3.5 w-3.5 text-amber-200 fill-amber-300/40" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-200 fill-amber-300/40" />
        )}
        <span className="font-bold">{isVipAlert ? "👑 KuaiKan VIP Required" : "⚠️ เหรียญ KuaiKan หมด"}</span>
        {coinBalance !== null && coinBalance !== undefined && (
          <span className="hidden md:inline text-[11px] font-normal opacity-90">
            ({Number(coinBalance).toLocaleString()} KK)
          </span>
        )}
      </Button>
    )
  }

  // 2. If logged in to KuaiKan (even without alert, show real-time VIP & Coins status badge)
  if (sessionData?.loggedIn) {
    const remainedDays = vipInfo?.remainedDays
    const formattedCoins = (coinBalance !== null && coinBalance !== undefined)
      ? Number(coinBalance).toLocaleString()
      : null

    const vipLabel = isVip
      ? (remainedDays !== undefined && remainedDays > 0 ? `VIP (${remainedDays} วัน)` : "VIP Active")
      : "VIP หมดอายุ"

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        className={`gap-1.5 text-xs font-semibold shadow-xs cursor-pointer transition-all ${
          isVip
            ? "bg-gradient-to-r from-amber-500/15 via-purple-600/20 to-indigo-600/20 hover:from-amber-500/25 hover:to-indigo-600/30 text-amber-200 border-amber-500/40 hover:border-amber-400"
            : "bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600"
        }`}
        title={`KuaiKan Manhua: สถานะ ${isVip ? "สมาชิก VIP Active" : "VIP ไม่ได้เปิดใช้งาน/หมดอายุ"} • ยอดคงเหลือ ${formattedCoins ?? 0} KK Coins (คลิกเพื่อจัดการ)`}
      >
        <Crown className={`h-3.5 w-3.5 ${isVip ? "text-amber-400 fill-amber-400/30" : "text-slate-400"}`} />
        <span className="font-bold">{isVip ? `👑 ${vipLabel}` : `⚠️ ${vipLabel}`}</span>
        {formattedCoins !== null && (
          <span className="flex items-center gap-1 text-[11px] text-amber-300/90 font-mono">
            <span>•</span>
            <span>🪙 {formattedCoins} KK</span>
          </span>
        )}
        {isKuaikanRunning && (
          <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold animate-pulse">
            <RefreshCw className="h-2.5 w-2.5 animate-spin text-emerald-300" />
            <span>กำลังซื้อ Raw</span>
          </span>
        )}
      </Button>
    )
  }

  return null
}

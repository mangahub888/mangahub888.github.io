import * as React from "react"
import { toast } from "sonner"

export interface AppVersionInfo {
  version: string
  commit: string
  packageVersion: string
  buildTime: string
}

export const CURRENT_BUILD_VERSION =
  typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "dev"
export const CURRENT_BUILD_TIME =
  typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev"
export const CURRENT_COMMIT =
  typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev"
export const CURRENT_PACKAGE_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2.0.0"

export const LAST_RELOADED_KEY = "mgh_last_reloaded_version"

/**
 * Safe sessionStorage read wrapper to prevent crashes in private/sandboxed browsing.
 */
export function safeGetStorage(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage.getItem(key)
    }
  } catch {
    // Restricted or unavailable in strict private mode
  }
  return null
}

/**
 * Safe sessionStorage write wrapper to prevent crashes in private/sandboxed browsing.
 */
export function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(key, value)
    }
  } catch {
    // Restricted or unavailable in strict private mode
  }
}

/**
 * Safe sessionStorage remove wrapper to prevent crashes in private/sandboxed browsing.
 */
export function safeRemoveStorage(key: string): void {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(key)
    }
  } catch {
    // Restricted or unavailable in strict private mode
  }
}

/**
 * Clean any cache-busting search params (?_v=..., ?_reload=..., or ?_t=...)
 * from the browser address bar while preserving the view path and hash.
 */
export function cleanCacheBustingParams() {
  try {
    const url = new URL(window.location.href)
    let changed = false
    if (url.searchParams.has("_v")) {
      url.searchParams.delete("_v")
      changed = true
    }
    if (url.searchParams.has("_nocache")) {
      url.searchParams.delete("_nocache")
      changed = true
    }
    if (url.searchParams.has("_reload")) {
      url.searchParams.delete("_reload")
      changed = true
    }
    if (url.searchParams.has("_t")) {
      url.searchParams.delete("_t")
      changed = true
    }
    if (changed) {
      const searchStr = url.searchParams.toString()
      const newUrl =
        url.pathname + (searchStr ? `?${searchStr}` : "") + url.hash
      window.history.replaceState(null, "", newUrl)
    }
  } catch {
    // Ignore errors in non-browser environments
  }
}

/**
 * Resolve the absolute endpoint for version.json.
 * Avoids relative "./version.json" resolution failures on sub-routes with trailing slashes (e.g. /connectors/).
 */
export function getVersionEndpoint(): string {
  const envBase =
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/"
  if (envBase.startsWith("/")) {
    const cleanBase = envBase.replace(/\/+$/, "")
    return `${cleanBase}/version.json`
  }
  return "/version.json"
}

/**
 * Fetch the latest version manifest directly from the server,
 * explicitly bypassing browser HTTP cache with unique timestamp, timeout, and no-store headers.
 */
export async function fetchRemoteVersion(
  timeoutMs = 6000
): Promise<AppVersionInfo | null> {
  // If browser is known to be offline, skip network request
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return null
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const targetUrl = `${getVersionEndpoint()}?_t=${Date.now()}`
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
      cache: "no-store",
      signal: controller?.signal,
    })

    if (!response.ok) {
      return null
    }

    const text = await response.text()
    if (!text || !text.trim()) return null
    let data: AppVersionInfo
    try {
      data = JSON.parse(text)
    } catch {
      return null
    }
    return data
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      console.warn("[VersionManager] Could not fetch remote version manifest:", err)
    }
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Parse an ISO date string, Unix timestamp string, or epoch number into a millisecond timestamp.
 * Returns NaN if unparseable or invalid.
 */
export function parseTimestamp(val: unknown): number {
  if (typeof val === "number") return val
  if (typeof val === "string") {
    // If string consists only of digits (Unix epoch ms)
    if (/^\d+$/.test(val.trim())) {
      const num = Number(val.trim())
      if (!isNaN(num)) return num
    }
    const parsed = Date.parse(val)
    if (!isNaN(parsed)) return parsed
  }
  return NaN
}

/**
 * Pure chronological version comparator between current running bundle and remote manifest.
 * Guarantees that:
 * 1. Newer remote buildTime returns true.
 * 2. Older/equal remote buildTime returns false (prevents lagging CDN downgrade loops).
 * 3. Invalid/unparseable remote buildTime when current buildTime is valid returns false (prevents corrupt manifest loops).
 * 4. Dev mode returns false.
 */
export function compareAppVersions(
  current: Partial<AppVersionInfo> | null | undefined,
  remote: Partial<AppVersionInfo> | null | undefined,
  isDev = false
): boolean {
  if (!remote || !remote.buildTime) return false
  if (
    isDev ||
    !current ||
    current.buildTime === "dev" ||
    current.version === "dev" ||
    remote.buildTime === "dev" ||
    remote.version === "dev"
  ) {
    return false
  }

  // Parse ISO build times or timestamps for chronological comparison
  const remoteTime = parseTimestamp(remote.buildTime)
  const currentTime = parseTimestamp(current.buildTime)

  if (!isNaN(remoteTime) && !isNaN(currentTime)) {
    // If remote build is strictly newer than currently running bundle
    if (remoteTime > currentTime) {
      return true
    }
    // If remote build is older or identical, never trigger a false-positive downgrade
    if (remoteTime <= currentTime) {
      return false
    }
  }

  // If current build time is valid but remote timestamp is corrupted/unparseable, reject update
  if (!isNaN(currentTime) && isNaN(remoteTime)) {
    return false
  }

  // Fallback for non-standard timestamp strings
  if (
    current.buildTime !== remote.buildTime &&
    isNaN(currentTime) &&
    isNaN(remoteTime)
  ) {
    return true
  }

  // Check version ID mismatch if not "dev"
  if (
    current.version &&
    current.version !== "dev" &&
    remote.version &&
    current.version !== remote.version
  ) {
    return true
  }

  // Check commit mismatch if available
  if (
    current.commit &&
    current.commit !== "dev" &&
    remote.commit &&
    remote.commit !== "dev" &&
    current.commit !== remote.commit
  ) {
    return true
  }

  return false
}

/**
 * Helper to check if a target version has already been processed by storage or URL query param,
 * accommodating both bare tokens ('v2') and timestamped user-reload tokens ('v2_1730434000').
 */
export function isReloadTargeted(
  targetVersion: string | undefined | null,
  lastReloaded: string | null,
  currentQueryV: string | null
): boolean {
  if (!targetVersion) return false
  if (lastReloaded === targetVersion) return true
  if (currentQueryV === targetVersion) return true
  if (currentQueryV && currentQueryV.startsWith(`${targetVersion}_`)) return true
  return false
}

/**
 * Check if the remote version is newer or different from the current loaded bundle.
 */
export function isNewerVersion(remote: AppVersionInfo | null): boolean {
  const isDev =
    CURRENT_BUILD_TIME === "dev" ||
    CURRENT_BUILD_VERSION === "dev" ||
    (typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV))

  return compareAppVersions(
    {
      version: CURRENT_BUILD_VERSION,
      buildTime: CURRENT_BUILD_TIME,
      commit: CURRENT_COMMIT,
      packageVersion: CURRENT_PACKAGE_VERSION,
    },
    remote,
    isDev
  )
}

/**
 * Perform a cache-busting reload by redirecting to current URL with `_v=<version>`,
 * completely circumventing GitHub Pages 10-minute browser disk cache.
 *
 * @param targetVersion - version manifest identifier or custom token
 * @param isUserInitiated - if true, guarantees an immediate cache-busting reload even if URL or storage already contains targetVersion
 */
export function forceCacheBustingReload(
  targetVersion?: string,
  isUserInitiated = false
) {
  try {
    const versionKey = targetVersion || `${Date.now()}`
    safeSetStorage(LAST_RELOADED_KEY, versionKey)

    const url = new URL(window.location.href)
    const currentV = url.searchParams.get("_v")

    // For automated mount reload, skip if query already contains this exact version or timestamped version
    if (!isUserInitiated && isReloadTargeted(versionKey, null, currentV)) {
      console.warn(
        `[VersionManager] Automated reload with target version ${versionKey} already performed. Skipping duplicate loop.`
      )
      return
    }

    // Clean any prior temporary tokens
    url.searchParams.delete("_reload")
    url.searchParams.delete("_t")

    // For user clicks or fresh target, append timestamp to guarantee edge CDN and browser cache bypass
    const finalParam = isUserInitiated
      ? `${versionKey}_${Date.now()}`
      : versionKey

    url.searchParams.set("_v", finalParam)

    if (isUserInitiated) {
      toast.loading("กำลังโหลด MangaHub เวอร์ชันล่าสุด...", {
        id: "mgh-app-reload",
        duration: 3000,
      })
    }

    window.location.replace(url.toString())
  } catch {
    try {
      window.location.reload()
    } catch {
      // Non-browser fallback
    }
  }
}

/**
 * Format ISO build time into user-friendly localized string.
 */
export function formatBuildDate(isoString: string): string {
  if (!isoString || isoString === "dev") return "Development"
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString("th-TH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return isoString
  }
}

export interface UseVersionWatcherOptions {
  onUpdateAvailable?: (info: AppVersionInfo) => void
  checkIntervalMs?: number
}

/**
 * React hook to manage automatic version checking, stale cache detection,
 * visibility change triggers, browser back/forward cache (bfcache) restoration,
 * and user-friendly update notifications.
 */
export function useVersionWatcher(options: UseVersionWatcherOptions = {}) {
  const { onUpdateAvailable, checkIntervalMs = 2 * 60 * 1000 } = options
  const [updateAvailable, setUpdateAvailable] =
    React.useState<AppVersionInfo | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)
  const hasPromptedToast = React.useRef(false)
  const isMountedRef = React.useRef(true)
  const inFlightCheckRef = React.useRef(false)
  const onUpdateAvailableRef = React.useRef(onUpdateAvailable)

  // Keep callback ref updated without invalidating checkVersion
  React.useEffect(() => {
    onUpdateAvailableRef.current = onUpdateAvailable
  }, [onUpdateAvailable])

  // Track component mount lifecycle to prevent unmounted state updates
  React.useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkVersion = React.useCallback(
    async (isMountCheck = false) => {
      // Deduplicate concurrent check invocations
      if (inFlightCheckRef.current) {
        return
      }
      inFlightCheckRef.current = true

      if (isMountedRef.current) {
        setIsChecking(true)
      }

      try {
        const remote = await fetchRemoteVersion()
        if (!isMountedRef.current) return

        if (remote && isNewerVersion(remote)) {
          setUpdateAvailable(remote)
          onUpdateAvailableRef.current?.(remote)

          // On initial app mount (or bfcache restoration): auto-refresh if stale cache
          if (isMountCheck) {
            const lastReloaded = safeGetStorage(LAST_RELOADED_KEY)
            let currentParamV: string | null = null
            try {
              currentParamV = new URL(window.location.href).searchParams.get("_v")
            } catch {}

            const alreadyTargeted =
              isReloadTargeted(remote.version, lastReloaded, currentParamV) ||
              isReloadTargeted(remote.buildTime, lastReloaded, currentParamV)

            if (!alreadyTargeted) {
              console.info(
                `[VersionManager] Stale cache detected on mount (${CURRENT_BUILD_TIME} vs ${remote.buildTime}). Auto-refreshing...`
              )
              forceCacheBustingReload(remote.version, false)
              return
            }
          }

          // If active in-session, show non-intrusive actionable notification once
          if (!hasPromptedToast.current) {
            hasPromptedToast.current = true
            toast.info("พบการอัปเดตระบบ MangaHub เวอร์ชันใหม่", {
              description: `เวอร์ชัน: ${remote.packageVersion || "ล่าสุด"} (${formatBuildDate(
                remote.buildTime
              )})`,
              action: {
                label: "อัปเดตทันที",
                onClick: () => forceCacheBustingReload(remote.version, true),
              },
              duration: 15000,
            })
          }
        } else if (remote) {
          // We are confirmed on latest version: clean up session storage flag and any leftover _v param in URL
          safeRemoveStorage(LAST_RELOADED_KEY)
          cleanCacheBustingParams()
        }
      } finally {
        inFlightCheckRef.current = false
        if (isMountedRef.current) {
          setIsChecking(false)
        }
      }
    },
    [] // Stable reference: onUpdateAvailable is read from onUpdateAvailableRef
  )

  React.useEffect(() => {
    // 1. Check on mount
    checkVersion(true)

    // 2. Check when page is restored from browser back/forward cache (bfcache)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        checkVersion(true)
      }
    }
    window.addEventListener("pageshow", handlePageShow)

    // 3. Check when user returns to this tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkVersion(false)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // 4. Periodic background check (minimum 10s interval sanity clamp)
    const safeIntervalMs = Math.max(checkIntervalMs, 10000)
    const timer = setInterval(() => {
      checkVersion(false)
    }, safeIntervalMs)

    return () => {
      window.removeEventListener("pageshow", handlePageShow)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearInterval(timer)
    }
  }, [checkVersion, checkIntervalMs])

  return {
    updateAvailable,
    isChecking,
    checkVersion: () => checkVersion(false),
    applyUpdate: () => forceCacheBustingReload(updateAvailable?.version, true),
    currentVersion: CURRENT_PACKAGE_VERSION,
    currentBuildTime: CURRENT_BUILD_TIME,
    currentCommit: CURRENT_COMMIT,
  }
}

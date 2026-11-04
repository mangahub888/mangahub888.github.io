import * as React from "react"
import { useQuery } from "@tanstack/react-query"

export interface GitHubWorkflowRun {
  id: number
  name: string
  path: string
  status: "queued" | "in_progress" | "completed" | "waiting" | string
  conclusion: "success" | "failure" | "cancelled" | "timed_out" | null | string
  html_url: string
  run_number: number
  event: string
  run_started_at: string
  created_at: string
  updated_at: string
  head_branch?: string
  head_commit?: {
    id: string
    message: string
  }
}

const GITHUB_REPO = "mangahub888/mangahub888.github.io"
const ACTIONS_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=10`

export async function fetchGitHubActionsRuns(): Promise<GitHubWorkflowRun[]> {
  try {
    const res = await fetch(ACTIONS_API_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!res.ok) {
      if (res.status === 403) {
        console.warn("GitHub Actions API rate limit exceeded")
      }
      return []
    }
    const json = await res.json()
    return Array.isArray(json.workflow_runs) ? json.workflow_runs : []
  } catch (err) {
    console.warn("Failed to fetch GitHub Actions runs:", err)
    return []
  }
}

export function useGitHubActionsStatus() {
  const {
    data: runs = [],
    isLoading,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["githubActionsStatus"],
    queryFn: fetchGitHubActionsRuns,
    refetchInterval: (query) => {
      // Pause interval when tab is in background to preserve rate limit
      if (typeof document !== "undefined" && document.hidden) return false
      return 45000 // 45 seconds polling
    },
    refetchOnWindowFocus: true,
    staleTime: 30000,
    retry: 1,
  })

  const state = React.useMemo(() => {
    const isWorkflowRunning = (r: GitHubWorkflowRun) =>
      r.status === "in_progress" || r.status === "queued"

    const isKuaikan = (r: GitHubWorkflowRun) =>
      (r.path && r.path.includes("kuaikan")) ||
      (r.name && r.name.toLowerCase().includes("kuaikan"))

    const isRawTracker = (r: GitHubWorkflowRun) =>
      (r.path && r.path.includes("auto_raw_tracker")) ||
      (r.name && r.name.toLowerCase().includes("raw tracker"))

    const isThunderScans = (r: GitHubWorkflowRun) =>
      (r.path && r.path.includes("thunderscans")) ||
      (r.name && r.name.toLowerCase().includes("thunderscans"))

    const isProjectIdeas = (r: GitHubWorkflowRun) =>
      (r.path && r.path.includes("project_ideas")) ||
      (r.name && r.name.toLowerCase().includes("project ideas"))

    const activeRuns = runs.filter(isWorkflowRunning)
    const isAnyRunning = activeRuns.length > 0

    const kuaikanRuns = runs.filter(isKuaikan)
    const activeKuaikanRun = kuaikanRuns.find(isWorkflowRunning) || null
    const isKuaikanRunning = Boolean(activeKuaikanRun)

    const rawTrackerRuns = runs.filter(isRawTracker)
    const activeRawTrackerRun = rawTrackerRuns.find(isWorkflowRunning) || null
    const isRawTrackerRunning = Boolean(activeRawTrackerRun)

    const thunderScansRuns = runs.filter(isThunderScans)
    const activeThunderScansRun = thunderScansRuns.find(isWorkflowRunning) || null
    const isThunderScansRunning = Boolean(activeThunderScansRun)

    const projectIdeasRuns = runs.filter(isProjectIdeas)
    const activeProjectIdeasRun = projectIdeasRuns.find(isWorkflowRunning) || null
    const isProjectIdeasRunning = Boolean(activeProjectIdeasRun)

    const latestActiveRun = activeRuns[0] || null
    const latestKuaikanRun = kuaikanRuns[0] || null
    const latestRawTrackerRun = rawTrackerRuns[0] || null
    const latestProjectIdeasRun = projectIdeasRuns[0] || null

    return {
      runs,
      activeRuns,
      isAnyRunning,
      isKuaikanRunning,
      isRawTrackerRunning,
      isThunderScansRunning,
      isProjectIdeasRunning,
      activeKuaikanRun,
      activeRawTrackerRun,
      activeThunderScansRun,
      activeProjectIdeasRun,
      latestActiveRun,
      latestKuaikanRun,
      latestRawTrackerRun,
      latestProjectIdeasRun,
    }
  }, [runs])

  return {
    ...state,
    isLoading,
    isFetching,
    refetch,
    lastChecked: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
  }
}

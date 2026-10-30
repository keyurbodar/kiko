import type { RunStep, WorkerRow } from "@kiko/protocol"
import { anyRunning, liveLabel, windowKey } from "../run/run-log"
import { stillFailing } from "../run/run-tree-rows"

export type HelperState = "working" | "done" | "failed" | "stopped"

export type HelperLane = {
  id: string
  slug: string
  window: string
  task: string
  title: string
  state: HelperState
  line: string
  startedAt: number
  endedAt: number | undefined
  count: number
  steps: readonly RunStep[]
}

export type HelperStatuses = ReadonlyMap<string, WorkerRow["status"]>

export type HelperAwake = { busy: (slug: string) => boolean; stale: boolean }

const TITLE_WORDS = 5

export function helperTitle(task: string): string {
  const first = task.trim().split(/(?<=[.!?])\s|\n/)[0] ?? ""
  const words = first.replace(/[.!?:;,\s]+$/, "").split(/\s+/)
  const short = words.slice(0, TITLE_WORDS).join(" ")
  return words.length > TITLE_WORDS ? `${short}…` : short
}

function stateOf(steps: readonly RunStep[], live: WorkerRow["status"] | undefined, awake: HelperAwake): HelperState {
  if (live === "done") return "done"
  if (live === "failed") return "failed"
  if (live === "stopped") return "stopped"
  if (live === "pending" || live === "running") return "working"
  if (anyRunning(steps) && (awake.stale || awake.busy(steps[0]!.slug))) return "working"
  return stillFailing(steps) ? "failed" : "done"
}

function laneOf(
  id: string,
  task: string,
  steps: readonly RunStep[],
  live: WorkerRow["status"] | undefined,
  awake: HelperAwake,
): HelperLane {
  const first = steps[0]!
  const last = steps.findLast((step) => step.status === "running") ?? steps.at(-1)!
  const ends = steps.map((step) => step.endedAt)
  const open = anyRunning(steps) || ends.some((end) => end === undefined)
  return {
    id,
    slug: first.slug,
    window: windowKey(first.slug, first.after),
    task,
    title: helperTitle(task),
    state: stateOf(steps, live, awake),
    line: liveLabel(last) || last.name,
    startedAt: Math.min(...steps.map((step) => step.startedAt)),
    endedAt: open ? undefined : Math.max(...(ends as number[])),
    count: steps.length,
    steps,
  }
}

export function helperLanes(steps: readonly RunStep[], statuses: HelperStatuses, awake: HelperAwake): HelperLane[] {
  const groups = new Map<string, { task: string; steps: RunStep[] }>()
  for (const step of steps) {
    if (!step.worker) continue
    const group = groups.get(step.worker.id)
    if (group) group.steps.push(step)
    else groups.set(step.worker.id, { task: step.worker.task, steps: [step] })
  }
  return [...groups].map(([id, group]) => laneOf(id, group.task, group.steps, statuses.get(id), awake))
}

export const helperWord = (state: HelperState): string =>
  ({ working: "Working", done: "Finished", failed: "Failed", stopped: "Stopped" })[state]

export function elapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function nestedLanes(lanes: readonly HelperLane[], busy: (slug: string) => boolean): HelperLane[] {
  const newest = new Map<string, HelperLane>()
  for (const lane of lanes) {
    const seen = newest.get(lane.slug)
    if (!seen || lane.startedAt > seen.startedAt) newest.set(lane.slug, lane)
  }
  return lanes.filter((lane) => busy(lane.slug) && lane.window === newest.get(lane.slug)?.window)
}

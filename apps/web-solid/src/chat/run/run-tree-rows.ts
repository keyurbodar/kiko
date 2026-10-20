import type { RunStep } from "@kiko/protocol"
import { anyRunning, buildEntries, type Entry, extraInput, iconOf, liveLabel, pathOf, type StepIcon, summarizeSteps } from "./run-log"

export const LIVE_ROWS = 3

export type TreeRow = {
  kind: "step" | "worker" | "note" | "loading"
  id: string
  label: string
  icon?: StepIcon
  running: boolean
  target?: { path: string; folder: boolean }
  detail?: { input?: string; output?: string; failed: boolean; running: boolean; lines?: string[] }
}

export type TreeHead = { kind: "fold" | "summary"; label: string; open: boolean; failed: boolean }

export type Tree = {
  head?: TreeHead
  folded: TreeRow[]
  shown: TreeRow[]
}

export type TreeState = {
  working: boolean
  open: boolean
  count?: number
  fetching?: boolean
}

export const isLive = (steps: readonly Pick<RunStep, "status">[], working: boolean): boolean => working || anyRunning(steps)

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const NO_WORKER_OPEN: ReadonlySet<string> = new Set()

const LOADING: TreeRow = { kind: "loading", id: "loading", label: "Loading steps…", running: true }

function rowOf(entry: Entry): TreeRow {
  if (entry.kind === "worker") {
    const running = anyRunning(entry.steps)
    const failed = entry.steps.some((s) => s.status === "failed")
    return { kind: "worker", id: entry.id, label: entry.task, icon: "worker", running, detail: { failed, running, lines: entry.steps.map(liveLabel) } }
  }
  const { step } = entry
  const target = pathOf(step)
  const running = step.status === "running"
  return {
    kind: step.note ? "note" : "step",
    id: step.id,
    label: liveLabel(step),
    icon: iconOf(step),
    running,
    ...(target ? { target } : {}),
    ...(step.note ? {} : { detail: { input: extraInput(step), output: step.output, failed: step.status === "failed", running } }),
  }
}

const failedIn = (entries: readonly Entry[]) => entries.some((e) => (e.kind === "worker" ? e.steps : [e.step]).some((s) => s.status === "failed"))

export function treeOf(steps: readonly RunStep[], state: TreeState): Tree {
  const entries = buildEntries(steps, NO_WORKER_OPEN)
  const rows = entries.map(rowOf)
  if (isLive(steps, state.working)) {
    const hidden = Math.max(0, rows.length - LIVE_ROWS)
    if (hidden === 0) return { folded: [], shown: rows }
    const head: TreeHead = { kind: "fold", label: plural(hidden, "earlier step", "earlier steps"), open: state.open, failed: failedIn(entries.slice(0, hidden)) }
    return { head, folded: rows.slice(0, hidden), shown: rows.slice(hidden) }
  }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { folded: [], shown: [] }
  const missing = steps.length < count
  const { summary, hasFailure } = summarizeSteps(steps)
  const head: TreeHead = { kind: "summary", label: !missing && summary ? summary : plural(count, "step", "steps"), open: state.open, failed: hasFailure }
  return { head, folded: missing && state.fetching ? [...rows, LOADING] : rows, shown: [] }
}

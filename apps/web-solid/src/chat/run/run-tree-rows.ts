import type { RunStep } from "@kiko/protocol"
import {
  anyRunning,
  buildEntries,
  type Entry,
  extraInput,
  iconOf,
  liveLabel,
  pathOf,
  type StepIcon,
  summarizeSteps,
} from "./run-log"

const LIVE_ROWS = 3

export type DetailStatus = "idle" | "loading" | "ready" | "error"

export type RowDetail = {
  input?: string
  output?: string
  failed: boolean
  running: boolean
  status: DetailStatus
  lines?: readonly string[]
}

export type TreeRow = {
  kind: "step" | "worker" | "note" | "loading" | "error"
  id: string
  label: string
  icon?: StepIcon
  running: boolean
  child: boolean
  expand?: string
  target?: { path: string; folder: boolean }
  detail?: RowDetail
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
  detail: DetailStatus
  workers?: ReadonlySet<string>
}

export const isLive = (steps: readonly Pick<RunStep, "status">[], working: boolean): boolean =>
  working || anyRunning(steps)

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const NO_WORKERS: ReadonlySet<string> = new Set()

const LOADING: TreeRow = { kind: "loading", id: "loading", label: "Loading steps…", running: true, child: false }

const UNAVAILABLE: TreeRow = {
  kind: "error",
  id: "unavailable",
  label: "Output unavailable",
  running: false,
  child: false,
}

const pending = (status: DetailStatus) => status === "loading" || status === "idle"

type WorkerEntry = Extract<Entry, { kind: "worker" }>
type StepEntry = Extract<Entry, { kind: "step" }>

function workerRow(entry: WorkerEntry, status: DetailStatus): TreeRow {
  const running = anyRunning(entry.steps)
  const failed = entry.steps.some((s) => s.status === "failed")
  const detail: RowDetail = { failed, running, status, lines: entry.steps.map(liveLabel) }
  return {
    kind: "worker",
    id: entry.id,
    label: entry.task,
    icon: "worker",
    running,
    child: false,
    expand: entry.id,
    ...(entry.open ? {} : { detail }),
  }
}

function stepRow(entry: StepEntry, status: DetailStatus): TreeRow {
  const { step } = entry
  const icon = iconOf(step)
  const target = pathOf(step)
  const running = step.status === "running"
  const detail: RowDetail = {
    input: extraInput(step),
    output: step.output,
    failed: step.status === "failed",
    running,
    status,
  }
  return {
    kind: step.note ? "note" : "step",
    id: step.id,
    label: liveLabel(step),
    running,
    child: entry.child,
    ...(icon ? { icon } : {}),
    ...(target ? { target } : {}),
    ...(step.note ? {} : { detail }),
  }
}

const rowOf = (entry: Entry, status: DetailStatus): TreeRow =>
  entry.kind === "worker" ? workerRow(entry, status) : stepRow(entry, status)

const failedIn = (entries: readonly Entry[]) =>
  entries.some((e) => (e.kind === "worker" ? e.steps : [e.step]).some((s) => s.status === "failed"))

function missingRows(missing: boolean, status: DetailStatus): TreeRow[] {
  if (!missing) return []
  if (status === "error") return [UNAVAILABLE]
  return pending(status) ? [LOADING] : []
}

export function treeOf(steps: readonly RunStep[], state: TreeState): Tree {
  const entries = buildEntries(steps, state.workers ?? NO_WORKERS)
  const rows = entries.map((entry) => rowOf(entry, state.detail))
  if (isLive(steps, state.working)) {
    const hidden = Math.max(0, rows.length - LIVE_ROWS)
    if (hidden === 0) return { folded: [], shown: rows }
    const head: TreeHead = {
      kind: "fold",
      label: plural(hidden, "earlier step", "earlier steps"),
      open: state.open,
      failed: failedIn(entries.slice(0, hidden)),
    }
    return { head, folded: rows.slice(0, hidden), shown: rows.slice(hidden) }
  }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { folded: [], shown: [] }
  const missing = steps.length < count
  const { summary, hasFailure } = summarizeSteps(steps)
  const head: TreeHead = {
    kind: "summary",
    label: !missing && summary ? summary : plural(count, "step", "steps"),
    open: state.open,
    failed: hasFailure,
  }
  return { head, folded: [...rows, ...missingRows(missing, state.detail)], shown: [] }
}

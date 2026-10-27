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
import type { RunSummary } from "./run-summary"

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

export type LabelPart = { text: string; strong?: true; mono?: true }

export type TreeRow = {
  kind: "step" | "worker" | "note" | "loading" | "error"
  id: string
  label: string
  parts: readonly LabelPart[]
  meta?: string
  last?: true
  through?: true
  icon?: StepIcon
  running: boolean
  failed: boolean
  child: boolean
  path: boolean
  startedAt?: number
  endedAt?: number
  expand?: string
  target?: { path: string; folder: boolean }
  detail?: RowDetail
}

export type TreeHead = {
  kind: "fold" | "summary"
  label: string
  parts: readonly LabelPart[]
  open: boolean
  failed: boolean
  startedAt?: number
  endedAt?: number
}

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
  lanes?: boolean
  known?: RunSummary
}

export const isLive = (steps: readonly Pick<RunStep, "status">[], working: boolean): boolean =>
  working || anyRunning(steps)

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const NO_WORKERS: ReadonlySet<string> = new Set()

const QUIET_OBJECT = /^(?:a|an|the|at|on|in|through|it|memory|files|routines|background)\b/i
const TWO_WORD_VERB = /^(?:Added task|Added recipe|Made folder) /

function stepParts(label: string, command: boolean): LabelPart[] {
  const lead = TWO_WORD_VERB.exec(label)?.[0] ?? /^\S+ /.exec(label)?.[0]
  const object = lead ? label.slice(lead.length) : ""
  if (!lead || !object || QUIET_OBJECT.test(object)) return [{ text: label }]
  return [
    { text: lead },
    { text: object, strong: true, ...(command && lead === "Ran " ? { mono: true as const } : {}) },
  ]
}

const countParts = (label: string): LabelPart[] =>
  label
    .split(/(\d+ (?:other |earlier )?[a-z]+)/)
    .filter(Boolean)
    .map((text) => (/^\d/.test(text) ? { text, strong: true as const } : { text }))

const LOADING: TreeRow = {
  kind: "loading",
  id: "loading",
  label: "Loading steps…",
  parts: [{ text: "Loading steps…" }],
  running: true,
  failed: false,
  child: false,
  path: false,
}

const UNAVAILABLE: TreeRow = {
  kind: "error",
  id: "unavailable",
  label: "Output unavailable",
  parts: [{ text: "Output unavailable" }],
  running: false,
  failed: false,
  child: false,
  path: false,
}

export function stillFailing(steps: readonly Pick<RunStep, "name" | "status" | "startedAt">[]): boolean {
  return steps.some(
    (failed) =>
      failed.status === "failed" &&
      !steps.some(
        (retry) => retry.name === failed.name && retry.status === "done" && retry.startedAt > failed.startedAt,
      ),
  )
}

function span(steps: readonly Pick<RunStep, "startedAt" | "endedAt">[]): { startedAt?: number; endedAt?: number } {
  if (steps.length === 0) return {}
  const startedAt = Math.min(...steps.map((s) => s.startedAt))
  const ends = steps.map((s) => s.endedAt)
  if (ends.some((end) => end === undefined)) return { startedAt }
  return { startedAt, endedAt: Math.max(...(ends as number[])) }
}

function markLivePath(rows: TreeRow[]): TreeRow[] {
  const last = rows.findLastIndex((row) => row.running)
  if (last < 0) return rows
  return rows.map((row, i) => (i <= last ? { ...row, path: true } : row))
}

const pending = (status: DetailStatus) => status === "loading" || status === "idle"

type WorkerEntry = Extract<Entry, { kind: "worker" }>
type StepEntry = Extract<Entry, { kind: "step" }>

function workerRow(entry: WorkerEntry, status: DetailStatus): TreeRow {
  const running = anyRunning(entry.steps)
  const failed = !running && stillFailing(entry.steps)
  const detail: RowDetail = { failed, running, status, lines: entry.steps.map(liveLabel) }
  return {
    kind: "worker",
    id: entry.id,
    label: entry.task,
    parts: [{ text: entry.task }],
    ...(running ? {} : { meta: `${failed ? "failed" : "done"}, ${plural(entry.steps.length, "step", "steps")}` }),
    icon: "worker",
    running,
    failed,
    child: false,
    path: false,
    ...span(entry.steps),
    expand: entry.id,
    ...(entry.open ? {} : { detail }),
  }
}

function stepRow(entry: StepEntry, status: DetailStatus): TreeRow {
  const { step } = entry
  const icon = iconOf(step)
  const target = pathOf(step)
  const running = step.status === "running"
  const label = liveLabel(step)
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
    label,
    parts: step.note || running ? [{ text: label }] : stepParts(label, step.tool === "run"),
    running,
    failed: step.status === "failed",
    child: entry.child,
    path: false,
    startedAt: step.startedAt,
    ...(step.endedAt === undefined ? {} : { endedAt: step.endedAt }),
    ...(icon ? { icon } : {}),
    ...(target ? { target } : {}),
    ...(step.note ? {} : { detail }),
  }
}

const rowOf = (entry: Entry, status: DetailStatus): TreeRow =>
  entry.kind === "worker" ? workerRow(entry, status) : stepRow(entry, status)

const failedIn = (entries: readonly Entry[]) =>
  stillFailing(entries.flatMap((e) => (e.kind === "worker" ? e.steps : [e.step])))

function missingRows(missing: boolean, status: DetailStatus): TreeRow[] {
  if (!missing) return []
  if (status === "error") return [UNAVAILABLE]
  return pending(status) ? [LOADING] : []
}

function shaped(rows: readonly TreeRow[]): TreeRow[] {
  const lastTop = rows.findLastIndex((row) => !row.child)
  return rows.map((row, i) => {
    const next = rows[i + 1]
    const last = row.child ? !next?.child : i === lastTop
    const through = row.child && i < lastTop
    return { ...row, ...(last ? { last: true as const } : {}), ...(through ? { through: true as const } : {}) }
  })
}

export function summaryOf(steps: readonly RunStep[]): RunSummary | undefined {
  const label = summarizeSteps(steps)
  return label ? { label, ...span(steps) } : undefined
}

export function treeOf(steps: readonly RunStep[], state: TreeState): Tree {
  const all = buildEntries(steps, state.workers ?? NO_WORKERS)
  const entries = state.lanes ? all.filter((entry) => entry.kind !== "worker" && !entry.step.worker) : all
  if (state.lanes && entries.length === 0 && !state.working && !anyRunning(steps)) return { folded: [], shown: [] }
  const marked = markLivePath(entries.map((entry) => rowOf(entry, state.detail)))
  if (isLive(steps, state.working)) {
    const rows = shaped(marked)
    const hidden = Math.max(0, rows.length - LIVE_ROWS)
    if (hidden === 0) return { folded: [], shown: rows }
    const label = plural(hidden, "earlier step", "earlier steps")
    const head: TreeHead = {
      kind: "fold",
      label,
      parts: countParts(label),
      open: state.open,
      failed: failedIn(entries.slice(0, hidden)),
    }
    return { head, folded: rows.slice(0, hidden), shown: rows.slice(hidden) }
  }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { folded: [], shown: [] }
  const missing = steps.length < count
  const summary = missing ? undefined : summaryOf(steps)
  const { label, ...times } = summary ?? state.known ?? { label: plural(count, "step", "steps") }
  const head: TreeHead = {
    kind: "summary",
    label,
    parts: countParts(label),
    open: state.open,
    failed: stillFailing(steps),
    ...times,
  }
  return { head, folded: shaped([...marked, ...missingRows(missing, state.detail)]), shown: [] }
}

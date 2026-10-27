import type { RunStep } from "@kiko/protocol"
import { anyRunning, extraInput, iconOf, liveLabel, pathOf, type StepIcon, summarizeSteps } from "./run-log"
import type { RunSummary } from "./run-summary"

export type DetailStatus = "idle" | "loading" | "ready" | "error"

export type RowDetail = {
  input?: string
  output?: string
  failed: boolean
  running: boolean
  status: DetailStatus
}

export type LabelPart = { text: string; strong?: true; mono?: true }

type Span = { startedAt: number; endedAt?: number }

export type StepItem = Span & {
  kind: "step"
  id: string
  label: string
  parts: readonly LabelPart[]
  icon?: StepIcon
  running: boolean
  failed: boolean
  target?: { path: string; folder: boolean }
  detail: RowDetail
}

export type NoteItem = { kind: "note"; id: string; text: string; startedAt: number }

export type GroupItem = Span & {
  kind: "group"
  id: string
  label: string
  parts: readonly LabelPart[]
  icon?: StepIcon
  running: boolean
  failed: boolean
  steps: readonly StepItem[]
}

export type WorkerItem = Span & {
  kind: "worker"
  id: string
  label: string
  meta?: string
  running: boolean
  failed: boolean
  steps: readonly StepItem[]
}

export type WorkItem = StepItem | NoteItem | GroupItem | WorkerItem

export type WorkHead = { summary: string; failed: boolean; startedAt?: number; endedAt?: number }

export type WorkLog = {
  live: boolean
  head?: WorkHead
  items: readonly WorkItem[]
  missing?: "loading" | "error"
}

export type WorkState = {
  working: boolean
  count?: number
  endedAt?: number
  detail: DetailStatus
  known?: RunSummary
  lanes?: boolean
}

export const isLive = (steps: readonly Pick<RunStep, "status">[], working: boolean): boolean =>
  working || anyRunning(steps)

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

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
    .split(/(\d+ (?:other )?[a-z]+)/)
    .filter(Boolean)
    .map((text) => (/^\d/.test(text) ? { text, strong: true as const } : { text }))

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

function stepItem(step: RunStep, status: DetailStatus): StepItem {
  const icon = iconOf(step)
  const target = pathOf(step)
  const running = step.status === "running"
  const label = liveLabel(step)
  return {
    kind: "step",
    id: step.id,
    label,
    parts: running ? [{ text: label }] : stepParts(label, step.tool === "run"),
    running,
    failed: step.status === "failed",
    startedAt: step.startedAt,
    ...(step.endedAt === undefined ? {} : { endedAt: step.endedAt }),
    ...(icon ? { icon } : {}),
    ...(target ? { target } : {}),
    detail: { input: extraInput(step), output: step.output, failed: step.status === "failed", running, status },
  }
}

function groupItem(steps: readonly RunStep[], status: DetailStatus): StepItem | GroupItem {
  const items = steps.map((step) => stepItem(step, status))
  if (items.length === 1) return items[0]!
  const label = summarizeSteps(steps)
  const icon = iconOf({ ...steps[0]!, status: "done" })
  return {
    kind: "group",
    id: `g:${steps[0]!.id}`,
    label,
    parts: countParts(label),
    running: anyRunning(steps),
    failed: stillFailing(steps),
    steps: items,
    startedAt: steps[0]!.startedAt,
    ...span(steps),
    ...(icon ? { icon } : {}),
  }
}

function workerItem(id: string, task: string, steps: readonly RunStep[], status: DetailStatus): WorkerItem {
  const running = anyRunning(steps)
  const failed = !running && stillFailing(steps)
  return {
    kind: "worker",
    id: `w:${id}`,
    label: task,
    ...(running ? {} : { meta: `${failed ? "failed" : "done"}, ${plural(steps.length, "step", "steps")}` }),
    running,
    failed,
    steps: steps.map((step) => stepItem(step, status)),
    startedAt: steps[0]!.startedAt,
    ...span(steps),
  }
}

function splitRunning(steps: readonly RunStep[]): [readonly RunStep[], readonly RunStep[]] {
  const at = steps.findIndex((step) => step.status === "running")
  return at < 0 ? [steps.slice(0, -1), steps.slice(-1)] : [steps.slice(0, at), steps.slice(at)]
}

type Slot = WorkItem | { kind: "worker-slot"; id: string }

function itemsOf(steps: readonly RunStep[], status: DetailStatus, live: boolean): WorkItem[] {
  const out: Slot[] = []
  const workers = new Map<string, { task: string; steps: RunStep[] }>()
  let run: RunStep[] = []
  const flush = (last: boolean) => {
    if (run.length === 0) return
    const [settled, current] = last && live && run.length > 1 ? splitRunning(run) : [run, []]
    if (settled.length) out.push(groupItem(settled, status))
    for (const step of current) out.push(stepItem(step, status))
    run = []
  }
  for (const step of steps) {
    if (step.worker) {
      const worker = workers.get(step.worker.id)
      if (worker) worker.steps.push(step)
      else {
        flush(false)
        workers.set(step.worker.id, { task: step.worker.task, steps: [step] })
        out.push({ kind: "worker-slot", id: step.worker.id })
      }
    } else if (step.note) {
      flush(false)
      out.push({ kind: "note", id: step.id, text: step.label, startedAt: step.startedAt })
    } else run.push(step)
  }
  flush(true)
  return out.map((slot) => {
    if (slot.kind !== "worker-slot") return slot
    const worker = workers.get(slot.id)!
    return workerItem(slot.id, worker.task, worker.steps, status)
  })
}

export function summaryOf(steps: readonly RunStep[], endedAt?: number): RunSummary | undefined {
  const label = summarizeSteps(steps)
  if (!label) return undefined
  const own = steps.filter((step) => !step.worker)
  const times = span(own.length ? own : steps)
  return { label, ...times, ...(endedAt === undefined ? {} : { endedAt }) }
}

export function workLogOf(steps: readonly RunStep[], state: WorkState): WorkLog {
  const live = isLive(steps, state.working)
  const own = state.lanes ? steps.filter((step) => !step.worker) : steps
  if (live) return { live, items: itemsOf(own, state.detail, true) }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { live, items: [] }
  const missing = steps.length < count
  const summary = (missing ? undefined : summaryOf(steps, state.endedAt)) ??
    state.known ?? { label: plural(count, "step", "steps") }
  const head: WorkHead = {
    summary: summary.label,
    failed: stillFailing(steps),
    ...(summary.startedAt === undefined ? {} : { startedAt: summary.startedAt }),
    ...(summary.endedAt === undefined ? {} : { endedAt: summary.endedAt }),
  }
  const items = itemsOf(own, state.detail, false)
  if (!missing) return { live, head, items }
  if (state.detail === "error") return { live, head, items, missing: "error" }
  return { live, head, items, ...(state.detail === "ready" ? {} : { missing: "loading" as const }) }
}

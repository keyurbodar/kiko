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

export type WorkerItem = Span & {
  kind: "worker"
  id: string
  label: string
  meta?: string
  running: boolean
  failed: boolean
  steps: readonly StepItem[]
}

export type WorkItem = StepItem | NoteItem | WorkerItem

export type WorkHead = { summary?: string; startedAt?: number; endedAt?: number }

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

type Slot = WorkItem | { kind: "worker-slot"; id: string }

function itemsOf(steps: readonly RunStep[], status: DetailStatus): WorkItem[] {
  const out: Slot[] = []
  const workers = new Map<string, { task: string; steps: RunStep[] }>()
  for (const step of steps) {
    if (step.worker) {
      const worker = workers.get(step.worker.id)
      if (worker) worker.steps.push(step)
      else {
        workers.set(step.worker.id, { task: step.worker.task, steps: [step] })
        out.push({ kind: "worker-slot", id: step.worker.id })
      }
    } else if (step.note) out.push({ kind: "note", id: step.id, text: step.label, startedAt: step.startedAt })
    else out.push(stepItem(step, status))
  }
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
  if (live) return { live, items: itemsOf(own, state.detail) }
  const count = Math.max(state.count ?? 0, steps.length)
  if (count === 0) return { live, items: [] }
  const missing = steps.length < count
  const summary = (missing ? undefined : summaryOf(steps, state.endedAt)) ?? state.known
  const head: WorkHead = {
    ...(summary?.label ? { summary: summary.label } : {}),
    ...(summary?.startedAt === undefined ? {} : { startedAt: summary.startedAt }),
    ...(summary?.endedAt === undefined ? {} : { endedAt: summary.endedAt }),
  }
  const items = itemsOf(own, state.detail)
  if (!missing) return { live, head, items }
  if (state.detail === "error") return { live, head, items, missing: "error" }
  return { live, head, items, ...(state.detail === "ready" ? {} : { missing: "loading" as const }) }
}

export type SummarySegment = { text: string; failed?: true }

const VERB: Partial<Record<StepIcon, (count: number) => string>> = {
  terminal: (n) => `ran ${plural(n, "command", "commands")}`,
  "file-view": (n) => `read ${plural(n, "file", "files")}`,
  search: (n) => `searched ${plural(n, "time", "times")}`,
  globe: (n) => `browsed ${plural(n, "page", "pages")}`,
  browser: (n) => `browsed ${plural(n, "page", "pages")}`,
}

export function groupSummary(steps: readonly RunStep[]): readonly SummarySegment[] {
  const calls = steps.filter((step) => !step.note)
  if (calls.length === 0) return []
  const edited = new Set<string>()
  const wrote = new Set<string>()
  const helpers = new Set<string>()
  const counted = new Map<StepIcon, number>()
  let other = 0
  let failed = 0
  for (const step of calls) {
    if (step.status === "failed") failed++
    if (step.worker) {
      helpers.add(step.worker.id)
      continue
    }
    const icon = iconOf({ ...step, status: "done" })
    if (icon === "edit") edited.add(pathOf(step)?.path ?? step.id)
    else if (icon === "file-add") wrote.add(pathOf(step)?.path ?? step.id)
    else if (icon && VERB[icon]) counted.set(icon, (counted.get(icon) ?? 0) + 1)
    else other++
  }
  const parts: string[] = []
  const commands = counted.get("terminal") ?? 0
  if (commands > 0) parts.push(VERB.terminal!(commands))
  if (edited.size > 0) parts.push(`edited ${plural(edited.size, "file", "files")}`)
  if (wrote.size > 0) parts.push(`wrote ${plural(wrote.size, "file", "files")}`)
  for (const icon of ["file-view", "search", "globe", "browser"] as const) {
    const count = counted.get(icon) ?? 0
    if (count > 0) parts.push(VERB[icon]!(count))
  }
  if (helpers.size > 0) parts.push(`started ${plural(helpers.size, "helper", "helpers")}`)
  if (other > 0) parts.push(`used ${plural(other, "tool", "tools")}`)
  if (parts.length === 0) return failed > 0 ? [{ text: `${failed} failed`, failed: true }] : []
  const first = parts[0]!
  const segments: SummarySegment[] = [
    { text: first.charAt(0).toUpperCase() + first.slice(1) },
    ...parts.slice(1).map((text) => ({ text })),
  ]
  if (failed > 0) segments.push({ text: `${failed} failed`, failed: true })
  return segments
}

export const summaryText = (segments: readonly SummarySegment[]): string =>
  segments.map((segment) => segment.text).join(" · ")

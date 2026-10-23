import type { RunStep, RunStepStatus, ToolKind } from "@kiko/protocol"

export type StepIcon =
  | "file-view"
  | "folder"
  | "file-add"
  | "edit"
  | "copy"
  | "trash"
  | "folder-add"
  | "move"
  | "terminal"
  | "link"
  | "globe"
  | "search"
  | "cursor"
  | "eye"
  | "code"
  | "file-text"
  | "browser"
  | "monitor"
  | "chat"
  | "help"
  | "memory"
  | "notes"
  | "book"
  | "clock"
  | "tasks"
  | "group"
  | "integrations"
  | "sparkles"
  | "scan"
  | "worker"
  | "stop"
  | "send"
  | "skills"
  | "wrench"
  | "alert-circle"
  | "app"

export const NAME_ICON: Record<string, StepIcon> = {
  read: "file-view",
  ls: "folder",
  write: "file-add",
  edit: "edit",
  cp: "copy",
  mv: "move",
  rm: "trash",
  mkdir: "folder-add",
  bash: "terminal",
  web_search: "search",
  browse: "browser",
  browser_look: "eye",
  browser_act: "cursor",
  browser_link: "link",
  zoom: "scan",
  ask_human: "help",
  send_message: "send",
  recall: "memory",
  note: "notes",
  loop: "memory",
  jev: "memory",
  read_skill: "book",
  create_routine: "clock",
  update_routine: "clock",
  cancel_routine: "clock",
  list_routines: "clock",
  create_task: "tasks",
  update_task: "tasks",
  start_work: "worker",
  steer_work: "worker",
  stop_work: "stop",
  create_agent: "group",
  create_group: "group",
  list_agents: "group",
  team: "group",
  overview: "group",
  model: "sparkles",
  connect_app: "integrations",
  add_recipe: "sparkles",
}

export const KIND_ICON: Record<ToolKind, StepIcon> = {
  read: "file-view",
  edit: "edit",
  run: "terminal",
  search: "search",
  web: "globe",
  other: "wrench",
}

export function iconOf(step: Pick<RunStep, "tool" | "status" | "name" | "app" | "note">): StepIcon | undefined {
  if (step.note) return undefined
  if (step.status === "failed") return "alert-circle"
  return NAME_ICON[step.name] ?? (step.app ? "app" : KIND_ICON[step.tool])
}

const FILE_CALLS = new Set(["read", "write", "edit", "cp", "mv"])
const FOLDER_CALLS = new Set(["ls", "mkdir"])

export function pathOf(step: Pick<RunStep, "name" | "label" | "note">): { path: string; folder: boolean } | null {
  const folder = FOLDER_CALLS.has(step.name)
  if (step.note || (!folder && !FILE_CALLS.has(step.name))) return null
  const at =
    step.name === "cp" || step.name === "mv" ? step.label.lastIndexOf(" to /") + 4 : step.label.indexOf(" /") + 1
  if (at <= 0) return folder ? { path: "", folder } : null
  return { path: step.label.slice(at + 1), folder }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const GROUPS: Record<ToolKind, { label: (count: number) => string; priority: number }> = {
  run: { label: (n) => `Ran ${plural(n, "command", "commands")}`, priority: 0 },
  edit: { label: (n) => `Changed ${plural(n, "file", "files")}`, priority: 0 },
  read: { label: (n) => `Read ${plural(n, "file", "files")}`, priority: 1 },
  search: { label: (n) => `Listed ${plural(n, "folder", "folders")}`, priority: 1 },
  web: { label: (n) => `Fetched ${plural(n, "page", "pages")}`, priority: 1 },
  other: { label: (n) => `Used ${plural(n, "tool", "tools")}`, priority: 2 },
}

export function summarizeSteps(steps: readonly Pick<RunStep, "tool" | "status" | "note">[]): {
  summary: string
  hasFailure: boolean
  failed: number
} {
  const calls = steps.filter((step) => !step.note)
  const groups = new Map<ToolKind, number>()
  for (const step of calls) groups.set(step.tool, (groups.get(step.tool) ?? 0) + 1)
  const all = [...groups].map(([tool, count], index) => ({
    index,
    count,
    priority: GROUPS[tool].priority,
    label: GROUPS[tool].label(count),
  }))
  const picked = [...all]
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
  const labels: string[] = picked.map((g) => g.label)
  const rest = calls.length - picked.reduce((n, g) => n + g.count, 0)
  if (rest > 0) labels.push(`Performed ${plural(rest, "other action", "other actions")}`)
  const sentence = labels.map((label, i) => (i === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)))
  const summary =
    sentence.length < 3 ? sentence.join(" and ") : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`
  const failed = steps.filter((s) => s.status === "failed").length
  return { summary, hasFailure: failed > 0, failed }
}

const PRESENT: Record<string, string> = {
  Read: "Reading",
  Ran: "Running",
  Edited: "Editing",
  Wrote: "Writing",
  Created: "Creating",
  Deleted: "Deleting",
  Moved: "Moving",
  Renamed: "Renaming",
  Listed: "Listing",
  Searched: "Searching",
  Fetched: "Fetching",
  Opened: "Opening",
  Browsed: "Browsing",
  Used: "Using",
  Called: "Calling",
  Sent: "Sending",
  Checked: "Checking",
  Updated: "Updating",
  Saved: "Saving",
  Loaded: "Loading",
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "exec", "nohup"])
const SKIPPED = new Set(["cd", "export", "set"])

export function programOf(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((w) => w && !/^\w+=/.test(w) && !WRAPPERS.has(w))
    const first = words[0]?.replace(/^["']|["']$/g, "")
    if (!first || SKIPPED.has(first)) continue
    return first.split("/").pop() || undefined
  }
  return undefined
}

export function liveLabel(step: Pick<RunStep, "tool" | "label" | "input" | "status">): string {
  if (step.status !== "running") return step.label
  if (step.tool === "run") return `Running ${programOf(step.input ?? step.label.replace(/^Ran\s+/, "")) ?? "command"}`
  const space = step.label.indexOf(" ")
  const verb = space === -1 ? step.label : step.label.slice(0, space)
  const present = PRESENT[verb]
  if (!present) return step.label
  return space === -1 ? present : `${present}${step.label.slice(space)}`
}

export function extraInput(step: Pick<RunStep, "label" | "input">): string | undefined {
  const input = step.input?.trim()
  if (!input) return undefined
  const label = step.label.trim()
  if (label === input || label.endsWith(` ${input}`)) return undefined
  return input
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms"
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 10_000) {
    const tenths = Math.round(ms / 100) / 10
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const total = Math.round(ms / 1000)
  const parts: string[] = []
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0) parts.push(`${s}s`)
  return parts.join(" ")
}

export function formatClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * 1000)
}

export const startOf = (steps: readonly Pick<RunStep, "startedAt">[]): number | undefined =>
  steps.length ? Math.min(...steps.map((s) => s.startedAt)) : undefined

export function totalDuration(steps: readonly Pick<RunStep, "startedAt" | "endedAt" | "status">[]): number | undefined {
  if (!steps.length || steps.some((s) => s.status === "running")) return undefined
  const end = Math.max(...steps.map((s) => s.endedAt ?? s.startedAt))
  return end - (startOf(steps) ?? end)
}

const RANK: Record<RunStepStatus, number> = { running: 0, done: 1, failed: 1 }
const rank = (step: Pick<RunStep, "status">) => RANK[step.status]

const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1)

const STEP_LIMIT = 600
const STEP_RUNS = 24

const stepKey = (step: Pick<RunStep, "runId" | "id">) => `${step.runId}:${step.id}`

function pruneSteps(steps: RunStep[]): RunStep[] {
  if (steps.length <= STEP_LIMIT) return steps
  const newest = new Map<string, number>()
  for (const step of steps) newest.set(step.runId, Math.max(newest.get(step.runId) ?? 0, step.startedAt))
  const keep = new Set(
    [...newest]
      .sort((a, b) => b[1] - a[1])
      .slice(0, STEP_RUNS)
      .map(([runId]) => runId),
  )
  const kept = steps.filter((step) => keep.has(step.runId))
  return kept.length === steps.length ? steps : kept
}

export function upsertStep(steps: readonly RunStep[], step: RunStep): RunStep[] {
  const key = stepKey(step)
  const at = steps.findIndex((s) => stepKey(s) === key)
  if (at === -1) return pruneSteps([...steps, step].sort(byStart))
  if (rank(step) < rank(steps[at])) return [...steps]
  const next = [...steps]
  next[at] = step
  return next.sort(byStart)
}

export type StepWindow = { key: string; slug: string; after: number; steps: number }

export const windowKey = (slug: string, after: number) => `${slug}#${after}`

export function parseWindow(key: string): { slug: string; after: number } {
  const at = key.lastIndexOf("#")
  return { slug: key.slice(0, at), after: Number(key.slice(at + 1)) }
}

export function stepWindows(
  messages: readonly { botId?: string; steps?: number; stepAfter?: number }[],
): Map<string, StepWindow> {
  const out = new Map<string, StepWindow>()
  for (const m of messages) {
    if (!m.botId || !m.steps) continue
    const after = m.stepAfter ?? 0
    out.set(windowKey(m.botId, after), { key: windowKey(m.botId, after), slug: m.botId, after, steps: m.steps })
  }
  return out
}

export const inWindow = (steps: readonly RunStep[], after: number) => steps.filter((s) => s.after === after)

export const newestAfter = (steps: readonly RunStep[]) => steps.reduce((n, s) => Math.max(n, s.after), -1)

export type Entry =
  | { key: string; kind: "step"; step: RunStep; child: boolean }
  | { key: string; kind: "worker"; id: string; task: string; steps: readonly RunStep[]; open: boolean }

export function buildEntries(steps: readonly RunStep[], open: ReadonlySet<string>): Entry[] {
  type Item = { at: number; order: number; step?: RunStep; worker?: { id: string; task: string; steps: RunStep[] } }
  const items: Item[] = []
  const workers = new Map<string, { id: string; task: string; steps: RunStep[] }>()
  for (const step of steps) {
    if (!step.worker) {
      items.push({ at: step.startedAt, order: 0, step })
      continue
    }
    const group = workers.get(step.worker.id)
    if (group) group.steps.push(step)
    else {
      const created = { id: step.worker.id, task: step.worker.task, steps: [step] }
      workers.set(step.worker.id, created)
      items.push({ at: step.startedAt, order: 1, worker: created })
    }
  }
  items.sort((a, b) => a.at - b.at || a.order - b.order)
  const out: Entry[] = []
  for (const item of items) {
    if (item.step) {
      out.push({ key: `s:${item.step.id}`, kind: "step", step: item.step, child: false })
      continue
    }
    const w = item.worker!
    const isOpen = open.has(w.id)
    out.push({ key: `w:${w.id}`, kind: "worker", id: w.id, task: w.task, steps: w.steps, open: isOpen })
    if (isOpen) for (const step of w.steps) out.push({ key: `s:${step.id}`, kind: "step", step, child: true })
  }
  return out
}

export const anyRunning = (steps: readonly Pick<RunStep, "status">[]): boolean =>
  steps.some((s) => s.status === "running")

export type Placement = "right-start" | "left-start" | "bottom-start" | "top-start"

type Box = { left: number; right: number; top: number; bottom: number }

export function placementOf(anchor: Box, card: Box): Placement | undefined {
  if (card.left >= anchor.right - 1) return "right-start"
  if (card.right <= anchor.left + 1) return "left-start"
  if (card.top >= anchor.bottom - 1) return "bottom-start"
  if (card.bottom <= anchor.top + 1) return "top-start"
  return undefined
}

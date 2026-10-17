import type { RunStep, RunStepStatus, ToolKind } from "@kiko/protocol"

/*
 * The run log as data: what each step looks like, how a run reads in one sentence, and how steps
 * merge. Ported from t3code's work log (`summarizeToolGroup`, `liveWorkEntryLabel`), cut to kiko's
 * six tool kinds. Nothing here touches the DOM, so every rule has a table in `run-log.test.ts`.
 */

/** A glyph id: `file-view` is `FileViewIcon` in `@kiko/ui/icons`. `app` is a Composio toolkit's logo. */
export type StepIcon =
  | "file-view" | "folder" | "file-add" | "edit" | "copy" | "trash" | "folder-add" | "move" | "terminal" | "link" | "globe" | "search"
  | "cursor" | "eye" | "code" | "file-text" | "browser" | "monitor" | "chat" | "help" | "memory" | "notes" | "book" | "clock" | "tasks"
  | "group" | "integrations" | "sparkles" | "scan" | "worker" | "stop" | "send" | "skills" | "wrench" | "alert-circle" | "app"

/** What each tool kiko ships looks like, by the name the model calls it. */
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
  web_fetch: "link",
  web_search: "search",
  browse: "browser",
  browser_look: "eye",
  browser_act: "cursor",
  browser_eval: "code",
  browser_extract: "file-text",
  browser_fetch: "globe",
  browser_files: "folder",
  browser_dialog: "chat",
  browser_tabs: "browser",
  browser_status: "monitor",
  browser_link: "link",
  browser_run: "terminal",
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

/** The icon for a tool kind, for a name the table does not know. t3code's: eye, pen, terminal, search, globe, wrench. */
export const KIND_ICON: Record<ToolKind, StepIcon> = {
  read: "file-view",
  edit: "edit",
  run: "terminal",
  search: "search",
  web: "globe",
  other: "wrench",
}

/** A failed call shows the alert glyph. Else the tool's own by name, then its Composio app, then its kind. */
export function iconOf(step: Pick<RunStep, "tool" | "status" | "name" | "app">): StepIcon {
  if (step.status === "failed") return "alert-circle"
  return NAME_ICON[step.name] ?? (step.app ? "app" : KIND_ICON[step.tool])
}

// Summary

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The sentence part for each kind, and how early it is picked when a run did more than two kinds of thing. */
const GROUPS: Record<ToolKind, { label: (count: number) => string; priority: number }> = {
  run: { label: (n) => `Ran ${plural(n, "command", "commands")}`, priority: 0 },
  edit: { label: (n) => `Changed ${plural(n, "file", "files")}`, priority: 0 },
  read: { label: (n) => `Read ${plural(n, "file", "files")}`, priority: 1 },
  search: { label: (n) => `Listed ${plural(n, "folder", "folders")}`, priority: 1 },
  web: { label: (n) => `Fetched ${plural(n, "page", "pages")}`, priority: 1 },
  other: { label: (n) => `Used ${plural(n, "tool", "tools")}`, priority: 2 },
}

/**
 * t3code's `summarizeToolGroup`: at most two kinds of action, picked by priority and shown in the
 * order they first appeared, then "Performed N other actions" for every call left over.
 */
export function summarizeSteps(steps: readonly Pick<RunStep, "tool" | "status">[]): { summary: string; hasFailure: boolean } {
  const groups = new Map<ToolKind, number>()
  for (const step of steps) groups.set(step.tool, (groups.get(step.tool) ?? 0) + 1)
  const all = [...groups].map(([tool, count], index) => ({ index, count, priority: GROUPS[tool].priority, label: GROUPS[tool].label(count) }))
  const picked = [...all]
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
  const labels: string[] = picked.map((g) => g.label)
  const rest = steps.length - picked.reduce((n, g) => n + g.count, 0)
  if (rest > 0) labels.push(`Performed ${plural(rest, "other action", "other actions")}`)
  const sentence = labels.map((label, i) => (i === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)))
  const summary = sentence.length < 3 ? sentence.join(" and ") : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`
  return { summary, hasFailure: steps.some((s) => s.status === "failed") }
}

// Live labels

/** The label's first word in the past tense, and the same word while the call runs. */
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

/** The program a shell command starts, such as "bun" for `cd app && FOO=1 bun test`. */
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

/** What a step says while it runs: "Reading /plan.md", "Running bun". A finished step keeps its own label. */
export function liveLabel(step: Pick<RunStep, "tool" | "label" | "input" | "status">): string {
  if (step.status !== "running") return step.label
  if (step.tool === "run") return `Running ${programOf(step.input ?? step.label.replace(/^Ran\s+/, "")) ?? "command"}`
  const space = step.label.indexOf(" ")
  const verb = space === -1 ? step.label : step.label.slice(0, space)
  const present = PRESENT[verb]
  if (!present) return step.label
  return space === -1 ? present : `${present}${step.label.slice(space)}`
}

/** Input worth showing under the label: only when it says more than the label does. */
export function extraInput(step: Pick<RunStep, "label" | "input">): string | undefined {
  const input = step.input?.trim()
  if (!input) return undefined
  const label = step.label.trim()
  if (label === input || label.endsWith(` ${input}`)) return undefined
  return input
}

// Time

/** t3code's `formatDuration`: 420ms, 3.4s, 42s, 1m 5s, 2h 3m. */
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

/** The running clock in the header, in whole seconds so it ticks once a second: 0s, 12s, 1m 5s. */
export function formatClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * 1000)
}

export const startOf = (steps: readonly Pick<RunStep, "startedAt">[]): number | undefined => (steps.length ? Math.min(...steps.map((s) => s.startedAt)) : undefined)

/** Start of the first step to end of the last. Undefined while any step is running. */
export function totalDuration(steps: readonly Pick<RunStep, "startedAt" | "endedAt" | "status">[]): number | undefined {
  if (!steps.length || steps.some((s) => s.status === "running")) return undefined
  const end = Math.max(...steps.map((s) => s.endedAt ?? s.startedAt))
  return end - (startOf(steps) ?? end)
}

// Merging

/** A step only moves forward: running, then done or failed. */
const RANK: Record<RunStepStatus, number> = { running: 0, done: 1, failed: 1 }
const rank = (step: Pick<RunStep, "status">) => RANK[step.status]

/** Array.sort is stable, so steps that start in the same millisecond keep the order they came in. */
const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt

/**
 * A run's steps with `step` in: replaced by id, in start order. A frame that arrives late never
 * takes a finished step back to running.
 */
export function upsertStep(steps: readonly RunStep[], step: RunStep): RunStep[] {
  const at = steps.findIndex((s) => s.id === step.id)
  if (at === -1) return [...steps, step].sort(byStart)
  if (rank(step) < rank(steps[at])) return [...steps]
  const next = [...steps]
  next[at] = step
  return next.sort(byStart)
}

// Which bubble opens which steps

/**
 * A run panel opens one window of an agent's steps: those it made after its message at `after`, which its
 * next message opens. The room stamps each step with it. The key names the agent and `after`, so the typing
 * row's window and the bubble that later lands for it share a key, and an open panel follows from one to the other.
 */
export type StepWindow = { key: string; slug: string; after: number; steps: number }

export const windowKey = (slug: string, after: number) => `${slug}#${after}`

export function parseWindow(key: string): { slug: string; after: number } {
  const at = key.lastIndexOf("#")
  return { slug: key.slice(0, at), after: Number(key.slice(at + 1)) }
}

/** The windows the agent messages in view open, by key. Each opens its agent's steps since that agent's previous message. */
export function stepWindows(messages: readonly { botId?: string; steps?: number; stepAfter?: number }[]): Map<string, StepWindow> {
  const out = new Map<string, StepWindow>()
  for (const m of messages) {
    if (!m.botId || !m.steps) continue
    const after = m.stepAfter ?? 0
    out.set(windowKey(m.botId, after), { key: windowKey(m.botId, after), slug: m.botId, after, steps: m.steps })
  }
  return out
}

/** The steps of one agent in one window, in start order. */
export const inWindow = (steps: readonly RunStep[], after: number) => steps.filter((s) => s.after === after)

/** The newest window an agent's steps reach: the one its typing row opens, unless a message in view opens it already. */
export const newestAfter = (steps: readonly RunStep[]) => steps.reduce((n, s) => Math.max(n, s.after), -1)

// The panel's rows

export type Entry =
  | { key: string; kind: "step"; step: RunStep; child: boolean }
  | { key: string; kind: "worker"; id: string; task: string; steps: readonly RunStep[]; open: boolean }

/**
 * The panel's flat list. Steps in start order. The steps of one background worker fold into a
 * single row placed after the last step that began before the worker's first step, which is the
 * call that started it. An open worker is followed by its steps.
 */
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

const sameEntry = (a: Entry, b: Entry): boolean => {
  if (a.kind === "step" && b.kind === "step") return a.step === b.step && a.child === b.child
  if (a.kind === "worker" && b.kind === "worker") return a.open === b.open && a.task === b.task && a.steps.length === b.steps.length && a.steps.every((s, i) => s === b.steps[i])
  return false
}

/** Keeps the object of every entry that did not change, so the list re-renders only the rows that did. */
export function keepEntries(previous: ReadonlyMap<string, Entry>, next: readonly Entry[]): Entry[] {
  return next.map((entry) => {
    const before = previous.get(entry.key)
    return before && sameEntry(before, entry) ? before : entry
  })
}

/** Whether any step of the run, a worker's included, is still going. */
export const anyRunning = (steps: readonly Pick<RunStep, "status">[]): boolean => steps.some((s) => s.status === "running")

// Where the panel sits

export type Placement = "right-start" | "left-start" | "bottom-start" | "top-start"

type Box = { left: number; right: number; top: number; bottom: number }

/**
 * The side of its anchor that a positioned card landed on, as a start-aligned placement. The panel
 * keeps this side while it is open. Undefined when the card overlaps the anchor on every side.
 */
export function placementOf(anchor: Box, card: Box): Placement | undefined {
  if (card.left >= anchor.right - 1) return "right-start"
  if (card.right <= anchor.left + 1) return "left-start"
  if (card.top >= anchor.bottom - 1) return "bottom-start"
  if (card.bottom <= anchor.top + 1) return "top-start"
  return undefined
}

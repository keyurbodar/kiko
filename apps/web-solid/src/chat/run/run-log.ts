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
  | "bulb"

const NAME_ICON: Record<string, StepIcon> = {
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
  browse: "globe",
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
  delete_agent: "group",
  delete_group: "group",
  remove_member: "group",
  computer_shell: "terminal",
  computer_read: "file-view",
  computer_write: "file-add",
  computer_look: "monitor",
  computer_act: "cursor",
  computer_link: "monitor",
}

const KIND_ICON: Record<ToolKind, StepIcon> = {
  read: "file-view",
  edit: "edit",
  run: "terminal",
  search: "search",
  web: "globe",
  other: "wrench",
}

export function iconOf(step: Pick<RunStep, "tool" | "status" | "name" | "app" | "note">): StepIcon | undefined {
  if (step.note) return "bulb"
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

export function summarizeSteps(steps: readonly Pick<RunStep, "tool" | "note">[]): string {
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
  return sentence.length < 3 ? sentence.join(" and ") : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`
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
  Added: "Adding",
  Removed: "Removing",
  Connected: "Connecting",
  Looked: "Looking",
  Clicked: "Clicking",
  Zoomed: "Zooming",
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "exec", "nohup"])
const SKIPPED = new Set(["cd", "export", "set"])

function programOf(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const word = segment
      .trim()
      .split(/\s+/)
      .find((w) => w && !/^\w+=/.test(w) && !WRAPPERS.has(w))
    const first = word?.replace(/^["']|["']$/g, "")
    if (!first || SKIPPED.has(first)) continue
    return first.split("/").pop() || undefined
  }
  return undefined
}

type Args = Record<string, unknown>

function argsOf(input: string | undefined): Args {
  try {
    const value: unknown = JSON.parse(input ?? "")
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Args) : {}
  } catch {
    return {}
  }
}

const COMMAND_CHARS = 80

const said = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const cut = (text: string) => (text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 1)}…` : text)
const titled = (value: unknown) => {
  const text = said(value).replace(/^@/, "").replace(/[-_]+/g, " ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}
const did = (verb: string, what: string, otherwise: string) => (what ? `${verb} ${what}` : otherwise)

const HUMAN: Record<string, (args: Args) => string> = {
  delete_agent: (a) => did("Deleted", titled(a.handle), "Deleted an agent"),
  delete_group: () => "Deleted a group",
  remove_member: (a) => did("Removed", titled(a.handle), "Removed a member"),
  connect_app: (a) => did("Connected", titled(a.app), "Connected an app"),
  add_recipe: (a) => did("Added recipe", titled(a.slug), "Added a recipe"),
  computer_shell: (a) => did("Ran", cut(said(a.command)), "Ran a command on the computer"),
  computer_read: (a) => did("Read", said(a.path), "Read a file on the computer"),
  computer_write: (a) => did("Wrote", said(a.path), "Wrote a file on the computer"),
  computer_look: () => "Looked at the screen",
  computer_act: () => "Used the computer",
  computer_link: () => "Linked the computer",
  browser_look: () => "Looked at the page",
  browser_act: () => "Clicked through the page",
  browser_link: () => "Shared the browser",
  zoom: () => "Zoomed in on the page",
}

function humanLabel(step: Pick<RunStep, "name" | "label" | "input">): string {
  if (step.label !== `Used ${step.name}`) return step.label
  return HUMAN[step.name]?.(argsOf(step.input)) ?? `Used ${step.name.replace(/_/g, " ")}`
}

export function liveLabel(step: Pick<RunStep, "tool" | "name" | "label" | "input" | "status">): string {
  const label = humanLabel(step)
  if (step.status !== "running") return label
  if (step.tool === "run") return `Running ${programOf(step.input ?? label.replace(/^Ran\s+/, "")) ?? "command"}`
  const space = label.indexOf(" ")
  const verb = space === -1 ? label : label.slice(0, space)
  const present = PRESENT[verb]
  if (!present) return label
  return space === -1 ? present : `${present}${label.slice(space)}`
}

export function extraInput(step: Pick<RunStep, "label" | "input">): string | undefined {
  const input = step.input?.trim()
  if (!input) return undefined
  const label = step.label.trim()
  if (label === input || label.endsWith(` ${input}`)) return undefined
  return input
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

export const anyRunning = (steps: readonly Pick<RunStep, "status">[]): boolean =>
  steps.some((s) => s.status === "running")

export const settledSteps = (steps: readonly RunStep[]): RunStep[] => steps.filter((step) => step.status !== "running")

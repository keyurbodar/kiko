import type { RunStep, RunStepStatus, ToolKind } from "@kiko/protocol"
import { shellLabel } from "./shell-label"

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
  | "apps"
  | "deploy"
  | "api"
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
  app_deploy: "deploy",
  app_list: "apps",
  app_inspect: "eye",
  app_call: "api",
  app_manage: "apps",
}

const KIND_ICON: Record<ToolKind, StepIcon> = {
  read: "file-view",
  edit: "edit",
  run: "terminal",
  search: "search",
  web: "globe",
  other: "wrench",
}

export function iconOf(
  step: Pick<RunStep, "tool" | "status" | "name" | "app" | "note"> & { input?: string },
): StepIcon | undefined {
  if (step.note) return "bulb"
  if (step.status === "failed") return "alert-circle"
  const shell = commandOf(step)
  if (shell !== undefined) return shellLabel(shell)?.icon ?? "terminal"
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

type Group = { one: string; many: (count: number) => string; first: boolean }

const KIND_GROUP: Partial<Record<StepIcon, Group>> = {
  deploy: { one: "deployed an app", many: (n) => `deployed ${n} apps`, first: true },
  edit: { one: "edited a file", many: (n) => `edited ${n} files`, first: true },
  "file-add": { one: "wrote a file", many: (n) => `wrote ${n} files`, first: true },
  send: { one: "sent a message", many: (n) => `sent ${n} messages`, first: true },
  "file-view": { one: "read a file", many: (n) => `read ${n} files`, first: false },
  folder: { one: "listed a folder", many: (n) => `listed ${n} folders`, first: false },
  globe: { one: "fetched a page", many: (n) => `fetched ${n} pages`, first: false },
  search: { one: "ran a search", many: (n) => `ran ${n} searches`, first: false },
  terminal: { one: "ran a command", many: (n) => `ran ${n} commands`, first: false },
}

const SPECIFIC_CHARS = 32

type Tally = { key: string; group?: Group; label: string; count: number; at: number }

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

function tallyOf(steps: readonly SummaryStep[]): Tally[] {
  const tallies = new Map<string, Tally>()
  steps.forEach((step, at) => {
    const icon = iconOf({ ...step, status: "done" })
    const group = icon ? KIND_GROUP[icon] : undefined
    const label = liveLabel({ ...step, status: "done" })
    const key = step.worker ? "helper" : group ? `g:${icon}` : `l:${label}`
    const found = tallies.get(key)
    if (found) found.count++
    else tallies.set(key, { key, label, count: 1, at, ...(group ? { group } : {}) })
  })
  return [...tallies.values()]
}

function phrase(tally: Tally): string {
  if (tally.key === "helper") return tally.count === 1 ? "started a helper" : `started ${tally.count} helpers`
  if (!tally.group) return lower(tally.label)
  if (tally.count > 1) return tally.group.many(tally.count)
  const specific = !tally.label.startsWith("Ran ") && tally.label.length <= SPECIFIC_CHARS
  return specific ? lower(tally.label) : tally.group.one
}

type SummaryStep = Pick<RunStep, "tool" | "note" | "name" | "label" | "status" | "app" | "worker"> & {
  input?: string
}

const SUMMARY_GROUPS = 2

export function summarizeSteps(steps: readonly SummaryStep[]): string {
  const calls = steps.filter((step) => !step.note)
  const workers = new Set(calls.flatMap((step) => (step.worker ? [step.worker.id] : [])))
  const own = calls.filter((step) => !step.worker)
  const tallies = [
    ...tallyOf(own),
    ...(workers.size ? [{ key: "helper", label: "", count: workers.size, at: Number.MAX_SAFE_INTEGER }] : []),
  ]
  const picked = [...tallies]
    .sort((a, b) => Number(!!b.group?.first) - Number(!!a.group?.first) || b.count - a.count || a.at - b.at)
    .slice(0, SUMMARY_GROUPS)
  const shown = picked.reduce((n, t) => n + t.count, 0)
  const rest = tallies.reduce((n, t) => n + t.count, 0) - shown
  const parts = picked.map(phrase)
  if (rest > 0) parts.push(`${rest} more ${rest === 1 ? "step" : "steps"}`)
  if (parts.length === 0) return ""
  const sentence = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
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
  Deployed: "Deploying",
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

const said = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const titled = (value: unknown) => {
  const text = said(value).replace(/^@/, "").replace(/[-_]+/g, " ")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
}
const did = (verb: string, what: string, otherwise: string) => (what ? `${verb} ${what}` : otherwise)

const inApp = (args: Args) => said(args.name)

const HUMAN: Record<string, (args: Args) => string> = {
  app_list: () => "Listed your apps",
  app_deploy: (a) => did("Deployed", inApp(a), "Deployed an app"),
  app_inspect: (a) => (inApp(a) && said(a.what) ? `Checked ${inApp(a)} ${said(a.what)}` : "Checked an app"),
  app_call: (a) =>
    inApp(a) && said(a.method) && said(a.path)
      ? `Called ${said(a.method)} ${said(a.path)} on ${inApp(a)}`
      : "Called an app",
  delete_agent: (a) => did("Deleted", titled(a.handle), "Deleted an agent"),
  delete_group: () => "Deleted a group",
  remove_member: (a) => did("Removed", titled(a.handle), "Removed a member"),
  connect_app: (a) => did("Connected", titled(a.app), "Connected an app"),
  add_recipe: (a) => did("Added recipe", titled(a.slug), "Added a recipe"),
  computer_shell: () => "Ran a command on the computer",
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

const hostOf = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  try {
    return new URL(value).hostname.replace(/^www\./, "") || undefined
  } catch {
    return undefined
  }
}

export function sourcesOf(step: Pick<RunStep, "input">): string[] {
  const args = argsOf(step.input)
  const urls = Array.isArray(args.urls) ? args.urls : [args.url]
  return [...new Set(urls.map(hostOf).filter((host): host is string => host !== undefined))]
}

function commandOf(step: Pick<RunStep, "name"> & { input?: string }): string | undefined {
  if (step.name === "bash") return step.input?.trim() || undefined
  if (step.name === "computer_shell") return said(argsOf(step.input).command) || undefined
  return undefined
}

function humanLabel(step: Pick<RunStep, "name" | "label" | "input">): string {
  const shell = commandOf(step)
  const described = shell === undefined ? undefined : shellLabel(shell)
  if (described) return described.label
  if (step.label !== `Used ${step.name}`) return step.label
  return HUMAN[step.name]?.(argsOf(step.input)) ?? `Used ${step.name.replace(/_/g, " ")}`
}

export function liveLabel(step: Pick<RunStep, "tool" | "name" | "label" | "input" | "status">): string {
  const label = humanLabel(step)
  if (step.status !== "running") return label
  if (label.startsWith("Ran ")) return `Running ${programOf(commandOf(step) ?? label.slice(4)) ?? "command"}`
  const space = label.indexOf(" ")
  const verb = space === -1 ? label : label.slice(0, space)
  const present = PRESENT[verb]
  if (!present) return label
  return space === -1 ? present : `${present}${label.slice(space)}`
}

export function extraInput(step: Pick<RunStep, "name" | "label" | "input">): string | undefined {
  const shell = commandOf(step)
  if (shell !== undefined) return shell
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

import { type ConversationId, defineExtension, type Extension, hook, ToolTask } from "@earendil-works/pi-durable"
import type { Activity, AgentSlug, RunStep, ToolKind } from "@kiko/protocol"
import { redact } from "../run-error"

export const PRESENCE = "presence"

const path = (args: Record<string, unknown>) => (typeof args.path === "string" ? ` ${args.path.startsWith("/") ? "" : "/"}${args.path}` : "")

const COMMAND_CHARS = 80

function command(args: Record<string, unknown>): string {
  const line = typeof args.command === "string" ? args.command.replace(/\s+/g, " ").trim() : ""
  if (!line) return "running a command on the files"
  return `running ${line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line}`
}

type Described = { doing: string; activity: Activity }

const KINDS: Readonly<Record<string, ToolKind>> = { read: "read", ls: "search", write: "edit", edit: "edit", bash: "run", web_fetch: "web" }

const tool = (name: string, doing: string): Described => ({ doing, activity: { kind: "tool", tool: KINDS[name] ?? "other", caption: doing } })

export function describeCall(name: string, args: Record<string, unknown>): Described | null {
  if (name.startsWith("memory_") || name === "read_skill") return null
  switch (name) {
    case "read":
      return tool(name, `reading${path(args)}`)
    case "ls":
      return tool(name, `looking through${path(args) || " the files"}`)
    case "write":
    case "edit":
      return tool(name, `editing${path(args)}`)
    case "bash":
      return tool(name, command(args))
    case "web_fetch":
      return tool(name, "reading a web page")
    case "start_work":
      return tool(name, "starting background work")
    case "create_routine":
    case "update_routine":
    case "list_routines":
    case "cancel_routine":
      return tool(name, "handling a routine")
    case "create_agent":
    case "create_group":
      return tool(name, "setting up agents")
    case "ask": {
      const to = typeof args.to === "string" ? args.to.replace(/^@/, "").toLowerCase() : ""
      return to ? { doing: `waiting on @${to}`, activity: { kind: "waiting", on: to as AgentSlug } } : null
    }
    case "ask_human":
      return tool(name, "asking the human")
    case "team":
    case "list_agents":
    case "send_message":
    case "steer_work":
    case "stop_work":
      return null
    default:
      return tool(name, `using ${name.replace(/_/g, " ")}`)
  }
}

const INPUT_CHARS = 2_000
const OUTPUT_CHARS = 4_000

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const str = (v: unknown) => (typeof v === "string" ? v : "")
const host = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** The past-tense words for a call, keyed by tool name. A tool that is not here reads "Used <name>". */
const LABELS: Readonly<Record<string, (args: Record<string, unknown>) => string>> = {
  read: (a) => `Read${path(a)}`,
  ls: (a) => `Listed${path(a) || " the files"}`,
  write: (a) => `Wrote${path(a)}`,
  edit: (a) => `Edited${path(a)}`,
  bash: (a) => {
    const line = str(a.command).replace(/\s+/g, " ").trim()
    return line ? `Ran ${cut(line, COMMAND_CHARS)}` : "Ran a command on the files"
  },
  web_fetch: (a) => (str(a.url) ? `Fetched ${host(str(a.url))}` : "Fetched a web page"),
  start_work: () => "Started background work",
  create_routine: () => "Created a routine",
  update_routine: () => "Updated a routine",
  list_routines: () => "Listed routines",
  cancel_routine: () => "Cancelled a routine",
  create_agent: () => "Created an agent",
  create_group: () => "Created a group",
  ask: (a) => `Asked ${str(a.to).replace(/^@/, "").toLowerCase()}`,
  ask_human: () => "Asked the human",
  mkdir: (a) => `Made folder${path(a)}`,
  mv: (a) => `Moved${path({ path: a.from })} to${path({ path: a.to })}`,
  cp: (a) => `Copied${path({ path: a.from })} to${path({ path: a.to })}`,
  rm: (a) => (Array.isArray(a.paths) && a.paths.length === 1 ? `Deleted${path({ path: a.paths[0] })}` : "Deleted files"),
  create_task: (a) => (str(a.title) ? `Added task ${cut(str(a.title), 60)}` : "Added a task"),
  update_task: () => "Updated a task",
  note: () => "Saved a note",
  recall: () => "Searched memory",
  browse: () => "Browsed the web",
}

const PATH_TOOLS = new Set(["read", "ls", "write", "edit", "mkdir"])

function inputOf(name: string, args: Record<string, unknown>): string | undefined {
  const full = name === "bash" ? str(args.command) : name === "web_fetch" ? str(args.url) : PATH_TOOLS.has(name) || !Object.keys(args).length ? "" : JSON.stringify(args)
  return full ? cut(redact(full), INPUT_CHARS) : undefined
}

/** What a tool knows about its own call that the table above cannot: a connected app's name and what it did. */
export type Describe = (name: string, args: Record<string, unknown>) => { label: string; app?: string; input?: string } | null

type StepShown = Pick<RunStep, "tool" | "name" | "label" | "input" | "app">

/** What the run panel shows for one call, or null for a call the human should not see. It asks `describeCall` first, so the two cannot drift. */
export function stepOf(name: string, args: Record<string, unknown>, describe?: Describe): StepShown | null {
  const described = describeCall(name, args)
  if (!described) return null
  const tool = described.activity.kind === "tool" ? described.activity.tool : "other"
  const own = describe?.(name, args)
  const label = own?.label ?? LABELS[name]?.(args) ?? `Used ${name}`
  const input = own?.input ?? inputOf(name, args)
  return { tool, name, label: PATH_TOOLS.has(name) ? label : redact(label), ...(input ? { input: cut(redact(input), INPUT_CHARS) } : {}), ...(own?.app ? { app: own.app } : {}) }
}

/** A tool result as the panel's output text: its text parts, credentials removed, cut to 4,000 characters. */
export function outputOf(content: readonly { type: string; text?: string }[] | undefined): string | undefined {
  const text = (content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("\n")
  return text ? cut(redact(text), OUTPUT_CHARS) : undefined
}

const ERROR_CHARS = 60

export function failed(doing: string, content: readonly { type: string; text?: string }[] | undefined): string {
  const error = (content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join(" ").replace(/\s+/g, " ").trim()
  return `failed: ${doing}${error ? ` (${error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}…` : error})` : ""}`
}

export function failedCall(described: Described, content: readonly { type: string; text?: string }[] | undefined): Described {
  const caption = failed(described.doing, content)
  return { doing: caption, activity: { kind: "failed", caption } }
}

/** One tool call, as the agent hands it to the room: the step, and what the agent is doing now. */
export type StepItem = { step: Omit<RunStep, "slug" | "after">; doing?: string; activity?: Activity }

/** Whose call it is: the run it belongs to, and the worker that made it. */
type StepScope = { runId: string; worker?: { id: string; task: string } }

export type StepsPort = {
  /** Null for a call that is no one's to show. */
  scope(conversationId: ConversationId): StepScope | null
  push(item: StepItem): void
  describe?: Describe
}

/** Reports every tool call the human should see, when it starts and when it ends. The end carries the whole step, so it stands alone after a restart. */
export function presenceExtension(port: StepsPort): Extension {
  const started = new Map<string, number>()
  const key = (conversationId: ConversationId, id: string) => `${conversationId}:${id}`
  const build = (call: { name: string; arguments?: unknown }, conversationId: ConversationId) => {
    const args = (call.arguments ?? {}) as Record<string, unknown>
    const scope = port.scope(conversationId)
    const shown = scope ? stepOf(call.name, args, port.describe) : null
    const described = describeCall(call.name, args)
    return scope && shown && described ? { scope, shown, described } : null
  }
  return defineExtension({
    name: PRESENCE,
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api) => {
          const built = build(call, api.conversationId)
          if (!built) return undefined
          const startedAt = Date.now()
          started.set(key(api.conversationId, call.id), startedAt)
          const { scope, shown, described } = built
          port.push({ step: { id: call.id, runId: scope.runId, ...(scope.worker ? { worker: scope.worker } : {}), ...shown, status: "running", startedAt }, doing: described.doing, activity: described.activity })
          return undefined
        },
        afterTool: async (call, result, api) => {
          const built = build(call, api.conversationId)
          if (!built) return undefined
          const at = key(api.conversationId, call.id)
          const endedAt = Date.now()
          const startedAt = started.get(at) ?? endedAt
          started.delete(at)
          const { scope, shown, described } = built
          const output = outputOf(result.output)
          const out = result.isError ? failedCall(described, result.output) : null
          port.push({
            step: { id: call.id, runId: scope.runId, ...(scope.worker ? { worker: scope.worker } : {}), ...shown, status: result.isError ? "failed" : "done", startedAt, endedAt, ...(output ? { output } : {}) },
            ...(out ? { doing: out.doing, activity: out.activity } : {}),
          })
          return undefined
        },
      }),
    ],
  })
}

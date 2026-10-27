import {
  type ConversationId,
  defineExtension,
  type Extension,
  GenerationTask,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable"
import type { Activity, RunStep, ToolKind } from "@kiko/protocol"
import { redact } from "../run-error"

const PRESENCE = "presence"

const path = (args: Record<string, unknown>) =>
  typeof args.path === "string" ? ` ${args.path.startsWith("/") ? "" : "/"}${args.path}` : ""

const COMMAND_CHARS = 80

function command(args: Record<string, unknown>): string {
  const line = typeof args.command === "string" ? args.command.replace(/\s+/g, " ").trim() : ""
  if (!line) return "running a command on the files"
  return `running ${line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line}`
}

type Described = { doing: string; activity: Activity }

const KINDS: Readonly<Record<string, ToolKind>> = {
  read: "read",
  ls: "search",
  write: "edit",
  edit: "edit",
  bash: "run",
}

const tool = (name: string, doing: string): Described => ({
  doing,
  activity: { kind: "tool", tool: KINDS[name] ?? "other", caption: doing },
})

function describeCall(name: string, args: Record<string, unknown>): Described | null {
  if (name.startsWith("memory_")) return null
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
    case "start_work":
      return tool(name, "starting background work")
    case "create_routine":
    case "update_routine":
    case "list_routines":
    case "delete_routine":
    case "cancel_routine":
      return tool(name, "handling a routine")
    case "create_agent":
    case "create_group":
      return tool(name, "setting up agents")
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

const LABELS: Readonly<Record<string, (args: Record<string, unknown>) => string>> = {
  read: (a) => `Read${path(a)}`,
  ls: (a) => `Listed${path(a) || " the files"}`,
  write: (a) => `Wrote${path(a)}`,
  edit: (a) => `Edited${path(a)}`,
  bash: (a) => {
    const line = str(a.command).replace(/\s+/g, " ").trim()
    return line ? `Ran ${cut(line, COMMAND_CHARS)}` : "Ran a command on the files"
  },
  start_work: () => "Started background work",
  create_routine: () => "Created a routine",
  update_routine: () => "Updated a routine",
  list_routines: () => "Listed routines",
  cancel_routine: () => "Cancelled a routine",
  delete_routine: () => "Deleted a routine",
  create_agent: () => "Created an agent",
  create_group: () => "Created a group",
  ask_human: () => "Asked the human",
  mkdir: (a) => `Made folder${path(a)}`,
  mv: (a) => `Moved${path({ path: a.from })} to${path({ path: a.to })}`,
  cp: (a) => `Copied${path({ path: a.from })} to${path({ path: a.to })}`,
  rm: (a) =>
    Array.isArray(a.paths) && a.paths.length === 1 ? `Deleted${path({ path: a.paths[0] })}` : "Deleted files",
  create_task: (a) => (str(a.title) ? `Added task ${cut(str(a.title), 60)}` : "Added a task"),
  update_task: () => "Updated a task",
  note: () => "Saved a note",
  recall: () => "Searched memory",
  browse: () => "Browsed the web",
}

const PATH_TOOLS = new Set(["read", "ls", "write", "edit", "mkdir"])

function inputOf(name: string, args: Record<string, unknown>): string | undefined {
  const full =
    name === "bash" ? str(args.command) : PATH_TOOLS.has(name) || !Object.keys(args).length ? "" : JSON.stringify(args)
  return full ? cut(redact(full), INPUT_CHARS) : undefined
}

export type Describe = (
  name: string,
  args: Record<string, unknown>,
) => { label: string; app?: string; input?: string } | null

type StepShown = Pick<RunStep, "tool" | "name" | "label" | "input" | "app">

function stepOf(name: string, args: Record<string, unknown>, describe?: Describe): StepShown | null {
  const described = describeCall(name, args)
  if (!described) return null
  const tool = described.activity.kind === "tool" ? described.activity.tool : "other"
  const own = describe?.(name, args)
  const label = own?.label ?? LABELS[name]?.(args) ?? `Used ${name}`
  const input = own?.input ?? inputOf(name, args)
  return {
    tool,
    name,
    label: PATH_TOOLS.has(name) ? label : redact(label),
    ...(input ? { input: cut(redact(input), INPUT_CHARS) } : {}),
    ...(own?.app ? { app: own.app } : {}),
  }
}

function outputOf(content: readonly { type: string; text?: string }[] | undefined): string | undefined {
  const text = (content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("\n")
  return text ? cut(redact(text), OUTPUT_CHARS) : undefined
}

const ERROR_CHARS = 60

function failed(doing: string, content: readonly { type: string; text?: string }[] | undefined): string {
  const error = (content ?? [])
    .flatMap((c) => (c.type === "text" && c.text ? [c.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  return `failed: ${doing}${error ? ` (${error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}…` : error})` : ""}`
}

function failedCall(described: Described, content: readonly { type: string; text?: string }[] | undefined): Described {
  const caption = failed(described.doing, content)
  return { doing: caption, activity: { kind: "failed", caption } }
}

export type StepItem = { step: Omit<RunStep, "slug" | "after">; doing?: string; activity?: Activity }

type StepScope = { runId: string; worker?: { id: string; task: string } }

export type StepsPort = {
  scope(conversationId: ConversationId): StepScope | null
  push(item: StepItem): void
  describe?: Describe
}

type StepShownIn = readonly { type: string; text?: string }[] | undefined

type Opened = { step: StepItem["step"]; described: Described }

const stepKey = (conversationId: ConversationId, id: string) => `${conversationId}:${id}`

function closedStep(opened: Opened, status: "done" | "failed", endedAt: number, content?: StepShownIn): StepItem {
  const output = outputOf(content)
  const out = status === "failed" ? failedCall(opened.described, content) : null
  return {
    step: { ...opened.step, status, endedAt, ...(output ? { output } : {}) },
    ...(out ? { doing: out.doing, activity: out.activity } : {}),
  }
}

export function presenceExtension(port: StepsPort): Extension {
  const open = new Map<string, Opened>()
  const build = (call: { name: string; arguments?: unknown }, conversationId: ConversationId) => {
    const args = (call.arguments ?? {}) as Record<string, unknown>
    const scope = port.scope(conversationId)
    const shown = scope ? stepOf(call.name, args, port.describe) : null
    const described = describeCall(call.name, args)
    return scope && shown && described ? { scope, shown, described } : null
  }
  const begin = (call: { id: string; name: string; arguments?: unknown }, conversationId: ConversationId): void => {
    const built = build(call, conversationId)
    if (!built) return
    const step: StepItem["step"] = {
      id: call.id,
      runId: built.scope.runId,
      ...(built.scope.worker ? { worker: built.scope.worker } : {}),
      ...built.shown,
      status: "running",
      startedAt: Date.now(),
    }
    open.set(stepKey(conversationId, call.id), { step, described: built.described })
    port.push({ step, doing: built.described.doing, activity: built.described.activity })
  }
  const finish = (key: string, item: StepItem): void => {
    open.delete(key)
    port.push(item)
  }
  return defineExtension({
    name: PRESENCE,
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api) => {
          begin(call, api.conversationId)
          return undefined
        },
        afterTool: async (call, result, api) => {
          const key = stepKey(api.conversationId, call.id)
          const opened = open.get(key)
          if (!opened) return undefined
          finish(key, closedStep(opened, result.isError ? "failed" : "done", Date.now(), result.output))
          return undefined
        },
      }),
      hook(GenerationTask, {
        afterTools: async (_assistant, _results, api) => {
          const mine = `${api.conversationId}:`
          for (const [key, opened] of open) {
            if (!key.startsWith(mine)) continue
            finish(key, closedStep(opened, "failed", Date.now()))
          }
        },
      }),
    ],
  })
}

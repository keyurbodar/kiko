import { defineExtension, type Extension, hook, ToolTask } from "@earendil-works/pi-durable"
import type { Activity, AgentSlug, ToolKind } from "@kiko/protocol"

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

const ERROR_CHARS = 60

export function failed(doing: string, content: readonly { type: string; text?: string }[] | undefined): string {
  const error = (content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join(" ").replace(/\s+/g, " ").trim()
  return `failed: ${doing}${error ? ` (${error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}…` : error})` : ""}`
}

export function failedCall(described: Described, content: readonly { type: string; text?: string }[] | undefined): Described {
  const caption = failed(described.doing, content)
  return { doing: caption, activity: { kind: "failed", caption } }
}

export function presenceExtension(report: (doing: string, activity: Activity) => Promise<unknown>): Extension {
  return defineExtension({
    name: PRESENCE,
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call) => {
          const described = describeCall(call.name, (call.arguments ?? {}) as Record<string, unknown>)
          if (described) void report(described.doing, described.activity).catch(() => undefined)
          return undefined
        },
        afterTool: async (call, result) => {
          const described = result.isError ? describeCall(call.name, (call.arguments ?? {}) as Record<string, unknown>) : null
          if (described) {
            const out = failedCall(described, result.output)
            void report(out.doing, out.activity).catch(() => undefined)
          }
          return undefined
        },
      }),
    ],
  })
}

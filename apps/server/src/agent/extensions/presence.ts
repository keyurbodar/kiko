import { defineExtension, type Extension, hook, ToolTask } from "@earendil-works/pi-durable"

export const PRESENCE = "presence"

const path = (args: Record<string, unknown>) => (typeof args.path === "string" ? ` ${args.path.startsWith("/") ? "" : "/"}${args.path}` : "")

const COMMAND_CHARS = 80

function command(args: Record<string, unknown>): string {
  const line = typeof args.command === "string" ? args.command.replace(/\s+/g, " ").trim() : ""
  if (!line) return "running a command on the files"
  return `running ${line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line}`
}

export function describeCall(name: string, args: Record<string, unknown>): string | null {
  if (name.startsWith("memory_") || name === "read_skill") return null
  switch (name) {
    case "read":
      return `reading${path(args)}`
    case "ls":
      return `looking through${path(args) || " the files"}`
    case "write":
    case "edit":
      return `editing${path(args)}`
    case "bash":
      return command(args)
    case "web_fetch":
      return "reading a web page"
    case "start_work":
      return "starting background work"
    case "create_reminder":
    case "list_reminders":
    case "cancel_reminder":
      return "handling a reminder"
    case "propose_agent":
    case "propose_group":
    case "create":
      return "setting up agents"
    case "team":
    case "list_agents":
    case "send_message":
    case "ask":
    case "steer_work":
    case "stop_work":
      return null
    default:
      return `using ${name.replace(/_/g, " ")}`
  }
}

const ERROR_CHARS = 60

export function failed(doing: string, content: readonly { type: string; text?: string }[] | undefined): string {
  const error = (content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join(" ").replace(/\s+/g, " ").trim()
  return `failed: ${doing}${error ? ` (${error.length > ERROR_CHARS ? `${error.slice(0, ERROR_CHARS - 1)}…` : error})` : ""}`
}

export function presenceExtension(report: (doing: string) => Promise<unknown>): Extension {
  return defineExtension({
    name: PRESENCE,
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call) => {
          const doing = describeCall(call.name, (call.arguments ?? {}) as Record<string, unknown>)
          if (doing) void report(doing).catch(() => undefined)
          return undefined
        },
        afterTool: async (call, result) => {
          const doing = result.isError ? describeCall(call.name, (call.arguments ?? {}) as Record<string, unknown>) : null
          if (doing) void report(failed(doing, result.content)).catch(() => undefined)
          return undefined
        },
      }),
    ],
  })
}

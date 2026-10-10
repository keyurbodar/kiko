import { defineExtension, type Extension, hook, ToolTask } from "@earendil-works/pi-durable"

// Architecture section 7.12. The room sees file changes and messages itself; everything else an
// agent does happens inside it: connected apps through Composio, web pages, subagents, reminders.
// This hook tells the room what each tool call is about, in a few plain words, so teammates and
// the human see it on the team board. It never blocks or delays a call. Memory stays silent.

export const PRESENCE = "presence"

const path = (args: Record<string, unknown>) => (typeof args.path === "string" ? ` ${args.path.startsWith("/") ? "" : "/"}${args.path}` : "")

/** ASSUMPTION: how much of a bash command the board shows. */
const COMMAND_CHARS = 80

/** The command itself, on one line, so a teammate sees which files it is about before it saves. */
function command(args: Record<string, unknown>): string {
  const line = typeof args.command === "string" ? args.command.replace(/\s+/g, " ").trim() : ""
  if (!line) return "running a command on the files"
  return `running ${line.length > COMMAND_CHARS ? `${line.slice(0, COMMAND_CHARS - 1)}…` : line}`
}

/** What a call is about, or null when it says nothing a teammate needs. */
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
    case "spawn_subagent":
      return "working with a helper"
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
      return null
    default:
      return `using ${name.replace(/_/g, " ")}`
  }
}

/** ASSUMPTION: how much of a tool's error the trace keeps. */
const ERROR_CHARS = 60

/** `failed: reading /x.md (no such file)`. */
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
          // Fire and forget: the board is a picture, never a gate.
          if (doing) void report(doing).catch(() => undefined)
          return undefined
        },
        // What failed and why is what memory keeps longest (OptChat), so a failed call joins the run's trace.
        afterTool: async (call, result) => {
          const doing = result.isError ? describeCall(call.name, (call.arguments ?? {}) as Record<string, unknown>) : null
          if (doing) void report(failed(doing, result.content)).catch(() => undefined)
          return undefined
        },
      }),
    ],
  })
}

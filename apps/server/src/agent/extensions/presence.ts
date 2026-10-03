import { defineExtension, type Extension, hook, ToolTask } from "@earendil-works/pi-durable"

// Architecture section 7.12. The room sees file changes and messages itself; everything else an
// agent does happens inside it: integrations through Executor, web pages, subagents, reminders.
// This hook tells the room what each tool call is about, in a few plain words, so teammates and
// the human see it on the team board. It never blocks or delays a call. Memory stays silent.

export const PRESENCE = "presence"

const path = (args: Record<string, unknown>) => (typeof args.path === "string" ? ` ${args.path.startsWith("/") ? "" : "/"}${args.path}` : "")

/** What a call is about, or null when it says nothing a teammate needs. */
export function describeCall(name: string, args: Record<string, unknown>): string | null {
  if (name.startsWith("memory_") || name === "read_skill") return null
  if (name === "executor_execute") return "running code on the human's connected apps"
  if (name.startsWith("executor_")) return `using ${name.slice("executor_".length).replace(/_/g, " ")} (connected apps)`
  switch (name) {
    case "read":
      return `reading${path(args)}`
    case "ls":
      return `looking through${path(args) || " the files"}`
    case "write":
    case "edit":
      return `editing${path(args)}`
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
    case "check_agent":
    case "list_agents":
    case "send_message":
    case "broadcast":
      return null
    default:
      return `using ${name.replace(/_/g, " ")}`
  }
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
      }),
    ],
  })
}

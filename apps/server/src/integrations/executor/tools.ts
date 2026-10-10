import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { spill } from "../../agent/extensions/spill"
import { count } from "../../lib/dev-stats"
import type { RoomFs } from "../../files/room-fs"
import { acceptResponse, type ApprovalGate, pendingInteraction, RESUME_TOOL } from "./approval"

export const EXECUTOR = "executor"

export type ExecutorTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
}

export type ExecutorResultBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
export type ExecutorCall = (name: string, args: Record<string, unknown>) => Promise<{ content: ExecutorResultBlock[]; isError?: boolean }>
/** Searches the apps Executor can add. */
export type ExecutorFind = (query: string, limit?: number) => Promise<unknown[]>
export const FIND_TOOL = "executor_find_apps"

/**
 * Dev stats for one agent call: its time end to end, and how much of it Executor reports its apps'
 * tools took inside. The rest is Executor's own work and the network.
 */
function countCall(name: string, ms: number, content: ExecutorResultBlock[]): void {
  count(`executor.${name}.ms`, Math.round(ms))
  const text = content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
  count(`executor.${name}.toolsMs`, [...text.matchAll(/"durationMs":(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0))
}

export const toolName = (name: string) => `executor_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64)

export function executorExtension(tools: readonly ExecutorTool[], call: ExecutorCall, gate?: ApprovalGate, fs?: RoomFs, find?: ExecutorFind): Extension {
  const finder = find
    ? [
        declareEffect(
          "read",
          defineTool({
            name: FIND_TOOL,
            description: "Search every app the human can add through Executor (thousands of MCP, OpenAPI, and GraphQL services). Returns the best few as { entry, name, kind, domain, about }; pass entry to the executor app's apps.install. Answers at once.",
            parameters: { type: "object", properties: { query: { type: "string", description: "what the app should do or be, such as \"web search\" or \"linear\"" }, limit: { type: "number" } }, required: ["query"] } as never,
            replay: "safe",
            execute: async (args) => {
              const input = (args ?? {}) as { query?: unknown; limit?: unknown }
              count("executor.call.find_apps")
              try {
                const found = await find(String(input.query ?? ""), typeof input.limit === "number" ? input.limit : undefined)
                return { content: [{ type: "text" as const, text: found.length ? JSON.stringify(found) : "no app matches. try other words, or import any MCP server by its URL." }] }
              } catch (e) {
                return { content: [{ type: "text" as const, text: `executor did not answer: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
              }
            },
          }),
          { outside: "executor" },
        ),
      ]
    : []
  return defineExtension({
    name: EXECUTOR,
    tools: [...finder, ...tools.map((t) =>
      declareEffect(
        t.readOnly ? "read" : t.name === RESUME_TOOL ? "write" : "external",
        defineTool({
          name: toolName(t.name),
          description: `${t.description?.trim() || t.name} (through executor, the human's connected apps)`,
          parameters: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} }) as never,
          replay: t.readOnly ? "safe" : "unsafe",
          execute: async (args, api) => {
            const input = (args ?? {}) as Record<string, unknown>
            count(`executor.call.${t.name}`)
            try {
              if (t.name === RESUME_TOOL) {
                const requestId = String(input.requestId ?? "")
                const ok = gate ? await gate({ kind: "resume", requestId }) : null
                if (typeof ok !== "string") {
                  const why = ok?.refused ?? "resuming needs the human's approval in the chat."
                  return { content: [{ type: "text" as const, text: `not resumed: ${why} you cannot approve it yourself.` }], isError: true }
                }
                input.response = acceptResponse(requestId, (input.response as { content?: unknown } | undefined)?.content)
              }
              const sent = performance.now()
              const out = await call(t.name, input)
              countCall(t.name, performance.now() - sent, out.content)
              const text = out.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
              const pending = gate ? pendingInteraction(text) : null
              if (pending && gate) {
                const summary = pending.message.replace(/\s+/g, " ").slice(0, 400) || undefined
                await gate({ kind: "pause", requestId: pending.requestId, tool: toolName(RESUME_TOOL), summary, ttlMs: pending.expiresAt - Date.now() })
                const ask = pending.kind === "input" ? " ask the human for what it needs in the chat, and pass their answer as response.content." : ""
                return {
                  content: [{ type: "text" as const, text: `${text}\n\nthis is paused for the human; a card is in the chat. tell the human what it does and wait.${ask} once the approval result says accepted, call ${toolName(RESUME_TOOL)} with requestId ${pending.requestId}. never run the program again to continue it.` }],
                }
              }
              if (!out.content.length) return { content: [{ type: "text" as const, text: "(no output)" }], isError: out.isError }
              const content = await Promise.all(out.content.map(async (b) => (b.type === "text" ? { ...b, text: await spill(fs, `executor-${t.name}`, b.text) } : b)))
              return { content, isError: out.isError }
            } catch (e) {
              return { content: [{ type: "text" as const, text: `executor did not answer: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
            }
          },
        }),
        { outside: "executor" },
      ),
    )],
  })
}

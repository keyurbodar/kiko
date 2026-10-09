import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { spill } from "../../agent/extensions/spill"
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

export const toolName = (name: string) => `executor_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64)

export function executorExtension(tools: readonly ExecutorTool[], call: ExecutorCall, gate?: ApprovalGate, fs?: RoomFs): Extension {
  return defineExtension({
    name: EXECUTOR,
    tools: tools.map((t) =>
      declareEffect(
        t.readOnly ? "read" : t.name === RESUME_TOOL ? "write" : "external",
        defineTool({
          name: toolName(t.name),
          description: `${t.description?.trim() || t.name} (through executor, the human's connected apps)`,
          parameters: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} }) as never,
          replay: t.readOnly ? "safe" : "unsafe",
          execute: async (args, api) => {
            const input = (args ?? {}) as Record<string, unknown>
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
              const out = await call(t.name, input)
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
    ),
  })
}

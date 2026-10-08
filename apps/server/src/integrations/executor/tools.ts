import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import { spill } from "../../agent/extensions/spill"
import type { RoomFs } from "../../files/room-fs"
import { acceptResponse, type ApprovalGate, pendingInteraction, RESUME_TOOL } from "./approval"

// Architecture section 12.2, P7-04. Every tool Executor lists becomes an agent tool named
// `executor_<name>`, with Executor's own description and input schema. Nothing about a tool is
// written here: adding an integration in the Executor console changes the next run's tools.
// Every Executor tool is `external` (the trust gate holds it in a run nobody asked for) unless the server
// marks it read-only, and every result is outside content, so it is wrapped as untrusted.

export const EXECUTOR = "executor"

/** One tool as `tools/list` returned it. Plain data, so `UserDO` can pass it over RPC. */
export type ExecutorTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
}

export type ExecutorResultBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
export type ExecutorCall = (name: string, args: Record<string, unknown>) => Promise<{ content: ExecutorResultBlock[]; isError?: boolean }>

/** `executor_` plus the name, with anything a model's tool name cannot hold turned into `_`. */
export const toolName = (name: string) => `executor_${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64)

/** With `fs`, a result too big to return whole is saved in the chat's files (`spill.ts`). */
export function executorExtension(tools: readonly ExecutorTool[], call: ExecutorCall, gate?: ApprovalGate, fs?: RoomFs): Extension {
  return defineExtension({
    name: EXECUTOR,
    tools: tools.map((t) =>
      declareEffect(
        // Resume acts outside kiko, but only against a pause card the human accepted (below), which is
        // stricter than the trust gate. Declaring it external would post a second card for the same act.
        t.readOnly ? "read" : t.name === RESUME_TOOL ? "write" : "external",
        defineTool({
          name: toolName(t.name),
          description: `${t.description?.trim() || t.name} (through executor, the human's connected apps)`,
          // Executor's JSON Schema is passed through as is: pi-ai sends it to the model unchanged.
          parameters: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} }) as never,
          // An external call is not safe to repeat after a crash: it may have acted already.
          replay: t.readOnly ? "safe" : "unsafe",
          execute: async (args, api) => {
            const input = (args ?? {}) as Record<string, unknown>
            try {
              // P7-05: resume runs only against a card the human accepted, and kiko writes the answer.
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
                // Post the card now, so the human sees it while the agent tells them what it needs.
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

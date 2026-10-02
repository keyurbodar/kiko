import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "../../agent/effects"
import { type ApprovalGate, pausedExecution, RESUME_TOOL } from "./approval"

// Architecture section 12.2, P7-04. Every tool Executor lists becomes an agent tool named
// `executor_<name>`, with Executor's own description and input schema. Nothing about a tool is
// written here: adding an integration in the Executor console changes the next run's tools.
// Every Executor tool is `external` (the trust gate holds it in a tainted run) unless the server
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

export function executorExtension(tools: readonly ExecutorTool[], call: ExecutorCall, gate?: ApprovalGate): Extension {
  return defineExtension({
    name: EXECUTOR,
    tools: tools.map((t) =>
      declareEffect(
        t.readOnly ? "read" : "external",
        defineTool({
          name: toolName(t.name),
          description: `${t.description?.trim() || t.name} (through executor, the human's connected apps)`,
          // Executor's JSON Schema is passed through as is: pi-ai sends it to the model unchanged.
          parameters: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} }) as never,
          // An external call is not safe to repeat after a crash: it may have acted already.
          replay: t.readOnly ? "safe" : "unsafe",
          execute: async (args, api) => {
            const input = (args ?? {}) as Record<string, unknown>
            const key = `${api.conversationId}:${api.callId}`
            try {
              // P7-05: resume runs only against a card the human accepted. Without a gate it never runs.
              if (t.name === RESUME_TOOL) {
                const executionId = String(input.executionId ?? input.execution_id ?? "")
                const ok = gate ? await gate(key, toolName(RESUME_TOOL), { executionId }) : null
                if (typeof ok !== "string") {
                  const why = ok?.refused ?? "resuming needs the human's approval in the chat."
                  return { content: [{ type: "text" as const, text: `not resumed: ${why} you cannot approve it yourself.` }], isError: true }
                }
              }
              const out = await call(t.name, input)
              const text = out.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")
              const paused = t.name === RESUME_TOOL ? null : pausedExecution(text)
              if (paused && gate) {
                // Post the card now, so the human sees it while the agent tells them what it needs.
                await gate(`pause:${paused}`, toolName(RESUME_TOOL), { executionId: paused })
                return {
                  content: [{ type: "text" as const, text: `${text}\n\nthis action is paused for the human's approval; a card is in the chat. tell the human what it does and wait. once the approval result says accepted, call ${toolName(RESUME_TOOL)} with executionId ${paused}.` }],
                }
              }
              return { content: out.content.length ? out.content : [{ type: "text" as const, text: "(no output)" }], isError: out.isError }
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

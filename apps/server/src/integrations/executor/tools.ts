import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "../../agent/effects"

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

export function executorExtension(tools: readonly ExecutorTool[], call: ExecutorCall): Extension {
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
          execute: async (args) => {
            try {
              const out = await call(t.name, (args ?? {}) as Record<string, unknown>)
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

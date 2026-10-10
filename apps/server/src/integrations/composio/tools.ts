import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { spill } from "../../agent/extensions/spill"
import type { RoomFs } from "../../files/room-fs"
import { count } from "../../lib/dev-stats"
import type { ComposioCall, ComposioCallResult, ComposioTool } from "./client"
import { directResult, MULTI_EXECUTE, SEARCH } from "./learn"

export const COMPOSIO = "composio"

/** Composio tools agents never get, and why. */
export const HIDDEN: Readonly<Record<string, string>> = {
  COMPOSIO_REMOTE_BASH_TOOL: "the workbench covers it",
  COMPOSIO_SUBMIT_FEEDBACK: "feedback to Composio is not the agent's to send",
  COMPOSIO_MANAGE_SKILL: "yuki has its own skills",
  COMPOSIO_SEARCH_SKILLS: "yuki has its own skills",
  COMPOSIO_USE_SKILL: "yuki has its own skills",
}

const requiredFlags = (schema: unknown): string[] => {
  const s = schema as { properties?: Record<string, { type?: unknown }>; required?: unknown } | null
  if (!s || !Array.isArray(s.required)) return []
  return s.required.filter((k): k is string => typeof k === "string" && s.properties?.[k]?.type === "boolean")
}

/** Models often omit a required boolean that Composio accepts as false, so the schema stops requiring it. */
export function relaxSchema<T>(schema: T): T {
  const flags = requiredFlags(schema)
  if (!flags.length) return schema
  const s = schema as unknown as { required: string[] }
  return { ...schema, required: s.required.filter((k) => !flags.includes(k)) }
}

/** Sets each boolean the schema required but the model left out to false. */
export const fillFlags = (schema: unknown, args: Record<string, unknown>): Record<string, unknown> => {
  const flags = requiredFlags(schema).filter((k) => args[k] === undefined)
  return flags.length ? { ...args, ...Object.fromEntries(flags.map((k) => [k, false])) } : args
}

/** `COMPOSIO_SEARCH_TOOLS` becomes `composio_search_tools`. */
export const toolName = (name: string) => `composio_${name.replace(/^COMPOSIO_/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`.slice(0, 64)

export function composioExtension(tools: readonly ComposioTool[], call: ComposioCall, fs?: RoomFs): Extension {
  const visible = tools.filter((t) => !(t.name in HIDDEN))
  const meta = new Set(visible.filter((t) => !t.direct).map((t) => toolName(t.name)))
  const shown = visible.filter((t) => !t.direct || !meta.has(toolName(t.name)))
  const direct = shown.filter((t) => t.direct).map((t) => toolName(t.name))
  // Composio's search description says to always search first, which would skip the learned tools.
  const skip = direct.length ? `When ${direct.join(", ")} already does the job, call it directly and do not search. ` : ""
  return defineExtension({
    name: COMPOSIO,
    tools: shown.map((t) => {
        const name = toolName(t.name)
        return declareEffect(
          t.readOnly ? "read" : "external",
          defineTool({
            name,
            description: t.direct ? `${t.description || t.name} (${t.direct.toolkit} through composio, call it directly)` : `${t.name === SEARCH ? skip : ""}${t.description?.trim() || t.name} (through composio, the human's connected apps)`,
            parameters: relaxSchema(t.inputSchema) as never,
            replay: t.readOnly ? "safe" : "unsafe",
            execute: (args) =>
              timed(name, fs, async () => {
                const sent = fillFlags(t.inputSchema, (args ?? {}) as Record<string, unknown>)
                if (!t.direct) return call(t.name, sent)
                const { text, isError } = directResult(await call(MULTI_EXECUTE, { tools: [{ tool_slug: t.direct.slug, arguments: sent }], sync_response_to_workbench: false, thought: "direct call" }))
                return { content: [{ type: "text" as const, text }], isError }
              }),
          }),
          { outside: "composio" },
        )
      }),
  })
}

/** Runs one tool call with dev stats, spills big text, and turns a throw into a tool error. */
async function timed(name: string, fs: RoomFs | undefined, run: () => Promise<ComposioCallResult>) {
  count(`composio.call.${name}`)
  try {
    const sent = performance.now()
    const out = await run()
    count(`composio.${name}.ms`, Math.round(performance.now() - sent))
    if (!out.content.length) return { content: [{ type: "text" as const, text: "(no output)" }], isError: out.isError }
    const content = await Promise.all(out.content.map(async (b) => (b.type === "text" ? { ...b, text: await spill(fs, `composio-${name}`, b.text) } : b)))
    return { content, isError: out.isError }
  } catch (e) {
    return { content: [{ type: "text" as const, text: `composio did not answer: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
  }
}

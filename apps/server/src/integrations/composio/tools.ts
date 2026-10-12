import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { spill } from "../../agent/extensions/spill"
import type { RoomFs } from "../../files/room-fs"
import { count, inFlight } from "../../lib/dev-stats"
import { composioErrorText } from "./connect"
import type { ComposioCall, ComposioCallResult, ComposioTool } from "./client"
import { directResult, MULTI_EXECUTE } from "./learn"
import { COMPOSIO_MAX_CONCURRENT, createLimiter, withRetry } from "./limit"

export const COMPOSIO = "composio"

const requiredFlags = (schema: unknown): string[] => {
  const s = schema as { properties?: Record<string, { type?: unknown }>; required?: unknown } | null
  if (!s || !Array.isArray(s.required)) return []
  return s.required.filter((k): k is string => typeof k === "string" && s.properties?.[k]?.type === "boolean")
}

/** Models often omit a required boolean that Composio's meta tools accept as false. Learned tools keep theirs: those are the model's choice. */
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

/** Learned tools after the listed ones, with the first of any two that map to the same name, so the prompt prefix stays stable. */
function shown(tools: readonly ComposioTool[]): ComposioTool[] {
  const byName = (a: ComposioTool, b: ComposioTool) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const taken = new Set<string>()
  const fresh = (t: ComposioTool) => {
    const name = toolName(t.name)
    if (taken.has(name)) return false
    taken.add(name)
    return true
  }
  return [...tools.filter((t) => !t.direct).filter(fresh), ...tools.filter((t) => t.direct).sort(byName).filter(fresh)]
}

const learned = (tools: readonly ComposioTool[]) => shown(tools).flatMap((t) => (t.direct ? [toolName(t.name)] : []))

/** Which learned tools a worker can call, so the talker can name one in its task (architecture section 8). */
export function learnedNote(tools: readonly ComposioTool[]): string | undefined {
  const names = learned(tools)
  return names.length ? `connected-app tools a worker can call directly: ${names.join(", ")}.` : undefined
}

export function composioExtension(tools: readonly ComposioTool[], rawCall: ComposioCall, fs?: RoomFs): Extension {
  const limiter = createLimiter(COMPOSIO_MAX_CONCURRENT)
  // Inside the limiter, so the peak counts calls that run together, not calls queued behind it.
  const send: ComposioCall = (n, a) => limiter.run(() => inFlight("composio.peak", () => rawCall(n, a)))
  const names = learned(tools)
  return defineExtension({
    name: COMPOSIO,
    // Composio's search description says to always search first, which would skip learned tools.
    sections: names.length ? [section("composio", () => `connected-app tools you can call directly, no search needed: ${names.join(", ")}.`)] : [],
    tools: shown(tools).map((t) => {
        const name = toolName(t.name)
        const call: ComposioCall = t.readOnly ? (n, a) => withRetry(() => send(n, a)) : send
        const base = t.direct ? `${t.description || t.name} (${t.direct.toolkit} through composio, call it directly)` : `${t.description?.trim() || t.name} (through composio, the human's connected apps)`
        return declareEffect(
          t.readOnly ? "read" : "external",
          defineTool({
            name,
            description: t.name === MULTI_EXECUTE ? `${base} Slow for many tools at once; for more than 3 independent calls, issue separate parallel tool calls instead.` : base,
            parameters: (t.direct ? t.inputSchema : relaxSchema(t.inputSchema)) as never,
            replay: t.readOnly ? "safe" : "unsafe",
            execute: (args) =>
              timed(name, fs, async () => {
                const given = (args ?? {}) as Record<string, unknown>
                if (!t.direct) return call(t.name, fillFlags(t.inputSchema, given))
                const sent = given
                const { text, isError } = directResult(await call(MULTI_EXECUTE, { tools: [{ tool_slug: t.direct.slug, arguments: sent }], sync_response_to_workbench: false, thought: "direct call" }))
                return { content: [{ type: "text" as const, text }], isError }
              }),
          }),
        )
      }),
  })
}

/** Dev stats, spill of big text, and a throw turned into a tool error. */
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
    return { content: [{ type: "text" as const, text: composioErrorText(e) }], isError: true }
  }
}

import type { ComposioCallResult } from "./client"

// A learned tool skips the search and its extra model turns on the next chat, so it is kept
// once a multi-execute of it succeeds.

export type LearnedTool = { slug: string; toolkit: string; description: string; inputSchema: Record<string, unknown>; usedAt: number; readOnly?: boolean }
export type Candidate = Omit<LearnedTool, "usedAt" | "readOnly">

export const SEARCH = "COMPOSIO_SEARCH_TOOLS"
export const SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS"
export const MULTI_EXECUTE = "COMPOSIO_MULTI_EXECUTE_TOOL"
export const LEARNED_MAX = 24

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)

export function resultJson(out: ComposioCallResult): Obj | undefined {
  const block = out.content[0]
  if (block?.type !== "text") return undefined
  try {
    const v = JSON.parse(block.text)
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

export function candidates(body: Obj): Candidate[] {
  const schemas = isObj(body.data) ? body.data.tool_schemas : undefined
  const entries = Array.isArray(schemas) ? schemas : isObj(schemas) ? Object.values(schemas) : []
  return entries.flatMap((e) =>
    isObj(e) && typeof e.tool_slug === "string" && isObj(e.input_schema)
      ? [{ slug: e.tool_slug, toolkit: String(e.toolkit ?? ""), description: String(e.description ?? "").trim(), inputSchema: e.input_schema }]
      : [],
  )
}

function slugsOf(args: Obj, body: Obj | undefined, keep: (response: Obj) => boolean): string[] {
  const sent = Array.isArray(args.tools) ? args.tools : []
  const results = body && isObj(body.data) && Array.isArray(body.data.results) ? body.data.results : []
  return results.flatMap((r, i) => {
    if (!isObj(r) || !isObj(r.response) || !keep(r.response)) return []
    const asked = sent[typeof r.index === "number" ? r.index : i]
    const slug = typeof r.tool_slug === "string" ? r.tool_slug : isObj(asked) ? asked.tool_slug : undefined
    return typeof slug === "string" ? [slug] : []
  })
}

export const succeeded = (args: Obj, body: Obj): string[] => slugsOf(args, body, (r) => r.successful === true)

export function failed(args: Obj, body: Obj | undefined): string[] {
  if (body) return slugsOf(args, body, (r) => r.successful === false)
  const sent = Array.isArray(args.tools) ? args.tools : []
  return sent.flatMap((t) => (isObj(t) && typeof t.tool_slug === "string" ? [t.tool_slug] : []))
}

export const forget = (learned: readonly LearnedTool[], slugs: readonly string[]): LearnedTool[] => learned.filter((t) => !slugs.includes(t.slug))

export function remember(learned: readonly LearnedTool[], used: readonly Candidate[], now: number): LearnedTool[] {
  const fresh = used.map((c) => ({ ...learned.find((t) => t.slug === c.slug), ...c, usedAt: now }))
  const slugs = new Set(fresh.map((t) => t.slug))
  return [...fresh, ...learned.filter((t) => !slugs.has(t.slug))].sort((a, b) => b.usedAt - a.usedAt).slice(0, LEARNED_MAX)
}

export function directResult(out: ComposioCallResult): { text: string; isError: boolean } {
  const body = resultJson(out)
  const result = isObj(body?.data) && Array.isArray(body.data.results) ? body.data.results[0] : undefined
  const response = isObj(result) ? result.response : undefined
  if (out.isError || !isObj(response) || response.successful === false) {
    const error = (isObj(response) && response.error) || (isObj(result) && result.error) || body?.error
    const raw = out.content.map((b) => (b.type === "text" ? b.text : "")).join("\n")
    return { text: error ? (typeof error === "string" ? error : JSON.stringify(error)) : raw || "composio returned no result", isError: true }
  }
  return { text: JSON.stringify(response), isError: false }
}

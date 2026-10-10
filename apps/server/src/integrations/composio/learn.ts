import type { ComposioCallResult } from "./client"

// A Composio tool the agent ran successfully becomes a direct tool, so the next chat skips the
// search and its extra model turns. Candidates come from the schemas a search or schema lookup
// returned; a candidate is learned when a multi-execute of it succeeds.

export type LearnedTool = { slug: string; toolkit: string; description: string; inputSchema: Record<string, unknown>; usedAt: number }
export type Candidate = Omit<LearnedTool, "usedAt">

export const SEARCH = "COMPOSIO_SEARCH_TOOLS"
export const SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS"
export const MULTI_EXECUTE = "COMPOSIO_MULTI_EXECUTE_TOOL"
export const LEARNED_MAX = 24

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)

/** The JSON body of a call's first text block, or undefined. */
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

/** Tools with a full input schema in a search or schema lookup result. */
export function candidates(body: Obj): Candidate[] {
  const schemas = isObj(body.data) ? body.data.tool_schemas : undefined
  const entries = Array.isArray(schemas) ? schemas : isObj(schemas) ? Object.values(schemas) : []
  return entries.flatMap((e) =>
    isObj(e) && typeof e.tool_slug === "string" && isObj(e.input_schema)
      ? [{ slug: e.tool_slug, toolkit: String(e.toolkit ?? ""), description: String(e.description ?? "").trim(), inputSchema: e.input_schema }]
      : [],
  )
}

/** Slugs that ran successfully in a multi-execute. A result names its slug, else its request entry does. */
export function succeeded(args: Obj, body: Obj): string[] {
  const sent = Array.isArray(args.tools) ? args.tools : []
  const results = isObj(body.data) && Array.isArray(body.data.results) ? body.data.results : []
  return results.flatMap((r, i) => {
    if (!isObj(r) || !isObj(r.response) || r.response.successful !== true) return []
    const asked = sent[typeof r.index === "number" ? r.index : i]
    const slug = typeof r.tool_slug === "string" ? r.tool_slug : isObj(asked) ? asked.tool_slug : undefined
    return typeof slug === "string" ? [slug] : []
  })
}

/** `learned` with `used` upserted at `now`, most recent first, at most `LEARNED_MAX`. */
export function remember(learned: readonly LearnedTool[], used: readonly Candidate[], now: number): LearnedTool[] {
  const fresh = used.map((c) => ({ ...c, usedAt: now }))
  const slugs = new Set(fresh.map((t) => t.slug))
  return [...fresh, ...learned.filter((t) => !slugs.has(t.slug))].sort((a, b) => b.usedAt - a.usedAt).slice(0, LEARNED_MAX)
}

/**
 * A search result without what the model does not need: workbench snippets, toolkit blurbs, and
 * the time notice. Plans, pitfalls, schemas, connection statuses, and the session stay.
 */
export function trimSearch(body: Obj): Obj {
  if (!isObj(body.data)) return body
  const d = body.data
  return {
    ...body,
    data: {
      ...d,
      ...(Array.isArray(d.results) ? { results: d.results.map((r) => (isObj(r) ? omit(r, "reference_workbench_snippets") : r)) } : {}),
      ...(Array.isArray(d.toolkit_connection_statuses) ? { toolkit_connection_statuses: d.toolkit_connection_statuses.map((s) => (isObj(s) ? omit(s, "description") : s)) } : {}),
      ...(isObj(d.time_info) ? { time_info: omit(d.time_info, "message") } : {}),
    },
  }
}

function omit(o: Obj, key: string): Obj {
  const { [key]: _, ...rest } = o
  return rest
}

/**
 * The one result of a direct multi-execute, as the model should see it. A failed tool or a failed
 * call is an error with Composio's text.
 */
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

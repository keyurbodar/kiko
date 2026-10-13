// Composio's session MCP server, spoken as plain JSON-RPC over fetch. The user's one project key
// (`ak_...`) creates a session for the user, and the session's MCP url answers `tools/list` and
// `tools/call` with a bare POST: no `initialize` and no `Mcp-Session-Id`. The key goes in `x-api-key`,
// the header Composio documents for a project key, on every request. It is never put in an error or a log.

const API = "https://backend.composio.dev/api/v3.1/"
/** A session url must be on this origin, so the key never goes anywhere else. */
const SESSION_ORIGIN = "https://backend.composio.dev"
export const REJECTED = "Composio rejected this key"

/*
 * Composio has two kinds of key. A Platform project key (`ak_`) makes a session per kiko user on
 * `backend.composio.dev`. A Composio Connect key (`ck_`) is one person's own account: its apps are
 * connected on Composio's side, and its MCP server is one fixed url with no sessions and no catalog.
 */
const CONNECT_URL = "https://connect.composio.dev/mcp"
const isConnectKey = (key: string) => key.startsWith("ck_")

/** What a session request needs: the key and the session's MCP url. */
export type Session = { id: string; url: string }
export type Target = { key: string; url: string }

export type ComposioTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
  /** A learned app tool, run through a one-item multi-execute instead of by its own name. */
  direct?: { slug: string; toolkit: string }
}

export type ComposioResultBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
export type ComposioCallResult = { content: ComposioResultBlock[]; isError?: boolean }
export type ComposioCall = (name: string, args: Record<string, unknown>) => Promise<ComposioCallResult>

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

function retryAfterSeconds(res: Response): number | undefined {
  const seconds = Number(res.headers.get("retry-after"))
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/**
 * The JSON-RPC response with `id` from a response body. An event stream carries it as the `data`
 * of one event; other events and `:` comment lines are skipped.
 */
export function parseRpcResponse(body: string, contentType: string, id: number): unknown {
  const candidates = contentType.includes("text/event-stream") ? eventData(body) : [body]
  for (const data of candidates) {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
    try {
      message = JSON.parse(data)
    } catch {
      continue
    }
    if (message?.id !== id) continue
    if (message.error) throw new ComposioError(`Composio refused the request: ${String(message.error.message ?? "unknown error").slice(0, 300)}`)
    return message.result
  }
  throw new ComposioError("Composio sent no answer")
}

function eventData(body: string): string[] {
  const out: string[] = []
  let data: string[] = []
  const flush = () => {
    if (data.length) out.push(data.join("\n"))
    data = []
  }
  for (const raw of body.split(/\r?\n/)) {
    if (raw === "") flush()
    else if (raw.startsWith("data:")) data.push(raw.slice(raw[5] === " " ? 6 : 5))
  }
  flush()
  return out
}

let nextId = 1

/** True when Composio says the session no longer exists, so a new one is worth one retry. */
export const sessionGone = (e: unknown): boolean => e instanceof ComposioError && (e.status === 404 || e.status === 410)

export async function composioRpc(target: Target, method: string, params: Record<string, unknown>, fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): Promise<unknown> {
  const id = nextId++
  const res = await fetchImpl(target.url, {
    method: "POST",
    headers: {
      [isConnectKey(target.key) ? "x-consumer-api-key" : "x-api-key"]: target.key,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel()
    throw new ComposioError(REJECTED, res.status)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new ComposioError(`Composio answered ${res.status}`, res.status, retryAfterSeconds(res))
  }
  return parseRpcResponse(await res.text(), res.headers.get("content-type") ?? "", id)
}

type ListedTool = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }

export async function listTools(target: Target, fetchImpl?: typeof fetch): Promise<ComposioTool[]> {
  const result = (await composioRpc(target, "tools/list", {}, fetchImpl, 20_000)) as { tools?: ListedTool[] } | undefined
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? (t.inputSchema as Record<string, unknown>) : { type: "object", properties: {} },
    ...(t.annotations?.readOnlyHint ? { readOnly: true } : {}),
  }))
}

type McpBlock = { type: string; text?: string; data?: string; mimeType?: string; [k: string]: unknown }

export async function callTool(target: Target, name: string, args: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<ComposioCallResult> {
  const result = (await composioRpc(target, "tools/call", { name, arguments: args }, fetchImpl)) as { content?: McpBlock[]; isError?: boolean } | undefined
  const content = (result?.content ?? []).map((b): ComposioResultBlock => {
    if (b.type === "text") return { type: "text", text: String(b.text ?? "") }
    if (b.type === "image" && b.data && b.mimeType) return { type: "image", data: b.data, mimeType: b.mimeType }
    return { type: "text", text: JSON.stringify(b) }
  })
  return { content, ...(result?.isError ? { isError: true } : {}) }
}

/** One request to Composio's API with the key. A 401 or 403 is `REJECTED`. */
async function api(key: string, path: string, fetchImpl: typeof fetch, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const res = await fetchImpl(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": key, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return res
  await res.body?.cancel()
  throw new ComposioError(res.status === 401 || res.status === 403 ? REJECTED : `Composio answered ${res.status}`, res.status, retryAfterSeconds(res))
}

/** Throws unless Composio accepts `key`, with the cheapest read it has. */
export async function checkKey(key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (isConnectKey(key)) return void (await listTools({ key, url: CONNECT_URL }, fetchImpl))
  await (await api(key, "toolkits?limit=1", fetchImpl)).body?.cancel()
}

/** A new session for `userId`. Its MCP url must be on Composio's own origin. */
export async function createSession(key: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<Session> {
  if (isConnectKey(key)) return { id: "connect", url: CONNECT_URL }
  const body = (await (await api(key, "tool_router/session", fetchImpl, { method: "POST", body: { user_id: userId } })).json()) as { session_id?: unknown; mcp?: { url?: unknown } }
  const id = body.session_id
  const url = body.mcp?.url
  if (typeof id !== "string" || typeof url !== "string" || new URL(url).origin !== SESSION_ORIGIN) throw new ComposioError("Composio sent no session")
  return { id, url }
}

/** Deletes a session. One that is already gone is not an error. */
export async function deleteSession(key: string, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (isConnectKey(key)) return
  await api(key, `tool_router/session/${encodeURIComponent(id)}`, fetchImpl, { method: "DELETE" }).then(
    (res) => res.body?.cancel(),
    (e) => {
      if (!sessionGone(e)) throw e
    },
  )
}

/** Whether Composio's tool catalog tags `slug` read-only. */
export async function catalogReadOnly(key: string, slug: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  // A Connect key has no catalog access, so its learned tools stay `external`, the safe class.
  if (isConnectKey(key)) return false
  const { tags } = (await (await api(key, `tools/${encodeURIComponent(slug)}`, fetchImpl)).json()) as { tags?: unknown }
  return Array.isArray(tags) && tags.includes("readOnlyHint")
}

/** The learned tools and their classes, sorted so using a tool (which reorders the list) does not reopen agents. */
export const learnedSignature = (tools: readonly ComposioTool[]): string => tools.flatMap((t) => (t.direct ? [`${t.name}${t.readOnly ? ":read" : ""}`] : [])).sort().join(" ")

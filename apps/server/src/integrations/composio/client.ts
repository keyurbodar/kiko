const API = "https://backend.composio.dev/api/v3.1/"
const SESSION_ORIGIN = "https://backend.composio.dev"
export const REJECTED = "Composio rejected this key"

const CONNECT_URL = "https://connect.composio.dev/mcp"
const isConnectKey = (key: string) => key.startsWith("ck_")

export type Session = { id: string; url: string }
export type Target = { key: string; url: string }

export type ComposioTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
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

function parseRpcResponse(body: string, contentType: string, id: number): unknown {
  const candidates = contentType.includes("text/event-stream") ? eventData(body) : [body]
  for (const data of candidates) {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
    try {
      message = JSON.parse(data)
    } catch {
      continue
    }
    if (message?.id !== id) continue
    if (message.error)
      throw new ComposioError(
        `Composio refused the request: ${String(message.error.message ?? "unknown error").slice(0, 300)}`,
      )
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

export const sessionGone = (e: unknown): boolean => e instanceof ComposioError && (e.status === 404 || e.status === 410)

async function composioRpc(
  target: Target,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000,
): Promise<unknown> {
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

type ListedTool = {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean }
}

export async function listTools(target: Target, fetchImpl?: typeof fetch): Promise<ComposioTool[]> {
  const result = (await composioRpc(target, "tools/list", {}, fetchImpl, 20_000)) as
    | { tools?: ListedTool[] }
    | undefined
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    inputSchema:
      t.inputSchema && typeof t.inputSchema === "object"
        ? (t.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {} },
    ...(t.annotations?.readOnlyHint ? { readOnly: true } : {}),
  }))
}

type McpBlock = { type: string; text?: string; data?: string; mimeType?: string; [k: string]: unknown }

export async function callTool(
  target: Target,
  name: string,
  args: Record<string, unknown>,
  fetchImpl?: typeof fetch,
): Promise<ComposioCallResult> {
  const result = (await composioRpc(target, "tools/call", { name, arguments: args }, fetchImpl)) as
    | { content?: McpBlock[]; isError?: boolean }
    | undefined
  const content = (result?.content ?? []).map((b): ComposioResultBlock => {
    if (b.type === "text") return { type: "text", text: String(b.text ?? "") }
    if (b.type === "image" && b.data && b.mimeType) return { type: "image", data: b.data, mimeType: b.mimeType }
    return { type: "text", text: JSON.stringify(b) }
  })
  return { content, ...(result?.isError ? { isError: true } : {}) }
}

async function api(
  key: string,
  path: string,
  fetchImpl: typeof fetch,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const res = await fetchImpl(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": key, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return res
  await res.body?.cancel()
  throw new ComposioError(
    res.status === 401 || res.status === 403 ? REJECTED : `Composio answered ${res.status}`,
    res.status,
    retryAfterSeconds(res),
  )
}

export async function checkKey(key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (isConnectKey(key)) return void (await listTools({ key, url: CONNECT_URL }, fetchImpl))
  await (await api(key, "toolkits?limit=1", fetchImpl)).body?.cancel()
}

const PRELOAD = ["COMPOSIO_SEARCH_WEB", "COMPOSIO_SEARCH_NEWS", "COMPOSIO_SEARCH_FETCH_URL_CONTENT"] as const

export async function createSession(key: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<Session> {
  if (isConnectKey(key)) return { id: "connect", url: CONNECT_URL }
  const body = (await (
    await api(key, "tool_router/session", fetchImpl, {
      method: "POST",
      body: { user_id: userId, preload: { tools: [...PRELOAD] } },
    })
  ).json()) as { session_id?: unknown; mcp?: { url?: unknown } }
  const id = body.session_id
  const url = body.mcp?.url
  if (typeof id !== "string" || typeof url !== "string" || new URL(url).origin !== SESSION_ORIGIN)
    throw new ComposioError("Composio sent no session")
  return { id, url }
}

export async function deleteSession(key: string, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (isConnectKey(key)) return
  await api(key, `tool_router/session/${encodeURIComponent(id)}`, fetchImpl, { method: "DELETE" }).then(
    (res) => res.body?.cancel(),
    (e) => {
      if (!sessionGone(e)) throw e
    },
  )
}

export async function connectedAccounts(
  key: string,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Set<string> | null> {
  if (isConnectKey(key)) return null
  const body = (await (
    await api(key, `connected_accounts?user_ids=${encodeURIComponent(userId)}&statuses=ACTIVE&limit=200`, fetchImpl)
  ).json()) as { items?: { toolkit?: { slug?: unknown } }[] }
  return new Set((body.items ?? []).flatMap((i) => (typeof i.toolkit?.slug === "string" ? [i.toolkit.slug] : [])))
}

export async function resolveToolkit(
  key: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const cleaned = name.trim()
  if (!cleaned) return null
  if (isConnectKey(key)) return cleaned.toLowerCase().replace(/[^a-z0-9]/g, "") || null
  const body = (await (
    await api(key, `toolkits?search=${encodeURIComponent(cleaned)}&limit=10`, fetchImpl)
  ).json()) as { items?: { slug?: unknown; name?: unknown }[] }
  const items = (body.items ?? []).flatMap((i) =>
    typeof i.slug === "string" ? [{ slug: i.slug, name: typeof i.name === "string" ? i.name : "" }] : [],
  )
  if (!items.length) return null
  const squeeze = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
  const want = squeeze(cleaned)
  const exact = items.find((i) => squeeze(i.name) === want || squeeze(i.slug) === want)
  return (exact ?? items[0]!).slug
}

export async function catalogReadOnly(key: string, slug: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (isConnectKey(key)) return false
  const { tags } = (await (await api(key, `tools/${encodeURIComponent(slug)}`, fetchImpl)).json()) as { tags?: unknown }
  return Array.isArray(tags) && tags.includes("readOnlyHint")
}

export const learnedSignature = (tools: readonly ComposioTool[]): string =>
  tools
    .flatMap((t) => (t.direct ? [`${t.name}${t.readOnly ? ":read" : ""}`] : []))
    .sort()
    .join(" ")

// Composio's hosted MCP server, spoken as plain JSON-RPC over fetch. The server is stateless: no
// `initialize` and no `Mcp-Session-Id`, so every request is one POST that answers in an event stream.
// The user's consumer key (`ck_...`) goes in `x-consumer-api-key`, the header Composio documents for it. It is never put in an error or a log.

export const COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp"
export const REJECTED = "Composio rejected this key"

export type ComposioTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  readOnly?: boolean
}

export type ComposioResultBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
export type ComposioCallResult = { content: ComposioResultBlock[]; isError?: boolean }
export type ComposioCall = (name: string, args: Record<string, unknown>) => Promise<ComposioCallResult>

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
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

export async function composioRpc(key: string, method: string, params: Record<string, unknown>, fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): Promise<unknown> {
  const id = nextId++
  const res = await fetchImpl(COMPOSIO_MCP_URL, {
    method: "POST",
    headers: { "x-consumer-api-key": key, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel()
    throw new ComposioError(REJECTED, res.status)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new ComposioError(`Composio answered ${res.status}`, res.status)
  }
  return parseRpcResponse(await res.text(), res.headers.get("content-type") ?? "", id)
}

type ListedTool = { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }

export async function listTools(key: string, fetchImpl?: typeof fetch): Promise<ComposioTool[]> {
  const result = (await composioRpc(key, "tools/list", {}, fetchImpl, 20_000)) as { tools?: ListedTool[] } | undefined
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? (t.inputSchema as Record<string, unknown>) : { type: "object", properties: {} },
    ...(t.annotations?.readOnlyHint ? { readOnly: true } : {}),
  }))
}

type McpBlock = { type: string; text?: string; data?: string; mimeType?: string; [k: string]: unknown }

export async function callTool(key: string, name: string, args: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<ComposioCallResult> {
  const result = (await composioRpc(key, "tools/call", { name, arguments: args }, fetchImpl)) as { content?: McpBlock[]; isError?: boolean } | undefined
  const content = (result?.content ?? []).map((b): ComposioResultBlock => {
    if (b.type === "text") return { type: "text", text: String(b.text ?? "") }
    if (b.type === "image" && b.data && b.mimeType) return { type: "image", data: b.data, mimeType: b.mimeType }
    return { type: "text", text: JSON.stringify(b) }
  })
  return { content, ...(result?.isError ? { isError: true } : {}) }
}

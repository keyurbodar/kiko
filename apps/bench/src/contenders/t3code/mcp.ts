export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface McpCallResult {
  readonly content: readonly unknown[]
  readonly structuredContent: unknown
  readonly isError: boolean
}

export interface McpSession {
  listTools(): Promise<readonly McpTool[]>
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult>
  close(): Promise<void>
}

interface JsonRpcEnvelope {
  readonly jsonrpc?: unknown
  readonly id?: unknown
  readonly method?: unknown
  readonly result?: unknown
  readonly error?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnvelope = (value: unknown): value is JsonRpcEnvelope => isRecord(value)

const decodeEnvelopes = (contentType: string, body: string): readonly JsonRpcEnvelope[] => {
  if (body.trim().length === 0) return []
  if (!contentType.includes("text/event-stream")) {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? parsed.filter(isEnvelope) : isEnvelope(parsed) ? [parsed] : []
  }
  const envelopes: JsonRpcEnvelope[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    const data = line.slice("data:".length).trim()
    if (data.length === 0) continue
    try {
      const parsed: unknown = JSON.parse(data)
      if (isEnvelope(parsed)) envelopes.push(parsed)
    } catch {
      continue
    }
  }
  return envelopes
}

const envelopeError = (error: unknown): string =>
  isRecord(error) && typeof error.message === "string" ? error.message : JSON.stringify(error)

export const connectMcp = async (input: {
  readonly endpoint: string
  readonly authorization: string
  readonly clientName: string
}): Promise<McpSession> => {
  let sessionId: string | undefined
  let protocolVersion: string | undefined
  let nextId = 1
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: input.authorization,
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
    ...(protocolVersion === undefined ? {} : { "mcp-protocol-version": protocolVersion }),
  })

  const post = async (body: unknown, signal?: AbortSignal): Promise<readonly JsonRpcEnvelope[]> => {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
    const newSessionId = response.headers.get("mcp-session-id")
    if (newSessionId !== null) sessionId = newSessionId
    if (response.status === 202) return []
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`t3code MCP responded ${response.status}: ${text.slice(0, 400)}`)
    }
    const envelopes = decodeEnvelopes(response.headers.get("content-type") ?? "", text)
    for (const envelope of envelopes) {
      if (isRecord(envelope.result) && typeof envelope.result.protocolVersion === "string") {
        protocolVersion = envelope.result.protocolVersion
      }
    }
    return envelopes
  }

  const request = async (method: string, params: unknown, signal?: AbortSignal): Promise<unknown> => {
    const id = nextId++
    const envelopes = await post({ jsonrpc: "2.0", id, method, params }, signal)
    const envelope = envelopes.find((candidate) => candidate.id === id)
    if (envelope === undefined) throw new Error(`t3code MCP ${method} returned no response`)
    if (envelope.error !== undefined) throw new Error(`t3code MCP ${method}: ${envelopeError(envelope.error)}`)
    return envelope.result
  }

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: input.clientName, version: "0.0.0" },
  })
  await post({ jsonrpc: "2.0", method: "notifications/initialized" })

  return {
    listTools: async () => {
      const result = await request("tools/list", {})
      const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : []
      return tools.filter(isRecord).flatMap((tool) =>
        typeof tool.name === "string"
          ? [
              {
                name: tool.name,
                description: typeof tool.description === "string" ? tool.description : "",
                inputSchema: tool.inputSchema,
              },
            ]
          : [],
      )
    },
    callTool: async (name, args, signal) => {
      const result = await request("tools/call", { name, arguments: args }, signal)
      const record = isRecord(result) ? result : {}
      return {
        content: Array.isArray(record.content) ? record.content : [],
        structuredContent: record.structuredContent,
        isError: record.isError === true,
      }
    },
    close: async () => {
      await fetch(input.endpoint, { method: "DELETE", headers: headers() }).catch(() => undefined)
    },
  }
}

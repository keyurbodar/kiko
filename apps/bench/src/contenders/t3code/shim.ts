import { Socket } from "node:net"
import { createInterface } from "node:readline"

export interface RelayPayload {
  readonly token: string
  readonly endpoint: string
  readonly authorization: string
}

interface JsonRpcMessage {
  readonly jsonrpc?: unknown
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseMessage = (line: string): JsonRpcMessage | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  return isRecord(parsed) ? parsed : undefined
}

const response = (id: unknown, result: unknown): unknown => ({ jsonrpc: "2.0", id, result })

const failure = (id: unknown, code: number, message: string): unknown => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
})

export const acpReply = (line: string): unknown | undefined => {
  const message = parseMessage(line)
  if (message === undefined || typeof message.method !== "string") return undefined
  if (message.id === undefined) return undefined
  switch (message.method) {
    case "initialize":
      return response(message.id, {
        protocolVersion: 1,
        agentInfo: { name: "kiko-bench-t3code-shim", version: "1.0.0" },
        agentCapabilities: {},
      })
    case "authenticate":
      return response(message.id, {})
    case "session/new":
      return response(message.id, {
        sessionId: `bench-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
      })
    case "session/prompt":
      return response(message.id, { stopReason: "end_turn" })
    case "session/set_mode":
    case "session/set_model":
      return response(message.id, {})
    case "session/set_config_option":
      return response(message.id, { configOptions: [] })
    default:
      return failure(message.id, -32601, `Method not found: ${message.method}`)
  }
}

export const relayPayload = (env: Readonly<Record<string, string | undefined>>): RelayPayload | undefined => {
  const relay = env.KIKO_BENCH_RELAY
  const token = env.KIKO_BENCH_RELAY_TOKEN
  const endpoint = env.T3_ACP_MCP_ENDPOINT
  const authorization = env.T3_ACP_MCP_AUTHORIZATION
  if (!relay || !token || !endpoint || !authorization) return undefined
  return { token, endpoint, authorization }
}

const sendRelay = (socket: Socket, payload: RelayPayload): void => {
  socket.write(`${JSON.stringify(payload)}\n`, () => socket.end())
}

const relay = (payload: RelayPayload, address: string): void => {
  const separator = address.lastIndexOf(":")
  const host = address.slice(0, separator)
  const port = Number(address.slice(separator + 1))
  if (host.length === 0 || !Number.isInteger(port)) return
  const connection = new Socket()
  connection.on("error", () => undefined)
  connection.connect(port, host, () => sendRelay(connection, payload))
}

const main = (): void => {
  const payload = relayPayload(process.env)
  const address = process.env.KIKO_BENCH_RELAY
  if (payload !== undefined && address !== undefined) relay(payload, address)
  const lines = createInterface({ input: process.stdin })
  lines.on("line", (line) => {
    const reply = acpReply(line)
    if (reply !== undefined) process.stdout.write(`${JSON.stringify(reply)}\n`)
  })
}

if (import.meta.main) main()

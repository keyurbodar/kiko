import { createServer, type Socket } from "node:net"

export interface FakeDesktop {
  readonly socket: string
  close(): Promise<void>
}

const WINDOWS = "2 windows\n1: Fixture — a demo window\n2: Terminal"
const TOOLS = [
  {
    name: "list_windows",
    description: "list the top-level windows on this desktop",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_window_state",
    description: "read one window and return its text and a picture",
    inputSchema: { type: "object", properties: { window_id: { type: "integer" } }, required: ["window_id"] },
  },
]

const status = {
  version: "fake-desktop-1",
  os: process.platform === "darwin" ? "macos" : "linux",
  session: "bench",
  permissions: { accessibility: "granted", screen: "granted", automation: "granted" },
  browsers: [],
  displays: [{ id: "1", width: 1280, height: 800, scale: 1 }],
}

function answer(id: unknown, call: { method?: unknown; params?: unknown }): unknown {
  if (call.method === "status") return { id, ok: true, value: status }
  if (call.method === "desktop.tools") return { id, ok: true, value: { version: "fake-desktop-1", tools: TOOLS } }
  if (call.method === "desktop.call") {
    const params =
      typeof call.params === "object" && call.params !== null ? (call.params as Record<string, unknown>) : {}
    if (params.name === "list_windows") return { id, ok: true, value: { content: [{ type: "text", text: WINDOWS }] } }
    if (params.name === "get_window_state")
      return { id, ok: true, value: { content: [{ type: "text", text: "window 1: Fixture" }] } }
    return { id, ok: false, error: { code: "unsupported", message: `no desktop tool called ${String(params.name)}` } }
  }
  return { id, ok: false, error: { code: "unsupported", message: `no method called ${String(call.method)}` } }
}

function serve(connection: Socket): void {
  let buffer = ""
  connection.setEncoding("utf8")
  connection.on("data", (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf("\n")
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf("\n")
      if (!line) continue
      let call: { id?: unknown; method?: unknown; params?: unknown }
      try {
        call = JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown }
      } catch {
        continue
      }
      connection.write(`${JSON.stringify(answer(call.id, call))}\n`)
    }
  })
  connection.on("error", () => undefined)
}

export function startFakeDesktop(socket: string): Promise<FakeDesktop> {
  const server = createServer(serve)
  return new Promise((resolve) => {
    server.listen(socket, () => resolve({ socket, close: () => new Promise((done) => server.close(() => done())) }))
  })
}

import { createServer, type Server } from "node:http"
import { describe, expect, it } from "vitest"

import { connectMcp } from "./mcp"

interface FakeRequest {
  readonly method: string
  readonly authorization: string | undefined
  readonly sessionId: string | undefined
  readonly body: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const startFakeServer = async (): Promise<{
  readonly endpoint: string
  readonly requests: FakeRequest[]
  close(): Promise<void>
}> => {
  const requests: FakeRequest[] = []
  const server: Server = createServer((request, response) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      body += chunk
    })
    request.on("end", () => {
      const sessionHeader = request.headers["mcp-session-id"]
      requests.push({
        method: request.method ?? "",
        authorization: request.headers.authorization,
        sessionId: typeof sessionHeader === "string" ? sessionHeader : undefined,
        body,
      })
      if (request.method === "DELETE") {
        response.writeHead(200).end()
        return
      }
      const message: unknown = JSON.parse(body)
      const id = isRecord(message) ? message.id : undefined
      if (id === undefined) {
        response.writeHead(202).end()
        return
      }
      const method = isRecord(message) ? message.method : undefined
      if (method === "initialize") {
        response
          .writeHead(200, { "content-type": "application/json", "mcp-session-id": "session-1" })
          .end(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18" } }))
        return
      }
      if (method === "tools/list") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { tools: [{ name: "preview_open", description: "open", inputSchema: {} }] },
          }),
        )
        return
      }
      response.writeHead(200, { "content-type": "text/event-stream" }).end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "clicked" }], isError: false },
        })}\n\n`,
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("fake server did not bind")
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

describe("MCP client", () => {
  it("initializes, reuses the session id, lists tools and reads SSE call results", async () => {
    const fake = await startFakeServer()
    try {
      const session = await connectMcp({
        endpoint: fake.endpoint,
        authorization: "Bearer test",
        clientName: "kiko-bench",
      })
      const tools = await session.listTools()
      expect(tools).toEqual([{ name: "preview_open", description: "open", inputSchema: {} }])
      const result = await session.callTool("preview_act", { action: "click" })
      expect(result).toEqual({
        content: [{ type: "text", text: "clicked" }],
        structuredContent: undefined,
        isError: false,
      })
      await session.close()

      expect(fake.requests.map((entry) => entry.method)).toEqual(["POST", "POST", "POST", "POST", "DELETE"])
      expect(fake.requests.every((entry) => entry.authorization === "Bearer test")).toBe(true)
      expect(fake.requests.slice(1, 4).every((entry) => entry.sessionId === "session-1")).toBe(true)
      expect(fake.requests[4]?.body).toBe("")
    } finally {
      await fake.close()
    }
  })
})

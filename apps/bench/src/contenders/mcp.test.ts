import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { McpServer } from "./mcp"

const FAKE_SERVER = `
const readline = require("node:readline")
const rl = readline.createInterface({ input: process.stdin })
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
const tools = [
  { name: "echo", description: "Echo text", inputSchema: { type: "object" } },
  { name: "image", description: "Return an image", inputSchema: { type: "object" } },
  { name: "fail", description: "Fail", inputSchema: { type: "object" } },
]
rl.on("line", (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } })
    return
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } })
    return
  }
  if (message.method === "tools/call") {
    const name = message.params.name
    if (name === "echo") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: message.params.arguments.text }] } })
      return
    }
    if (name === "image") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            { type: "text", text: "shot" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        },
      })
      return
    }
    send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "boom" }] } })
    return
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } })
})
`

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function fakeServer(): Promise<McpServer> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-bench-mcp-"))
  const path = join(dir, "server.cjs")
  await writeFile(path, FAKE_SERVER)
  const server = await McpServer.start({
    command: process.execPath,
    args: [path],
    clientName: "kiko-bench-test",
  })
  cleanups.push(async () => {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  })
  return server
}

describe("McpServer", () => {
  it("lists tools and maps text, image and error results", async () => {
    const server = await fakeServer()
    const signal = new AbortController().signal

    expect(server.tools().map((tool) => tool.name)).toEqual(["echo", "image", "fail"])

    const echo = await server.call("echo", { text: "hello" }, signal)
    expect(echo).toEqual({ text: "hello", images: [], isError: false })

    const image = await server.call("image", {}, signal)
    expect(image.text).toBe("shot")
    expect(image.images).toEqual([{ mime: "image/png", base64: "AAAA" }])
    expect(image.isError).toBe(false)

    const fail = await server.call("fail", {}, signal)
    expect(fail).toEqual({ text: "boom", images: [], isError: true })
  })
})

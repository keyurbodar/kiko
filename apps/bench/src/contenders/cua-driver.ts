import { connect } from "node:net"
import { join } from "node:path"
import type { Condition, Contender, Machine, ToolResult, ToolSpec, Track } from "../types"
import { McpServer } from "./mcp"

const BINARY_ENV = "KIKO_BENCH_CUA_DRIVER"
const SOCKET_TIMEOUT_MS = 30_000

function accepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const settle = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once("connect", () => settle(true))
    socket.once("error", () => settle(false))
  })
}

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await accepts(path)) return
    if (Date.now() >= deadline) throw new Error(`cua-driver daemon socket ${path} did not accept connections`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function versionOf(stdout: string): string {
  return stdout.trim().split(/\s+/).pop() ?? stdout.trim()
}

export class CuaDriverContender implements Contender {
  readonly name = "cua-driver"
  readonly tracks: readonly Track[] = ["desktop", "mixed"]
  #version = ""
  #server: McpServer | undefined
  #daemon: { pid: number; stop(): Promise<void> } | undefined

  get version(): string {
    return this.#version
  }

  async start(m: Machine, _condition: Condition): Promise<void> {
    const binary = process.env[BINARY_ENV] ?? "cua-driver"
    this.#version = versionOf((await m.exec([binary, "--version"])).stdout)
    this.#server = m.os === "macos" ? await this.#startEmbedded(m, binary) : await this.#startStandalone(binary)
  }

  tools(): readonly ToolSpec[] {
    return (this.#server?.tools() ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }))
  }

  async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    if (!this.#server) throw new Error("cua-driver is not started")
    return this.#server.call(name, args, signal)
  }

  async stop(): Promise<void> {
    await this.#server?.close()
    this.#server = undefined
    await this.#daemon?.stop()
    this.#daemon = undefined
  }

  async #startStandalone(binary: string): Promise<McpServer> {
    return McpServer.start({ command: binary, args: ["mcp"], clientName: "kiko-bench" })
  }

  async #startEmbedded(m: Machine, binary: string): Promise<McpServer> {
    const socket = join(m.workdir, "cua-driver.sock")
    const env = { CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_PERMISSION_MODE: "standard" }
    this.#daemon = await m.spawn([binary, "serve", "--embedded", "--socket", socket], { env })
    await waitForSocket(socket, SOCKET_TIMEOUT_MS)
    return McpServer.start({
      command: binary,
      args: ["mcp", "--embedded", "--socket", socket],
      env: { CUA_DRIVER_EMBEDDED: "1" },
      clientName: "kiko-bench",
    })
  }
}

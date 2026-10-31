import type { Condition, Contender, Machine, ToolResult, ToolSpec, Track } from "../types"
import { McpServer } from "./mcp"

const BINARY_ENV = "KIKO_BENCH_AGENT_BROWSER"
let sessions = 0

function versionOf(stdout: string): string {
  return stdout.trim().split(/\s+/).pop() ?? stdout.trim()
}

export class AgentBrowserContender implements Contender {
  readonly name = "agent-browser"
  readonly tracks: readonly Track[] = ["browser", "mixed"]
  #version = ""
  #server: McpServer | undefined

  get version(): string {
    return this.#version
  }

  async start(m: Machine, _condition: Condition): Promise<void> {
    const binary = process.env[BINARY_ENV] ?? "agent-browser"
    this.#version = versionOf((await m.exec([binary, "--version"])).stdout)
    sessions += 1
    this.#server = await McpServer.start({
      command: binary,
      args: ["mcp"],
      clientName: "kiko-bench",
      protocolVersion: "2025-06-18",
      env: { AGENT_BROWSER_SESSION: `kiko-bench-${process.pid}-${sessions}` },
    })
  }

  tools(): readonly ToolSpec[] {
    return (this.#server?.tools() ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }))
  }

  async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    if (!this.#server) throw new Error("agent-browser is not started")
    return this.#server.call(name, args, signal)
  }

  async stop(): Promise<void> {
    await this.#server?.close()
    this.#server = undefined
  }
}

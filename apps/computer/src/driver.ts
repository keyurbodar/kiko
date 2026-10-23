import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { accessSync, constants } from "node:fs"
import { join } from "node:path"

export type DriverTool = { name: string; schema: Record<string, unknown> }

export type DriverResult = {
  isError: boolean
  text: string
  image: { mime: string; base64: string } | null
  structured: Record<string, unknown>
}

export type DriverHandle = {
  tools: Map<string, DriverTool>
  call(name: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<DriverResult>
  close(): Promise<void>
}

const DRIVER_TIMEOUT_MS = 30_000

const DRIVER_NAMES = ["cua-driver", "cua-driver.exe"] as const

export function findDriver(dir: string): string | null {
  for (const name of DRIVER_NAMES) {
    const local = join(dir, name)
    try {
      accessSync(local, constants.X_OK)
      return local
    } catch {}
  }
  return Bun.which("cua-driver")
}

type Part = { type?: string; text?: string; mimeType?: string; data?: string }

function textOf(content: readonly Part[]): string {
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
}

function imageOf(content: readonly Part[]): { mime: string; base64: string } | null {
  for (const part of content) {
    if (part.type === "image" && typeof part.data === "string") {
      return { mime: part.mimeType ?? "image/png", base64: part.data }
    }
  }
  return null
}

function toDriverResult(result: { content?: unknown; structuredContent?: unknown; isError?: boolean }): DriverResult {
  const content = Array.isArray(result.content) ? (result.content as Part[]) : []
  const structured =
    typeof result.structuredContent === "object" && result.structuredContent !== null
      ? (result.structuredContent as Record<string, unknown>)
      : {}
  return { isError: result.isError === true, text: textOf(content), image: imageOf(content), structured }
}

export async function connectDriver(binary: string): Promise<DriverHandle> {
  const transport = new StdioClientTransport({ command: binary, args: ["mcp"], stderr: "ignore" })
  const client = new Client({ name: "kiko-computer", version: "0" }, { capabilities: {} })
  await client.connect(transport)
  const listed = await client.listTools()
  const tools = new Map<string, DriverTool>(
    listed.tools.map((tool) => [
      tool.name,
      { name: tool.name, schema: (tool.inputSchema ?? {}) as Record<string, unknown> },
    ]),
  )
  await enableAgentCursor(client, tools)
  return {
    tools,
    async call(name, args, timeoutMs, signal) {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: Math.max(1000, Math.min(timeoutMs, DRIVER_TIMEOUT_MS)),
        signal,
      })
      return toDriverResult(result as Parameters<typeof toDriverResult>[0])
    },
    async close() {
      await client.close()
    },
  }
}

async function enableAgentCursor(client: Client, tools: Map<string, DriverTool>): Promise<void> {
  if (!tools.has("set_agent_cursor_enabled")) return
  await client
    .callTool({ name: "set_agent_cursor_enabled", arguments: { enabled: false } }, undefined, { timeout: 5000 })
    .catch(() => undefined)
}

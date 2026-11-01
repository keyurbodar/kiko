import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { Readable } from "node:stream"
import type { Image, ToolResult } from "../types"

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface McpServerOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly clientName: string
  readonly protocolVersion?: string
  readonly timeoutMs?: number
}

class McpError extends Error {}

type RpcMessage = {
  readonly id?: number | string
  readonly method?: string
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

type Pending = {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

const DEFAULT_TIMEOUT_MS = 120_000
const SHUTDOWN_MS = 3000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseMessage(line: string): RpcMessage | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? (value as RpcMessage) : undefined
  } catch {
    return undefined
  }
}

function toImage(item: Record<string, unknown>): Image | undefined {
  if (item.type !== "image" || typeof item.data !== "string") return undefined
  if (item.mimeType === "image/png" || item.mimeType === "image/jpeg") {
    return { mime: item.mimeType, base64: item.data }
  }
  return undefined
}

function toText(item: Record<string, unknown>): string | undefined {
  return item.type === "text" && typeof item.text === "string" ? item.text : undefined
}

function mapToolResult(result: unknown): ToolResult {
  const record = isRecord(result) ? result : {}
  const content = Array.isArray(record.content) ? record.content : []
  const texts: string[] = []
  const images: Image[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const text = toText(item)
    if (text !== undefined) texts.push(text)
    const image = toImage(item)
    if (image) images.push(image)
  }
  if (texts.length === 0 && record.structuredContent !== undefined) {
    texts.push(JSON.stringify(record.structuredContent))
  }
  return { text: texts.join("\n"), images, isError: record.isError === true }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class McpServer {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, Pending>()
  readonly #tools: McpTool[] = []
  readonly #timeoutMs: number
  readonly #outputClosed: Promise<void>
  #buffer = ""
  #stderr = ""
  #nextId = 1
  #closed = false

  private constructor(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
    this.#child = child
    this.#timeoutMs = timeoutMs
    this.#outputClosed = this.#pump(child.stdout)
    void this.#pumpStderr(child.stderr)
    void this.#outputClosed.then(() => this.#failPending(new McpError(`server closed: ${this.#stderr.trim()}`)))
  }

  static async start(options: McpServerOptions): Promise<McpServer> {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const server = new McpServer(child, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    await server.#initialize(options)
    await server.#loadTools()
    return server
  }

  tools(): readonly McpTool[] {
    return this.#tools
  }

  async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    const result = await this.#request("tools/call", { name, arguments: args }, signal)
    return mapToolResult(result)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#child.stdin.end()
    await Promise.race([this.#outputClosed, pause(SHUTDOWN_MS)])
    this.#child.kill("SIGTERM")
    this.#failPending(new McpError("server closed"))
  }

  async #pump(stream: Readable): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of stream) this.#receive(decoder.decode(chunk as Uint8Array, { stream: true }))
    } catch (error) {
      this.#stderr = `${this.#stderr}${error instanceof Error ? error.message : String(error)}`.slice(-8192)
    }
  }

  async #pumpStderr(stream: Readable): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for await (const chunk of stream) {
        this.#stderr = `${this.#stderr}${decoder.decode(chunk as Uint8Array, { stream: true })}`.slice(-8192)
      }
    } catch {
      return
    }
  }

  async #initialize(options: McpServerOptions): Promise<void> {
    await this.#request("initialize", {
      protocolVersion: options.protocolVersion ?? "2025-06-18",
      capabilities: {},
      clientInfo: { name: options.clientName, version: "0.0.0" },
    })
    this.#write({ jsonrpc: "2.0", method: "notifications/initialized" })
  }

  async #loadTools(): Promise<void> {
    let cursor: string | undefined
    do {
      const result = await this.#request("tools/list", cursor ? { cursor } : {})
      const record = isRecord(result) ? result : {}
      const tools = Array.isArray(record.tools) ? record.tools : []
      for (const tool of tools) {
        if (!isRecord(tool) || typeof tool.name !== "string") continue
        this.#tools.push({
          name: tool.name,
          description: typeof tool.description === "string" ? tool.description : "",
          inputSchema: tool.inputSchema,
        })
      }
      cursor = typeof record.nextCursor === "string" ? record.nextCursor : undefined
    } while (cursor)
  }

  #request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      if (this.#closed) {
        reject(new McpError(`server closed before ${method}`))
        return
      }
      let done = false
      let timer: ReturnType<typeof setTimeout>
      let onAbort: () => void
      const finish = (error?: Error, value?: unknown) => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        this.#pending.delete(id)
        if (error) reject(error)
        else resolve(value)
      }
      onAbort = () => finish(new McpError(`${method} aborted`))
      timer = setTimeout(() => finish(new McpError(`${method} timed out after ${this.#timeoutMs}ms`)), this.#timeoutMs)
      signal?.addEventListener("abort", onAbort, { once: true })
      this.#pending.set(id, {
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
      })
      this.#write({ jsonrpc: "2.0", id, method, params })
    })
  }

  #write(message: unknown): void {
    if (this.#child.stdin.destroyed) return
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #receive(chunk: string): void {
    this.#buffer += chunk
    const lines = this.#buffer.split("\n")
    this.#buffer = lines.pop() ?? ""
    for (const line of lines) {
      const message = parseMessage(line.trim())
      if (message) this.#dispatch(message)
    }
  }

  #dispatch(message: RpcMessage): void {
    if (typeof message.id !== "number") return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    if (message.error) {
      pending.reject(new McpError(`${message.error.code}: ${message.error.message}`))
      return
    }
    pending.resolve(message.result)
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

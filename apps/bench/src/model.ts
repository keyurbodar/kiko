const DEFAULT_BASE_URL = "https://opencode.ai/inference/go/openai/v1"
const CHAT_PATH = "/chat/completions"

export type ChatPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } }

export type ChatContent = string | readonly ChatPart[]

export interface RawToolCall {
  readonly id: string
  readonly type: "function"
  readonly function: { readonly name: string; readonly arguments: string }
}

export type ChatMessage =
  | { readonly role: "system" | "user"; readonly content: ChatContent }
  | {
      readonly role: "assistant"
      readonly content: string | null
      readonly tool_calls?: readonly RawToolCall[]
      readonly reasoning_content?: string
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: ChatContent }

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

export interface ModelUsage {
  readonly prompt: number
  readonly cached: number
  readonly completion: number
  readonly reasoning: number
  readonly cost: number
  readonly listCost: number
}

export interface ModelReply {
  readonly content: string
  readonly reasoning: string
  readonly toolCalls: readonly RawToolCall[]
  readonly usage: ModelUsage
  readonly finishReason: string | null
  readonly latencyMs: number
  readonly ttftMs: number
  readonly raw: unknown
}

export interface ChatRequest {
  readonly model: string
  readonly messages: readonly ChatMessage[]
  readonly tools: readonly ToolDefinition[]
  readonly session: string
  readonly effort?: "low" | "medium" | "high"
  readonly signal?: AbortSignal
}

export class ModelError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = "ModelError"
    this.status = status
  }
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>

export interface ModelClientOptions {
  readonly key: string
  readonly baseUrl?: string
  readonly version: string
  readonly streaming?: boolean
  readonly fetch?: Fetcher
}

type Bag = Record<string, unknown>

const bag = (value: unknown): Bag => (typeof value === "object" && value !== null ? (value as Bag) : {})

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0)

const str = (value: unknown): string => (typeof value === "string" ? value : "")

function firstChoice(raw: unknown): Bag {
  const choices = bag(raw).choices
  return Array.isArray(choices) ? bag(choices[0]) : {}
}

function usageOf(raw: unknown): ModelUsage {
  const usage = bag(bag(raw).usage)
  const opencode = bag(usage.opencode)
  const tokens = bag(opencode.tokens)
  const details = bag(usage.completion_tokens_details)
  const promptDetails = bag(usage.prompt_tokens_details)
  const cost = num(usage.cost)
  const listCost = num(opencode.list_cost)
  return {
    prompt: num(usage.prompt_tokens),
    cached: num(promptDetails.cached_tokens) || num(tokens.cache_read),
    completion: num(usage.completion_tokens),
    reasoning: num(details.reasoning_tokens) || num(tokens.reasoning),
    cost: cost !== 0 ? cost : listCost,
    listCost: listCost !== 0 ? listCost : cost,
  }
}

function toolCallsOf(message: Bag): RawToolCall[] {
  const calls = message.tool_calls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call) => {
    const entry = bag(call)
    const fn = bag(entry.function)
    if (typeof entry.id !== "string" || typeof fn.name !== "string") return []
    return [
      {
        id: entry.id,
        type: "function" as const,
        function: { name: fn.name, arguments: str(fn.arguments) || "{}" },
      },
    ]
  })
}

export class ModelClient {
  private readonly key: string
  private readonly url: string
  private readonly version: string
  private readonly streaming: boolean
  private readonly send: Fetcher

  constructor(options: ModelClientOptions) {
    this.key = options.key
    this.url = `${options.baseUrl ?? DEFAULT_BASE_URL}${CHAT_PATH}`
    this.version = options.version
    this.streaming = options.streaming ?? true
    this.send = options.fetch ?? ((input, init) => fetch(input, init))
  }

  async chat(request: ChatRequest): Promise<ModelReply> {
    const body = {
      model: request.model,
      messages: request.messages,
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...(request.effort ? { reasoning_effort: request.effort } : {}),
      ...(this.streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
    }
    const started = performance.now()
    const response = await this.send(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        "user-agent": `kiko-bench/${this.version}`,
        "x-opencode-session": request.session,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ModelError(`the model answered ${response.status}: ${text.slice(0, 500)}`, response.status)
    }
    const type = response.headers.get("content-type") ?? ""
    if (type.includes("text/event-stream") && response.body !== null) return this.readStream(response.body, started)
    return this.readJson(response, started)
  }

  private async readJson(response: Response, started: number): Promise<ModelReply> {
    const text = await response.text()
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new ModelError(`the model answered with invalid JSON: ${text.slice(0, 500)}`, response.status)
    }
    const latencyMs = performance.now() - started
    const choice = firstChoice(raw)
    const message = bag(choice.message)
    return {
      content: str(message.content),
      reasoning: str(message.reasoning_content),
      toolCalls: toolCallsOf(message),
      usage: usageOf(raw),
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
      latencyMs,
      ttftMs: latencyMs,
      raw,
    }
  }

  private async readStream(stream: ReadableStream<Uint8Array>, started: number): Promise<ModelReply> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const calls = new Map<number, { id: string; name: string; arguments: string }>()
    let pending = ""
    let content = ""
    let reasoning = ""
    let finishReason: string | null = null
    let usage: ModelUsage = { prompt: 0, cached: 0, completion: 0, reasoning: 0, cost: 0, listCost: 0 }
    let ttftMs = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split("\n")
        pending = lines.pop() ?? ""
        for (const line of lines) {
          const event = streamEvent(line)
          if (event === undefined) continue
          if (event === DONE_EVENT) return this.reply(content, reasoning, calls, usage, finishReason, started, ttftMs)
          const chunk = event
          if (bag(chunk).error !== undefined)
            throw new ModelError(`the model stream failed: ${JSON.stringify(bag(chunk).error).slice(0, 500)}`)
          if (bag(chunk).usage !== undefined && bag(chunk).usage !== null) usage = usageOf(chunk)
          const choice = firstChoice(chunk)
          if (Object.keys(choice).length === 0) continue
          const delta = bag(choice.delta)
          const pieces = deltaPieces(delta)
          if (ttftMs === 0 && pieces.length > 0) ttftMs = performance.now() - started
          content += str(delta.content)
          reasoning += str(delta.reasoning_content) || str(delta.reasoning)
          for (const part of toolCallParts(delta)) accumulateCall(calls, part)
          if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason
        }
      }
    } finally {
      reader.releaseLock()
    }
    return this.reply(content, reasoning, calls, usage, finishReason, started, ttftMs)
  }

  private reply(
    content: string,
    reasoning: string,
    calls: Map<number, { id: string; name: string; arguments: string }>,
    usage: ModelUsage,
    finishReason: string | null,
    started: number,
    ttftMs: number,
  ): ModelReply {
    const latencyMs = performance.now() - started
    return {
      content,
      reasoning,
      toolCalls: [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call], index) => ({
          id: call.id || `call-${index + 1}`,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments || "{}" },
        })),
      usage,
      finishReason,
      latencyMs,
      ttftMs: ttftMs === 0 ? latencyMs : ttftMs,
      raw: null,
    }
  }
}

const DONE_EVENT = Symbol("done")

function streamEvent(line: string): unknown | typeof DONE_EVENT | undefined {
  if (!line.startsWith("data:")) return undefined
  const data = line.slice("data:".length).trim()
  if (!data) return undefined
  if (data === "[DONE]") return DONE_EVENT
  try {
    return JSON.parse(data) as unknown
  } catch {
    return undefined
  }
}

function deltaPieces(delta: Bag): string[] {
  const pieces: string[] = []
  for (const key of ["content", "reasoning_content", "reasoning"] as const) {
    const value = delta[key]
    if (typeof value === "string" && value.length > 0) pieces.push(value)
  }
  const calls = delta.tool_calls
  if (Array.isArray(calls) && calls.length > 0) pieces.push("tool_calls")
  return pieces
}

function toolCallParts(delta: Bag): { index: number; id: string; name: string; arguments: string }[] {
  const calls = delta.tool_calls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call, position) => {
    const entry = bag(call)
    const fn = bag(entry.function)
    return [
      {
        index: typeof entry.index === "number" ? entry.index : position,
        id: str(entry.id),
        name: str(fn.name),
        arguments: str(fn.arguments),
      },
    ]
  })
}

function accumulateCall(
  calls: Map<number, { id: string; name: string; arguments: string }>,
  part: { index: number; id: string; name: string; arguments: string },
): void {
  const held = calls.get(part.index) ?? { id: "", name: "", arguments: "" }
  calls.set(part.index, {
    id: held.id || part.id,
    name: held.name || part.name,
    arguments: held.arguments + part.arguments,
  })
}

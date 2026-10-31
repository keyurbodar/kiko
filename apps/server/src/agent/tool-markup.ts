import {
  type AssistantMessage,
  type AssistantMessageEvent,
  getCurrentTools,
  type TranscriptContext as Context,
  createAssistantMessageEventStream,
  type Provider,
  type ToolCall,
} from "@earendil-works/pi-ai"

type TextCall = { name: string; args: Record<string, string> }

type Family = {
  open: RegExp
  close: RegExp
  calls?: (inner: string) => TextCall[]
}

const NS = String.raw`(?:[\w-]+:)?`
const attr = String.raw`\s+name\s*=\s*["']([^"']+)["']`

function invokes(inner: string): TextCall[] {
  const out: TextCall[] = []
  for (const m of inner.matchAll(
    new RegExp(String.raw`<${NS}invoke${attr}[^>]*>([\s\S]*?)(?:</${NS}invoke>|$)`, "g"),
  )) {
    const args: Record<string, string> = {}
    for (const p of (m[2] ?? "").matchAll(
      new RegExp(String.raw`<${NS}parameter${attr}[^>]*>([\s\S]*?)</${NS}parameter>`, "g"),
    ))
      args[p[1] ?? ""] = p[2] ?? ""
    out.push({ name: m[1] ?? "", args })
  }
  return out
}

const jsonCall = (text: string): TextCall[] => {
  try {
    const value = JSON.parse(text.trim()) as { name?: unknown; arguments?: unknown; parameters?: unknown }
    const raw = value.arguments ?? value.parameters ?? {}
    const args =
      typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>)
    if (typeof value.name !== "string") return []
    return [
      {
        name: value.name,
        args: Object.fromEntries(
          Object.entries(args).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
        ),
      },
    ]
  } catch {
    return []
  }
}

function hermes(inner: string): TextCall[] {
  const named = /<function=([^>\s]+)>([\s\S]*)/.exec(inner)
  if (!named) return jsonCall(inner)
  const args: Record<string, string> = {}
  for (const p of (named[2] ?? "").matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g))
    args[p[1] ?? ""] = (p[2] ?? "").replace(/^\n|\n$/g, "")
  return [{ name: named[1] ?? "", args }]
}

function kimi(inner: string): TextCall[] {
  const out: TextCall[] = []
  for (const m of inner.matchAll(
    /<\|tool_call_begin\|>\s*([^<]*?)\s*<\|tool_call_argument_begin\|>([\s\S]*?)(?:<\|tool_call_end\|>|$)/g,
  )) {
    const call = jsonCall(
      `{"name":${JSON.stringify((m[1] ?? "").replace(/^functions\./, "").replace(/:\d+$/, ""))},"arguments":${(m[2] ?? "").trim() || "{}"}}`,
    )
    out.push(...call)
  }
  return out
}

const DEEPSEEK_CALL = "<｜tool▁call▁begin｜>"
const DEEPSEEK_END = "<｜tool▁call▁end｜>"
const DEEPSEEK_SEP = "<｜tool▁sep｜>"
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*(?:```)?$/

function deepseekCall(call: string): TextCall[] {
  const [head = "", ...rest] = call.split(DEEPSEEK_SEP)
  if (!rest.length) return []
  const body = rest.join(DEEPSEEK_SEP).trim()
  const typed = head.trim() === "function"
  const line = typed ? body.indexOf("\n") : -1
  const name = typed ? (line < 0 ? body : body.slice(0, line)).trim() : head.trim()
  const raw = typed ? (line < 0 ? "" : body.slice(line + 1).trim()) : body
  const args = (FENCE.exec(raw)?.[1] ?? raw).trim()
  return jsonCall(`{"name":${JSON.stringify(name)},"arguments":${args || "{}"}}`)
}

function deepseek(inner: string): TextCall[] {
  return inner
    .split(DEEPSEEK_CALL)
    .slice(1)
    .flatMap((segment) => deepseekCall(segment.split(DEEPSEEK_END)[0] ?? ""))
}

const hidden = (tag: string): Family => ({ open: new RegExp(`<${tag}(?:\\s[^>]*)?>`), close: new RegExp(`</${tag}>`) })

const FAMILIES: readonly Family[] = [
  {
    open: new RegExp(String.raw`(?:<${NS}|(?<![^\n])[\w-]+:)function_calls>?`),
    close: new RegExp(`</${NS}function_calls>`),
    calls: invokes,
  },
  { open: /<tool_call>/, close: /<\/tool_call>/, calls: hermes },
  { open: /<\|tool_calls_section_begin\|>/, close: /<\|tool_calls_section_end\|>/, calls: kimi },
  { open: /<｜tool▁calls▁begin｜>/, close: /<｜tool▁calls▁end｜>/, calls: deepseek },
  hidden("function_results"),
  hidden("tool_response"),
  hidden("tool_result"),
  hidden("system-reminder"),
  hidden("system-event"),
  hidden("think"),
  hidden("thinking"),
  hidden("reasoning"),
]

type Hit = { start: number; end: number; family: Family }

function firstOpen(text: string, from: number): Hit | null {
  const window = text.slice(from)
  if (!window.includes("<") && !window.includes("function_calls")) return null
  let best: Hit | null = null
  for (const family of FAMILIES) {
    const m = family.open.exec(window)
    if (m && (best === null || from + m.index < best.start))
      best = { start: from + m.index, end: from + m.index + m[0].length, family }
  }
  return best
}

function pendingFrom(text: string): number {
  const lt = text.lastIndexOf("<")
  if (lt !== -1 && /^<[^\s>]*$/.test(text.slice(lt)) && text.length - lt <= 40) return lt
  const line = text.lastIndexOf("\n") + 1
  return /^[\w-]+(?::\w*)?$/.test(text.slice(line)) && text.length - line <= 40 ? line : text.length
}

type Parsed = { prose: string; calls: TextCall[] }
type Scan = { text: string; stop: number; at: number; prose: string; calls: TextCall[] }
type Scanned = Parsed & { scan: Scan }

const EMPTY_SCAN: Scan = { text: "", stop: 0, at: 0, prose: "", calls: [] }

function pendingFunctionCall(text: string): boolean {
  const match = /^([\w-]+)(?::([\w]*))?$/.exec(text)
  return match !== null && (match[2] === undefined || "function_calls".startsWith(match[2]))
}

function safeAdvance(text: string, stop: number): number {
  let next = text.length
  const open = text.indexOf("<", Math.max(stop, text.lastIndexOf(">") + 1))
  if (open !== -1) next = open
  const line = text.lastIndexOf("\n") + 1
  if (pendingFunctionCall(text.slice(line))) next = Math.min(next, Math.max(line, stop))
  if (stop > 0 && text[stop - 1] !== "\n" && pendingFunctionCall(text.slice(stop))) next = Math.min(next, stop)
  return next
}

function scanToolMarkup(text: string, final: boolean, cached?: Scan): Scanned {
  const base = cached && text.startsWith(cached.text) ? cached : EMPTY_SCAN
  let stop = base.stop
  let at = base.at
  let prose = base.prose
  const calls = [...base.calls]
  for (;;) {
    const hit = firstOpen(text, at)
    if (!hit) break
    prose += text.slice(at, hit.start)
    const rest = text.slice(hit.end)
    const close = hit.family.close.exec(rest)
    const inner = close ? rest.slice(0, close.index) : rest
    if (final || close) calls.push(...(hit.family.calls?.(inner) ?? []))
    if (!close) return { prose, calls, scan: { text, stop: hit.start, at: hit.start, prose, calls } }
    at = hit.end + close.index + close[0].length
    stop = at
  }
  if (final) {
    const done = prose + text.slice(at)
    return { prose: done, calls, scan: { text, stop, at: text.length, prose: done, calls } }
  }
  const pending = stop + pendingFrom(text.slice(stop))
  const advance = safeAdvance(text, stop)
  if (pending < at || advance < at) return scanToolMarkup(text, final)
  const next = Math.min(pending, advance)
  return {
    prose: prose + text.slice(at, pending),
    calls,
    scan: { text, stop, at: next, prose: prose + text.slice(at, next), calls },
  }
}

export const scrubToolMarkup = (text: string, final = true): string => scanToolMarkup(text, final).prose

type Schemaed = { properties?: Record<string, { type?: unknown }> }

function argsOf(call: TextCall, schema: Schemaed | undefined): ToolCall["arguments"] {
  const out: ToolCall["arguments"] = {}
  for (const [key, raw] of Object.entries(call.args)) {
    const wantsString = schema?.properties?.[key]?.type === "string"
    if (wantsString) {
      out[key] = raw.replace(/^\n|\n$/g, "")
      continue
    }
    try {
      out[key] = JSON.parse(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

function registered(name: string, context: Context): { name: string; schema: Schemaed | undefined } {
  const tools = getCurrentTools(context.messages as never)
  const clean = name.replace(/:\d+$/, "")
  const parts = clean.split(".")
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join(".")
    const tool = tools.find((t) => t.name === candidate)
    if (tool) return { name: tool.name, schema: tool.parameters as Schemaed }
  }
  return { name: parts.at(-1) ?? clean, schema: undefined }
}

function rewrite(
  message: AssistantMessage,
  context: Context,
  final: boolean,
  scans?: Map<number, Scan>,
): AssistantMessage {
  let changed = false
  const content: AssistantMessage["content"] = []
  for (const [index, part] of message.content.entries()) {
    if (part.type !== "text") {
      content.push(part)
      continue
    }
    const { prose, calls, scan } = scanToolMarkup(part.text, final, scans?.get(index))
    scans?.set(index, scan)
    if (prose === part.text) {
      content.push(part)
      continue
    }
    changed = true
    if (prose.trim() || !final) content.push({ ...part, text: prose })
    if (final) {
      for (const call of calls) {
        const tool = registered(call.name, context)
        content.push({
          type: "toolCall",
          id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
          name: tool.name,
          arguments: argsOf(call, tool.schema),
        })
      }
    }
  }
  if (!changed) return message
  const called = final && content.some((p) => p.type === "toolCall")
  return {
    ...message,
    content,
    ...(called && (message.stopReason === "stop" || message.stopReason === "length")
      ? { stopReason: "toolUse" as const }
      : {}),
  }
}

function rewriteEvent(
  event: AssistantMessageEvent,
  context: Context,
  seen: Map<number, string>,
  scans: Map<number, Scan>,
): AssistantMessageEvent {
  if (event.type === "done") return { ...event, message: rewrite(event.message, context, true, scans) }
  if (event.type === "error") return { ...event, error: rewrite(event.error, context, true, scans) }
  const partial = rewrite(event.partial, context, false, scans)
  if (event.type === "text_delta" || event.type === "text_end") {
    const part = event.partial.content[event.contentIndex]
    const { prose: shown, scan } = scanToolMarkup(
      part?.type === "text" ? part.text : "",
      event.type === "text_end",
      scans.get(event.contentIndex),
    )
    scans.set(event.contentIndex, scan)
    const before = seen.get(event.contentIndex) ?? ""
    seen.set(event.contentIndex, shown)
    return event.type === "text_delta"
      ? { ...event, delta: shown.startsWith(before) ? shown.slice(before.length) : "", partial }
      : { ...event, content: shown, partial }
  }
  return { ...event, partial }
}

type Stream = Provider["streamSimple"]

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

type ModelRef = Pick<AssistantMessage, "api" | "provider"> & { id: string }

function failure(error: unknown, model: ModelRef, last: AssistantMessage | undefined): AssistantMessage {
  return {
    ...(last ?? {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_USAGE,
      timestamp: Date.now(),
    }),
    role: "assistant",
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
  }
}

export function withTextToolCalls(call: Stream): Stream {
  return ((model, context, options) => {
    const inner = call(model, context, options)
    const out = createAssistantMessageEventStream()
    const seen = new Map<number, string>()
    const scans = new Map<number, Scan>()
    let last: AssistantMessage | undefined
    void (async () => {
      try {
        for await (const event of inner) {
          if (event.type !== "done" && event.type !== "error") last = event.partial
          out.push(rewriteEvent(event, context, seen, scans))
        }
      } catch (error) {
        out.push({ type: "error", reason: "error", error: failure(error, model, last) })
      } finally {
        out.end()
      }
    })()
    return out
  }) as Stream
}

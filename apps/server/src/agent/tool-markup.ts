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

function deepseek(inner: string): TextCall[] {
  const out: TextCall[] = []
  for (const m of inner.matchAll(
    /<｜tool▁call▁begin｜>[\s\S]*?<｜tool▁sep｜>\s*([^\n<]+?)\s*\n?(?:```(?:json)?\s*([\s\S]*?)\s*```)?\s*(?:<｜tool▁call▁end｜>|$)/g,
  )) {
    out.push(...jsonCall(`{"name":${JSON.stringify(m[1] ?? "")},"arguments":${(m[2] ?? "").trim() || "{}"}}`))
  }
  return out
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
  let best: Hit | null = null
  for (const family of FAMILIES) {
    const m = family.open.exec(text.slice(from))
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

function parseToolMarkup(text: string, final: boolean): Parsed {
  let prose = ""
  const calls: TextCall[] = []
  let at = 0
  for (;;) {
    const hit = firstOpen(text, at)
    if (!hit) break
    prose += text.slice(at, hit.start)
    const rest = text.slice(hit.end)
    const close = hit.family.close.exec(rest)
    const inner = close ? rest.slice(0, close.index) : rest
    if (final || close) calls.push(...(hit.family.calls?.(inner) ?? []))
    if (!close) return { prose, calls }
    at = hit.end + close.index + close[0].length
  }
  const tail = text.slice(at)
  return { prose: prose + (final ? tail : tail.slice(0, pendingFrom(tail))), calls }
}

export const scrubToolMarkup = (text: string, final = true): string => parseToolMarkup(text, final).prose

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

function rewrite(message: AssistantMessage, context: Context, final: boolean): AssistantMessage {
  let changed = false
  const content: AssistantMessage["content"] = []
  for (const part of message.content) {
    if (part.type !== "text") {
      content.push(part)
      continue
    }
    const { prose, calls } = parseToolMarkup(part.text, final)
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
  return { ...message, content, ...(called && message.stopReason === "stop" ? { stopReason: "toolUse" as const } : {}) }
}

function rewriteEvent(
  event: AssistantMessageEvent,
  context: Context,
  seen: Map<number, string>,
): AssistantMessageEvent {
  if (event.type === "done") return { ...event, message: rewrite(event.message, context, true) }
  if (event.type === "error") return { ...event, error: rewrite(event.error, context, true) }
  const partial = rewrite(event.partial, context, false)
  if (event.type === "text_delta" || event.type === "text_end") {
    const shown = scrubToolMarkup(
      event.partial.content[event.contentIndex]?.type === "text"
        ? (event.partial.content[event.contentIndex] as { text: string }).text
        : "",
      event.type === "text_end",
    )
    const before = seen.get(event.contentIndex) ?? ""
    seen.set(event.contentIndex, shown)
    return event.type === "text_delta"
      ? { ...event, delta: shown.startsWith(before) ? shown.slice(before.length) : "", partial }
      : { ...event, content: shown, partial }
  }
  return { ...event, partial }
}

type Stream = Provider["streamSimple"]

export function withTextToolCalls(call: Stream): Stream {
  return ((model, context, options) => {
    const inner = call(model, context, options)
    const out = createAssistantMessageEventStream()
    const seen = new Map<number, string>()
    void (async () => {
      try {
        for await (const event of inner) out.push(rewriteEvent(event, context, seen))
      } finally {
        out.end()
      }
    })()
    return out
  }) as Stream
}

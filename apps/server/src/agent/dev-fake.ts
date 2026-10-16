import { awaitWithContext } from "@earendil-works/chord/context"
import { getCurrentTools, Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { type Effect, declareEffect } from "@kiko/agent/effects"
import { plainReport } from "@kiko/agent/workers"
import { boundedWait } from "@kiko/durable/bounded-wait"
import { type BuildAgentInput, buildAgent } from "./factory"
import { withTextToolCalls } from "./tool-markup"
import type { AgentSetup } from "@kiko/agent/host"
import type { RoleInput } from "./prompt"
import type { WorkspacePort } from "./extensions/workspace"

export const FAKE_MODEL = { provider: "faux", modelId: "faux-1" } as const
export const SLOW_TOOL = "slow_tool"
const SLOW_WRITE_TOOL = "slow_write"
export const SLOW_TOOL_MS = 5_000
const LATER_MS = 3_000
const TOKENS_PER_SECOND = 25
const LONG = Array.from({ length: 12 }, (_, i) => `slow words ${i + 1} keep this paragraph open for a while,`).join(" ")

type Part = { type: string; text?: string }
type Message = { role?: string; content?: string | Part[]; stopReason?: string; toolName?: string; toolCallId?: string }

const rawOf = (m: Message) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""))

function missedOf(raw: string): string[] {
  const memory = /<memory>([\s\S]*?)<\/memory>/.exec(raw)?.[1] ?? ""
  const chat = memory.slice(memory.search(/(^|\n)chat[^\n]*:\n/) + 1)
  return chat
    .split("\n")
    .filter((line) => line.startsWith("#"))
    .map((line) => line.replace(/^#\S+ (?:[a-z]{3} \d+ (?:\d{4} )?)?\d\d:\d\d /, "").replace(/\[[0-9a-f-]{36}\] /g, ""))
}

const textOf = (m: Message) =>
  rawOf(m)
    .replace(/<memory>[\s\S]*?<\/memory>\s*/g, "")
    .replace(/<context>[\s\S]*?<\/context>\s*/g, "")
    .replace(/<system-event[^>]*>\s*([\s\S]*?)\s*<\/system-event>/g, "$1")
    .trim()
const callsTool = (m: Message) => typeof m.content !== "string" && (m.content ?? []).some((p) => p.type === "toolCall")

const WORK_STEP_MS = 3_000

function capture(match: readonly string[], index: number): string {
  const value = match[index]
  if (value === undefined) throw new Error(`regex group ${index} did not participate in the match`)
  return value
}

const directCall = (text: string) => /\[(?:ws|tool) (\w+) (\{.*?\})\]/.exec(text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"))

function workerReply(messages: readonly Message[], toolNames: () => string) {
  const users = messages.filter((m) => m.role === "user").map(textOf)
  if (users[0] === "[tools]") return fauxAssistantMessage(`tools: ${toolNames()}`)
  const results = messages.filter((m) => m.role === "toolResult")
  const browse = browseScript(messages, users)
  if (browse) return fauxAssistantMessage(browse, { stopReason: "toolUse" })
  const last = messages.at(-1)
  if (last?.role === "toolResult" && last.toolName?.startsWith("browse")) return fauxAssistantMessage(browsed(textOf(last)))
  const direct = directCall(users[0] ?? "")
  if (direct && !results.length) return fauxAssistantMessage(fauxToolCall(capture(direct, 1), JSON.parse(capture(direct, 2))), { stopReason: "toolUse" })
  const steps = direct ? 1 : Number(/\[steps (\d+)\]/.exec(users[0] ?? "")?.[1] ?? 1)
  if (results.length < steps) return fauxAssistantMessage(fauxToolCall(SLOW_TOOL, { ms: WORK_STEP_MS }), { stopReason: "toolUse" })
  const told = results.map((r) => plainReport(textOf(r))).filter(Boolean)
  return fauxAssistantMessage(`work done: heard=${users.join(" | ")}${direct && told.length ? `; tool: ${told.join(", ")}` : ""}`)
}

const toolsOf = (transcript: readonly Message[]) => new Set([...JSON.stringify(transcript.filter((m) => m.role === "system")).matchAll(/"name":"([\w-]+)","description"/g)].map((m) => capture(m, 1)))

export function fakeReply(transcript: readonly Message[]) {
  const toolNames = () => getCurrentTools(transcript as never).map((t) => t.name).sort().join(",")
  const messages = transcript.filter((m) => m.role !== "system")
  const offered = toolsOf(transcript)
  if (!offered.has("start_work")) return workerReply(messages, toolNames)
  const tail = messages.at(-1)
  const report = tail?.role === "user" ? /<work id="(\w+)" status="(\w+)">([\s\S]*?)<\/work>/.exec(textOf(tail)) : null
  if (report) return fauxAssistantMessage(`report ${report[1]} ${report[2]}: ${capture(report, 3).trim()}`)
  const last = messages.at(-1)
  const handOff = (m: Message | undefined) => {
    if (m?.role !== "user") return null
    const browseAsk = BROWSE_LINE.exec(textOf(m))
    if (browseAsk && !offered.has("browse")) return browseAsk
    const call = directCall(textOf(m))
    return call && !offered.has(capture(call, 1)) ? call : null
  }
  const toWorker = handOff(last)
  if (toWorker) return fauxAssistantMessage(fauxToolCall("start_work", { task: toWorker[0] }), { stopReason: "toolUse" })
  if (last?.role === "toolResult" && last.toolName === "start_work" && handOff(messages.findLast((m) => m.role === "user"))) return fauxAssistantMessage("[skip]")
  const answered = messages.findLastIndex((m) => m.role === "assistant" && !callsTool(m) && m.stopReason !== "aborted")
  const since = messages.slice(answered + 1)
  const users = since.filter((m) => m.role === "user").map(textOf)
  const results = since.filter((m) => m.role === "toolResult").map(textOf)
  const ws = last?.role === "user" ? /\[ws (\w+) (\{.*?\})\]/.exec(textOf(last)) : null
  if (ws) return fauxAssistantMessage(fauxToolCall(capture(ws, 1), JSON.parse(capture(ws, 2))), { stopReason: "toolUse" })
  const fetchFirst = last?.role === "user" && /^\[fetch\]/.test(textOf(last))
  const page = last?.role === "toolResult" && last.toolName === "fake_fetch"
  if (last?.role === "user" && textOf(last) === "[tools]") return fauxAssistantMessage(`tools: ${toolNames()}`)
  const browse = browseScript(messages, users)
  if (browse) return fauxAssistantMessage(browse, { stopReason: "toolUse" })
  if (last?.role === "toolResult" && last.toolName?.startsWith("browse")) return fauxAssistantMessage(browsed(textOf(last)))
  const typed = last?.role === "user" ? textCall(rawOf(last)) : null
  if (typed) return fauxAssistantMessage(typed)
  const any = last && ((last.role === "user" && !fetchFirst) || page) ? anyToolCall(rawOf(last)) : null
  if (any) return fauxAssistantMessage(any, { stopReason: "toolUse" })
  const twoPart = users.at(-1)?.includes("[two-part]")
  if (twoPart && last?.role === "user") return fauxAssistantMessage([fauxText("part one."), fauxToolCall(SLOW_TOOL, { ms: 1 })], { stopReason: "toolUse" })
  if (twoPart && last?.role === "toolResult" && last.toolName === SLOW_TOOL) return fauxAssistantMessage(`${LONG} heard: ${users.join(" | ")}`)
  const later = users.map((u) => /\[later ([a-z0-9-]+)\]\s*([^<]*)/.exec(u)).find(Boolean)
  if (later && last?.role === "user") return fauxAssistantMessage(fauxToolCall(SLOW_TOOL, { ms: LATER_MS }), { stopReason: "toolUse" })
  if (later && last?.role === "toolResult" && last.toolName === SLOW_TOOL) return fauxAssistantMessage(fauxToolCall("send_message", { to: capture(later, 1), text: capture(later, 2).trim() }), { stopReason: "toolUse" })
  if (last?.role === "user" && users.some((u) => u.includes("[tool]")) && results.length === 0) {
    return fauxAssistantMessage(fauxToolCall(SLOW_TOOL, {}), { stopReason: "toolUse" })
  }
  if (last?.role === "user" && users.some((u) => u.includes("[write]")) && results.length === 0) {
    return fauxAssistantMessage(fauxToolCall(SLOW_WRITE_TOOL, {}), { stopReason: "toolUse" })
  }
  const team = last?.role === "user" ? teamCall(textOf(last)) : null
  if (team) return fauxAssistantMessage(team, { stopReason: "toolUse" })
  const calls = fakeCalls(messages)
  if (calls.length) return fauxAssistantMessage(calls, { stopReason: "toolUse" })
  const ran = fakeResults(since)
  if (ran) return fauxAssistantMessage(ran)
  const briefed = since.filter((m) => m.role === "user" && textOf(m).includes("[missed]"))
  const missed = briefed.length ? `; missed: ${briefed.flatMap((m) => missedOf(rawOf(m))).join(" | ")}` : ""
  const heard = `heard: ${users.join(" | ")}${results.length ? `; tool: ${results.join(", ")}` : ""}${missed}`
  const newest = last?.role === "user" ? textOf(last) : ""
  const failing = /(?:^|\s)\[model-error\]\s*([\s\S]*)$/.exec(newest)
  if (failing) return fauxAssistantMessage("", { stopReason: "error", errorMessage: capture(failing, 1) })
  const scripted = /(?:^|\s)\[reply\]\s*([\s\S]*)$/.exec(newest)
  if (scripted) return fauxAssistantMessage(capture(scripted, 1))
  if (newest.includes("[brief]")) {
    const raw = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p) => p.text ?? "").join("")
    const lines = raw.split("\n").filter((l) => l.startsWith("- ") && l.includes(" reacted "))
    return fauxAssistantMessage(lines.length ? `brief: ${lines.map((l) => l.slice(2)).join(" | ")}` : "brief: none")
  }
  if (newest.includes("what is the status")) {
    const notes = last ? rawOf(last).split("\n").filter((l) => /^- w\d+ \(/.test(l)) : []
    return fauxAssistantMessage(`status: ${notes.join(" | ") || "no workers"}`)
  }
  if (newest.includes("[quiet]") && !results.length) return fauxAssistantMessage("[skip]")
  if (newest.includes("[slow]")) return fauxAssistantMessage(`${LONG} ${heard}`)
  return fauxAssistantMessage(heard)
}

const BROWSE_LINE = /\[browse (\S+) click ([^\]]+)\]/

function browseScript(messages: readonly Message[], users: readonly string[]) {
  const last = messages.at(-1)
  const ask = users.map((u) => BROWSE_LINE.exec(u)).findLast(Boolean)
  if (!ask) return null
  if (last?.role === "user") return BROWSE_LINE.test(textOf(last)) ? fauxToolCall("browse", { urls: [capture(ask, 1)] }) : null
  if (last?.role !== "toolResult" || last.toolName !== "browse") return null
  const label = capture(ask, 2).trim().toLowerCase()
  const id = textOf(last).split("\n").map((l) => /^(\d+) \S+ "(.*)"$/.exec(l)).find((m) => m && capture(m, 2).trim().toLowerCase() === label)?.[1]
  return id === undefined ? null : fauxToolCall("browser_act", { steps: [{ op: "click", id: Number(id) }] })
}

function browsed(result: string): string {
  const lines = result.split("\n").filter((l) => l.trim() && !/^<\/?untrusted/.test(l))
  const did = lines.findIndex((l) => l.startsWith("did:"))
  const [title, url] = lines.slice(did + 1)
  return url?.startsWith("http") ? `browsed: ${did >= 0 ? `${lines[did]} | ` : ""}${title} | ${url}` : `browsed: ${result.slice(0, 400)}`
}

function anyToolCall(raw: string) {
  const text = raw.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
  const direct = /\[tool (\w+) (\{.*\})\]\s*$/m.exec(text)
  return direct ? fauxToolCall(capture(direct, 1), JSON.parse(capture(direct, 2))) : null
}

/** `[textcall name {json}]` answers the way an open model does when it writes its tool call as text. */
function textCall(raw: string) {
  const m = /\[textcall (\w+) (\{.*\})\]\s*$/m.exec(raw.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"))
  if (!m) return null
  const args = Object.entries(JSON.parse(capture(m, 2)) as Record<string, unknown>)
    .map(([k, v]) => `<atem:parameter name="${k}">${typeof v === "string" ? v : JSON.stringify(v)}</atem:parameter>`)
    .join("\n")
  return `Sure, one moment.\natem:function_calls\n<atem:invoke name="default.${capture(m, 1)}">\n${args}\n</atem:invoke>\n</atem:function_calls>`
}

const slowTool = (name: string, effect: Effect) =>
  declareEffect(
    effect,
    defineTool({
      name,
      description: "waits a few seconds, then says slept.",
      parameters: Type.Object({ ms: Type.Optional(Type.Number()) }),
      execute: async (args, _api, context) => {
        await awaitWithContext(boundedWait(Math.min(args.ms ?? SLOW_TOOL_MS, 300_000)), context)
        return { content: [{ type: "text", text: "slept" }] }
      },
    }),
  )

export const SLOW_TOOL_EXTENSION: Extension = defineExtension({ name: "test-slow-tool", tools: [slowTool(SLOW_TOOL, "read"), slowTool(SLOW_WRITE_TOOL, "write")] })

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const page = Type.Object({ page: Type.String() })

export const FAKE_TOOLS = {
  fake_fetch: declareEffect(
    "read",
    defineTool({ name: "fake_fetch", description: "fetches a page.", parameters: page, execute: async ({ page }) => text(page) }),
  ),
  fake_lookup: declareEffect(
    "read",
    defineTool({ name: "fake_lookup", description: "looks something up in kiko.", parameters: Type.Object({}), execute: async () => text("found") }),
  ),
  fake_note: declareEffect(
    "write",
    defineTool({ name: "fake_note", description: "writes a note.", parameters: Type.Object({}), execute: async () => text("noted") }),
  ),
  fake_ask: declareEffect(
    "message",
    defineTool({ name: "fake_ask", description: "messages a teammate.", parameters: Type.Object({}), execute: async () => text("asked") }),
  ),
  fake_send: declareEffect(
    "external",
    defineTool({ name: "fake_send", description: "sends an email outside kiko.", parameters: Type.Object({}), execute: async () => text("sent") }),
  ),
}

export const FAKE_TOOLS_EXTENSION: Extension = defineExtension({ name: "test-fake-tools", tools: Object.values(FAKE_TOOLS) })

const isFakeTool = (name: string): name is keyof typeof FAKE_TOOLS => Object.hasOwn(FAKE_TOOLS, name)

function fakeCalls(messages: readonly Message[]) {
  const last = messages.at(-1)
  if (last?.role === "user") {
    const turn = textOf(last)
    const fetch = /^\[fetch\]\s*([\s\S]*)$/.exec(turn)
    if (fetch) return [fauxToolCall("fake_fetch", { page: capture(fetch, 1) })]
    return directives(turn)
  }
  if (last?.role !== "toolResult") return []
  const round = messages.slice(messages.findLastIndex((m) => m.role === "assistant") + 1)
  return round.flatMap((m) => directives(textOf(m)))
}

const directives = (text: string) =>
  [...text.matchAll(/\[call (\w+)\]/g)].flatMap((m) => {
    const name = capture(m, 1)
    return isFakeTool(name) && name !== "fake_fetch" ? [fauxToolCall(name, {})] : []
  })

function fakeResults(since: readonly Message[]): string | null {
  const results = since.filter((m) => m.role === "toolResult" && isFakeTool(m.toolName ?? ""))
  if (!results.length) return null
  const state = (t: string) => (t.includes("Tool call blocked") ? "blocked" : "ran")
  return `tools: ${results.map((m) => `${m.toolName} ${state(textOf(m))}`).join(", ")}`
}

function teamCall(turn: string) {
  const agent = [...turn.matchAll(/<agent-message from="([^"]+)"[^>]*>([\s\S]*?)<\/agent-message>/g)].at(-1)
  if (agent && capture(agent, 2).includes("[question]")) return fauxToolCall("send_message", { to: capture(agent, 1), text: "[answer] 42" })
  const asked = /\[ask ([a-z0-9-]+)\]\s*([\s\S]*)$/.exec(turn)
  if (asked) return fauxToolCall("ask", { to: capture(asked, 1), question: capture(asked, 2) })
  if (agent && capture(agent, 2).includes("[echo]")) return fauxToolCall("send_message", { to: capture(agent, 1), text: "[echo]" })
  const send = /\[send ([a-z0-9-]+)\]\s*([\s\S]*)$/.exec(turn)
  if (send) return fauxToolCall("send_message", { to: capture(send, 1), text: capture(send, 2) })
  if (turn.includes("[shout]")) return fauxToolCall("send_message", { to: "all", text: "[shout]" })
  return turn.includes("[team]") ? fauxToolCall("team", {}) : null
}

export function fakeSetup(role: RoleInput = { role: "", lead: true }, workspace?: WorkspacePort, messaging?: BuildAgentInput["messaging"], more: Pick<BuildAgentInput, "reminders" | "chief" | "loops" | "work" | "browser" | "presence"> = {}) {
  const faux = fauxProvider({ tokensPerSecond: TOKENS_PER_SECOND })
  const step = (context: { messages: readonly unknown[] }) => fakeReply(context.messages as Message[])
  faux.setResponses(Array.from({ length: 500 }, () => step))
  const models = createModels()
  models.setProvider({ ...faux.provider, streamSimple: withTextToolCalls(faux.provider.streamSimple), stream: withTextToolCalls(faux.provider.stream as never) as never })
  return { models, ...buildAgent({ ...role, ...more, model: FAKE_MODEL, messaging, ...(workspace ? { workspace } : {}), testExtensions: [SLOW_TOOL_EXTENSION, FAKE_TOOLS_EXTENSION] }) } satisfies AgentSetup
}

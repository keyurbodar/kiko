import { awaitWithContext } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { type Approvals, isRunTainted, markRunTainted } from "@yuki/agent/trust"
import { type BuildAgentInput, buildAgent } from "./factory"
import type { AgentSetup } from "@yuki/agent/host"
import type { RoleInput } from "./prompt"
import type { WorkspacePort } from "./extensions/workspace"

export const FAKE_MODEL = { provider: "faux", modelId: "faux-1" } as const
export const SLOW_TOOL = "slow_tool"
export const SLOW_TOOL_MS = 5_000
const LATER_MS = 3_000
const TOKENS_PER_SECOND = 25
const LONG = Array.from({ length: 12 }, (_, i) => `slow words ${i + 1} keep this paragraph open for a while,`).join(" ")

type Part = { type: string; text?: string }
type Message = { role?: string; content?: string | Part[]; stopReason?: string; toolName?: string }

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
    .trim()
const callsTool = (m: Message) => typeof m.content !== "string" && (m.content ?? []).some((p) => p.type === "toolCall")

export function fakeReply(transcript: readonly Message[]) {
  const messages = transcript.filter((m) => m.role !== "system")
  const answered = messages.findLastIndex((m) => m.role === "assistant" && !callsTool(m) && m.stopReason !== "aborted")
  const since = messages.slice(answered + 1)
  const users = since.filter((m) => m.role === "user").map(textOf)
  const results = since.filter((m) => m.role === "toolResult").map(textOf)
  const last = messages.at(-1)
  const ws = last?.role === "user" ? /\[ws (\w+) (\{.*?\})\]/.exec(textOf(last)) : null
  if (ws) return fauxAssistantMessage(fauxToolCall(ws[1]!, JSON.parse(ws[2]!)), { stopReason: "toolUse" })
  const fetchFirst = last?.role === "user" && /^\[(fetch|mark)\]/.test(textOf(last))
  const page = last?.role === "toolResult" && (last.toolName === "fake_fetch" || last.toolName === "fake_mark")
  const any = (last?.role === "user" && !fetchFirst) || page ? anyToolCall(rawOf(last!), messages) : null
  if (any) return fauxAssistantMessage(any, { stopReason: "toolUse" })
  // One model turn is one bubble, so a two-part answer is two turns: a short note with a tool call, then the rest.
  const twoPart = users.at(-1)?.includes("[two-part]")
  if (twoPart && last?.role === "user") return fauxAssistantMessage([fauxText("part one."), fauxToolCall(SLOW_TOOL, { ms: 1 })], { stopReason: "toolUse" })
  if (twoPart && last?.role === "toolResult" && last.toolName === SLOW_TOOL) return fauxAssistantMessage(`${LONG} heard: ${users.join(" | ")}`)
  const later = users.map((u) => /\[later ([a-z0-9-]+)\]\s*([^<]*)/.exec(u)).find(Boolean)
  if (later && last?.role === "user") return fauxAssistantMessage(fauxToolCall(SLOW_TOOL, { ms: LATER_MS }), { stopReason: "toolUse" })
  if (later && last?.role === "toolResult" && last.toolName === SLOW_TOOL) return fauxAssistantMessage(fauxToolCall("send_message", { to: later[1]!, text: later[2]!.trim() }), { stopReason: "toolUse" })
  if (last?.role === "user" && users.some((u) => u.includes("[tool]")) && results.length === 0) {
    return fauxAssistantMessage(fauxToolCall(SLOW_TOOL, {}), { stopReason: "toolUse" })
  }
  const team = last?.role === "user" ? teamCall(textOf(last)) : null
  if (team) return fauxAssistantMessage(team, { stopReason: "toolUse" })
  const calls = trustCalls(messages)
  if (calls.length) return fauxAssistantMessage(calls, { stopReason: "toolUse" })
  const ran = trustResults(since)
  if (ran) return fauxAssistantMessage(ran)
  const briefed = since.filter((m) => m.role === "user" && textOf(m).includes("[missed]"))
  const missed = briefed.length ? `; missed: ${briefed.flatMap((m) => missedOf(rawOf(m))).join(" | ")}` : ""
  const heard = `heard: ${users.join(" | ")}${results.length ? `; tool: ${results.join(", ")}` : ""}${missed}`
  const newest = last?.role === "user" ? textOf(last) : ""
  const scripted = /(?:^|\s)\[reply\]\s*([\s\S]*)$/.exec(newest)
  if (scripted) return fauxAssistantMessage(scripted[1]!)
  if (newest.includes("[brief]")) {
    const raw = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p) => p.text ?? "").join("")
    const lines = raw.split("\n").filter((l) => l.startsWith("- ") && l.includes(" reacted "))
    return fauxAssistantMessage(lines.length ? `brief: ${lines.map((l) => l.slice(2)).join(" | ")}` : "brief: none")
  }
  if (newest.includes("[quiet]") && !results.length) return fauxAssistantMessage("[skip]")
  if (newest.includes("[slow]")) return fauxAssistantMessage(`${LONG} ${heard}`)
  return fauxAssistantMessage(heard)
}

function anyToolCall(raw: string, messages: readonly Message[]) {
  const text = raw.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
  const accepted = /reason="approval_result"[^>]*>\s*the human accepted (\w+) \(card /.exec(text)
  if (accepted && !isTrustTool(accepted[1]!)) {
    const calls = messages.flatMap((m) => (m.role === "assistant" && typeof m.content !== "string" ? (m.content ?? []) : [])) as { type: string; name?: string; arguments?: Record<string, unknown> }[]
    const before = calls.findLast((p) => p.type === "toolCall" && p.name === accepted[1])
    if (before) return fauxToolCall(accepted[1]!, (before.arguments ?? {}) as Parameters<typeof fauxToolCall>[1])
  }
  const direct = /\[tool (\w+) (\{.*\})\]\s*$/m.exec(text)
  return direct ? fauxToolCall(direct[1]!, JSON.parse(direct[2]!)) : null
}

const slowTool = defineTool({
  name: SLOW_TOOL,
  description: "waits a few seconds, then says slept.",
  parameters: Type.Object({ ms: Type.Optional(Type.Number()) }),
  execute: async (args, _api, context) => {
    await awaitWithContext(new Promise((resolve) => setTimeout(resolve, Math.min(args.ms ?? SLOW_TOOL_MS, 300_000))), context)
    return { content: [{ type: "text", text: "slept" }] }
  },
})

export const SLOW_TOOL_EXTENSION: Extension = defineExtension({ name: "test-slow-tool", tools: [declareEffect("read", slowTool)] })

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const flagged = (word: string, api: Parameters<typeof isRunTainted>[0]) => text(isRunTainted(api) ? `${word} (tainted)` : word)
const page = Type.Object({ page: Type.String() })

export const TRUST_TOOLS = {
  fake_fetch: declareEffect(
    "read",
    defineTool({ name: "fake_fetch", description: "fetches a page.", parameters: page, execute: async ({ page }) => text(page) }),
    { outside: "web" },
  ),
  fake_mark: declareEffect(
    "read",
    defineTool({
      name: "fake_mark",
      description: "reads a file.",
      parameters: page,
      execute: async ({ page }, api) => {
        markRunTainted(api, "file")
        return text(page)
      },
    }),
  ),
  fake_lookup: declareEffect(
    "read",
    defineTool({ name: "fake_lookup", description: "looks something up in yuki.", parameters: Type.Object({}), execute: async () => text("found") }),
  ),
  fake_note: declareEffect(
    "write",
    defineTool({ name: "fake_note", description: "writes a note.", parameters: Type.Object({}), execute: async (_a, api) => flagged("noted", api) }),
  ),
  fake_ask: declareEffect(
    "message",
    defineTool({ name: "fake_ask", description: "messages a teammate.", parameters: Type.Object({}), execute: async (_a, api) => flagged("asked", api) }),
  ),
  fake_send: declareEffect(
    "external",
    defineTool({ name: "fake_send", description: "sends an email outside yuki.", parameters: Type.Object({}), execute: async () => text("sent") }),
  ),
}

export const TRUST_TOOLS_EXTENSION: Extension = defineExtension({ name: "test-trust-tools", tools: Object.values(TRUST_TOOLS) })

const isTrustTool = (name: string): name is keyof typeof TRUST_TOOLS => Object.hasOwn(TRUST_TOOLS, name)

function trustCalls(messages: readonly Message[]) {
  const last = messages.at(-1)
  if (last?.role === "user") {
    const turn = textOf(last)
    const fetch = /^\[(fetch|mark)\]\s*([\s\S]*)$/.exec(turn)
    if (fetch) return [fauxToolCall(`fake_${fetch[1]}`, { page: fetch[2]! })]
    const accepted = /<system-event reason="approval_result"[^>]*>\s*the human accepted (\w+)/.exec(turn)
    if (accepted && isTrustTool(accepted[1]!)) return [fauxToolCall(accepted[1]!, {})]
    return directives(turn)
  }
  if (last?.role !== "toolResult") return []
  const round = messages.slice(messages.findLastIndex((m) => m.role === "assistant") + 1)
  return round.flatMap((m) => directives(textOf(m)))
}

const directives = (text: string) =>
  [...text.matchAll(/\[call (\w+)\]/g)].flatMap(([, name]) => (isTrustTool(name!) && name !== "fake_fetch" && name !== "fake_mark" ? [fauxToolCall(name!, {})] : []))

function trustResults(since: readonly Message[]): string | null {
  const results = since.filter((m) => m.role === "toolResult" && isTrustTool(m.toolName ?? ""))
  if (!results.length) return null
  const state = (t: string) => (t.includes("Tool call blocked") ? "blocked" : t.includes("(tainted)") ? "ran tainted" : "ran")
  return `tools: ${results.map((m) => `${m.toolName} ${state(textOf(m))}`).join(", ")}`
}

function teamCall(turn: string) {
  const agent = [...turn.matchAll(/<agent-message from="([^"]+)"[^>]*>([\s\S]*?)<\/agent-message>/g)].at(-1)
  if (agent && agent[2]!.includes("[question]")) return fauxToolCall("send_message", { to: agent[1]!, text: "[answer] 42" })
  const asked = /\[ask ([a-z0-9-]+)\]\s*([\s\S]*)$/.exec(turn)
  if (asked) return fauxToolCall("ask", { to: asked[1]!, question: asked[2]! })
  if (agent && agent[2]!.includes("[echo]")) return fauxToolCall("send_message", { to: agent[1]!, text: "[echo]" })
  const send = /\[send ([a-z0-9-]+)\]\s*([\s\S]*)$/.exec(turn)
  if (send) return fauxToolCall("send_message", { to: send[1]!, text: send[2]! })
  if (turn.includes("[shout]")) return fauxToolCall("send_message", { to: "all", text: "[shout]" })
  return turn.includes("[team]") ? fauxToolCall("team", {}) : null
}

export function fakeSetup(role: RoleInput = { role: "", lead: true }, workspace?: WorkspacePort, messaging?: BuildAgentInput["messaging"], approvals?: Approvals, scripts?: BuildAgentInput["scripts"], more: Pick<BuildAgentInput, "authority" | "reminders" | "chief" | "loops"> = {}) {
  const faux = fauxProvider({ tokensPerSecond: TOKENS_PER_SECOND })
  const step = (context: { messages: readonly unknown[] }) => fakeReply(context.messages as Message[])
  faux.setResponses(Array.from({ length: 500 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  return { models, ...buildAgent({ ...role, ...more, model: FAKE_MODEL, messaging, ...(workspace ? { workspace } : {}), ...(approvals ? { approvals } : {}), ...(scripts ? { scripts } : {}), testExtensions: [SLOW_TOOL_EXTENSION, TRUST_TOOLS_EXTENSION] }) } satisfies AgentSetup
}

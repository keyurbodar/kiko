import { awaitWithContext } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { MISSED_HEADER } from "../room/brief"
import { declareEffect } from "./effects"
import { type Approvals, isRunTainted, markRunTainted } from "./extensions/trust"
import { type BuildAgentInput, buildAgent } from "./factory"
import type { AgentSetup } from "./host"
import type { RoleInput } from "./prompt"
import type { WorkspacePort } from "./extensions/workspace"

// DEV AND TESTS ONLY. A scripted agent for `bun kiko verify mid-run` (P1-12): pi-ai's faux provider
// answers from the transcript, and one slow tool makes "a tool is running" last long enough to
// test. It spends no tokens and is deterministic. `AgentDO` uses it only in a development build and
// only for an agent the dev route marked. The markers in the human's text pick the script:
//
//   [slow]      the answer is one long paragraph, about six seconds with no bubble
//   [two-part]  a short first bubble, then a long second paragraph, about six seconds
//   [tool]      the model calls `slow_tool` first, which sleeps SLOW_TOOL_MS
//   [reply] x   the answer is exactly `x`, such as `[react:👍]` (P6-07). A tag such as `@all` may come first
//   [brief]     the answer is the reaction lines of the room's brief, or `brief: none` (P6-07)
//   a follow-up (the lead already answered)  the answer is [skip], which posts nothing
//   [missed]    the answer ends with `; missed: <the brief's missed messages, joined by " | ">` (P6-01)
//   [fetch] x   the model calls `fake_fetch` with page `x`, outside content (P7-01)
//   [mark] x    the model calls `fake_mark`, which returns `x` and marks the run tainted (P7-01)
//   [call t]    the model calls trust tool `t`, from a user turn or from a tool result, which is
//               how a fooled model obeys an injected instruction (P7-01)
//   [ws t {json}] the model calls workspace tool `t` with the JSON arguments (P6-02)
//   [send s] x  the model calls `send_message` to `s` with `x` (P6-03)
//   [echo]      in a teammate's message: the model sends `[echo]` back to that teammate, forever (P6-03)
//   [shout]     the model calls `broadcast` with `[shout]`, from a human or a teammate, forever (P6-03)
//   [check s]   the model calls `check_agent` on `s` (P6-03)
//
// An `approval_result` that says `the human accepted t` makes the model call trust tool `t` again (P7-02).
//
// After trust tools ran, the answer is `tools: <name> ran|ran tainted|blocked, ...` (P7-01).
//
// Every answer is `heard: <the user turns since the last answer, joined by " | ">`, plus
// `; tool: <result>` when a tool ran since then. The text shows which turns one run answered.

export const FAKE_MODEL = { provider: "faux", modelId: "faux-1" } as const
export const SLOW_TOOL = "slow_tool"
export const SLOW_TOOL_MS = 5_000
/** Faux tokens are about four characters. 25 a second is about 100 characters a second. */
const TOKENS_PER_SECOND = 25
const LONG = Array.from({ length: 12 }, (_, i) => `slow words ${i + 1} keep this paragraph open for a while,`).join(" ")

type Part = { type: string; text?: string }
type Message = { role?: string; content?: string | Part[]; stopReason?: string; toolName?: string }

/** The whole text of a message, the room's `<context>` brief included. */
const rawOf = (m: Message) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""))

/** The missed-message lines of the brief in `raw`, as `<who>: <text>`, without message ids. */
function missedOf(raw: string): string[] {
  const brief = /<context>([\s\S]*?)<\/context>/.exec(raw)?.[1] ?? ""
  const at = brief.indexOf(MISSED_HEADER)
  if (at < 0) return []
  return brief
    .slice(at + MISSED_HEADER.length)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/^\[[^\]]*\] /, ""))
}

/** The text of a message without the room's `<context>` brief. */
const textOf = (m: Message) =>
  rawOf(m)
    .replace(/<context>[\s\S]*?<\/context>\s*/g, "")
    .trim()
const callsTool = (m: Message) => typeof m.content !== "string" && (m.content ?? []).some((p) => p.type === "toolCall")

/** One scripted reply to the transcript so far. Pure, so the suite can predict every answer. */
export function fakeReply(transcript: readonly Message[]) {
  // The prompt and the tool list travel as system messages, and one may follow the newest turn.
  const messages = transcript.filter((m) => m.role !== "system")
  const answered = messages.findLastIndex((m) => m.role === "assistant" && !callsTool(m) && m.stopReason !== "aborted")
  const since = messages.slice(answered + 1)
  const users = since.filter((m) => m.role === "user").map(textOf)
  const results = since.filter((m) => m.role === "toolResult").map(textOf)
  const last = messages.at(-1)
  // A follow-up after the lead answered (section 7.2): the fake, like a quiet teammate, stays quiet.
  // The note sits in the brief, which `textOf` strips, so it is read from the raw text.
  if (last?.role === "user" && rawOf(last).includes("already answered this")) return fauxAssistantMessage("[skip]")
  const ws = last?.role === "user" ? /\[ws (\w+) (\{.*?\})\]/.exec(textOf(last)) : null
  if (ws) return fauxAssistantMessage(fauxToolCall(ws[1]!, JSON.parse(ws[2]!)), { stopReason: "toolUse" })
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
    // The reaction lines of the room's brief (section 7.4), which `textOf` strips.
    const raw = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p) => p.text ?? "").join("")
    const lines = raw.split("\n").filter((l) => l.startsWith("- ") && l.includes(" reacted "))
    return fauxAssistantMessage(lines.length ? `brief: ${lines.map((l) => l.slice(2)).join(" | ")}` : "brief: none")
  }
  if (newest.includes("[slow]")) return fauxAssistantMessage(`${LONG} ${heard}`)
  if (newest.includes("[two-part]")) return fauxAssistantMessage(`part one.\n\n${LONG} ${heard}`)
  return fauxAssistantMessage(heard)
}

/** Sleeps, and stops sleeping when the run is aborted. Effect: read (it touches nothing). */
const slowTool = defineTool({
  name: SLOW_TOOL,
  description: "waits a few seconds, then says slept.",
  parameters: Type.Object({}),
  execute: async (_args, _api, context) => {
    await awaitWithContext(new Promise((resolve) => setTimeout(resolve, SLOW_TOOL_MS)), context)
    return { content: [{ type: "text", text: "slept" }] }
  },
})

export const SLOW_TOOL_EXTENSION: Extension = defineExtension({ name: "test-slow-tool", tools: [declareEffect("read", slowTool)] })

// P7-01, architecture section 16. Fake tools, one per effect, for `bun kiko verify injection`.
// `fake_send` stands for any action outside kiko. The trust gate must stop it in a tainted run.

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
/** `x`, or `x (tainted)` when the trust extension says the run is tainted. */
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
    defineTool({ name: "fake_lookup", description: "looks something up in kiko.", parameters: Type.Object({}), execute: async () => text("found") }),
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
    defineTool({ name: "fake_send", description: "sends an email outside kiko.", parameters: Type.Object({}), execute: async () => text("sent") }),
  ),
}

export const TRUST_TOOLS_EXTENSION: Extension = defineExtension({ name: "test-trust-tools", tools: Object.values(TRUST_TOOLS) })

const isTrustTool = (name: string): name is keyof typeof TRUST_TOOLS => Object.hasOwn(TRUST_TOOLS, name)

/** The trust tool calls the newest turn asks for: a user turn, or the tool results since the last call. */
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

/** `tools: fake_fetch ran, fake_send blocked`, or null when no trust tool ran this run. */
function trustResults(since: readonly Message[]): string | null {
  const results = since.filter((m) => m.role === "toolResult" && isTrustTool(m.toolName ?? ""))
  if (!results.length) return null
  const state = (t: string) => (t.includes("Tool call blocked") ? "blocked" : t.includes("(tainted)") ? "ran tainted" : "ran")
  return `tools: ${results.map((m) => `${m.toolName} ${state(textOf(m))}`).join(", ")}`
}

/** The fake agent's setup. The factory builds it, with the slow tool as a test extension. */
/** The team tool call a user turn asks for (P6-03), or null. A teammate's `[echo]` goes back to that teammate. */
function teamCall(turn: string) {
  const agent = [...turn.matchAll(/<agent-message from="([^"]+)"[^>]*>([\s\S]*?)<\/agent-message>/g)].at(-1)
  if (agent && agent[2]!.includes("[echo]")) return fauxToolCall("send_message", { to: agent[1]!, text: "[echo]" })
  const send = /\[send ([a-z0-9-]+)\]\s*([\s\S]*)$/.exec(turn)
  if (send) return fauxToolCall("send_message", { to: send[1]!, text: send[2]! })
  if (turn.includes("[shout]")) return fauxToolCall("broadcast", { text: "[shout]" })
  const check = /\[check ([a-z0-9-]+)\]/.exec(turn)
  return check ? fauxToolCall("check_agent", { slug: check[1]! }) : null
}

export function fakeSetup(role: RoleInput = { role: "", lead: true }, workspace?: WorkspacePort, messaging?: BuildAgentInput["messaging"], approvals?: Approvals, scripts?: BuildAgentInput["scripts"]) {
  const faux = fauxProvider({ tokensPerSecond: TOKENS_PER_SECOND })
  const step = (context: { messages: readonly unknown[] }) => fakeReply(context.messages as Message[])
  faux.setResponses(Array.from({ length: 500 }, () => step))
  const models = createModels()
  models.setProvider(faux.provider)
  return { models, ...buildAgent({ ...role, model: FAKE_MODEL, messaging, ...(workspace ? { workspace } : {}), ...(approvals ? { approvals } : {}), ...(scripts ? { scripts } : {}), testExtensions: [SLOW_TOOL_EXTENSION, TRUST_TOOLS_EXTENSION] }) } satisfies AgentSetup
}

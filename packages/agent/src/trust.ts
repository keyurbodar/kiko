import type { Context } from "@earendil-works/chord"
import type { Message } from "@earendil-works/pi-ai"
import {
  type ConversationId,
  defineExtension,
  type Extension,
  GenerationTask,
  hook,
  type HookApi,
  type ToolExecutionApi,
  type ToolExecutionResult,
  ToolTask,
} from "@earendil-works/pi-durable"
import type { Effect, EffectDeclaration } from "./effects"
import { type Authority, HUMAN } from "./authority"

export const TRUST = "trust"

export type ExternalCall = { conversationId: ConversationId; callId: string; tool: string; arguments: Record<string, unknown> }

export type Approvals = (call: ExternalCall, context: Context) => Promise<string | { refused: string } | null>

export type ExternalDecision = { tool: string; callId: string; tainted: boolean; approval: string | null; ran: boolean }

export type TrustOptions = {
  effects: ReadonlyMap<string, EffectDeclaration>
  approvals?: Approvals
  authority?: () => Authority
}

type TrustState = {
  taint: Map<ConversationId, boolean>
  marked: Map<string, string>
  externals: ExternalDecision[]
  authority: () => Authority
}

const STATES = new WeakMap<Extension, TrustState>()
const MAX_DECISIONS = 200

export type Gate =
  | { allow: true;  flagTainted: boolean }
  | { allow: false; reason: string }

export const NO_CARD = "not run: no human asked for this run, and kiko could not post a card for the human's ok. go on without it."

export function needsApproval(authority: Authority, tool: string): boolean {
  if (authority.origin === "human") return false
  return !(authority.origin === "routine" && authority.grant.includes(tool))
}

export function gate(effect: Effect, tainted: boolean, approval: string | null, authority: Authority = HUMAN, tool = ""): Gate {
  switch (effect) {
    case "read":
      return { allow: true, flagTainted: false }
    case "write":
    case "message":
      return { allow: true, flagTainted: tainted }
    case "external":
      return !needsApproval(authority, tool) || approval ? { allow: true, flagTainted: false } : { allow: false, reason: NO_CARD }
  }
}

const KIKO_TAGS = ["untrusted", "agent-message", "system-event", "context", "human", "user", "system", "assistant", "tool", "kiko"]
const OPENERS = "<＜﹤‹〈⟨〈"
const LOOKALIKE = new RegExp(`[${OPENERS}](\\s*\\/?\\s*)(${KIKO_TAGS.join("|")})(?![\\w-])`, "giu")

export function escapeLookalikes(text: string): string {
  return text.normalize("NFKC").replace(LOOKALIKE, (_m, slash: string, name: string) => `&lt;${slash}${name}`)
}

const attr = (value: string) => value.replace(/[^\w.:-]/g, "_")

export function wrapUntrusted(text: string, source: string, nonce: string): string {
  return `<untrusted source="${attr(source)}" id="${nonce}">\n${escapeLookalikes(text)}\n</untrusted>`
}

const UNTRUSTED_BLOCK = /<untrusted source="[\w.:-]*" id="[0-9a-f]{32}">/
const TAINTED_ENVELOPE = /<(agent-message|system-event)\b[^>\n]*\btainted="true"/

const textOf = (message: Message): string => {
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((p: { type?: string; text?: string }) => (p.type === "text" ? (p.text ?? "") : "")).join("")
}

const isFinalAnswer = (m: Message) =>
  m.role === "assistant" && m.stopReason !== "aborted" && m.stopReason !== "toolUse" && !m.content.some((p) => p.type === "toolCall")

export function runTainted(messages: readonly Message[]): boolean {
  const start = messages.findLastIndex(isFinalAnswer) + 1
  return messages.slice(start).some(taints)
}

export function taints(m: Message): boolean {
  return (m.role === "user" && TAINTED_ENVELOPE.test(textOf(m))) || (m.role === "toolResult" && UNTRUSTED_BLOCK.test(textOf(m)))
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

const nonceFor = (api: HookApi, context: Context) => api.memo<string>("trust:nonce", hex(crypto.getRandomValues(new Uint8Array(16))), context)

async function wrapResult(result: ToolExecutionResult, source: string, api: HookApi, context: Context): Promise<ToolExecutionResult> {
  const parts = result.content ?? []
  const text = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")
  const others = parts.filter((p) => p.type !== "text")
  const wrapped = wrapUntrusted(text, source, await nonceFor(api, context))
  return { ...result, content: [{ type: "text", text: wrapped }, ...others] }
}

export function trustExtension(options: TrustOptions): Extension {
  const authority = options.authority ?? (() => HUMAN)
  const state: TrustState = { taint: new Map(), marked: new Map(), externals: [], authority }
  const approvals: Approvals = options.approvals ?? (async () => null)
  const declared = (name: string): EffectDeclaration => options.effects.get(name) ?? { effect: "external" }

  const extension = defineExtension({
    name: TRUST,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }, api) => {
          state.taint.set(api.conversationId, runTainted(messages))
          return undefined
        },
      }),
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          const { effect } = declared(call.name)
          const tainted = state.taint.get(api.conversationId) ?? true
          const run = authority()
          const answer =
            effect === "external" && needsApproval(run, call.name)
              ? await approvals({ conversationId: api.conversationId, callId: call.id, tool: call.name, arguments: call.arguments }, context)
              : null
          const approval = typeof answer === "string" ? answer : null
          const gated = gate(effect, tainted, approval, run, call.name)
          const decision = !gated.allow && answer && typeof answer === "object" ? { allow: false as const, reason: answer.refused } : gated
          if (effect === "external") {
            state.externals.push({ tool: call.name, callId: call.id, tainted, approval, ran: decision.allow })
            if (state.externals.length > MAX_DECISIONS) state.externals.shift()
          }
          return decision.allow ? undefined : { block: decision.reason }
        },
        afterTool: async (call, result, api, context) => {
          const key = `${api.conversationId}:${call.id}`
          const source = declared(call.name).outside ?? state.marked.get(key)
          state.marked.delete(key)
          if (!source) return undefined
          state.taint.set(api.conversationId, true)
          return wrapResult(result, source, api, context)
        },
      }),
    ],
  })
  STATES.set(extension, state)
  return extension
}

function stateOf(api: Pick<ToolExecutionApi, "registry">): TrustState {
  const extension = api.registry.extension(TRUST)
  const state = extension && STATES.get(extension)
  if (!state) throw new Error("the trust extension is not installed. build agents with factory.ts")
  return state
}

export function markRunTainted(api: Pick<ToolExecutionApi, "registry" | "conversationId" | "callId">, source: string): void {
  const state = stateOf(api)
  state.taint.set(api.conversationId, true)
  state.marked.set(`${api.conversationId}:${api.callId}`, source)
}

export function isRunTainted(api: Pick<ToolExecutionApi, "registry" | "conversationId">): boolean {
  return stateOf(api).taint.get(api.conversationId) ?? true
}

export function runAuthority(api: Pick<ToolExecutionApi, "registry">): Authority {
  return stateOf(api).authority()
}

export function externalDecisions(extension: Extension): readonly ExternalDecision[] {
  return STATES.get(extension)?.externals ?? []
}

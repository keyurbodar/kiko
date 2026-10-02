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
import type { Effect, EffectDeclaration } from "../effects"

// Architecture section 16. `Trust` limits what an injected instruction can do, in code. The model
// can be fooled; the gate below sets the limit on the damage.
//
// - `afterTool` wraps a result of outside content in `<untrusted source="..." id="NONCE">`, escapes
//   every look-alike tag inside it, and taints the run.
// - `beforeRequest` works out the run's taint from the transcript before every model request, so a
//   tainted agent envelope starts a tainted run and taint ends with the run's final answer.
// - `beforeTool` applies the table of section 16.3. An `external` tool in a tainted run needs a
//   human approval record (P7-02 provides them through `approvals`).
//
// The factory always selects this extension. Tools reach it through `isRunTainted` and
// `markRunTainted`, which find this agent's state from the tool's `api.registry`.

export const TRUST = "trust"

/** One `external` call a tainted run wants to make. P7-02 answers it with an approval id or null. */
export type ExternalCall = { conversationId: ConversationId; callId: string; tool: string; arguments: Record<string, unknown> }

/** Returns the id of the human's approval record for this call, or null when there is none. */
export type Approvals = (call: ExternalCall, context: Context) => Promise<string | null>

/** One `external` call the gate saw. A test asserts no row has `ran` with `tainted` and no `approval`. */
export type ExternalDecision = { tool: string; callId: string; tainted: boolean; approval: string | null; ran: boolean }

export type TrustOptions = {
  /** Tool effects by name, from `effectTable`. A name not in it is treated as `external`. */
  effects: ReadonlyMap<string, EffectDeclaration>
  /** Default: no approval ever exists, so a tainted run never acts outside kiko. */
  approvals?: Approvals
}

type TrustState = {
  /** The run's taint per conversation. Absent means unknown, which counts as tainted. */
  taint: Map<ConversationId, boolean>
  /** `conversation:callId` of calls a tool marked as outside content with `markRunTainted`. */
  marked: Map<string, string>
  /** Every `external` decision of this process, newest last. Kept short. */
  externals: ExternalDecision[]
}

const STATES = new WeakMap<Extension, TrustState>()
const MAX_DECISIONS = 200

// ---------------------------------------------------------------------------------------------
// The gate (section 16.3). A pure table.

export type Gate =
  | { allow: true; /** Set for a write or a message from a tainted run: flag what it stores or sends. */ flagTainted: boolean }
  | { allow: false; reason: string }

export const NEEDS_APPROVAL = "needs human approval: this run read outside content, so it cannot act outside kiko without the human's ok."

/**
 * | effect   | clean run | tainted run                                     |
 * | -------- | --------- | ----------------------------------------------- |
 * | read     | allow     | allow                                           |
 * | write    | allow     | allow, the stored item is flagged tainted       |
 * | message  | allow     | allow, the envelope carries `tainted: true`     |
 * | external | allow     | allow only with a human approval record         |
 */
export function gate(effect: Effect, tainted: boolean, approval: string | null): Gate {
  if (!tainted) return { allow: true, flagTainted: false }
  switch (effect) {
    case "read":
      return { allow: true, flagTainted: false }
    case "write":
    case "message":
      return { allow: true, flagTainted: true }
    case "external":
      return approval ? { allow: true, flagTainted: true } : { allow: false, reason: NEEDS_APPROVAL }
  }
}

// ---------------------------------------------------------------------------------------------
// Marking (section 16.2).

/** Tag names kiko gives meaning to. A look-alike of any of them inside outside content is escaped. */
const KIKO_TAGS = ["untrusted", "agent-message", "system-event", "context", "human", "user", "system", "assistant", "tool", "kiko"]
/** `<` and the brackets that render like it. */
const OPENERS = "<＜﹤‹〈⟨〈"
const LOOKALIKE = new RegExp(`[${OPENERS}](\\s*\\/?\\s*)(${KIKO_TAGS.join("|")})(?![\\w-])`, "giu")

/** Escapes every opening or closing tag that looks like one of kiko's, in any case and with any bracket. */
export function escapeLookalikes(text: string): string {
  // Fold full-width forms first, so `＜ｕｎｔｒｕｓｔｅｄ＞` cannot slip past the tag names. The content is
  // data, so the fold changes nothing the model needs.
  return text.normalize("NFKC").replace(LOOKALIKE, (_m, slash: string, name: string) => `&lt;${slash}${name}`)
}

const attr = (value: string) => value.replace(/[^\w.:-]/g, "_")

/** The block a result of outside content becomes. The nonce makes the closing tag unguessable. */
export function wrapUntrusted(text: string, source: string, nonce: string): string {
  return `<untrusted source="${attr(source)}" id="${nonce}">\n${escapeLookalikes(text)}\n</untrusted>`
}

/** Matches the opening of a block made by `wrapUntrusted`. Escaped look-alikes never match. */
const UNTRUSTED_BLOCK = /<untrusted source="[\w.:-]*" id="[0-9a-f]{32}">/
/** An agent or system envelope from a tainted run, as `renderInput` writes it. */
const TAINTED_ENVELOPE = /<(agent-message|system-event)\b[^>\n]*\btainted="true"/

const textOf = (message: Message): string => {
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((p: { type?: string; text?: string }) => (p.type === "text" ? (p.text ?? "") : "")).join("")
}

const isFinalAnswer = (m: Message) =>
  m.role === "assistant" && m.stopReason !== "aborted" && m.stopReason !== "toolUse" && !m.content.some((p) => p.type === "toolCall")

/**
 * Whether the current run has read outside content. The run is every message after the last final
 * answer. It is tainted when one of its inputs is a tainted envelope, or one of its tool results is
 * an `<untrusted>` block. A human could type the marker; that only taints, which is the safe side.
 */
export function runTainted(messages: readonly Message[]): boolean {
  const start = messages.findLastIndex(isFinalAnswer) + 1
  for (const m of messages.slice(start)) {
    if (m.role === "user" && TAINTED_ENVELOPE.test(textOf(m))) return true
    if (m.role === "toolResult" && UNTRUSTED_BLOCK.test(textOf(m))) return true
  }
  return false
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

/** A random nonce, memoized on the tool task so a replayed result is identical. */
const nonceFor = (api: HookApi, context: Context) => api.memo<string>("trust:nonce", hex(crypto.getRandomValues(new Uint8Array(16))), context)

/** Wraps the text parts of a result in one `<untrusted>` block. Images pass through. */
async function wrapResult(result: ToolExecutionResult, source: string, api: HookApi, context: Context): Promise<ToolExecutionResult> {
  const parts = result.content ?? []
  const text = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")
  const others = parts.filter((p) => p.type !== "text")
  const wrapped = wrapUntrusted(text, source, await nonceFor(api, context))
  return { ...result, content: [{ type: "text", text: wrapped }, ...others] }
}

// ---------------------------------------------------------------------------------------------
// The extension.

/** Built by the factory only, once per agent process. */
export function trustExtension(options: TrustOptions): Extension {
  const state: TrustState = { taint: new Map(), marked: new Map(), externals: [] }
  const approvals: Approvals = options.approvals ?? (async () => null)
  const declared = (name: string): EffectDeclaration => options.effects.get(name) ?? { effect: "external" }

  const extension = defineExtension({
    name: TRUST,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }, api) => {
          // The transcript is the durable truth. This also clears taint once a run has answered.
          state.taint.set(api.conversationId, runTainted(messages))
          return undefined
        },
      }),
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          const { effect } = declared(call.name)
          // Unknown after a restart between the request and this call: fail closed.
          const tainted = state.taint.get(api.conversationId) ?? true
          const approval =
            effect === "external" && tainted
              ? await approvals({ conversationId: api.conversationId, callId: call.id, tool: call.name, arguments: call.arguments }, context)
              : null
          const decision = gate(effect, tainted, approval)
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

/**
 * For a tool that read outside content but did not declare `outside` (P8-05 web fetch may need it
 * when only some calls fetch). Taints the calling run at once, and the trust extension wraps this
 * call's result in an `<untrusted source>` block, so the taint survives in the transcript. Declaring
 * `declareEffect("read", tool, { outside: "web" })` does the same for every call and is preferred.
 */
export function markRunTainted(api: Pick<ToolExecutionApi, "registry" | "conversationId" | "callId">, source: string): void {
  const state = stateOf(api)
  state.taint.set(api.conversationId, true)
  state.marked.set(`${api.conversationId}:${api.callId}`, source)
}

/**
 * Whether the calling run is tainted. A `write` tool flags what it stores with it (section 13.2), and
 * a `message` tool sets the envelope's `tainted` with it. Unknown counts as tainted.
 */
export function isRunTainted(api: Pick<ToolExecutionApi, "registry" | "conversationId">): boolean {
  return stateOf(api).taint.get(api.conversationId) ?? true
}

/** Every `external` decision this process made, oldest first. For tests and the dev fake agent. */
export function externalDecisions(extension: Extension): readonly ExternalDecision[] {
  return STATES.get(extension)?.externals ?? []
}

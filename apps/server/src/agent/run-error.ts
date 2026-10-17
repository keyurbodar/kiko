import type { ErrorAction, RunErrorAction, RunErrorKind } from "@kiko/protocol"

// Sorted by what the human can do about it. The first row that matches wins, so the rows that mean
// "your key" come before the ones that mean "the provider is busy".
const KINDS: readonly (readonly [RunErrorKind, RegExp])[] = [
  ["too_long", /context[ _-]?(length|window)|maximum context|prompt is too long|too many tokens|input is too long|token limit|exceeds the (model|context)/i],
  ["model_not_found", /model[^.]{0,40}(not found|does not exist|not available|unknown|unsupported|is not supported)|unknown model|no such model|invalid model|\bnot[_ ]found\b.{0,40}model|\b404\b/i],
  ["quota", /quota|credit balance|insufficient[ _](funds|credit|balance)|billing|payment required|\b402\b|usage limit|exceeded your current/i],
  ["invalid_key", /\b(401|403)\b|invalid[ _-]?(x-)?api[ _-]?key|incorrect api key|authentication|unauthori[sz]ed|permission[ _]denied|invalid[ _]token|no api key/i],
  ["rate_limit", /\b429\b|rate[ _-]?limit|too many requests|resource[ _]exhausted/i],
  ["refused", /content[ _-]?(filter|policy)|safety|refus|violat|blocked|moderation/i],
  ["timeout", /timed? ?out|timeout|deadline exceeded|\b504\b|stalled/i],
  ["overloaded", /overloaded|\b(502|503|529)\b|unavailable|bad gateway|capacity|\b5\d\d\b/i],
  ["network", /connection (error|reset|refused|closed)|fetch failed|network|econn|enotfound|socket hang up|dns|offline/i],
]

const DETAIL_MAX = 300

/** Cuts out anything that looks like a key or a bearer token. */
export function redact(text: string): string {
  return text
    .replace(/(bearer\s+)\S+/gi, "$1[hidden]")
    .replace(/\b(sk|pk|rk|key|tok|ghp|xox[abp])[-_][A-Za-z0-9_-]{8,}/gi, "[hidden]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]")
}

/**
 * The provider's own words, shown small under kiko's sentence so the human sees what actually went wrong.
 * Anything that looks like a key or a bearer token is cut out, and the text is capped.
 */
export function runErrorDetail(message: string | undefined): string | undefined {
  const text = redact(message ?? "").replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text
}

export function classifyRunError(message: string | undefined): RunErrorKind {
  const text = message ?? ""
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other"
}

type Reply = { message: (provider: string, name: string) => string; actions: readonly RunErrorAction[] }

/** The fixed sentence for each failure and what the human can do. Never the provider's own words. */
const REPLIES: Record<RunErrorKind, Reply> = {
  no_key: { message: (p, n) => `${n} cannot answer yet. ${p} is not connected.`, actions: ["open_settings", "retry"] },
  invalid_key: { message: (p) => `${p} did not accept the key. Check the key, then retry.`, actions: ["open_settings", "change_model", "retry"] },
  quota: { message: (p) => `${p} says the quota or credit is used up. Check the plan or the billing.`, actions: ["open_settings", "change_model", "retry"] },
  rate_limit: { message: (p) => `${p} is rate limiting requests. Wait a moment, then retry.`, actions: ["retry", "change_model"] },
  model_not_found: { message: (p) => `${p} does not offer this model. Pick another one.`, actions: ["change_model", "open_settings"] },
  network: { message: (p) => `Kiko could not reach ${p}. Check the connection, then retry.`, actions: ["retry", "change_model"] },
  overloaded: { message: (p) => `${p} is overloaded right now. Retry in a moment.`, actions: ["retry", "change_model"] },
  timeout: { message: (p) => `${p} took too long to answer. Retry.`, actions: ["retry", "change_model"] },
  refused: { message: (_p, n) => `The model refused that request. ${n} could not answer it.`, actions: ["retry", "change_model"] },
  too_long: { message: () => "This chat is too long for the model. Pick a model with a larger context, or start a new chat.", actions: ["change_model"] },
  other: { message: (_p, n) => `${n} hit an error and could not answer. Retry, or pick another model.`, actions: ["retry", "change_model", "open_settings"] },
}

type RunFailure = { kind: RunErrorKind; message: string; actions: readonly RunErrorAction[]; toast: ErrorAction | undefined }

/** `provider` is the provider's display name, `agent` the agent's. */
export function describeRunError(kind: RunErrorKind, provider: string, agent: string): RunFailure {
  const reply = REPLIES[kind]
  return { kind, message: reply.message(provider, agent), actions: reply.actions, toast: reply.actions.includes("open_settings") && kind !== "other" ? "open_models" : undefined }
}

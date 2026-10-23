import type { ErrorAction, RunErrorAction, RunErrorKind } from "@kiko/protocol"
import { RETRY_AFTER_TOO_LONG } from "./retry"

const KINDS: readonly (readonly [RunErrorKind, RegExp])[] = [
  [
    "too_long",
    /context[ _-]?(length|window)|maximum context|prompt is too long|too many tokens|input is too long|token limit|exceeds the (model|context)/i,
  ],
  [
    "model_not_found",
    /model[^.]{0,40}(not found|does not exist|not available|unknown|unsupported|is not supported)|unknown model|no such model|invalid model|\bnot[_ ]found\b.{0,40}model|\b404\b/i,
  ],
  [
    "quota",
    /quota|credit balance|insufficient[ _](funds|credit|balance)|billing|payment required|\b402\b|usage limit|exceeded your current/i,
  ],
  [
    "invalid_key",
    /\b(401|403)\b|invalid[ _-]?(x-)?api[ _-]?key|incorrect api key|authentication|unauthori[sz]ed|permission[ _]denied|invalid[ _]token|no api key/i,
  ],
  ["rate_limit", /\b429\b|rate[ _-]?limit|too many requests|resource[ _]exhausted/i],
  ["refused", /content[ _-]?(filter|policy)|safety|refus|violat|blocked|moderation/i],
  ["timeout", /timed? ?out|timeout|deadline exceeded|\b504\b|stalled|stopped responding/i],
  ["cut_off", /stream ended without finish_reason|terminated|premature close|unexpected end of (stream|json input)/i],
  ["overloaded", /overloaded|\b(502|503|529)\b|unavailable|bad gateway|capacity|\b5\d\d\b/i],
  [
    "network",
    /connection (error|reset|refused|closed)|fetch failed|network|econn|enotfound|socket hang up|dns|offline/i,
  ],
]

const DETAIL_MAX = 300

const FATAL: Readonly<Record<RunErrorKind, boolean>> = {
  no_key: true,
  signed_out: true,
  invalid_key: true,
  quota: true,
  no_model: true,
  model_not_found: true,
  refused: true,
  too_long: true,
  rate_limit: false,
  network: false,
  overloaded: false,
  timeout: false,
  cut_off: false,
  other: false,
}

export const stopsWorkers = (kind: RunErrorKind): boolean => FATAL[kind]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function redact(text: string): string {
  return text
    .replace(/(bearer\s+)\S+/gi, "$1[hidden]")
    .replace(/\b(sk|pk|rk|key|tok|ghp|xox[abp])[-_][A-Za-z0-9_-]{8,}/gi, "[hidden]")
    .replace(/[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : "[hidden]"))
}

const HTML = /<!doctype html|<html[\s>]/i

function providerWords(message: string | undefined): string {
  const text = message ?? ""
  const start = text.search(HTML)
  if (start < 0) return text
  const page = text.slice(start)
  const pick = (tag: string) =>
    page
      .match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]
      ?.replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const said = [...new Set([pick("title"), pick("h1")].filter((t): t is string => !!t))].join(". ")
  return [
    text.slice(0, start).trim(),
    `The provider answered with a web page instead of an answer${said ? `: ${said}` : "."}`,
  ]
    .filter(Boolean)
    .join(" ")
}

export function runErrorDetail(message: string | undefined): string | undefined {
  const text = redact(providerWords(message)).replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text
}

export function classifyRunError(message: string | undefined): RunErrorKind {
  const text = providerWords(message)
  if (text.includes(RETRY_AFTER_TOO_LONG)) return "rate_limit"
  const kind = KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other"
  return kind === "refused" && HTML.test(message ?? "") ? "other" : kind
}

type Reply = { reason: string; actions: readonly RunErrorAction[] }

const REPLIES: Record<RunErrorKind, Reply> = {
  no_key: { reason: "not connected", actions: ["open_settings", "retry"] },
  signed_out: { reason: "sign-in expired", actions: ["open_settings", "retry"] },
  no_model: { reason: "no model picked", actions: ["change_model", "retry"] },
  invalid_key: { reason: "key or sign-in not accepted", actions: ["open_settings", "retry"] },
  quota: { reason: "quota or credit used up", actions: ["open_settings", "change_model"] },
  rate_limit: { reason: "rate limited", actions: ["retry", "change_model"] },
  model_not_found: { reason: "model not offered", actions: ["change_model", "open_settings"] },
  network: { reason: "could not reach it", actions: ["retry", "change_model"] },
  overloaded: { reason: "overloaded", actions: ["retry", "change_model"] },
  timeout: { reason: "request timed out", actions: ["retry", "change_model"] },
  cut_off: { reason: "connection closed early", actions: ["retry", "change_model"] },
  refused: { reason: "request refused", actions: ["retry", "change_model"] },
  too_long: { reason: "chat too long for the model", actions: ["change_model"] },
  other: { reason: "returned an error", actions: ["retry", "change_model"] },
}

type RunFailure = {
  kind: RunErrorKind
  message: string
  actions: readonly RunErrorAction[]
  toast: ErrorAction | undefined
}

export function describeRunError(kind: RunErrorKind, provider: string): RunFailure {
  const reply = REPLIES[kind]
  return {
    kind,
    message: provider ? `${provider}: ${reply.reason}` : reply.reason,
    actions: reply.actions,
    toast: reply.actions.includes("open_settings") ? "open_models" : undefined,
  }
}

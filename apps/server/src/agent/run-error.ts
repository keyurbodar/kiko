import type { RunErrorKind } from "@kiko/protocol"

// Sorted by what the user can do about it. The first row that matches wins, so the rows that mean
// "your key" come before the ones that mean "the provider is busy".
const KINDS: readonly (readonly [RunErrorKind, RegExp])[] = [
  ["too_long", /context[ _-]?(length|window)|maximum context|prompt is too long|too many tokens|input is too long|token limit|exceeds the (model|context)/i],
  ["invalid_key", /\b(401|403)\b|invalid[ _-]?(x-)?api[ _-]?key|incorrect api key|authentication|unauthori[sz]ed|permission[ _]denied|invalid[ _]token|credit balance|billing|no api key/i],
  ["rate_limit", /\b429\b|rate[ _-]?limit|quota|too many requests|resource[ _]exhausted/i],
  ["refused", /content[ _-]?(filter|policy)|safety|refus|violat|blocked|moderation/i],
  ["provider_down", /\b(5\d\d)\b|overloaded|unavailable|bad gateway|timed? ?out|timeout|connection (error|reset|refused)|fetch failed|network|econn|socket hang up/i],
]

export function classifyRunError(message: string | undefined): RunErrorKind {
  const text = message ?? ""
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other"
}

// A provider can echo part of a key in its error. Long unbroken tokens and anything after "key" or
// "bearer" never leave the server.
export function scrubDetail(message: string, max = 200): string {
  const clean = message
    .replace(/(bearer|api[ _-]?key|token)\W+\S+/gi, "$1 [hidden]")
    .replace(/\S{24,}/g, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

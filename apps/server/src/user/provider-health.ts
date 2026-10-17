import type { ProviderProblem, RunErrorKind } from "@kiko/protocol"
import { classifyRunError } from "../agent/run-error"

type AuthFailure = "signed_out" | "unreachable" | "fresh"

// The first row that matches wins. Only a definitive refusal means the sign-in is gone; a network error, a 5xx,
// a rate limit or a timeout says nothing about the credential, so unmatched text counts as unreachable.
const AUTH_FAILURES: readonly (readonly [AuthFailure, RegExp])[] = [
  ["fresh", /expires too soon/i],
  ["unreachable", /\b(429|5\d\d)\b|timed? ?out|timeout|abort|fetch failed|network|\beconn|enotfound|socket|\bdns\b|offline|unavailable/i],
  ["signed_out", /\b(400|401|403)\b|invalid_grant|invalid_token|invalid_client|unauthori[sz]ed|forbidden|revoked|expired|reconnect|no longer valid/i],
]

/** What an OAuth refresh failure means. "fresh" is a refresh that worked but gave a short-lived token. */
export function classifyAuthFailure(message: string | undefined): AuthFailure {
  const text = message ?? ""
  return AUTH_FAILURES.find(([, pattern]) => pattern.test(text))?.[0] ?? "unreachable"
}

const PROBLEM_OF_RUN: Partial<Record<RunErrorKind, ProviderProblem>> = {
  invalid_key: "key_refused",
  signed_out: "signed_out",
  quota: "no_credit",
}

export const problemOfRun = (kind: RunErrorKind): ProviderProblem | null => PROBLEM_OF_RUN[kind] ?? null

/** A refused credential that is a sign-in reads as an expired sign-in, not a bad key. */
export const runKindFor = (kind: RunErrorKind, credential: "api_key" | "oauth" | undefined): RunErrorKind =>
  kind === "invalid_key" && credential === "oauth" ? "signed_out" : kind

/**
 * What a probe of the provider proves. A provider that answered clears the problem. A refusal or an empty balance
 * sets one. A limit or an outage proves nothing, so the stored problem stays as it is ("keep").
 */
export function probeVerdict(said: string | null, credential: "api_key" | "oauth"): ProviderProblem | null | "keep" {
  if (said === null) return null
  return problemOfRun(runKindFor(classifyRunError(said), credential)) ?? "keep"
}

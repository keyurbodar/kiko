import type { ProviderProblem, RunErrorKind } from "@kiko/protocol"
import { classifyRunError } from "../agent/run-error"
import type { ProbeReply } from "./credentials-check"

type AuthFailure = "signed_out" | "unreachable" | "fresh"

const AUTH_FAILURES: readonly (readonly [AuthFailure, RegExp])[] = [
  ["fresh", /expires too soon/i],
  [
    "unreachable",
    /\b(429|5\d\d)\b|timed? ?out|timeout|abort|fetch failed|network|\beconn|enotfound|socket|\bdns\b|offline|unavailable/i,
  ],
  [
    "signed_out",
    /\b(400|401|403)\b|invalid_grant|invalid_token|invalid_client|unauthori[sz]ed|forbidden|revoked|expired|reconnect|no longer valid/i,
  ],
]

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

export const runKindFor = (kind: RunErrorKind, credential: "api_key" | "oauth" | undefined): RunErrorKind =>
  kind === "invalid_key" && credential === "oauth" ? "signed_out" : kind

export function probeVerdict(probe: ProbeReply, credential: "api_key" | "oauth"): ProviderProblem | null | "keep" {
  if (!probe.ran) return "keep"
  if (probe.said === null) return null
  return problemOfRun(runKindFor(classifyRunError(probe.said), credential)) ?? "keep"
}

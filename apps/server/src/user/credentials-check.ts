import type { Models } from "@earendil-works/pi-ai"
import { runErrorDetail } from "../agent/run-error"

const CHECK_TIMEOUT_MS = 10_000
const REJECTED =
  /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[\w\s-]{0,24}key|incorrect api key|api key[\w\s-]{0,24}(?:invalid|not valid|rejected|revoked)/i

const KEY_REFUSED = "The provider refused that key"

export type ProbeReply = { ran: true; said: string | null } | { ran: false }

export const keyRefusedText = (said: string): string => {
  const detail = runErrorDetail(said)
  return detail ? `${KEY_REFUSED}. It said: ${detail}` : `${KEY_REFUSED}.`
}

export async function keyRefused(
  models: Models,
  provider: string,
  headers?: Record<string, string>,
  sessionId?: string,
): Promise<string | null> {
  const probe = await providerSaid(models, provider, headers, sessionId)
  return probe.ran && probe.said !== null && REJECTED.test(probe.said) ? probe.said : null
}

export async function providerSaid(
  models: Models,
  provider: string,
  headers?: Record<string, string>,
  sessionId?: string,
): Promise<ProbeReply> {
  const cheapest = models
    .getModels(provider)
    .filter((m) => m.input.includes("text"))
    .sort(
      (a, b) =>
        Number(a.reasoning) - Number(b.reasoning) || a.cost.input + a.cost.output - (b.cost.input + b.cost.output),
    )[0]
  if (!cheapest) return { ran: false }
  try {
    const reply = await models.completeSimple(
      cheapest,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { headers, ...(sessionId ? { sessionId } : {}), maxTokens: 16, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    )
    return { ran: true, said: reply.stopReason === "error" ? (reply.errorMessage ?? "") : null }
  } catch (error) {
    return { ran: true, said: error instanceof Error ? error.message : "" }
  }
}

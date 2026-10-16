import type { Models } from "@earendil-works/pi-ai"
import { runErrorDetail } from "../agent/run-error"

const CHECK_TIMEOUT_MS = 10_000
const REJECTED = /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[\w\s-]{0,24}key|incorrect api key|api key[\w\s-]{0,24}(?:invalid|not valid|rejected|revoked)/i

const KEY_REFUSED = "The provider refused that key"

/** What the person reads: kiko's sentence, then what the provider said, keys removed. */
export const keyRefusedText = (said: string): string => {
  const detail = runErrorDetail(said)
  return detail ? `${KEY_REFUSED}. It said: ${detail}` : `${KEY_REFUSED}.`
}

/**
 * Sends the cheapest request the provider offers with the candidate key. Only an answer that says the key
 * is refused fails the check; a limit, an outage, or a network error cannot prove the key bad, so the save goes on.
 * Returns the provider's words when it refused the key, else null.
 */
export async function keyRefused(models: Models, provider: string, headers?: Record<string, string>): Promise<string | null> {
  const cheapest = models
    .getModels(provider)
    .filter((m) => m.input.includes("text"))
    .sort((a, b) => Number(a.reasoning) - Number(b.reasoning) || a.cost.input + a.cost.output - (b.cost.input + b.cost.output))[0]
  if (!cheapest) return null
  try {
    const reply = await models.completeSimple(
      cheapest,
      { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
      { headers, maxTokens: 16, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    )
    const said = reply.stopReason === "error" ? (reply.errorMessage ?? "") : ""
    return REJECTED.test(said) ? said : null
  } catch (error) {
    return error instanceof Error && REJECTED.test(error.message) ? error.message : null
  }
}

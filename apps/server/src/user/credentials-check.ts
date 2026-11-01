import type { Models } from "@earendil-works/pi-ai"

const CHECK_TIMEOUT_MS = 10_000
const REJECTED =
  /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[\w\s-]{0,24}key|incorrect api key|api key[\w\s-]{0,24}(?:invalid|not valid|rejected|revoked)/i

export type KeyProblem = { readonly sentence: string; readonly status?: number }

const STATUS = /\b([45]\d{2})\b/

export function keyProblem(provider: string, said: string): KeyProblem {
  const unrecognized = `${provider} didn't recognize that key. Check that you copied all of it.`
  const status = STATUS.exec(said)?.[1]
  if (status === undefined) return { sentence: unrecognized }
  const code = Number(status)
  if (code === 401 || code === 403) return { sentence: unrecognized, status: code }
  if (code === 429) return { sentence: `${provider} is rate limiting this key. Try again in a minute.`, status: code }
  if (code >= 500) return { sentence: `${provider} is having trouble right now. Try again in a minute.`, status: code }
  return { sentence: `${provider} rejected that key.`, status: code }
}

export const keyProblemText = (provider: string, said: string): string => {
  const { sentence, status } = keyProblem(provider, said)
  return status === undefined ? sentence : `${sentence} · ${status}`
}

export type ProbeReply = { ran: true; said: string | null } | { ran: false }

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

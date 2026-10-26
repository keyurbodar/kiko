import { boundedWait } from "@kiko/durable/bounded-wait"
import { limitOf } from "./limits"

export const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 } as const

export const retrying = (attempt: number): string => `retrying, ${attempt} of ${RETRY.maxRetries}`

const MAX_RETRY_AFTER_MS = 60_000

export const RETRY_AFTER_TOO_LONG = "The provider asked to wait longer than 60 s before the next request"

const RETRYABLE = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500

type Gates = Map<string, number>

const GATES: Gates = new Map()

function gateOf(gates: Gates, keys: readonly string[], now: number): number {
  let until = 0
  for (const key of keys) {
    const at = gates.get(key)
    if (at === undefined) continue
    if (at <= now) gates.delete(key)
    else until = Math.max(until, at)
  }
  return until
}

export function withRetryAfter(
  egress: typeof fetch,
  provider = "",
  gates: Gates = GATES,
  clock: () => number = Date.now,
): (model: string) => typeof fetch {
  let notBefore = 0
  return (model) => {
    const keys = [provider, `${provider}/${model}`]
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      signal?.throwIfAborted()
      const gate = gateOf(gates, keys, clock())
      if (gate - clock() > MAX_RETRY_AFTER_MS) return tooLong(gate)
      notBefore = Math.max(notBefore, gate)
      if (notBefore > clock()) await waitUntil(notBefore, signal, clock)
      signal?.throwIfAborted()
      const response = await egress(input, init)
      if (response.ok) for (const key of keys) gates.delete(key)
      if (!RETRYABLE(response.status)) return response
      const now = clock()
      const limit = limitOf({ status: response.status, headers: response.headers, now })
      if (limit?.resetAt === undefined) return response
      gates.set(limit.scope === "model" ? `${provider}/${model}` : provider, limit.resetAt)
      if (limit.resetAt - now <= MAX_RETRY_AFTER_MS) {
        notBefore = Math.max(notBefore, limit.resetAt)
        return response
      }
      await response.body?.cancel()
      return tooLong(limit.resetAt)
    }) as typeof fetch
  }
}

function tooLong(resetAt: number): Response {
  const message = `${RETRY_AFTER_TOO_LONG}. resets_at=${new Date(resetAt).toISOString()}`
  return new Response(JSON.stringify({ error: { message } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  })
}

async function waitUntil(at: number, signal: AbortSignal | undefined, clock: () => number): Promise<void> {
  const wait = boundedWait(Math.max(0, at - clock()))
  if (!signal) return wait
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      wait.cancel()
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void wait.then(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    })
  })
}

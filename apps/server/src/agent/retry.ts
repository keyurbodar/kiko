import { boundedWait } from "@kiko/durable/bounded-wait"

export const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 } as const

export const retrying = (attempt: number): string => `retrying, ${attempt} of ${RETRY.maxRetries}`

const MAX_RETRY_AFTER_MS = 60_000

export const RETRY_AFTER_TOO_LONG = "The provider asked to wait longer than 60 s before the next request"

const RETRYABLE = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500

const NUMERIC = /^\d+(\.\d+)?$/

function retryAfterMs(headers: Headers, now: number): number | undefined {
  const millis = headers.get("retry-after-ms")?.trim()
  if (millis && NUMERIC.test(millis)) return Number(millis)
  const after = headers.get("retry-after")?.trim()
  if (!after) return undefined
  if (NUMERIC.test(after)) return Number(after) * 1_000
  const date = Date.parse(after)
  return Number.isNaN(date) ? undefined : date - now
}

export function withRetryAfter(egress: typeof fetch): typeof fetch {
  let notBefore = 0
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    signal?.throwIfAborted()
    if (notBefore > Date.now()) await waitUntil(notBefore, signal)
    signal?.throwIfAborted()
    const response = await egress(input, init)
    if (!RETRYABLE(response.status)) return response
    const asked = retryAfterMs(response.headers, Date.now())
    if (asked === undefined) return response
    if (asked <= MAX_RETRY_AFTER_MS) {
      notBefore = Math.max(notBefore, Date.now() + asked)
      return response
    }
    await response.body?.cancel()
    return tooLong()
  }) as typeof fetch
}

function tooLong(): Response {
  return new Response(JSON.stringify({ error: { message: RETRY_AFTER_TOO_LONG } }), { status: 400, headers: { "content-type": "application/json" } })
}

async function waitUntil(at: number, signal: AbortSignal | undefined): Promise<void> {
  const wait = boundedWait(Math.max(0, at - Date.now()))
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

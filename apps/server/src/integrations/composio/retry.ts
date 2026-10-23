import { boundedWait } from "@kiko/durable/bounded-wait"
import { ComposioError } from "./client"

const RETRY_DELAYS_MS = [400, 1200]
const RETRY_STATUSES = new Set([429, 502, 503, 504])
const RETRY_AFTER_MAX_MS = 10_000

export async function withRetry<T>(fn: () => Promise<T>, delays: readonly number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const delay = delays[attempt]
      if (delay === undefined || !(e instanceof ComposioError) || !e.status || !RETRY_STATUSES.has(e.status)) throw e
      const wait =
        e.retryAfter !== undefined
          ? Math.min(e.retryAfter * 1000, RETRY_AFTER_MAX_MS)
          : delay * (0.75 + Math.random() * 0.5)
      await boundedWait(wait)
    }
  }
}

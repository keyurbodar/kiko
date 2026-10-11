import { ComposioError } from "./client"

export const COMPOSIO_MAX_CONCURRENT = 40

export const RETRY_DELAYS_MS = [400, 1200]
const RETRY_STATUSES: Record<number, true> = { 429: true, 502: true, 503: true, 504: true }

/** FIFO async semaphore: at most `max` calls of `run` are in flight; a slot frees whether the call returns or throws. */
export function createLimiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active < max) active++
      else {
        const { promise, resolve } = Promise.withResolvers<void>()
        waiting.push(resolve)
        await promise
      }
      try {
        return await fn()
      } finally {
        const next = waiting.shift()
        if (next) next()
        else active--
      }
    },
  }
}

/** Retry-After in ms when the error carries one (seconds), capped at 10s. */
function retryAfterMs(e: ComposioError): number | undefined {
  const header = "retryAfter" in e ? e.retryAfter : undefined
  const seconds = typeof header === "number" ? header : typeof header === "string" ? Number(header) : Number.NaN
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 10_000) : undefined
}

/** Runs `fn`, retrying a 429/502/503/504 ComposioError after each of `delays` (jittered, or the error's Retry-After). Only for calls safe to repeat. */
export async function withRetry<T>(fn: () => Promise<T>, delays: readonly number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const delay = delays[attempt]
      if (delay === undefined || !(e instanceof ComposioError) || !e.status || !RETRY_STATUSES[e.status]) throw e
      const wait = retryAfterMs(e) ?? delay * (0.75 + Math.random() * 0.5)
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, wait)
      await promise
    }
  }
}

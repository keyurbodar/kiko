import type { LivePolicy } from "./types"

const RELOAD_MS = 1_000

export function cachedPolicy(
  initial: LivePolicy,
  load: () => Promise<LivePolicy>,
  now: () => number = Date.now,
): () => LivePolicy {
  let value = initial
  let readAt = now()
  let pending = false
  return () => {
    const current = now()
    if (pending || current - readAt < RELOAD_MS) return value
    readAt = current
    pending = true
    void load().then(
      (next) => {
        value = next
        pending = false
      },
      () => {
        pending = false
      },
    )
    return value
  }
}

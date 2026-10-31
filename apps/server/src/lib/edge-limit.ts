export function edgeLimit(limit: number, windowMs: number, now: () => number = Date.now): () => boolean {
  let start = Number.NEGATIVE_INFINITY
  let used = 0
  return () => {
    const at = now()
    if (at - start >= windowMs) {
      start = at
      used = 0
    }
    if (used >= limit) return false
    used += 1
    return true
  }
}

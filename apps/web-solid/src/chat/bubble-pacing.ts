export const BASE_GAP_MS = 350
export const PER_CHAR_MS = 12
export const MAX_GAP_MS = 1200

export const gapMs = (chars: number): number => Math.min(MAX_GAP_MS, BASE_GAP_MS + PER_CHAR_MS * Math.max(0, chars))

export function showAt(previous: number | undefined, arrivedAt: number, chars: number): number {
  if (previous === undefined) return arrivedAt
  return Math.max(arrivedAt, previous + gapMs(chars))
}

export type Offer = {
  id: string
  slug: string
  chars: number
  live: boolean
}

export type PacerOptions = {
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  onChange?: () => void
  reducedMotion?: () => boolean
}

export type Pacer = {
  offer(o: Offer): void
  isHeld(id: string): boolean
  holding(slug: string): boolean
  holders(): string[]
  flush(): void
  dispose(): void
}

type Lane = { last?: number; queue: { id: string; at: number }[]; timer?: unknown }

export function createPacer(options: PacerOptions = {}): Pacer {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const reduced = options.reducedMotion ?? (() => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  const changed = () => options.onChange?.()

  const lanes = new Map<string, Lane>()
  const held = new Set<string>()
  const seen = new Set<string>()

  function arm(lane: Lane) {
    if (lane.timer !== undefined) clearTimer(lane.timer)
    lane.timer = undefined
    const head = lane.queue[0]
    if (!head) return
    lane.timer = setTimer(() => release(lane), Math.max(0, head.at - now()))
  }

  function release(lane: Lane) {
    lane.timer = undefined
    const t = now()
    let any = false
    while (lane.queue.length > 0 && lane.queue[0].at <= t) {
      held.delete((lane.queue.shift() as { id: string }).id)
      any = true
    }
    arm(lane)
    if (any) changed()
  }

  return {
    offer(o) {
      if (seen.has(o.id)) return
      seen.add(o.id)
      if (!o.live || reduced()) return
      let lane = lanes.get(o.slug)
      if (!lane) lanes.set(o.slug, (lane = { queue: [] }))
      const at = showAt(lane.last, now(), o.chars)
      lane.last = at
      if (at <= now()) return
      lane.queue.push({ id: o.id, at })
      held.add(o.id)
      arm(lane)
      changed()
    },
    isHeld: (id) => held.has(id),
    holding: (slug) => (lanes.get(slug)?.queue.length ?? 0) > 0,
    holders: () => [...lanes].filter(([, l]) => l.queue.length > 0).map(([slug]) => slug),
    flush() {
      for (const lane of lanes.values()) {
        if (lane.timer !== undefined) clearTimer(lane.timer)
        lane.timer = undefined
        lane.queue = []
      }
      if (held.size > 0) {
        held.clear()
        changed()
      }
    },
    dispose() {
      for (const lane of lanes.values()) if (lane.timer !== undefined) clearTimer(lane.timer)
      lanes.clear()
      held.clear()
    },
  }
}

// Bubble pacing.
//
// The server posts a block the moment the model finishes it, so a long answer
// lands as one burst. The client spaces the bubbles of a live run so they
// arrive like someone texting: each one waits until a gap has passed since the
// one before, and the typing indicator shows in the gap.
//
// The scheduler is pure. It is fed arrival times and a clock, and it never
// reads the DOM. Held bubbles are already in the store; this only decides when
// the view may show them. History, a loaded transcript, and reduced motion get
// no delay.

export const BASE_GAP_MS = 350
export const PER_CHAR_MS = 12
export const MAX_GAP_MS = 1200

/** How long a bubble of `chars` characters is "typed" for, before the next one may show. */
export const gapMs = (chars: number): number => Math.min(MAX_GAP_MS, BASE_GAP_MS + PER_CHAR_MS * Math.max(0, chars))

/**
 * When a bubble may show. The first bubble of a burst shows on arrival. Each later one waits for the gap
 * after the previous bubble's show time, which may itself be in the future.
 */
export function showAt(previous: number | undefined, arrivedAt: number, chars: number): number {
	if (previous === undefined) return arrivedAt
	return Math.max(arrivedAt, previous + gapMs(chars))
}

export type Offer = {
	id: string
	/** The agent whose typing indicator covers the gap. */
	slug: string
	chars: number
	/** True for a bubble that arrived in a live run. False for history, which is never held. */
	live: boolean
}

export type PacerOptions = {
	now?: () => number
	setTimer?: (run: () => void, ms: number) => unknown
	clearTimer?: (handle: unknown) => void
	/** Called when a bubble is held or released. */
	onChange?: () => void
	reducedMotion?: () => boolean
}

export type Pacer = {
	/** Registers a bubble the first time it is seen. A repeat is ignored. */
	offer(o: Offer): void
	isHeld(id: string): boolean
	/** True while `slug` has a bubble waiting. The typing indicator stays up for it. */
	holding(slug: string): boolean
	/** The slugs with a bubble waiting. */
	holders(): string[]
	/** Shows every held bubble now. */
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

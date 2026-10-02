import { describe, expect, test } from "bun:test"
import { createPacer, gapMs, MAX_GAP_MS, showAt } from "./bubble-pacing"

describe("gapMs", () => {
	const table: [number, number][] = [
		[0, 350],
		[10, 470],
		[50, 950],
		[70, 1190],
		[71, 1200],
		[500, 1200],
	]
	for (const [chars, want] of table) test(`${chars} chars is ${want} ms`, () => expect(gapMs(chars)).toBe(want))
	test("never above the cap", () => expect(gapMs(1e6)).toBe(MAX_GAP_MS))
})

describe("showAt", () => {
	const table: [string, number | undefined, number, number, number][] = [
		["first bubble shows on arrival", undefined, 1000, 40, 1000],
		["a later bubble waits for the gap", 1000, 1010, 10, 1470],
		["a bubble that arrives after the gap shows on arrival", 1000, 5000, 10, 5000],
		["the gap counts from a show time in the future", 2000, 1000, 50, 2950],
	]
	for (const [name, prev, at, chars, want] of table) test(name, () => expect(showAt(prev, at, chars)).toBe(want))
})

function rig(reduced = false) {
	let t = 0
	const timers: { at: number; run: () => void; live: boolean }[] = []
	const pacer = createPacer({
		now: () => t,
		setTimer: (run, ms) => {
			const timer = { at: t + ms, run, live: true }
			timers.push(timer)
			return timer
		},
		clearTimer: (h) => void ((h as { live: boolean }).live = false),
		reducedMotion: () => reduced,
	})
	const advance = (to: number) => {
		for (;;) {
			const due = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0]
			if (!due) break
			t = due.at
			due.live = false
			due.run()
		}
		t = to
	}
	return { pacer, advance }
}

describe("pacer", () => {
	test("a burst of live bubbles shows one at a time", () => {
		const r = rig()
		r.pacer.offer({ id: "a", slug: "kiko", chars: 20, live: true })
		r.pacer.offer({ id: "b", slug: "kiko", chars: 20, live: true })
		r.pacer.offer({ id: "c", slug: "kiko", chars: 20, live: true })
		expect([r.pacer.isHeld("a"), r.pacer.isHeld("b"), r.pacer.isHeld("c")]).toEqual([false, true, true])
		expect(r.pacer.holding("kiko")).toBe(true)
		r.advance(589)
		expect(r.pacer.isHeld("b")).toBe(true)
		r.advance(590)
		expect([r.pacer.isHeld("b"), r.pacer.isHeld("c")]).toEqual([false, true])
		r.advance(1180)
		expect(r.pacer.isHeld("c")).toBe(false)
		expect(r.pacer.holding("kiko")).toBe(false)
	})

	test("history is never held", () => {
		const r = rig()
		for (const id of ["a", "b", "c"]) r.pacer.offer({ id, slug: "kiko", chars: 100, live: false })
		expect(r.pacer.holders()).toEqual([])
		expect(r.pacer.isHeld("b")).toBe(false)
	})

	test("reduced motion is never held", () => {
		const r = rig(true)
		for (const id of ["a", "b"]) r.pacer.offer({ id, slug: "kiko", chars: 100, live: true })
		expect(r.pacer.isHeld("b")).toBe(false)
	})

	test("a bubble offered twice is held once", () => {
		const r = rig()
		r.pacer.offer({ id: "a", slug: "kiko", chars: 5, live: true })
		r.pacer.offer({ id: "b", slug: "kiko", chars: 5, live: true })
		r.pacer.offer({ id: "b", slug: "kiko", chars: 5, live: true })
		r.advance(10_000)
		expect(r.pacer.holders()).toEqual([])
	})

	test("two agents are paced separately", () => {
		const r = rig()
		r.pacer.offer({ id: "a1", slug: "ada", chars: 20, live: true })
		r.pacer.offer({ id: "b1", slug: "bob", chars: 20, live: true })
		expect(r.pacer.isHeld("b1")).toBe(false)
		r.pacer.offer({ id: "a2", slug: "ada", chars: 20, live: true })
		expect(r.pacer.holders()).toEqual(["ada"])
	})

	test("a bubble after a long pause shows at once", () => {
		const r = rig()
		r.pacer.offer({ id: "a", slug: "kiko", chars: 20, live: true })
		r.advance(60_000)
		r.pacer.offer({ id: "b", slug: "kiko", chars: 20, live: true })
		expect(r.pacer.isHeld("b")).toBe(false)
	})

	test("flush shows everything and stops the timers", () => {
		const r = rig()
		for (const id of ["a", "b", "c"]) r.pacer.offer({ id, slug: "kiko", chars: 20, live: true })
		r.pacer.flush()
		expect(r.pacer.holders()).toEqual([])
		expect(r.pacer.isHeld("c")).toBe(false)
	})
})

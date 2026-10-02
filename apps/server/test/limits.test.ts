import { describe, expect, test } from "bun:test"
import {
	autonomousRunAllowed,
	checkSend,
	limitError,
	MAX_AUTONOMOUS_RUNS_PER_DAY,
	MAX_DELIVERIES_PER_ROOT,
	MAX_HOP,
	utcDay,
} from "../src/room/limits"

// Architecture section 7.7. Each limit at its boundary: the last allowed value passes, one more trips.

describe("hop limit", () => {
	test("a message may carry hop 8 and not hop 9", () => {
		expect(MAX_HOP).toBe(8)
		expect(checkSend(MAX_HOP, 0, 1)).toEqual({ ok: true })
		expect(checkSend(MAX_HOP + 1, 0, 1)).toEqual({ ok: false, limit: "hop" })
	})
})

describe("deliveries per root", () => {
	test("the 40th delivery passes and the 41st trips", () => {
		expect(MAX_DELIVERIES_PER_ROOT).toBe(40)
		expect(checkSend(1, MAX_DELIVERIES_PER_ROOT - 1, 1)).toEqual({ ok: true })
		expect(checkSend(1, MAX_DELIVERIES_PER_ROOT, 1)).toEqual({ ok: false, limit: "root" })
	})

	test("a broadcast that would pass the limit is refused whole", () => {
		expect(checkSend(1, MAX_DELIVERIES_PER_ROOT - 2, 2)).toEqual({ ok: true })
		expect(checkSend(1, MAX_DELIVERIES_PER_ROOT - 1, 2)).toEqual({ ok: false, limit: "root" })
	})

	test("the hop limit is reported first", () => {
		expect(checkSend(MAX_HOP + 1, MAX_DELIVERIES_PER_ROOT, 1)).toEqual({ ok: false, limit: "hop" })
	})
})

describe("autonomous runs per day", () => {
	const day = utcDay(Date.UTC(2026, 9, 2, 23, 59))
	test("the 50th run of a day starts and the 51st is held", () => {
		expect(MAX_AUTONOMOUS_RUNS_PER_DAY).toBe(50)
		expect(autonomousRunAllowed({ day, runs: MAX_AUTONOMOUS_RUNS_PER_DAY - 1 }, day)).toBe(true)
		expect(autonomousRunAllowed({ day, runs: MAX_AUTONOMOUS_RUNS_PER_DAY }, day)).toBe(false)
	})

	test("a new utc day starts at zero", () => {
		const next = utcDay(Date.UTC(2026, 9, 3, 0, 0))
		expect(day).toBe("2026-10-02")
		expect(next).toBe("2026-10-03")
		expect(autonomousRunAllowed({ day, runs: MAX_AUTONOMOUS_RUNS_PER_DAY }, next)).toBe(true)
		expect(autonomousRunAllowed(null, day)).toBe(true)
	})
})

test("a tripped limit tells the agent to summarize for the human", () => {
	for (const limit of ["hop", "root"] as const) {
		const text = limitError(limit)
		expect(text).toContain("summarize")
		expect(text).toContain("for the human")
		expect(text).toBe(text.toLowerCase())
	}
})

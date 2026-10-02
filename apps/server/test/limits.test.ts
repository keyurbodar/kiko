import { expect, test } from "bun:test"
import { DEFAULT_LIMITS, nextReset, resolveLimits, takeTurn, utcDay } from "../src/user/limits"

test("a turn is allowed up to the plan's count, then refused until the next UTC midnight", () => {
  const limits = resolveLimits({ turnsPerDay: 2 })
  const now = Date.UTC(2026, 9, 2, 15, 30)
  expect(takeTurn(0, limits, now)).toEqual({ ok: true, used: 1 })
  expect(takeTurn(1, limits, now)).toEqual({ ok: true, used: 2 })
  expect(takeTurn(2, limits, now)).toEqual({ ok: false, limit: 2, resetAt: Date.UTC(2026, 9, 3) })
  expect(utcDay(now)).toBe("2026-10-02")
  expect(nextReset(now)).toBe(Date.UTC(2026, 9, 3))
})

test("the stored record overrides the defaults, and junk is ignored", () => {
  expect(resolveLimits(null)).toEqual(DEFAULT_LIMITS)
  const r = resolveLimits({ plan: "pro", turnsPerDay: 5000, hops: -1, nope: 3 } as never)
  expect([r.plan, r.turnsPerDay, r.hops]).toEqual(["pro", 5000, DEFAULT_LIMITS.hops])
})

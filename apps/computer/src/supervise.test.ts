import { describe, expect, it } from "@effect/vitest"
import { nextDelay } from "./supervise"

describe("supervisor restart delay", () => {
  it("starts at one second and doubles while the daemon dies fast", () => {
    expect(nextDelay(0, 100)).toBe(1_000)
    expect(nextDelay(1_000, 100)).toBe(2_000)
    expect(nextDelay(2_000, 100)).toBe(4_000)
    expect(nextDelay(16_000, 9_999)).toBe(30_000)
  })

  it("stops growing at thirty seconds", () => {
    expect(nextDelay(20_000, 100)).toBe(30_000)
    expect(nextDelay(30_000, 100)).toBe(30_000)
  })

  it("starts over after a daemon that ran for ten seconds or more", () => {
    expect(nextDelay(30_000, 10_000)).toBe(1_000)
    expect(nextDelay(30_000, 60_000)).toBe(1_000)
  })
})

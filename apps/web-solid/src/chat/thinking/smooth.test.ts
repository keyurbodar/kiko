import { describe, expect, it } from "vitest"
import { smoothStep } from "./smooth"

const step = (shown: string, target: string, elapsed: number, dt: number) => smoothStep({ shown, target, elapsed, dt })

describe("smoothStep", () => {
  it("reveals at least one character per frame", () => {
    expect(step("", "abcdef", 0, 1)).toEqual({ shown: "a", elapsed: 1 })
  })

  it("drains the backlog over the smoothing window", () => {
    const target = "word ".repeat(40).trim()
    let shown = ""
    let elapsed = 0
    let frames = 0
    while (shown !== target && frames < 60) {
      const next = step(shown, target, elapsed, 16)
      expect(next.shown.startsWith(shown)).toBe(true)
      shown = next.shown
      elapsed = next.elapsed
      frames += 1
    }
    expect(shown).toBe(target)
    expect(frames).toBeLessThanOrEqual(30)
  })

  it("stops at a word boundary when the backlog is long", () => {
    const target = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda"
    const next = step("", target, 0, 16)
    expect(target.startsWith(next.shown)).toBe(true)
    expect(next.shown.endsWith(" ")).toBe(true)
    expect(next.shown.length).toBeLessThan(target.length)
  })

  it("keeps exact character steps for a short backlog", () => {
    expect(step("", "hello", 0, 450).shown).toBe("hello")
    expect(step("", "hello world", 0, 1).shown).toBe("h")
  })

  it("snaps when the new text is a rewrite", () => {
    expect(step("old thought", "new thought", 0, 16)).toEqual({ shown: "new thought", elapsed: 450 })
  })

  it("does not split a surrogate pair", () => {
    expect(step("", "😀 next", 0, 1).shown).toBe("😀")
  })
})

import { describe, expect, it } from "vitest"
import { endedThought, heardThought, thoughtMs, thoughtText } from "./thoughts"

const signal = (more: Partial<Parameters<typeof heardThought>[1]> = {}) => ({
  slug: "kiko",
  runId: "run-1",
  part: 0,
  text: "Quiet first.",
  done: false,
  ...more,
})

describe("thoughts", () => {
  it("counts only the time the agent spent thinking, across every model turn of a run", () => {
    let thought = heardThought(undefined, signal(), 1_000, 7)
    thought = heardThought(thought, signal({ text: "Quiet first. Then price.", done: true }), 4_000, 7)
    expect(thoughtMs(thought, 9_000)).toBe(3_000)

    thought = heardThought(thought, signal({ part: 1, text: "Now the walk." }), 10_000, 9)
    expect(thoughtMs(thought, 12_000)).toBe(5_000)
    expect(thoughtText(thought)).toBe("Quiet first. Then price.\n\nNow the walk.")
    expect(thought.after).toBe(7)
  })

  it("starts over for a new run", () => {
    const first = heardThought(undefined, signal({ done: true }), 1_000, 3)
    const next = heardThought(first, signal({ runId: "run-2", text: "Fresh." }), 20_000, 12)
    expect(thoughtText(next)).toBe("Fresh.")
    expect(next.after).toBe(12)
    expect(thoughtMs(next, 21_000)).toBe(1_000)
  })

  it("stops the clock when the run ends while still thinking", () => {
    const open = heardThought(undefined, signal(), 1_000, 0)
    const ended = endedThought(open, 6_000)
    expect(ended.over).toBe(true)
    expect(thoughtMs(ended, 60_000)).toBe(5_000)
  })
})

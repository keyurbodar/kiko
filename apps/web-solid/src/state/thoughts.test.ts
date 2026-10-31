import { describe, expect, it } from "vitest"
import {
  createThoughts,
  endedThought,
  finishedThoughts,
  heardThought,
  partMs,
  thoughtMs,
  thoughtText,
  type ThinkingSignal,
} from "./thoughts"

const signal = (more: Partial<ThinkingSignal> = {}): ThinkingSignal => ({
  slug: "kiko",
  runId: "run-1",
  part: 0,
  offset: 0,
  text: "Quiet first.",
  startedAt: 1_000,
  done: false,
  ...more,
})

describe("thoughts", () => {
  it("brings back a finished thought after the room is left and reopened", () => {
    const before = createThoughts()
    before.hear(signal({ text: "Quiet first.", done: true }), 7)
    before.idle("kiko")
    before.hear(signal({ runId: "run-2", text: "Still going" }), 9)
    const saved = finishedThoughts(before.all())
    expect(saved["kiko"]?.map((thought) => thought.runId)).toEqual(["run-1"])

    const after = createThoughts()
    after.hear(signal({ runId: "run-3", text: "Newer" }), 11)
    after.restore(saved)
    expect(after.all()["kiko"]?.map((thought) => thought.runId)).toEqual(["run-1", "run-3"])
    expect(thoughtText(after.all()["kiko"]![0]!)).toBe("Quiet first.")
  })

  it("appends each window a long thought arrives in, without replacing what it already shows", () => {
    let thought = heardThought(undefined, signal({ text: "Quiet first. " }), 2_000, 7)
    thought = heardThought(thought, signal({ offset: 13, text: "Then price." }), 3_000, 7)
    expect(thoughtText(thought)).toBe("Quiet first. Then price.")
    expect(partMs(thought.parts[0]!, 4_000, false)).toBe(2_000)
  })

  it("keeps what it has when a window starts past the end it knows", () => {
    let thought = heardThought(undefined, signal({ text: "Quiet first. " }), 2_000, 7)
    thought = heardThought(thought, signal({ offset: 40, text: "far tail" }), 3_000, 7)
    expect(thoughtText(thought)).toBe("Quiet first.")
    thought = heardThought(thought, signal({ offset: 13, text: "Then price." }), 3_100, 7)
    expect(thoughtText(thought)).toBe("Quiet first. Then price.")
  })

  it("resyncs to the full text the done signal carries", () => {
    let thought = heardThought(undefined, signal({ text: "Quiet first. " }), 2_000, 7)
    thought = heardThought(
      thought,
      signal({ offset: 0, text: "Quiet first. Then price. Breakfast wins.", done: true }),
      9_000,
      7,
    )
    expect(thoughtText(thought)).toBe("Quiet first. Then price. Breakfast wins.")
    expect(thought.over).toBe(false)
    expect(thought.openSince).toBeNull()
    expect(partMs(thought.parts[0]!, 60_000, false)).toBe(7_000)
  })

  it("keeps one text per model turn, in order, and counts every turn", () => {
    let thought = heardThought(undefined, signal({ text: "Quiet first." }), 1_000, 7)
    thought = heardThought(thought, signal({ text: "Quiet first.", done: true }), 4_000, 7)
    thought = heardThought(thought, signal({ part: 1, offset: 0, text: "Now the walk.", startedAt: 10_000 }), 10_000, 9)
    expect(thoughtText(thought)).toBe("Quiet first.\n\nNow the walk.")
    expect(thought.parts.map((part) => part.startedAt)).toEqual([1_000, 10_000])
    expect(thoughtMs(thought, 12_000)).toBe(5_000)
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

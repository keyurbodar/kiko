import { describe, expect, test } from "bun:test"
import { nextHold, type HoldEvent, type HoldState } from "./hints"
import { pillLabel } from "./HintLayer"

describe("holding the command key", () => {
  const run = (events: HoldEvent[]) => events.reduce<HoldState>((s, e) => nextHold(s, e), "idle")

  test("pressing Meta alone starts the hold; key repeat keeps it", () => {
    expect(run([{ type: "down", key: "Meta" }])).toBe("holding")
    expect(nextHold("shown", { type: "down", key: "Meta", repeat: true })).toBe("shown")
  })

  test("Control counts too, for other platforms", () => {
    expect(run([{ type: "down", key: "Control" }])).toBe("holding")
  })

  test("typing a shortcut cancels it, so cmd+k never flashes the hints", () => {
    expect(run([{ type: "down", key: "Meta" }, { type: "down", key: "k" }])).toBe("idle")
    expect(nextHold("shown", { type: "down", key: "k" })).toBe("idle")
  })

  test("letting go or leaving the window hides them", () => {
    expect(nextHold("shown", { type: "up", key: "Meta" })).toBe("idle")
    expect(nextHold("shown", { type: "blur" })).toBe("idle")
  })
})

describe("pill labels", () => {
  test("drop the noun and the trailing dots", () => {
    expect(pillLabel("chat: attach file...")).toBe("attach file")
    expect(pillLabel("view: toggle sidebar")).toBe("toggle sidebar")
  })
})

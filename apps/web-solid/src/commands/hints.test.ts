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
  test("drop the trailing ellipsis", () => {
    expect(pillLabel("Attach file…")).toBe("Attach file")
    expect(pillLabel("Toggle sidebar")).toBe("Toggle sidebar")
  })
})

import { place } from "./HintLayer"

describe("placing pills", () => {
  test("a pill past the right edge is pulled fully on screen", () => {
    const [box] = place([{ x: 1380, y: 40, w: 120, h: 24 }], ["bottom"], 1400, 900)
    expect(box!.x + box!.w).toBeLessThanOrEqual(1392)
  })

  test("a pill that lands on another moves along its side until clear", () => {
    const [a, b] = place([{ x: 60, y: 30, w: 110, h: 24 }, { x: 100, y: 30, w: 90, h: 24 }], ["right", "bottom"], 1400, 900)
    const clear = b!.y >= a!.y + a!.h || b!.x >= a!.x + a!.w || b!.x + b!.w <= a!.x || b!.y + b!.h <= a!.y
    expect(clear).toBe(true)
    expect(b!.y).toBeGreaterThan(a!.y)
  })

  test("pills that do not touch keep their places", () => {
    const boxes = [{ x: 20, y: 20, w: 80, h: 24 }, { x: 300, y: 20, w: 80, h: 24 }]
    expect(place(boxes, ["bottom", "bottom"], 1400, 900)).toEqual(boxes)
  })
})

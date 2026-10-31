import { describe, expect, it } from "vitest"
import type { Screen } from "./capture"
import { place } from "./place"

const LEFT: Screen = { width: 1000, height: 800, scale: 1, originX: 0, originY: 0 }
const RIGHT: Screen = { width: 800, height: 600, scale: 2, originX: 1000, originY: 0 }
const BELOW: Screen = { width: 1920, height: 1080, scale: 2, originX: -200, originY: 1080 }

describe("placing input on a display", () => {
  it("maps a normalized point to the display being watched", () => {
    expect(place(LEFT, LEFT, 0.5, 0.25)).toEqual({ x: 500, y: 200 })
    expect(place(RIGHT, RIGHT, 0.5, 0.5)).toEqual({ x: 1400, y: 300 })
  })

  it("keeps the display's own origin, negative origins included", () => {
    expect(place(BELOW, BELOW, 0, 0)).toEqual({ x: -200, y: 1080 })
    expect(place(BELOW, BELOW, 1, 1)).toEqual({ x: 1720, y: 2160 })
  })

  it("falls back to the whole desktop when no display is known", () => {
    expect(place(null, { width: 1920, height: 1080 }, 0.5, 0.5)).toEqual({ x: 960, y: 540 })
  })
})

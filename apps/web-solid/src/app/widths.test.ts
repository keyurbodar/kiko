import { afterEach, describe, expect, it, vi } from "vitest"
import { defaultWidth, fitWidths, INFO, RAIL, readPanelWidth, readWidth } from "./widths"

describe("right panel width", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("uses the design's fixed default on large screens", () => {
    expect(defaultWidth(INFO)).toBe(400)
  })

  it("keeps an owner's resized width", () => {
    vi.stubGlobal("localStorage", { getItem: () => "740" })
    expect(readWidth(INFO)).toBe(740)
  })

  it("never opens wider than 60% of the window", () => {
    vi.stubGlobal("localStorage", { getItem: () => "740" })
    expect(readPanelWidth(1440)).toBe(740)
    expect(readPanelWidth(1000)).toBe(600)
    expect(readPanelWidth(900)).toBe(540)
  })

  it("never opens narrower than the 320px minimum", () => {
    vi.stubGlobal("localStorage", { getItem: () => "200" })
    expect(readPanelWidth(1440)).toBe(400)
    expect(readPanelWidth(500)).toBe(320)
  })
})

describe("fitted widths", () => {
  it("counts a collapsed sidebar as the rail instead of the width floor", () => {
    expect(fitWidths(1440, RAIL, 400)).toEqual({ sidebar: RAIL, info: 400 })
  })

  it("keeps the right panel open only when the rail and it fit beside the chat", () => {
    expect(fitWidths(1000, RAIL, 400)).toEqual({ sidebar: RAIL, info: 400 })
    expect(fitWidths(800, RAIL, 400)).toEqual({ sidebar: RAIL, info: 0 })
  })
})

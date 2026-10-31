import { afterEach, describe, expect, it, vi } from "vitest"
import { clampPanelWidth, defaultWidth, fitSidebar, INFO, panelMaxWidth, RAIL, readWidth } from "./widths"

describe("right panel width", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("opens at t3code's 540px default", () => {
    expect(defaultWidth(INFO)).toBe(540)
  })

  it("keeps an owner's resized width", () => {
    vi.stubGlobal("localStorage", { getItem: () => "740" })
    expect(readWidth(INFO)).toBe(740)
  })

  it("never grows past 70% of the window or squeezes the chat under 360px", () => {
    expect(panelMaxWidth(1440)).toBe(1008)
    expect(panelMaxWidth(1440, 1144)).toBe(784)
    expect(panelMaxWidth(1100, 804)).toBe(444)
  })

  it("never shrinks below the 360px minimum, even when the row is tight", () => {
    expect(panelMaxWidth(1000, 600)).toBe(INFO.min)
    expect(clampPanelWidth(200, 800)).toBe(INFO.min)
    expect(clampPanelWidth(900, 444)).toBe(444)
  })
})

describe("fitted sidebar", () => {
  it("counts a collapsed sidebar as the rail instead of the width floor", () => {
    expect(fitSidebar(1440, RAIL)).toBe(RAIL)
    expect(fitSidebar(1440, 240)).toBe(280)
  })

  it("leaves the chat its minimum width", () => {
    expect(fitSidebar(600, 280)).toBe(240)
  })
})

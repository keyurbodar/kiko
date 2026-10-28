import { afterEach, describe, expect, it, vi } from "vitest"
import { defaultWidth, INFO, readWidth } from "./widths"

describe("right panel width", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("uses the design's fixed default on large screens", () => {
    expect(defaultWidth(INFO)).toBe(620)
  })

  it("keeps an owner's resized width", () => {
    vi.stubGlobal("localStorage", { getItem: () => "740" })
    expect(readWidth(INFO)).toBe(740)
  })
})

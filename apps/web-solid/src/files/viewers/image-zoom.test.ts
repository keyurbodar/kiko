import { describe, expect, it } from "vitest"
import { fitScale, stepZoom } from "./image-zoom"

describe("fitScale", () => {
  it("shrinks a big picture into the panel with a margin", () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 832, height: 600 })).toBeCloseTo(0.4)
  })

  it("never upscales a small picture", () => {
    expect(fitScale({ width: 120, height: 80 }, { width: 900, height: 600 })).toBe(1)
  })

  it("falls back to one before the picture is measured", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 900, height: 600 })).toBe(1)
  })
})

describe("stepZoom", () => {
  it("steps by a quarter and stops at the limits", () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1.25, -1)).toBe(1)
    expect(stepZoom(7.5, 1)).toBe(8)
    expect(stepZoom(0.06, -1)).toBe(0.05)
  })
})

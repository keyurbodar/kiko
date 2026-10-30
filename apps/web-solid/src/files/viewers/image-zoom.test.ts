import { describe, expect, it } from "vitest"
import { clickZoom, clampZoom, doubleClickZoom, fitScale, keyZoom, stepZoom } from "./image-zoom"

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
    expect(clampZoom(40)).toBe(8)
  })
})

describe("keyZoom", () => {
  it("maps plus, minus and zero to zoom controls", () => {
    expect(keyZoom("+", 0.5, 0.5)).toBe(0.625)
    expect(keyZoom("=", 0.5, 0.5)).toBe(0.625)
    expect(keyZoom("-", 0.5, 0.25)).toBe(0.4)
    expect(keyZoom("0", 4, 0.25)).toBe(0.25)
    expect(keyZoom("Enter", 4, 0.25)).toBeNull()
  })
})

describe("clickZoom", () => {
  it("zooms to twice fit, then returns to fit", () => {
    expect(clickZoom(0.4, 0.4)).toBe(0.8)
    expect(clickZoom(0.8, 0.4)).toBe(0.4)
  })
})

describe("doubleClickZoom", () => {
  it("toggles between fit and actual size", () => {
    expect(doubleClickZoom(0.4, 0.4)).toBe(1)
    expect(doubleClickZoom(1, 0.4)).toBe(0.4)
  })
})

import { describe, expect, test } from "bun:test"
import { contrastWithWhite, MIN_CONTRAST, parseHex, pickCardColor, readablePanel, themePanel } from "./cardColor"

/** RGBA pixels: `n` of each colour, in order. */
function pixels(...runs: [rgb: [number, number, number], n: number, alpha?: number][]): Uint8ClampedArray {
  const out: number[] = []
  for (const [[r, g, b], n, a = 255] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, a)
  return Uint8ClampedArray.from(out)
}

const hue = (hex: string) => {
  const [r, g, b] = parseHex(hex)!.map((c) => c / 255)
  const max = Math.max(r!, g!, b!)
  const min = Math.min(r!, g!, b!)
  const d = max - min
  const h = max === r ? ((g! - b!) / d + 6) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4
  return h * 60
}

describe("pickCardColor", () => {
  test("a YouTube thumbnail, mostly black bars and a red frame, gives a red panel", () => {
    const color = pickCardColor(pixels([[0, 0, 0], 300], [[230, 33, 23], 200], [[240, 240, 240], 76]))!
    expect(hue(color)).toBeLessThan(15)
    expect(contrastWithWhite(parseHex(color)!)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  test("the most common vivid hue wins, not an average of two", () => {
    // Orange and blue would average to a grey; the panel must be orange.
    const color = pickCardColor(pixels([[255, 69, 0], 300], [[30, 90, 255], 200]))!
    expect(hue(color)).toBeGreaterThan(10)
    expect(hue(color)).toBeLessThan(40)
  })

  test("a grey or nearly empty picture has no colour", () => {
    expect(pickCardColor(pixels([[128, 128, 128], 400], [[255, 255, 255], 176]))).toBeNull()
    expect(pickCardColor(pixels([[200, 200, 200], 560], [[255, 0, 0], 16]))).toBeNull()
    expect(pickCardColor(pixels([[255, 0, 0], 100, 0]))).toBeNull()
  })
})

describe("readablePanel", () => {
  test("darkens a light colour until white text reads at 4.5:1", () => {
    for (const hex of ["#ffeb3b", "#7fffd4", "#ff9900", "#d64040"]) {
      const out = readablePanel(parseHex(hex)!)
      expect(contrastWithWhite(parseHex(out)!)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })
})

describe("themePanel", () => {
  test("uses a branded theme-color and ignores white, black, and junk", () => {
    expect(themePanel("#ff4500")).not.toBeNull()
    expect(themePanel("rgb(214, 64, 64)")).not.toBeNull()
    expect(themePanel("rgba(255, 255, 255, 0.98)")).toBeNull()
    expect(themePanel("#000000")).toBeNull()
    expect(themePanel("#1e2327")).toBeNull()
    expect(themePanel("var(--x)")).toBeNull()
    expect(themePanel(undefined)).toBeNull()
  })
})

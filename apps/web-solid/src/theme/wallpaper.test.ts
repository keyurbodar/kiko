import { describe, expect, test } from "bun:test"
import { isWallpaper, MAX_WALLPAPER_CHARS, paletteOf, themeFrom } from "./wallpaper"
import { parseTheme } from "./schema"

type Rgb = [number, number, number]

/** A picture made of colour patches, each a share of the pixels. */
function picture(...patches: [Rgb, number][]): Uint8ClampedArray {
  const px: number[] = []
  for (const [[r, g, b], n] of patches) for (let i = 0; i < n; i++) px.push(r, g, b, 255)
  return new Uint8ClampedArray(px)
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

// Each row: a picture, the hue it must land near (OKLCH degrees), and the chroma range.
const PICTURES: [string, Uint8ClampedArray, number | null, [number, number]][] = [
  ["pure grey", picture([[128, 128, 128], 100]), null, [0, 0]],
  ["black and white", picture([[0, 0, 0], 50], [[255, 255, 255], 50]), null, [0, 0]],
  ["a vivid blue", picture([[40, 90, 230], 100]), 264, [1, 1.2]],
  ["a vivid red", picture([[220, 40, 40], 100]), 27, [1, 1.2]],
  // A dull wide sky and a small vivid flower bed: the vivid patch decides the hue.
  ["dull orange and a little vivid blue", picture([[150, 120, 100], 80], [[40, 90, 230], 20]), 264, [0.3, 1.2]],
  // Mostly grey with a hint of colour reads as mostly grey.
  ["grey with a speck of green", picture([[120, 120, 120], 97], [[30, 200, 60], 3]), 145, [0, 0.4]],
]

describe("the palette a wallpaper makes", () => {
  for (const [name, px, hue, [lo, hi]] of PICTURES) {
    test(name, () => {
      const p = paletteOf(px)
      if (hue !== null) expect(hueGap(p.hue, hue)).toBeLessThanOrEqual(8)
      expect(p.chroma).toBeGreaterThanOrEqual(lo)
      expect(p.chroma).toBeLessThanOrEqual(hi)
    })
  }

  test("transparent pixels do not vote", () => {
    const px = picture([[40, 90, 230], 10], [[220, 40, 40], 90])
    for (let i = 10 * 4; i < px.length; i += 4) px[i + 3] = 0
    expect(hueGap(paletteOf(px).hue, 264)).toBeLessThanOrEqual(8)
  })

  test("makes a theme the validator accepts", () => {
    expect(parseTheme(themeFrom(paletteOf(picture([[40, 90, 230], 100])))).ok).toBe(true)
  })
})

describe("a stored wallpaper", () => {
  test("is a small image data URL and nothing else", () => {
    expect(isWallpaper("data:image/webp;base64,UklGRg==")).toBe(true)
    expect(isWallpaper("data:image/jpeg;base64,/9j/4AAQ")).toBe(true)
    expect(isWallpaper("https://example.com/a.webp")).toBe(false)
    expect(isWallpaper('data:image/webp;base64,AA") ; background: red')).toBe(false)
    expect(isWallpaper("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false)
    expect(isWallpaper(`data:image/webp;base64,${"A".repeat(MAX_WALLPAPER_CHARS)}`)).toBe(false)
  })
})

describe("the sharp copy's key", () => {
  test("names one synced copy, so another picture never finds this one's sharp copy", async () => {
    const { keyOf } = await import("./wallpaper-store")
    const a = "data:image/webp;base64,UklGRg=="
    expect(keyOf(a)).toBe(keyOf(a))
    expect(keyOf(a)).not.toBe(keyOf("data:image/webp;base64,UklGRh=="))
  })
})

import { describe, expect, it } from "@effect/vitest"
import { spareKeycode, unicodeKeysym } from "./keysym"

describe("unicodeKeysym", () => {
  it("uses Latin-1 keysyms where they exist", () => {
    expect(unicodeKeysym(0x41)).toBe(0x41)
    expect(unicodeKeysym(0xe9)).toBe(0xe9)
  })

  it("uses the Unicode keysym above Latin-1", () => {
    expect(unicodeKeysym(0x7f)).toBe(0x0100007f)
    expect(unicodeKeysym(0x4e2d)).toBe(0x01004e2d)
    expect(unicodeKeysym(0x1f600)).toBe(0x0101f600)
  })
})

describe("spareKeycode", () => {
  const MIN = 8
  const MAX = 12
  const PER = 2

  function mapping(rows: number[][]): Float64Array {
    return Float64Array.from(rows.flat())
  }

  it("picks the highest keycode with no keysyms", () => {
    const syms = mapping([
      [0x61, 0x41],
      [0x62, 0x42],
      [0, 0],
      [0x63, 0],
      [0, 0],
    ])
    expect(spareKeycode(syms, MIN, MAX, PER)).toBe(12)
  })

  it("skips keycodes bound at any level", () => {
    const syms = mapping([
      [0x61, 0x41],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0x42],
    ])
    expect(spareKeycode(syms, MIN, MAX, PER)).toBe(11)
  })

  it("returns null when every keycode is bound", () => {
    const syms = mapping([
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ])
    expect(spareKeycode(syms, MIN, MAX, PER)).toBeNull()
  })
})

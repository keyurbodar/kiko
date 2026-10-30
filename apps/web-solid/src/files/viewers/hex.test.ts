import { describe, expect, it } from "vitest"
import { hexRow, hexRowCount } from "./hex"

const bytes = new TextEncoder().encode("Hi!\u0000\u0001 ~")

describe("hexRow", () => {
  it("prints an offset, padded bytes and the ascii column", () => {
    expect(hexRow(bytes, 0, 8)).toEqual({
      offset: "00000000",
      hex: "48 69 21 00 01 20 7e   ",
      ascii: "Hi!.. ~ ",
    })
  })

  it("pads the last short row and offsets in hex", () => {
    const line = hexRow(bytes, 6, 8)
    expect(line.offset).toBe("00000006")
    expect(line.hex.startsWith("7e ")).toBe(true)
    expect(line.ascii.startsWith("~")).toBe(true)
  })

  it("uses sixteen bytes across when no width is given", () => {
    expect(hexRow(bytes, 0).hex).toHaveLength(47)
    expect(hexRow(bytes, 0).ascii).toHaveLength(16)
  })
})

describe("hexRowCount", () => {
  it("counts one row for every sixteen bytes", () => {
    expect(hexRowCount(0)).toBe(0)
    expect(hexRowCount(16)).toBe(1)
    expect(hexRowCount(17)).toBe(2)
  })
})

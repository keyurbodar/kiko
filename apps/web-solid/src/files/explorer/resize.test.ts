import { describe, expect, it } from "vitest"
import { clampExplorerWidth, EXPLORER_MIN, EXPLORER_MAX, readExplorerWidth } from "./resize"

describe("clampExplorerWidth", () => {
  it("keeps a comfortable width when the row has room", () => {
    expect(clampExplorerWidth(256, 900)).toBe(256)
    expect(clampExplorerWidth(256, 256 + 256)).toBe(256)
  })

  it("never takes more than the row leaves for the file", () => {
    expect(clampExplorerWidth(560, 900)).toBe(EXPLORER_MAX)
    expect(clampExplorerWidth(256, 400)).toBe(EXPLORER_MIN)
    expect(clampExplorerWidth(256, 100)).toBe(EXPLORER_MIN)
  })

  it("never goes below the minimum", () => {
    expect(clampExplorerWidth(80, 900)).toBe(EXPLORER_MIN)
  })
})

describe("readExplorerWidth", () => {
  const store = (value: string | null) => ({ getItem: () => value })

  it("falls back to 256 for a missing or broken value", () => {
    expect(readExplorerWidth(store(null))).toBe(256)
    expect(readExplorerWidth(store("wide"))).toBe(256)
    expect(readExplorerWidth(undefined)).toBe(256)
  })

  it("reads a stored width and clamps it to the allowed range", () => {
    expect(readExplorerWidth(store("320"))).toBe(320)
    expect(readExplorerWidth(store("40"))).toBe(EXPLORER_MIN)
    expect(readExplorerWidth(store("9999"))).toBe(EXPLORER_MAX)
  })
})

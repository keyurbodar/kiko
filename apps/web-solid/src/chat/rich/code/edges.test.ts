import { describe, expect, it } from "vitest"
import { codeEdges, type ScrollBox } from "./edges"

const box = (overrides: Partial<ScrollBox> = {}): ScrollBox => ({
  scrollTop: 0,
  scrollHeight: 1000,
  clientHeight: 400,
  scrollLeft: 0,
  scrollWidth: 2000,
  clientWidth: 600,
  ...overrides,
})

describe("codeEdges", () => {
  it("shows only the right and bottom fades at the start", () => {
    expect(codeEdges(box())).toEqual({ top: false, bottom: true, left: false, right: true })
  })

  it("shows the top and left fades once the reader scrolls", () => {
    expect(codeEdges(box({ scrollTop: 600, scrollLeft: 1400 }))).toEqual({
      top: true,
      bottom: false,
      left: true,
      right: false,
    })
  })

  it("hides a fade within one pixel of the end", () => {
    expect(codeEdges(box({ scrollTop: 599, scrollLeft: 1399 })).bottom).toBe(false)
    expect(codeEdges(box({ scrollTop: 599, scrollLeft: 1399 })).right).toBe(false)
    expect(codeEdges(box({ scrollTop: 598, scrollLeft: 1398 })).bottom).toBe(true)
    expect(codeEdges(box({ scrollTop: 598, scrollLeft: 1398 })).right).toBe(true)
  })

  it("hides every fade when nothing overflows", () => {
    expect(codeEdges(box({ scrollHeight: 400, scrollWidth: 600 }))).toEqual({
      top: false,
      bottom: false,
      left: false,
      right: false,
    })
  })
})

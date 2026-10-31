import { describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"
import { clampArea } from "./linux"

vi.mock("bun:ffi", () => ({
  dlopen: () => ({ symbols: {} }),
  FFIType: {},
  JSCallback: class {
    readonly ptr = 0
  },
  toArrayBuffer: () => new ArrayBuffer(0),
}))

describe("clamping a capture to the X11 root", () => {
  it("leaves a rectangle that fits alone", () => {
    expect(clampArea({ originX: 0, originY: 0, width: 1920, height: 1080 }, 1920, 1080)).toEqual({
      originX: 0,
      originY: 0,
      width: 1920,
      height: 1080,
    })
  })

  it("cuts a rectangle that runs past the root down to the root", () => {
    expect(clampArea({ originX: 0, originY: 0, width: 2400, height: 1400 }, 1920, 1080)).toEqual({
      originX: 0,
      originY: 0,
      width: 1920,
      height: 1080,
    })
  })

  it("cuts the part above and left of the root off", () => {
    expect(clampArea({ originX: -40, originY: -30, width: 100, height: 90 }, 1920, 1080)).toEqual({
      originX: 0,
      originY: 0,
      width: 60,
      height: 60,
    })
  })

  it("returns nothing when the rectangle misses the root", () => {
    expect(clampArea({ originX: 1930, originY: 0, width: 100, height: 100 }, 1920, 1080)).toBeNull()
  })
})

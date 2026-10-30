import { describe, expect, it } from "@effect/vitest"
import { zoomOf } from "./tools"

describe("computer_look zoom", () => {
  it("zooms into a box of the last full screenshot", () => {
    expect(zoomOf([10.4, 0, 300, 40.6], "cap-1")).toEqual({ captureId: "cap-1", x: 10, y: 0, width: 300, height: 41 })
  })

  it("needs a full screenshot to zoom into", () => {
    expect(zoomOf([0, 0, 100, 100], undefined)).toContain("call computer_look without zoom")
  })

  it("refuses an empty or negative box", () => {
    expect(zoomOf([0, 0, 0, 10], "cap-1")).toContain("width and height of 1 or more")
    expect(zoomOf([-5, 0, 10, 10], "cap-1")).toContain("0 or more")
  })

  it("leaves a plain look alone", () => {
    expect(zoomOf(undefined, "cap-1")).toBeNull()
  })
})

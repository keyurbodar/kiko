import { describe, expect, test } from "bun:test"
import {
  containRect,
  flightTransform,
  lockAxis,
  pinchScale,
  resolveSwipe,
  swipeThreshold,
} from "./gestures"

const base = { width: 1000, height: 800, hasPrevious: true, hasNext: true }

describe("swipeThreshold", () => {
  test.each([
    [1000, 125],
    [500, 100],
    [375, 75],
    [625, 125],
  ])("%ipx extent commits at %ipx", (extent, expected) => {
    expect(swipeThreshold(extent)).toBe(expected)
  })
})

describe("resolveSwipe", () => {
  test.each([
    ["right past 125px goes back", { axis: "x", dx: 126, dy: 0 }, "previous"],
    ["left past 125px goes forward", { axis: "x", dx: -126, dy: 0 }, "next"],
    ["exactly at the threshold stays", { axis: "x", dx: 125, dy: 0 }, "stay"],
    ["short horizontal stays", { axis: "x", dx: 60, dy: 0 }, "stay"],
    ["down past 125px closes", { axis: "y", dx: 0, dy: 126 }, "close"],
    ["up past 125px closes", { axis: "y", dx: 0, dy: -126 }, "close"],
    ["short vertical stays", { axis: "y", dx: 0, dy: 90 }, "stay"],
    ["no axis stays", { axis: null, dx: 500, dy: 500 }, "stay"],
  ] as const)("%s", (_name, drag, expected) => {
    expect(resolveSwipe({ ...base, ...drag })).toBe(expected)
  })

  test("the 20 percent rule wins on a narrow window", () => {
    // 20 percent of 300 is 60, well under 125.
    expect(resolveSwipe({ ...base, width: 300, axis: "x", dx: -61, dy: 0 })).toBe("next")
    expect(resolveSwipe({ ...base, width: 300, axis: "x", dx: -59, dy: 0 })).toBe("stay")
  })

  test("the ends of the album do not page", () => {
    expect(resolveSwipe({ ...base, hasPrevious: false, axis: "x", dx: 200, dy: 0 })).toBe("stay")
    expect(resolveSwipe({ ...base, hasNext: false, axis: "x", dx: -200, dy: 0 })).toBe("stay")
  })
})

describe("lockAxis", () => {
  test("waits for travel", () => expect(lockAxis(3, 3)).toBeNull())
  test("picks the dominant axis", () => {
    expect(lockAxis(20, 5)).toBe("x")
    expect(lockAxis(5, -20)).toBe("y")
  })
})

describe("pinchScale", () => {
  test("follows the spread", () => expect(pinchScale(1, 100, 200)).toBe(2))
  test("clamps to 4", () => expect(pinchScale(2, 100, 900)).toBe(4))
  test("clamps to 0.5", () => expect(pinchScale(1, 100, 10)).toBe(0.5))
  test("ignores a zero start", () => expect(pinchScale(1.5, 0, 50)).toBe(1.5))
})

describe("containRect", () => {
  const stage = { left: 0, top: 48, width: 1000, height: 600 }
  test("letterboxes a wide picture", () => {
    expect(containRect(stage, { width: 2000, height: 500 })).toEqual({
      left: 0,
      top: 48 + 175,
      width: 1000,
      height: 250,
    })
  })
  test("pillarboxes a tall picture", () => {
    expect(containRect(stage, { width: 300, height: 600 })).toEqual({
      left: 350,
      top: 48,
      width: 300,
      height: 600,
    })
  })
  test("an unsized picture fills the stage", () => {
    expect(containRect(stage, { width: 0, height: 0 })).toEqual(stage)
  })
})

describe("flightTransform", () => {
  test("lays the picture over the thumbnail", () => {
    const picture = { left: 100, top: 100, width: 800, height: 400 }
    const thumb = { left: 20, top: 30, width: 200, height: 200 }
    const flight = flightTransform(picture, thumb)
    // The thumbnail is square, so the wide picture is scaled to cover it by height.
    expect(flight.scale).toBe(0.5)
    expect(flight.x).toBe(120 - 500)
    expect(flight.y).toBe(130 - 300)
  })
  test("is the identity over itself", () => {
    const box = { left: 10, top: 10, width: 100, height: 50 }
    expect(flightTransform(box, box)).toEqual({ x: 0, y: 0, scale: 1 })
  })
})

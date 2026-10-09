import { describe, expect, test } from "bun:test"
import { anchorAt, clampZoom, clickZoom, fitScale, keyZoom, MAX_ZOOM, maxHeight, panStep, scrollFor, wheelZoom } from "./zoom"

describe("image zoom", () => {
	test("zoom stays between fitted and 8x", () => {
		expect([clampZoom(0.2), clampZoom(3), clampZoom(40)]).toEqual([1, 3, MAX_ZOOM])
	})

	test("a picture fits the window and is never drawn past its own size", () => {
		const window = { width: 1000, height: 800 }
		expect(maxHeight(window)).toBe(640)
		// Wide: the width bound is 1000 * 0.92 - 96 = 824.
		expect(fitScale({ width: 1648, height: 100 }, window)).toBe(0.5)
		// Tall: the height bound is 640.
		expect(fitScale({ width: 100, height: 1280 }, window)).toBe(0.5)
		expect(fitScale({ width: 50, height: 50 }, window)).toBe(1)
		// A phone keeps no room for the arrows.
		expect(fitScale({ width: 920, height: 10 }, { width: 500, height: 800 })).toBeCloseTo(0.5)
	})

	test("the wheel zooms in on a scroll up, faster when pinching, and counts lines as 16 px", () => {
		const up = wheelZoom(1, { deltaY: -100, deltaMode: 0, ctrlKey: false }, 800)
		expect(up).toBeCloseTo(Math.exp(0.2))
		expect(wheelZoom(1, { deltaY: -10, deltaMode: 0, ctrlKey: true }, 800)).toBeCloseTo(Math.exp(0.1))
		expect(wheelZoom(2, { deltaY: -1, deltaMode: 1, ctrlKey: false }, 800)).toBeCloseTo(2 * Math.exp(0.032))
		expect(wheelZoom(1, { deltaY: 500, deltaMode: 0, ctrlKey: false }, 800)).toBe(1)
		expect(wheelZoom(7, { deltaY: -1, deltaMode: 2, ctrlKey: false }, 800)).toBe(MAX_ZOOM)
	})

	test("keys and clicks", () => {
		expect([keyZoom("Enter", 1), keyZoom(" ", 3), keyZoom("+", 2), keyZoom("=", 2), keyZoom("-", 3), keyZoom("-", 1), keyZoom("0", 5), keyZoom("a", 2)]).toEqual([2, 1, 3, 3, 2, 1, 1, null])
		expect([clickZoom(1), clickZoom(2.5)]).toEqual([2, 1])
	})

	test("the point under the pointer stays under it as the zoom changes", () => {
		const at = { x: 120, y: 80 }
		const anchor = anchorAt({ x: 0, y: 0 }, at, 1)
		expect(scrollFor(anchor, at, 2)).toEqual({ x: 120, y: 80 })
		// Already zoomed and scrolled: the same picture point lands under the pointer at 4x.
		const zoomed = anchorAt({ x: 300, y: 100 }, at, 2)
		expect(zoomed).toEqual({ x: 210, y: 90 })
		expect(scrollFor(zoomed, at, 4)).toEqual({ x: 720, y: 280 })
	})

	test("arrow keys pan 40 px", () => {
		expect([panStep("ArrowLeft"), panStep("ArrowDown"), panStep("Enter")]).toEqual([{ x: -40, y: 0 }, { x: 0, y: 40 }, null])
	})
})

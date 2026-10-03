import { expect, test } from "bun:test"
import { fitWithin, STILL_EDGE } from "./uploads"

test("a still fits the long edge and keeps the shape, and never scales up", () => {
	expect(fitWithin(4000, 3000, STILL_EDGE)).toEqual({ width: 840, height: 630 })
	expect(fitWithin(1080, 1920, STILL_EDGE)).toEqual({ width: 473, height: 840 })
	expect(fitWithin(600, 400, STILL_EDGE)).toEqual({ width: 600, height: 400 })
	expect(fitWithin(10_000, 1, 100)).toEqual({ width: 100, height: 1 })
})

import { describe, expect, test } from "bun:test"
import { reduceUpdate, stageText } from "./update"

describe("update progress", () => {
	test.each([
		["checking", "Checking the release"],
		["authorizing", "Authorizing"],
		["uploading", "Uploading"],
		["restarting", "Restarting"],
	] as const)("%s shows %s", (stage, text) => {
		expect(stageText(reduceUpdate({ t: "update.state", stage }))).toBe(text)
	})

	test("a failure keeps the server's sentence and shows no stage text", () => {
		const p = reduceUpdate({ t: "update.state", stage: "failed", error: "Reconnect Cloudflare, then try again." })
		expect(p).toEqual({ stage: "failed", error: "Reconnect Cloudflare, then try again." })
		expect(stageText(p)).toBeUndefined()
	})

	test("a failure with no sentence still says something", () => {
		expect(reduceUpdate({ t: "update.state", stage: "failed" })?.error).toBeTruthy()
	})

	test("idle shows nothing", () => {
		expect(stageText(null)).toBeUndefined()
	})
})

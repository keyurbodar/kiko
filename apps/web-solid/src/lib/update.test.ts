import { describe, expect, test } from "bun:test"
import { checkStall, reduceUpdate, sent, STALL_ERROR, STALL_MS, stageText } from "./update"

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

describe("a backend that never answers", () => {
	test("fails after the wait with the reinstall sentence", () => {
		const p = sent(1000)
		expect(checkStall(p, 1000 + STALL_MS - 1)).toBe(p)
		expect(checkStall(p, 1000 + STALL_MS)).toEqual({ stage: "failed", error: STALL_ERROR })
	})

	test("the first frame cancels the stall", () => {
		const answered = reduceUpdate({ t: "update.state", stage: "checking" })
		expect(checkStall(answered, 1_000_000)).toEqual({ stage: "checking" })
	})

	test("idle and failed progress are left alone", () => {
		expect(checkStall(null, 1_000_000)).toBeNull()
		const failed = reduceUpdate({ t: "update.state", stage: "failed", error: "x" })
		expect(checkStall(failed, 1_000_000)).toBe(failed)
	})
})

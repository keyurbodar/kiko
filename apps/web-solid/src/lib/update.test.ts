import { describe, expect, test } from "bun:test"
import { checkStall, pillView, reduceUpdate, sent, STALL_ERROR, STALL_MS, stageText } from "./update"

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

describe("pillView", () => {
	const idle = null
	const running = { stage: "uploading" } as const
	const failed = { stage: "failed", error: "No." } as const
	test.each([
		["nothing to do", "ok", false, idle, { kind: "none" }],
		["no hello yet", undefined, false, idle, { kind: "none" }],
		["a backend update", "update", false, idle, { kind: "update", blocked: false }],
		["a backend too old", "blocked", false, idle, { kind: "update", blocked: true }],
		["a stale tab", "ok", true, idle, { kind: "reload" }],
		["a stale tab outranks a backend update, which would install the old version", "update", true, idle, { kind: "reload" }],
		["a running update", "update", false, running, { kind: "busy", text: "Uploading" }],
		["a running update outranks a stale tab", "ok", true, running, { kind: "busy", text: "Uploading" }],
		["a failure", "update", false, failed, { kind: "failed", error: "No." }],
	] as const)("%s", (_name, skew, behind, progress, expected) => {
		expect(pillView(skew, behind, progress)).toEqual(expected)
	})
})

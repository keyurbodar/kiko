import { describe, expect, test } from "bun:test"
import { checkStall, landed, pillView, reduceUpdate, sent, STALL_ERROR, STALL_MS, stageText, updateTarget } from "./update"

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
		["a newer release is one update", "ok", true, idle, { kind: "update", blocked: false }],
		["a newer release and an old backend are the same update", "update", true, idle, { kind: "update", blocked: false }],
		["a blocked backend says so even with a newer release", "blocked", true, idle, { kind: "update", blocked: true }],
		["a running update", "update", false, running, { kind: "busy", text: "Uploading" }],
		["a running update outranks a stale tab", "ok", true, running, { kind: "busy", text: "Uploading" }],
		["a failure", "update", false, failed, { kind: "failed", error: "No." }],
	] as const)("%s", (_name, skew, behind, progress, expected) => {
		expect(pillView(skew, behind, progress)).toEqual(expected)
	})
})

describe("the release an update installs", () => {
	test("the front door's newest when it is ahead of this tab", () => {
		expect(updateTarget("0.3.0", "0.3.1")).toBe("0.3.1")
	})
	test("this tab's own when the front door is not ahead, or unknown", () => {
		expect(updateTarget("0.3.1", "0.3.1")).toBe("0.3.1")
		expect(updateTarget("0.3.1", "0.3.0")).toBe("0.3.1")
		expect(updateTarget("0.3.1", undefined)).toBe("0.3.1")
	})
})

describe("a restart has landed", () => {
	test.each([
		["0.3.1", "0.3.0", false],
		["0.3.1", "0.3.1", true],
		["0.3.1", "0.4.0", true],
		["0.3.1", undefined, false],
	] as const)("target %s, backend %s: %s", (target, backend, expected) => {
		expect(landed(target, backend)).toBe(expected)
	})
})

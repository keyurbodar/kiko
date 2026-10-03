import { describe, expect, test } from "bun:test"
import { humanHandle, mentionsHuman, messageLast } from "../src/activity"

const at = 1
const img = (name = "a.png") => ({ name: `attachments/k1-${name}`, type: "image/png" })
const vid = { name: "attachments/k2-clip.mp4", type: "video/mp4" }

describe("messageLast", () => {
	const cases: [string, Parameters<typeof messageLast>[0], ReturnType<typeof messageLast>][] = [
		["text", { from: "human", text: "hello\nthere", at }, { from: "human", kind: "text", text: "hello there", at }],
		["an agent keeps its name", { from: "agent", name: "Ada", text: "hi", at }, { from: "agent", name: "Ada", kind: "text", text: "hi", at }],
		["a link alone", { from: "human", text: " https://kat.ai/x ", at }, { from: "human", kind: "link", text: "https://kat.ai/x", at }],
		["one photo", { from: "human", text: "", files: [img()], at }, { from: "human", kind: "photo", at }],
		["a photo with a caption", { from: "human", text: "look", files: [img()], at }, { from: "human", kind: "photo", text: "look", at }],
		["two photos", { from: "human", text: "", files: [img(), img("b.png")], at }, { from: "human", kind: "photo", count: 2, at }],
		["one video", { from: "human", text: "", files: [vid], at }, { from: "human", kind: "video", at }],
		["an album", { from: "human", text: "", files: [img(), vid], at }, { from: "human", kind: "album", at }],
		["a file", { from: "human", text: "", files: [{ name: "attachments/k3-report.pdf", type: "application/pdf" }], at }, { from: "human", kind: "file", file: "report.pdf", at }],
		["two files", { from: "human", text: "", files: [{ name: "a.pdf", type: "application/pdf" }, img()], at }, { from: "human", kind: "file", count: 2, at }],
		["a voice message", { from: "human", text: "", files: [{ name: "attachments/k4-voice-1.ogg", type: "audio/ogg" }], at }, { from: "human", kind: "voice", at }],
		["audio", { from: "human", text: "", files: [{ name: "song.mp3", type: "audio/mpeg" }], at }, { from: "human", kind: "audio", file: "song.mp3", at }],
		["a system message", { from: "system", text: "reminder: water", at }, { from: "system", kind: "notice", text: "reminder: water", at }],
	]
	for (const [name, input, want] of cases) test(name, () => expect(messageLast(input)).toEqual(want))

	test("clips a long message to one line", () => {
		const out = messageLast({ from: "human", text: "x".repeat(500), at })
		expect(out.text!.length).toBe(120)
		expect(out.text!.endsWith("…")).toBe(true)
	})
})

describe("humanHandle", () => {
	const cases: [string | null, string][] = [
		["Keyur Patel", "keyur"],
		["alice", "alice"],
		["José", "jose"],
		["", "you"],
		[null, "you"],
		["李", "you"],
	]
	for (const [name, want] of cases) test(`${name} is @${want}`, () => expect(humanHandle(name)).toBe(want))
})

describe("mentionsHuman", () => {
	const cases: [string, string, boolean, boolean][] = [
		["names the handle", "@keyur can you check", false, true],
		["any case", "thanks @Keyur.", false, true],
		["a reply counts", "done", true, true],
		["a longer handle is someone else", "@keyurbot hi", false, false],
		["an email is not a mention", "mail me@keyur.dev", false, false],
		["no handle", "hi there", false, false],
	]
	for (const [name, text, reply, want] of cases) test(name, () => expect(mentionsHuman(text, "keyur", reply)).toBe(want))
})

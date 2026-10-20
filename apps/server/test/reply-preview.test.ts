import { ownerRoomFixture } from "./owner-room-fixture"
import { describe, expect, test } from "bun:test"
import type { AgentSlug } from "@kiko/protocol"
import { previewText } from "../src/room/log"

function room() {
	return ownerRoomFixture({ now: () => 1 }).log
}

const human = { kind: "human" } as const
const ada = { kind: "agent", slug: "ada" as AgentSlug } as const

describe("a reply carries what it answers", () => {
	test("the stored reply and the event both carry the original's words, so a reply never depends on the original being loaded", () => {
		const log = room()
		const original = log.addMessage({ from: ada, text: "the plan is  ready\nto go" })
		const reply = log.addMessage({ from: human, text: "great", replyTo: original.id })
		expect(reply.event).toMatchObject({ replyTo: original.id, reply: { seq: original.seq, from: ada, text: "the plan is ready to go" } })
		expect(log.message(reply.id)?.reply).toEqual({ seq: original.seq, from: ada, text: "the plan is ready to go" })
		expect(log.snapshot().messages.find((m) => m.id === reply.id)?.reply?.seq).toBe(original.seq)
	})

	test("a reply to the human's own message quotes the human", () => {
		const log = room()
		const mine = log.addMessage({ from: human, text: "first" })
		const reply = log.addMessage({ from: human, text: "second", replyTo: mine.id })
		expect(log.message(reply.id)?.reply).toEqual({ seq: mine.seq, from: human, text: "first" })
	})

	test("a reply to a reply quotes the reply, not the message under it", () => {
		const log = room()
		const a = log.addMessage({ from: ada, text: "root" })
		const b = log.addMessage({ from: human, text: "middle", replyTo: a.id })
		const c = log.addMessage({ from: ada, text: "top", replyTo: b.id })
		expect(log.message(c.id)?.reply).toEqual({ seq: b.seq, from: human, text: "middle" })
	})

	test("a deleted original reads as gone, with none of its words", () => {
		const log = room()
		const original = log.addMessage({ from: ada, text: "secret" })
		const reply = log.addMessage({ from: human, text: "ok", replyTo: original.id })
		log.deleteMessages([original.id], human)
		expect(log.message(reply.id)?.reply).toEqual({ seq: original.seq, from: ada, text: "", gone: true })
	})

	test("a page of history reads every reply's original in the same call", () => {
		const log = room()
		const a = log.addMessage({ from: ada, text: "one" })
		const b = log.addMessage({ from: ada, text: "two" })
		log.addMessage({ from: human, text: "r1", replyTo: a.id })
		log.addMessage({ from: human, text: "r2", replyTo: b.id })
		const replies = log.around(1, 0, 50).filter((m) => m.replyTo)
		expect(replies.map((m) => m.reply?.text)).toEqual(["one", "two"])
	})

	test("a reply with no original has no quote", () => {
		const log = room()
		const reply = log.addMessage({ from: human, text: "hello", replyTo: "no-such-message" as never })
		expect(reply.event).not.toHaveProperty("reply")
	})
})

describe("previewText", () => {
	test("long words are cut at 140 characters with an ellipsis", () => {
		const out = previewText("word ".repeat(100))
		expect(Array.from(out)).toHaveLength(140)
		expect(out.endsWith("…")).toBe(true)
	})
	test("an emoji is never cut in half", () => expect(previewText("😀".repeat(200))).toMatch(/^(😀)+…$/u))
	test("files stand in for missing words", () => {
		expect(previewText("", [{ name: "a.png", type: "image/png" }])).toBe("Photo")
		expect(previewText("", [{ name: "a.png", type: "image/png" }, { name: "b.png", type: "image/png" }])).toBe("2 photos")
		expect(previewText("", [{ name: "plan.pdf", type: "application/pdf" }, { name: "b.png", type: "image/png" }])).toBe("plan.pdf and 1 more")
	})
})

import { expect, test } from "bun:test"
import type { AgentSlug, Sender, SystemEvent } from "@kiko/protocol"
import { roomActivity as chatTouch } from "../src/room/activity"
import { RoomLog } from "../src/room/log"
import { RoomMemory } from "../src/room/memory"
import { ROOM_STEPS } from "../src/room/schema"
import { searchMessages } from "../src/room/search"
import { dividerMessage } from "../src/room/dividers"
import { sqlWith } from "./sql-shim"

const ada = "ada" as AgentSlug
const human: Sender = { kind: "human" }
const agent: Sender = { kind: "agent", slug: ada }

function room() {
	const sql = sqlWith(ROOM_STEPS)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	let clock = Date.UTC(2026, 8, 1)
	const log = new RoomLog(storage, () => (clock += 60_000))
	const memory = new RoomMemory(storage, { get: (k) => log.meta(k), set: (k, v) => log.setMeta(k, v) })
	return { sql, log, memory }
}

test("a private divider event reaches the owner's transcript and no agent, memory pass, search or chat preview", () => {
	const { sql, log, memory } = room()
	log.addMessage({ from: human, text: "find the pricing pages" })
	log.addMessage({ from: agent, text: "on it", run: { runId: "run-1", attempt: 0, index: 0 } })
	const stored = log.addMessage(dividerMessage("routine-created:r1", "Ada created a routine: find the three pricing pages", { kind: "routine_created", agent: ada, title: "find the three pricing pages", private: true }))
	log.addMessage({ from: agent, text: "still on it", run: { runId: "run-1", attempt: 0, index: 1 } })

	const owner = log.snapshot()
	expect(owner.messages.some((m) => m.event?.kind === "routine_created" && m.event.private)).toBe(true)
	expect(log.since(0).some((e) => e.t === "message" && e.event?.kind === "routine_created")).toBe(true)

	memory.sync()
	const remembered = memory.items(0, memory.count()).map((i) => i.text).join("\n")
	expect(remembered).toContain("still on it")
	expect(remembered).not.toContain("routine")
	expect(remembered).not.toContain("find the three pricing pages")

	expect(searchMessages(sql, "routine").results).toEqual([])
	expect(searchMessages(sql, "pricing").results.map((r) => r.snippet)).not.toContain(expect.stringContaining("created a routine"))

	const touch = chatTouch(sql, log)
	expect(touch.lastPreview).toBe("still on it")
	log.addMessage(dividerMessage("compacted:ada:1", "Ada compacted its context", { kind: "compacted", agent: ada, private: true }))
	expect(chatTouch(sql, log).lastPreview).toBe("still on it")
	expect(chatTouch(sql, log).unread).toBe(touch.unread)
	expect(stored.event?.t).toBe("message")
})

test("a public system event is read like any system line", () => {
	const { sql, log } = room()
	const event: SystemEvent = { kind: "delegated", from: ada, to: "bob" as AgentSlug, title: "write the tests" }
	log.addMessage({ from: { kind: "system", reason: "files" }, text: "@ada handed @bob a task: write the tests", event })
	expect(searchMessages(sql, "handed").results).toHaveLength(1)
	expect(log.snapshot().messages[0]?.event).toEqual(event)
})

test("a divider is stored once even if the room sees the same id twice", () => {
	const { log } = room()
	const first = dividerMessage("member:5", "Bob joined", { kind: "member_added", slug: "bob" as AgentSlug, name: "Bob", private: true })
	expect(log.addMessage(first).event).not.toBeNull()
	expect(log.addMessage(first).event).toBeNull()
})

import { expect, test } from "bun:test"
import type { AgentSlug, Sender, SystemEvent, WorkerRow } from "@kiko/protocol"
import { chatTouch } from "../src/room/chat-touch"
import { RoomLog } from "../src/room/log"
import { RoomMemory } from "../src/room/memory"
import { ROOM_STEPS } from "../src/room/schema"
import { searchMessages } from "../src/room/search"
import { workerMessages } from "../src/room/work-events"
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

const worker = (status: WorkerRow["status"], over: Partial<WorkerRow> = {}): WorkerRow => ({ id: "w1", task: "find the three pricing pages", status, step: null, steps: 0, startedAt: 100, ...over })

test("a private subagent event reaches the owner's transcript and no agent, memory pass, search or chat preview", () => {
	const { sql, log, memory } = room()
	log.addMessage({ from: human, text: "find the pricing pages" })
	log.addMessage({ from: agent, text: "on it", run: { runId: "run-1", attempt: 0, index: 0 } })
	const [started] = workerMessages(ada, [], [worker("running")])
	const stored = log.addMessage(started!)
	log.addMessage({ from: agent, text: "still on it", run: { runId: "run-1", attempt: 0, index: 1 } })

	const owner = log.snapshot()
	expect(owner.messages.some((m) => m.event?.kind === "subagent" && m.event.private)).toBe(true)
	expect(log.since(0).some((e) => e.t === "message" && e.event?.kind === "subagent")).toBe(true)

	memory.sync()
	const remembered = memory.items(0, memory.count()).map((i) => i.text).join("\n")
	expect(remembered).toContain("still on it")
	expect(remembered).not.toContain("worker")
	expect(remembered).not.toContain("find the three pricing pages")

	expect(searchMessages(sql, "worker").results).toEqual([])
	expect(searchMessages(sql, "pricing").results.map((r) => r.snippet)).not.toContain(expect.stringContaining("started a worker"))

	const touch = chatTouch(sql, log)
	expect(touch.lastPreview).toBe("still on it")
	log.addMessage({ from: { kind: "system", reason: "work" }, text: "@ada finished a worker: x", event: { kind: "subagent", agent: ada, state: "done", title: "x", private: true } })
	expect(chatTouch(sql, log).lastPreview).toBe("still on it")
	expect(chatTouch(sql, log).unread).toBe(touch.unread)
	expect(stored.event?.t).toBe("message")
})

test("a public system event is read like any system line", () => {
	const { sql, log } = room()
	const event: SystemEvent = { kind: "delegated", from: ada, to: "bob" as AgentSlug, title: "write the tests" }
	log.addMessage({ from: { kind: "system", reason: "work" }, text: "@ada handed @bob a task: write the tests", event })
	expect(searchMessages(sql, "handed").results).toHaveLength(1)
	expect(log.snapshot().messages[0]?.event).toEqual(event)
})

test("a worker starts once, ends once, and a replay or a step change adds nothing", () => {
	expect(workerMessages(ada, [], [worker("running")]).map((m) => m.event)).toEqual([{ kind: "subagent", agent: ada, state: "started", title: "find the three pricing pages", private: true }])
	expect(workerMessages(ada, [worker("running")], [worker("running", { step: "web_fetch", steps: 3 })])).toEqual([])
	expect(workerMessages(ada, [worker("running")], [worker("done")]).map((m) => m.event)).toEqual([{ kind: "subagent", agent: ada, state: "done", title: "find the three pricing pages", private: true }])
	expect(workerMessages(ada, [worker("done")], [worker("done")])).toEqual([])
	expect(workerMessages(ada, [worker("done")], [worker("running")])).toEqual([])
	expect(workerMessages(ada, [], [worker("done")])).toEqual([])
	const [one] = workerMessages(ada, [worker("running")], [worker("stopped")])
	expect(one?.text).toBe("@ada stopped a worker: find the three pricing pages")
})

test("a started line is stored once even if the room sees the same rows twice", () => {
	const { log } = room()
	const first = workerMessages(ada, [], [worker("running")])[0]!
	expect(log.addMessage(first).event).not.toBeNull()
	expect(log.addMessage(first).event).toBeNull()
})

import { expect, test } from "bun:test"
import type { MemoryOp, MemoryResult } from "@kiko/protocol"
import type { MemoryClient } from "./client"
import { replacedMark } from "./lines"
import { createMockMemory } from "./mock"
import { createMemoryStore } from "./store"

// The memory screen's store against the in-browser mock of UserDO, and against a server that says no.

test("loads the newest lines first, with the view and the model", async () => {
	const store = createMemoryStore(createMockMemory())
	await store.load()
	expect(store.state.loaded).toBe(true)
	expect(store.state.lines.map((l) => l.pos)).toEqual([4, 3, 2, 1, 0])
	expect(store.state.view.length).toBe(5)
	expect(store.state.model).toBeNull()
})

test("pin and redact apply at once and refresh what agents read", async () => {
	const store = createMemoryStore(createMockMemory())
	await store.load()
	store.pin(1, true)
	expect(store.state.lines.find((l) => l.pos === 1)!.pinned).toBe(true)
	await Bun.sleep(0)
	await Bun.sleep(0)
	expect(store.state.view[0]).toBe("pinned: sister is sam; they talk every sunday")
	store.redact(1)
	const gone = store.state.lines.find((l) => l.pos === 1)!
	expect([gone.redacted, gone.text, gone.pinned]).toEqual([true, "", false])
})

test("a note shows at once and stays after the server agrees", async () => {
	const store = createMemoryStore(createMockMemory())
	await store.load()
	const done = store.note("  allergic to   peanuts ")
	expect(store.state.lines[0]!.text).toBe("allergic to peanuts")
	await done
	expect(store.state.lines[0]).toMatchObject({ pos: 5, text: "allergic to peanuts", source: "you" })
})

test("a line a later fact replaced says so, and one that was not does not", async () => {
	const store = createMemoryStore(createMockMemory())
	await store.load()
	const old = store.state.lines.find((l) => l.pos === 0)!
	const current = store.state.lines.find((l) => l.pos === 4)!
	expect(replacedMark(old)).toBe("Replaced")
	expect(replacedMark(current)).toBeNull()
})

test("a refused change is undone and says why", async () => {
	const refusing: MemoryClient = {
		request: async (op: MemoryOp): Promise<MemoryResult> =>
			op.op === "list" ? { ok: true, lines: [{ pos: 0, at: 0, text: "x", source: "", pinned: false, redacted: false }], next: null } : op.op === "pin" ? { ok: false, error: "at most 10 pinned memories. unpin one first." } : { ok: true, text: [] },
		close() {},
	}
	const store = createMemoryStore(refusing)
	await store.load()
	store.pin(0, true)
	expect(store.state.lines[0]!.pinned).toBe(true)
	await Bun.sleep(0)
	expect(store.state.lines[0]!.pinned).toBe(false)
	expect(store.state.error).toBe("at most 10 pinned memories. unpin one first.")
})

import { expect, test } from "bun:test"
import type { MemoryOp, MemoryRecord, MemoryResult } from "@kiko/protocol"
import { createRoot } from "solid-js"
import type { MemoryClient } from "./client"
import { createMockMemory } from "./mock"
import { groupRecords, matches, parseBody, splitLinks } from "./records"
import { createMemoryStore } from "./store"

const rec = (over: Partial<MemoryRecord> & { id: string }): MemoryRecord => ({
	type: "person",
	title: over.id,
	aliases: [],
	body: "",
	pinned: false,
	archived: false,
	uses: 0,
	lastUsedAt: 0,
	createdAt: 0,
	updatedAt: 0,
	version: 1,
	...over,
})

test("groups by type, pinned first, archived last", () => {
	const groups = groupRecords([
		rec({ id: "a", updatedAt: 5 }),
		rec({ id: "b", updatedAt: 9 }),
		rec({ id: "c", pinned: true, updatedAt: 1 }),
		rec({ id: "d", type: "organization" }),
		rec({ id: "e", archived: true }),
	])
	expect(groups.map((g) => [g.key, g.records.map((r) => r.id)])).toEqual([
		["person", ["c", "b", "a"]],
		["organization", ["d"]],
		["archived", ["e"]],
	])
})

test("search needs every word in the title, an alias, or the body", () => {
	const r = rec({ id: "m", title: "margaret", aliases: ["mum"], body: "- likes tea" })
	expect(matches(r, "mum tea")).toBe(true)
	expect(matches(r, "mum coffee")).toBe(false)
	expect(groupRecords([r], "coffee")).toEqual([])
})

test("links and blocks", () => {
	expect(splitLinks("works on [[kiko]] and [[a-b]].")).toEqual([
		{ text: "works on " },
		{ link: "kiko" },
		{ text: " and " },
		{ link: "a-b" },
		{ text: "." },
	])
	expect(parseBody("# t\n- one\n\ntext").map((b) => b.kind)).toEqual(["heading", "bullet", "paragraph"])
})

/** A client the test answers by hand, so a request stays open while the test looks. */
function manual() {
	const sent: { op: MemoryOp; answer: (r: MemoryResult) => void }[] = []
	const client: MemoryClient = {
		request: (op) => new Promise((resolve) => sent.push({ op, answer: resolve })),
		close() {},
	}
	return { client, sent }
}

test("a pin shows before the server answers and is undone when it refuses", async () => {
	await createRoot(async (dispose) => {
		const { client, sent } = manual()
		const store = createMemoryStore(client)
		const loading = store.load()
		sent[0].answer({ ok: true, records: [rec({ id: "a" })] })
		await loading
		const done = store.pin("a", true)
		expect(store.get("a")?.pinned).toBe(true)
		expect(sent[1].op).toEqual({ op: "pin", id: "a", pinned: true })
		sent[1].answer({ ok: false, error: "no" })
		await done
		expect(store.get("a")?.pinned).toBe(false)
		expect(store.state.error).toBe("no")
		dispose()
	})
})

test("an edit bumps the version at once, adds the old body to history, and restore is a new version", async () => {
	await createRoot(async (dispose) => {
		const store = createMemoryStore(createMockMemory())
		await store.load()
		await store.loadHistory("margaret")
		expect(store.state.history.margaret).toEqual([])
		const before = { ...store.get("margaret")! }
		await store.save("margaret", "- likes coffee")
		expect(store.get("margaret")).toMatchObject({ body: "- likes coffee", version: before.version + 1 })
		expect(store.state.history.margaret.map((v) => [v.version, v.body])).toEqual([[1, before.body]])
		await store.restore("margaret", store.state.history.margaret[0])
		expect(store.get("margaret")).toMatchObject({ body: before.body, version: 3 })
		expect(store.state.history.margaret.map((v) => v.version)).toEqual([2, 1])
		dispose()
	})
})

test("a delete leaves the list at once and comes back when refused", async () => {
	await createRoot(async (dispose) => {
		const store = createMemoryStore(createMockMemory())
		await store.load()
		await store.remove("margaret")
		expect(store.get("margaret")).toBeUndefined()
		await store.remove("profile") // the mock refuses a singleton
		expect(store.get("profile")).toBeDefined()
		expect(store.state.error).toContain("cannot be removed")
		dispose()
	})
})

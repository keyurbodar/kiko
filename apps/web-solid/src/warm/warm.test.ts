import "fake-indexeddb/auto"
import { describe, expect, test } from "bun:test"
import type { Chat, Message, MessageId, RoomId } from "@yuki/protocol"
import { IDBFactory } from "fake-indexeddb"
import { allChats, getUserSeq, putChats, removeChat, replaceChats, setUserSeq } from "./chats"
import { compareKeys, deleteWarm, MEMORY_ROWS_PER_STORE, openWarm, warmName } from "./db"
import { getDraft, saveDraft } from "./drafts"
import {
	clearRoom,
	deleteMessages,
	getLastSeq,
	messagesBefore,
	newestMessages,
	putMessages,
	setLastSeq,
	trimRoom,
} from "./messages"
import { addToOutbox, outbox, removeFromOutbox } from "./outbox"

const A = "01J0000000000000000000000A" as RoomId
const B = "01J0000000000000000000000B" as RoomId

const msg = (seq: number): Message => ({
	id: `m${seq}` as MessageId,
	seq,
	at: 1_700_000_000_000 + seq,
	from: { kind: "human" },
	text: `message ${seq}`,
})
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Counts rows in a store through a separate raw connection, bypassing the warm tier. */
function rawCount(idb: IDBFactory, userId: string, store: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const r = idb.open(warmName(userId))
		r.onsuccess = () => {
			const db = r.result
			const c = db.transaction(store).objectStore(store).count()
			c.onsuccess = () => {
				db.close()
				resolve(c.result)
			}
		}
		r.onerror = () => reject(r.error)
	})
}

const backends = [
	["idb", () => ({ idb: new IDBFactory() })],
	["memory", () => ({ idb: null })],
] as const

for (const [mode, make] of backends) {
	describe(`messages on ${mode}`, () => {
		test("reads the newest messages oldest first, per room, before any flush", async () => {
			const warm = await openWarm({ userId: "u1", ...make() })
			expect(warm.mode).toBe(mode)
			putMessages(warm, A, range(1, 120))
			putMessages(warm, B, range(1, 10))
			const newest = await newestMessages(warm, A)
			expect(newest.map((m) => m.seq)).toEqual(range(71, 120).map((m) => m.seq))
			expect((await newestMessages(warm, B, 50)).length).toBe(10)
			expect((await messagesBefore(warm, A, 71, 3)).map((m) => m.seq)).toEqual([68, 69, 70])
			deleteMessages(warm, A, [120])
			expect((await newestMessages(warm, A, 1))[0].seq).toBe(119)
			warm.close()
		})

		test("trims a room, clears a room, and keeps lastSeq", async () => {
			const warm = await openWarm({ userId: "u1", ...make() })
			putMessages(warm, A, range(1, 30))
			putMessages(warm, B, range(1, 5))
			setLastSeq(warm, A, 30)
			await trimRoom(warm, A, 10)
			expect((await newestMessages(warm, A, 100)).map((m) => m.seq)).toEqual(range(21, 30).map((m) => m.seq))
			expect(await getLastSeq(warm, A)).toBe(30)
			clearRoom(warm, A)
			expect(await newestMessages(warm, A)).toEqual([])
			expect(await getLastSeq(warm, A)).toBe(0)
			expect((await newestMessages(warm, B)).length).toBe(5)
			warm.close()
		})

		test("writes 10,000 messages and reads the newest 50 in under 50 ms", async () => {
			const warm = await openWarm({ userId: "u1", ...make() })
			const all = range(1, 10_000)
			const start = performance.now()
			putMessages(warm, A, all)
			await warm.flush()
			const wrote = performance.now()
			const newest = await newestMessages(warm, A, 50)
			const read = performance.now()
			console.log(`${mode}: write 10000 in ${(wrote - start).toFixed(1)} ms, read newest 50 in ${(read - wrote).toFixed(1)} ms`)
			expect(newest.length).toBe(50)
			expect(newest[49].seq).toBe(10_000)
			expect(read - wrote).toBeLessThan(50)
			warm.close()
		})
	})
}

describe("idb", () => {
	test("a schema version bump drops every store", async () => {
		const idb = new IDBFactory()
		const v1 = await openWarm({ userId: "u1", idb, version: 1 })
		putMessages(v1, A, range(1, 5))
		putChats(v1, [chat(A, { title: "one" })])
		saveDraft(v1, { roomId: A, text: "hi", updatedAt: 1 })
		setLastSeq(v1, A, 5)
		await v1.flush()
		v1.close()
		await sleep(0)
		expect(await rawCount(idb, "u1", "messages")).toBe(5)

		const v2 = await openWarm({ userId: "u1", idb, version: 2 })
		expect(v2.mode).toBe("idb")
		expect(await newestMessages(v2, A)).toEqual([])
		expect(await allChats(v2)).toEqual([])
		expect(await getDraft(v2, A)).toBeUndefined()
		expect(await getLastSeq(v2, A)).toBe(0)
		expect(await v2.get<number>("meta", "schema")).toBe(2)
		v2.close()
	})

	test("an older schema than the stored one drops the database and opens", async () => {
		const idb = new IDBFactory()
		const v3 = await openWarm({ userId: "u1", idb, version: 3 })
		putMessages(v3, A, range(1, 5))
		await v3.flush()
		v3.close()
		await sleep(0)
		const v1 = await openWarm({ userId: "u1", idb, version: 1 })
		expect(v1.mode).toBe("idb")
		expect(await newestMessages(v1, A)).toEqual([])
		expect(await v1.get<number>("meta", "schema")).toBe(1)
		v1.close()
	})

	test("data survives a reopen", async () => {
		const idb = new IDBFactory()
		const first = await openWarm({ userId: "u1", idb })
		putMessages(first, A, range(1, 3))
		await addToOutbox(first, { roomId: A, frame: { t: "send", clientId: "c1", text: "hi" }, createdAt: 1 })
		first.close()
		await sleep(0)
		const second = await openWarm({ userId: "u1", idb })
		expect((await newestMessages(second, A)).length).toBe(3)
		expect((await outbox(second)).map((i) => i.frame.clientId)).toEqual(["c1"])
		second.close()
	})

	test("users never share a database, and deleteWarm drops one user", async () => {
		const idb = new IDBFactory()
		const u1 = await openWarm({ userId: "u1", idb })
		const u2 = await openWarm({ userId: "u2", idb })
		putMessages(u1, A, range(1, 3))
		await u1.flush()
		expect(await newestMessages(u2, A)).toEqual([])
		u1.close()
		await sleep(0)
		await deleteWarm("u1", idb)
		const again = await openWarm({ userId: "u1", idb })
		expect(await newestMessages(again, A)).toEqual([])
		again.close()
		u2.close()
	})

	test("batches writes and flushes them on its own after the interval", async () => {
		const idb = new IDBFactory()
		const warm = await openWarm({ userId: "u1", idb, flushEveryMs: 40 })
		putMessages(warm, A, range(1, 3))
		await sleep(5)
		expect(await rawCount(idb, "u1", "messages")).toBe(0)
		await sleep(120)
		expect(await rawCount(idb, "u1", "messages")).toBe(3)
		warm.close()
	})

	test("a blocked open degrades to memory", async () => {
		const idb = new IDBFactory()
		// Another tab holds version 1 and never steps aside.
		const holder = await new Promise<IDBDatabase>((resolve) => {
			const r = idb.open(warmName("u1"), 1)
			r.onsuccess = () => resolve(r.result)
		})
		const warm = await openWarm({ userId: "u1", idb, version: 2, openTimeoutMs: 200 })
		expect(warm.mode).toBe("memory")
		putMessages(warm, A, range(1, 3))
		expect((await newestMessages(warm, A)).length).toBe(3)
		warm.close()
		holder.close()
	})

	test("missing IndexedDB degrades to memory", async () => {
		const warm = await openWarm({ userId: "u1", idb: null })
		expect(warm.mode).toBe("memory")
		saveDraft(warm, { roomId: A, text: "draft", updatedAt: 1 })
		expect((await getDraft(warm, A))?.text).toBe("draft")
		warm.close()
	})

	test("the memory twin keeps at most its cap per store, dropping the oldest writes", async () => {
		const warm = await openWarm({ userId: "u1", idb: null })
		putMessages(warm, A, range(1, MEMORY_ROWS_PER_STORE + 100))
		const kept = await newestMessages(warm, A, MEMORY_ROWS_PER_STORE * 2)
		expect(kept).toHaveLength(MEMORY_ROWS_PER_STORE)
		expect(kept[0].seq).toBe(101)
		expect(kept.at(-1)?.seq).toBe(MEMORY_ROWS_PER_STORE + 100)
		warm.close()
	})

	test("another tab upgrading moves this tab to memory and keeps it working", async () => {
		const idb = new IDBFactory()
		const warm = await openWarm({ userId: "u1", idb, version: 1 })
		expect(warm.mode).toBe("idb")
		const other = await openWarm({ userId: "u1", idb, version: 2 })
		expect(other.mode).toBe("idb")
		expect(warm.mode).toBe("memory")
		putMessages(warm, A, range(1, 2))
		expect((await newestMessages(warm, A)).length).toBe(2)
		warm.close()
		other.close()
	})
})

const chat = (roomId: RoomId, over: Partial<Chat> = {}): Chat => ({
	roomId,
	title: "chat",
	pinned: false,
	muted: false,
	lastSeq: 0,
	lastPreview: "",
	unread: 0,
	updatedAt: 0,
	...over,
})

describe("chats, drafts, and outbox", () => {
	test("chat list sorts pinned first, then newest, and removal cascades", async () => {
		const warm = await openWarm({ userId: "u1", idb: new IDBFactory() })
		const C = "01J0000000000000000000000C" as RoomId
		putChats(warm, [chat(A, { updatedAt: 1 }), chat(B, { updatedAt: 3 }), chat(C, { updatedAt: 2, pinned: true })])
		expect((await allChats(warm)).map((c) => c.roomId)).toEqual([C, B, A])
		putMessages(warm, A, range(1, 3))
		saveDraft(warm, { roomId: A, text: "x", updatedAt: 1 })
		removeChat(warm, A)
		expect((await allChats(warm)).length).toBe(2)
		expect(await newestMessages(warm, A)).toEqual([])
		expect(await getDraft(warm, A)).toBeUndefined()
		replaceChats(warm, [chat(A)], 9)
		expect((await allChats(warm)).map((c) => c.roomId)).toEqual([A])
		expect(await getUserSeq(warm)).toBe(9)
		setUserSeq(warm, 10)
		expect(await getUserSeq(warm)).toBe(10)
		warm.close()
	})

	test("an empty draft is removed", async () => {
		const warm = await openWarm({ userId: "u1", idb: new IDBFactory() })
		saveDraft(warm, { roomId: A, text: "hello", updatedAt: 1 })
		saveDraft(warm, { roomId: A, text: "", updatedAt: 2 })
		expect(await getDraft(warm, A)).toBeUndefined()
		warm.close()
	})

	test("outbox writes land at once and list oldest first per room", async () => {
		const idb = new IDBFactory()
		const warm = await openWarm({ userId: "u1", idb, flushEveryMs: 60_000 })
		await addToOutbox(warm, { roomId: A, frame: { t: "send", clientId: "c2", text: "b" }, createdAt: 2 })
		await addToOutbox(warm, { roomId: A, frame: { t: "send", clientId: "c1", text: "a" }, createdAt: 1 })
		await addToOutbox(warm, { roomId: B, frame: { t: "send", clientId: "c3", text: "c" }, createdAt: 3 })
		expect(await rawCount(idb, "u1", "outbox")).toBe(3)
		expect((await outbox(warm, A)).map((i) => i.frame.clientId)).toEqual(["c1", "c2"])
		await removeFromOutbox(warm, "c1")
		expect((await outbox(warm)).map((i) => i.frame.clientId)).toEqual(["c2", "c3"])
		warm.close()
	})
})

test("compareKeys follows IndexedDB order", () => {
	expect(compareKeys(5, "a")).toBeLessThan(0)
	expect(compareKeys("a", [0])).toBeLessThan(0)
	expect(compareKeys([A, 2], [A, 10])).toBeLessThan(0)
	expect(compareKeys([A, -Infinity], [A, 1])).toBeLessThan(0)
	expect(compareKeys([A, 1], [B, 0])).toBeLessThan(0)
})

import "fake-indexeddb/auto"
import { describe, expect, test } from "bun:test"
import type { AgentSlug, Message, MessageId, RoomEvent, RoomId } from "@kiko/protocol"
import * as fixtures from "@kiko/protocol/fixtures"
import { IDBFactory } from "fake-indexeddb"
import { allChats } from "../warm/chats"
import { openWarm, type Warm } from "../warm/db"
import { getLastSeq, newestMessages, putMessages, setLastSeq } from "../warm/messages"
import { outbox } from "../warm/outbox"
import { createMockRoom, createMockUser, type MockRoomOptions } from "./mock-room"
import { overlayChats, overlayMessages, type RoomPatch, settleRoom } from "./patches"
import { applyRoomEvent, createRoomStore, emptyRoom, type RoomStoreOptions } from "./room-store"
import { backoffDelay, createSyncSocket, parseFrame } from "./socket"
import { createUserStore, newRoomId } from "./user-store"

const roomId = fixtures.roomId
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms
	while (!check()) {
		if (Date.now() > end) throw new Error("timed out")
		await sleep(1)
	}
}

let users = 0
const freshWarm = () => openWarm({ userId: `u${++users}`, idb: new IDBFactory(), flushEveryMs: 5 })

/** A schedule that times every task it runs. */
function timedSchedule() {
	const durations: number[] = []
	const schedule = (run: () => void) =>
		void setTimeout(() => {
			const start = performance.now()
			run()
			durations.push(performance.now() - start)
		}, 0)
	return { schedule, durations }
}

function setup(mockOptions: MockRoomOptions = {}, storeOptions: Partial<RoomStoreOptions> & { warm?: Warm } = {}) {
	const mock = createMockRoom(mockOptions)
	const make = async (warm?: Warm) => {
		const w = warm ?? storeOptions.warm ?? (await freshWarm())
		const store = createRoomStore({
			roomId,
			url: "ws://mock/room",
			connect: mock.connect,
			backoff: { baseMs: 5, maxMs: 20 },
			...storeOptions,
			warm: w,
		})
		return { store, warm: w }
	}
	return { mock, make }
}

const humanTexts = (messages: readonly Message[], text: string) => messages.filter((m) => m.text === text)

describe("the reducer", () => {
	test("replaying the fixture events gives the fixture snapshot", () => {
		const data = { ...emptyRoom(), members: [...fixtures.members] }
		for (const e of structuredClone(fixtures.roomEvents) as RoomEvent[]) applyRoomEvent(data, e)
		const { roster, ...rest } = data
		expect(rest).toEqual({ ...fixtures.roomSnapshot } as never)
		// cy joins at seq 11 and leaves at 12; the transcript shows both as system lines.
		expect(roster.map((n) => `${n.seq} ${n.name} ${n.kind}`)).toEqual(["11 cy joined", "12 cy left"])
	})

	test("a change to a current member is not a join", () => {
		const data = { ...emptyRoom(), members: [...fixtures.members] }
		const lead = fixtures.members[0]!
		applyRoomEvent(data, { seq: 1, at: 1, t: "member", member: { ...lead, name: "renamed" } })
		expect(data.roster).toEqual([])
		expect(data.members[0]!.name).toBe("renamed")
	})

	test("an event at or below the applied seq is skipped", () => {
		const data = emptyRoom()
		const [first] = structuredClone(fixtures.roomEvents) as RoomEvent[]
		expect(applyRoomEvent(data, first)).not.toBeNull()
		expect(applyRoomEvent(data, first)).toBeNull()
		expect(data.messages).toHaveLength(1)
	})

	test("new bytes at a path replace the file, and a metadata fill keeps it", () => {
		const data = emptyRoom()
		const at = (seq: number, id: string, extra = {}): RoomEvent =>
			({ t: "file", seq, at: seq, by: { kind: "human" }, file: { id, name: "a.txt", size: 1, type: "text/plain", ...extra } }) as RoomEvent
		applyRoomEvent(data, at(1, "v1"))
		applyRoomEvent(data, at(2, "v2"))
		expect(data.files.map((f) => f.id)).toEqual(["v2"])
		applyRoomEvent(data, at(3, "v2", { width: 4 }))
		expect(data.files).toEqual([{ id: "v2", name: "a.txt", size: 1, type: "text/plain", width: 4 }])
	})
})

describe("patches", () => {
	const m1 = fixtures.roomSnapshot.messages[0]
	const m2 = fixtures.roomSnapshot.messages[1]
	const patch = (clientId: string, frame: RoomPatch["frame"]): RoomPatch => ({ clientId, frame, at: 5 })

	test("untouched messages keep their identity and pending sends go last", () => {
		const view = overlayMessages(fixtures.roomSnapshot.messages, [
			patch("c9", { t: "send", clientId: "c9", text: "hi" }),
			patch("r1", { t: "react", messageId: m2.id, emoji: "🔥" }),
		])
		expect(view[0]).toBe(m1)
		expect(view[1].reactions).toEqual([{ by: { kind: "human" }, emoji: "🔥" }])
		expect(view[2]).toMatchObject({ text: "hi", pending: true, clientId: "c9", id: "local:c9" })
	})

	test("the human's reaction replaces its own and leaves an agent's alone", () => {
		const [v] = overlayMessages([m1], [patch("r", { t: "react", messageId: m1.id, emoji: "❤️" })])
		expect(v.reactions).toEqual([
			{ by: { kind: "agent", slug: fixtures.ada }, emoji: "👍" },
			{ by: { kind: "human" }, emoji: "❤️" },
		])
	})

	test("edit and delete apply, and each is dropped by the event that confirms it", () => {
		const patches = [
			patch("e", { t: "edit", messageId: m2.id, text: "new" }),
			patch("d", { t: "delete", messageId: m1.id }),
		]
		const view = overlayMessages([m1, m2], patches)
		expect(view.map((m) => m.text)).toEqual(["new"])
		expect(view[0].rich).toBeUndefined()
		const left = settleRoom(patches, [{ seq: 30, at: 1, t: "edit", messageId: m2.id, text: "new" }], 30)
		expect(left.map((p) => p.clientId)).toEqual(["d"])
		expect(settleRoom(left, [{ seq: 31, at: 1, t: "delete", messageIds: [m1.id] }], 31)).toEqual([])
	})

	test("an edit with different text does not confirm the patch", () => {
		const p = [patch("e", { t: "edit", messageId: m2.id, text: "new" })]
		expect(settleRoom(p, [{ seq: 30, at: 1, t: "edit", messageId: m2.id, text: "older" }], 30)).toHaveLength(1)
	})

	test("an acknowledged send waits until its seq is applied", () => {
		const p: RoomPatch = { ...patch("c", { t: "send", clientId: "c", text: "x" }), ack: { id: "m40" as MessageId, seq: 40 } }
		expect(settleRoom([p], [], 39)).toHaveLength(1)
		expect(settleRoom([p], [], 40)).toHaveLength(0)
	})

	test("chat edits overlay the list, pinned first", () => {
		const other = { ...fixtures.chat, roomId: fixtures.otherRoomId, pinned: false, title: "other", updatedAt: 1 }
		const view = overlayChats(
			[fixtures.chat, other],
			[
				{ clientId: "a", op: { op: "pin", roomId: fixtures.chat.roomId, pinned: false }, at: 0 },
				{ clientId: "b", op: { op: "pin", roomId: other.roomId, pinned: true }, at: 0 },
				{ clientId: "c", op: { op: "rename", roomId: other.roomId, title: "renamed" }, at: 0 },
			],
		)
		expect(view.map((c) => c.title)).toEqual(["renamed", "protocol plan"])
	})
})

describe("the socket", () => {
	test("backoff doubles, jitters within half, and stops at the cap", () => {
		expect(backoffDelay(0, 250, 10_000, () => 0)).toBe(125)
		expect(backoffDelay(0, 250, 10_000, () => 1)).toBe(250)
		expect(backoffDelay(3, 250, 10_000, () => 1)).toBe(2000)
		expect(backoffDelay(20, 250, 10_000, () => 1)).toBe(10_000)
	})

	test("junk frames are dropped at the edge", () => {
		expect(parseFrame("{")).toBeNull()
		expect(parseFrame("[1]")).toBeNull()
		expect(parseFrame('{"t":1}')).toBeNull()
		expect(parseFrame(new ArrayBuffer(2))).toBeNull()
		expect(parseFrame<{ t: string; who: string[] }>('{"t":"typing","who":[]}')).toEqual({ t: "typing", who: [] })
	})

	test("every connect starts with hello and the current lastSeq, and retries while offline", async () => {
		const mock = createMockRoom()
		mock.online = false
		let lastSeq = 3
		const statuses: string[] = []
		const socket = createSyncSocket({
			url: "ws://mock",
			connect: mock.connect,
			backoff: { baseMs: 2, maxMs: 4 },
			hello: () => ({ t: "hello", lastSeq }),
			onFrame: () => {},
			onStatus: (s) => statuses.push(s),
		})
		await sleep(30)
		expect(socket.status).not.toBe("open")
		expect(mock.received).toHaveLength(0)
		mock.online = true
		await until(() => mock.received.length === 1)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: 3 })
		lastSeq = 9
		mock.drop()
		await until(() => mock.received.length === 2)
		expect(mock.received[1]).toEqual({ t: "hello", lastSeq: 9 })
		expect(statuses.filter((s) => s === "open")).toHaveLength(2)
		socket.close()
	})
})

describe("the room store", () => {
	test("a member change shows at once, and a refusal rolls it back and is reported", async () => {
		const { make } = setup({ resetAfter: 0 }) // a snapshot, which carries the members
		const { store } = await make()
		await until(() => store.state.connection === "open" && store.state.seq === 17)
		const refused: string[] = []
		store.onMemberRefused((op, reason) => refused.push(`${op.op} ${op.slug} ${reason}`))
		const slugs = () => store.members().map((m) => `${m.slug}:${m.name}`)

		store.member({ op: "add", slug: "cy" as never, name: "cy" })
		store.member({ op: "rename", slug: fixtures.ada, name: "ada two" })
		expect(slugs()).toEqual(["ada:ada two", "bob:bob", "cy:cy"])
		await until(() => store.state.patches.length === 0)
		expect(store.state.members.map((m) => m.slug as string)).toEqual(["ada", "bob", "cy"])
		expect(store.state.roster.map((n) => `${n.name} ${n.kind}`)).toEqual(["cy joined"])

		store.member({ op: "remove", slug: "bob" as never })
		store.member({ op: "remove", slug: "cy" as never })
		store.member({ op: "remove", slug: fixtures.ada })
		// All three go at once; the room takes two and refuses the last one standing.
		expect(store.members()).toEqual([])
		await until(() => refused.length === 1 && store.state.patches.length === 0)
		expect(refused).toEqual(["remove ada last"])
		expect(slugs()).toEqual(["ada:ada two"])
		expect(store.state.roster.map((n) => `${n.name} ${n.kind}`)).toEqual(["cy joined", "bob left", "cy left"])
		store.close()
	})

	test("catalog asks the room for links and pages by the cursor it gave", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await until(() => store.state.connection === "open")
		store.send("one https://a.dev/1")
		store.send("two https://b.dev/2")
		store.send("no link here")
		await until(() => store.state.messages.filter((m) => m.from.kind === "human").length >= 3)
		const first = await store.catalog("links", undefined, 1)
		expect(first?.items.map((i) => (i.kind === "link" ? i.url : ""))).toEqual(["https://b.dev/2"])
		expect(first?.next).not.toBeNull()
		const rest = await store.catalog("links", first!.next!, 1)
		expect(rest?.items.map((i) => (i.kind === "link" ? i.url : ""))).toEqual(["https://a.dev/1"])
		expect(rest?.next).toBeNull()
		expect((await store.catalog("media"))?.items.map((i) => i.kind)).toEqual(["media"])
		store.close()
		expect(await store.catalog("links")).toBeNull()
	})

	test("paints from the warm tier, then says hello with its lastSeq", async () => {
		const { mock, make } = setup()
		const warm = await freshWarm()
		// The device has synced to seq 17 before.
		const snap = fixtures.roomSnapshot
		putMessages(warm, roomId, snap.messages)
		setLastSeq(warm, roomId, snap.seq)
		warm.put("meta", `room:${roomId}`, { readSeq: snap.readSeq, members: snap.members, tasks: snap.tasks, approvals: snap.approvals, files: snap.files })
		await warm.flush()
		mock.store({ t: "message", id: "m18" as MessageId, from: { kind: "agent", slug: fixtures.ada }, text: "later" })

		const { store } = await make(warm)
		await store.ready
		expect(store.state.messages.map((m) => m.text)).toEqual(snap.messages.map((m) => m.text))
		expect(store.state.tasks).toEqual(snap.tasks as never)
		await until(() => store.state.seq === 18)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: 17 })
		expect(store.messages().at(-1)?.text).toBe("later")
		await warm.flush()
		expect(await getLastSeq(warm, roomId)).toBe(18)
		store.close()
	})

	test("every action applies and returns before any network work", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await store.ready
		await until(() => store.state.connection === "open" && store.state.seq === 17)
		const before = mock.received.length
		const m1 = fixtures.roomSnapshot.messages[0].id
		const results = [
			store.send("hello there"),
			store.react(m1, "🎉"),
			store.edit(m1, "edited"),
			store.markRead(17),
			store.approve("a1", "accept"),
			store.task({ op: "create", id: "t9", title: "ship" }),
		]
		for (const r of results) expect((r as unknown) instanceof Promise).toBe(false)
		// Nothing has crossed the fake network yet, and the view already shows every action.
		expect(mock.received.length).toBe(before)
		const view = store.messages()
		expect(view.at(-1)).toMatchObject({ text: "hello there", pending: true })
		expect(view[0]).toMatchObject({ text: "edited" })
		expect(view[0].reactions?.some((r) => r.by.kind === "human" && r.emoji === "🎉")).toBe(true)
		expect(store.readSeq()).toBe(17)
		expect(store.approvals()[0].state).toBe("accepted")
		expect(store.tasks().map((t) => t.id)).toContain("t9")

		// The room confirms each one, and every patch is dropped.
		await until(() => store.state.patches.length === 0)
		expect(store.state.messages.at(-1)).toMatchObject({ text: "hello there" })
		expect(store.state.messages[0].text).toBe("edited")
		expect(store.state.approvals[0].state).toBe("accepted")
		expect(store.state.tasks.map((t) => t.id)).toContain("t9")
		store.close()
	})

	test("send while offline, reconnect, and see one message", async () => {
		const { mock, make } = setup()
		mock.online = false
		const { store, warm } = await make()
		await store.ready
		const clientId = store.send("sent offline")
		expect(humanTexts(store.messages(), "sent offline")).toHaveLength(1)
		expect((await outbox(warm, roomId)).map((i) => i.frame.clientId)).toEqual([clientId])
		await sleep(40)
		expect(store.state.connection).not.toBe("open")

		mock.online = true
		await until(() => store.state.patches.length === 0)
		expect(humanTexts(mock.log.filter((e) => e.t === "message") as Message[], "sent offline")).toHaveLength(1)
		expect(humanTexts(store.messages(), "sent offline")).toHaveLength(1)
		expect(store.messages().at(-1)?.pending).toBeUndefined()
		expect(await outbox(warm, roomId)).toEqual([])
		store.close()
	})

	test("a send whose ack is lost is resent once and stored once", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await until(() => store.state.connection === "open")
		mock.loseNextAck = true
		store.send("ack lost")
		await until(() => mock.received.filter((f) => f.t === "send").length === 2)
		await until(() => store.state.patches.length === 0)
		expect(humanTexts(mock.log.filter((e) => e.t === "message") as Message[], "ack lost")).toHaveLength(1)
		expect(humanTexts(store.messages(), "ack lost")).toHaveLength(1)
		store.close()
	})

	test("a send made offline survives a reload and goes out once", async () => {
		const { mock, make } = setup()
		mock.online = false
		const first = await make()
		await first.store.ready
		first.store.send("before reload")
		first.store.close()

		mock.online = true
		const second = await make(first.warm)
		await second.store.ready
		expect(humanTexts(second.store.messages(), "before reload")).toHaveLength(1)
		await until(() => second.store.state.patches.length === 0)
		expect(humanTexts(second.store.messages(), "before reload")).toHaveLength(1)
		expect(humanTexts(mock.log.filter((e) => e.t === "message") as Message[], "before reload")).toHaveLength(1)
		second.store.close()
	})

	test("a reset replaces the room and the warm tier", async () => {
		const events: RoomEvent[] = Array.from({ length: 600 }, (_, i) => ({
			t: "message",
			seq: i + 1,
			at: i,
			id: `m${i + 1}` as MessageId,
			from: { kind: "human" },
			text: `n${i + 1}`,
		}))
		const { mock, make } = setup({ events })
		const warm = await freshWarm()
		// A stale device: it knows an old message that the room no longer has.
		putMessages(warm, roomId, [{ id: "gone" as MessageId, seq: 1, at: 0, from: { kind: "human" }, text: "stale" }])
		setLastSeq(warm, roomId, 1)
		warm.put("meta", `room:${roomId}`, { readSeq: 0, members: [], tasks: [], approvals: [], files: [] })
		await warm.flush()

		const { store } = await make(warm)
		await until(() => store.state.seq === 600)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: 1 })
		expect(store.state.messages).toHaveLength(600)
		expect(store.state.messages[0].text).toBe("n1")
		expect(store.state.members.map((m) => m.slug)).toEqual([fixtures.ada, fixtures.bob])
		await warm.flush()
		expect(await getLastSeq(warm, roomId)).toBe(600)
		const stored = await newestMessages(warm, roomId, 1000)
		expect(stored).toHaveLength(600)
		expect(stored.some((m) => m.text === "stale")).toBe(false)
		store.close()
	})

	test("applies 1,000 events with no task over 8 ms", async () => {
		const { schedule, durations } = timedSchedule()
		const { mock, make } = setup({ schedule, resetAfter: 5000 }, { schedule })
		const { store } = await make()
		await until(() => store.state.seq === 17)

		// 1,000 events in one frame on resume, then 1,000 more one frame each.
		const many = (from: number) =>
			Array.from({ length: 1000 }, (_, i): RoomEvent => {
				const n = from + i
				return i % 4 === 3
					? { t: "react", seq: 0, at: 0, messageId: `x${n - 1}` as MessageId, by: { kind: "agent", slug: "ada" as AgentSlug }, emoji: "👍" }
					: { t: "message", seq: 0, at: 0, id: `x${n}` as MessageId, from: { kind: "agent", slug: "ada" as AgentSlug }, text: `bubble ${n}` }
			})
		mock.drop()
		mock.online = false
		mock.store(...many(0).map(({ seq: _, at: __, ...e }) => e as never))
		Bun.gc(true)
		durations.length = 0
		mock.online = true
		await until(() => store.state.seq === 1017, 10_000)
		await store.settled()
		const replay = Math.max(...durations)

		Bun.gc(true)
		durations.length = 0
		for (const e of many(1000)) {
			const { seq: _, at: __, ...rest } = e
			mock.store(rest as never)
		}
		await until(() => store.state.seq === 2017, 10_000)
		await store.settled()
		const live = Math.max(...durations)

		console.log(`longest task: ${replay.toFixed(2)} ms on replay, ${live.toFixed(2)} ms live`)
		expect(store.state.messages.length).toBe(2 + 1500)
		expect(store.state.messages.at(-1)?.text).toBe("bubble 1998")
		expect(store.state.messages.at(-1)?.reactions).toHaveLength(1)
		expect(replay).toBeLessThan(8)
		expect(live).toBeLessThan(8)
		store.close()
	})

	test("typing, status, and drafts are shown, and a final message replaces its draft", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await until(() => store.state.seq === 17)
		mock.broadcast({ t: "typing", who: [fixtures.ada] })
		mock.broadcast({ t: "status", slug: fixtures.ada, state: "typing" })
		mock.broadcast({ t: "draft", slug: fixtures.ada, runId: "r9", index: 0, text: "grow" })
		await until(() => Object.keys(store.state.drafts).length === 1)
		expect(store.state.typing).toEqual([fixtures.ada])
		expect(store.state.status[fixtures.ada]).toBe("typing")
		mock.store({ t: "message", id: "m99" as MessageId, from: { kind: "agent", slug: fixtures.ada }, text: "grown", run: { runId: "r9", attempt: 1, index: 0 } })
		await until(() => Object.keys(store.state.drafts).length === 0)
		mock.drop()
		await until(() => store.state.connection !== "open")
		expect(store.state.typing).toEqual([])
		store.close()
	})
})

describe("composer typing and run end", () => {
	test("typing frames go out at most once every 2 s", async () => {
		let t = 10_000
		const { mock, make } = setup({}, { now: () => t })
		const { store } = await make()
		await until(() => store.state.connection === "open")
		const typed = () => mock.received.filter((f) => f.t === "typing").length
		for (let i = 0; i < 20; i++) store.typing()
		await until(() => typed() === 1)
		t += 1999
		store.typing()
		await sleep(20)
		expect(typed()).toBe(1)
		t += 1
		store.typing()
		await until(() => typed() === 2)
		store.close()
	})

	test("an idle status clears that agent's drafts and keeps another's", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await until(() => store.state.seq === 17)
		mock.broadcast({ t: "draft", slug: fixtures.ada, runId: "r1", index: 0, text: "aborted" })
		mock.broadcast({ t: "draft", slug: fixtures.bob, runId: "r2", index: 0, text: "going" })
		await until(() => Object.keys(store.state.drafts).length === 2)
		mock.broadcast({ t: "status", slug: fixtures.ada, state: "idle" })
		await until(() => Object.keys(store.state.drafts).length === 1)
		expect(Object.values(store.state.drafts)[0].slug).toBe(fixtures.bob)
		store.close()
	})
})

describe("the user store", () => {
	test("chat edits apply at once, go out after a reconnect, and are confirmed", async () => {
		const mock = createMockUser()
		mock.online = false
		const warm = await freshWarm()
		const store = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		const roomIdNew = store.createChat("new chat")
		expect(roomIdNew as string).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
		store.pin(roomIdNew, true)
		expect(store.chats()[0]).toMatchObject({ roomId: roomIdNew, title: "new chat", pinned: true })

		mock.online = true
		await until(() => store.state.patches.length === 0)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: 0 })
		expect(store.chats().map((c) => c.title)).toEqual(["new chat", "protocol plan"])
		expect(store.state.chats.find((c) => c.roomId === roomIdNew)?.pinned).toBe(true)
		await warm.flush()
		expect((await allChats(warm)).map((c) => c.title)).toEqual(["new chat", "protocol plan"])

		store.remove(fixtures.roomId as RoomId)
		expect(store.chats().map((c) => c.title)).toEqual(["new chat"])
		await until(() => store.state.patches.length === 0)
		expect(store.state.chats).toHaveLength(1)
		store.close()
	})

	test("room ids are ULIDs", () => {
		expect(newRoomId(0, () => new Uint8Array(16)) as string).toBe("0".repeat(26))
	})
})

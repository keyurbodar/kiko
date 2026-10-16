import "fake-indexeddb/auto"
import { describe, expect, test } from "bun:test"
import type { AgentSlug, Message, MessageId, RoomEvent, RoomId } from "@kiko/protocol"
import * as fixtures from "@kiko/protocol/fixtures"
import { IDBFactory } from "fake-indexeddb"
import { allChats, putChats, setUserSeq } from "../warm/chats"
import { openWarm, type Warm } from "../warm/db"
import { dropBefore, getLastSeq, newestMessages, putMessages, setLastSeq } from "../warm/messages"
import { outbox } from "../warm/outbox"
import { createMockRoom, createMockUser, type MockRoomOptions } from "./mock-room"
import { overlayChats, overlayMessages, type RoomPatch, settleRoom } from "./patches"
import { applyRoomEvent, applyStatus, createRoomStore, emptyRoom, HISTORY_PAGE, MAX_MESSAGES_IN_MEMORY, type RoomStoreOptions, WINDOW_SLACK } from "./room-store"
import { backoffDelay, createSyncSocket, parseFrame } from "./socket"
import { createUserStore, newRoomId, OPEN_DEBOUNCE_MS } from "./user-store"
import { createUserChannel } from "./user-channel"

const roomId = fixtures.roomId
/** The seq the fixture room ends on. */
const LAST = fixtures.roomSnapshot.seq
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
		for (const s of fixtures.agentStatuses) applyStatus(data, s)
		expect(data).toEqual({ ...fixtures.roomSnapshot } as never)
	})

	test("an idle status takes the agent off the busy list", () => {
		const data = emptyRoom()
		applyStatus(data, { slug: "ada" as never, state: "typing" })
		expect(data.agents.map((a) => a.slug)).toEqual(["ada"])
		applyStatus(data, { slug: "ada" as never, state: "idle" })
		expect(data.agents).toEqual([])
	})

	test("a change to a current member updates it in place", () => {
		const data = { ...emptyRoom(), members: [...fixtures.members] }
		const lead = fixtures.members[0]!
		applyRoomEvent(data, { seq: 1, at: 1, t: "member", member: { ...lead, name: "renamed" } })
		expect(data.members[0]!.name).toBe("renamed")
	})

	test("an event at or below the applied seq is skipped", () => {
		const data = emptyRoom()
		const [first] = structuredClone(fixtures.roomEvents) as RoomEvent[]
		expect(applyRoomEvent(data, first)).not.toBeNull()
		expect(applyRoomEvent(data, first)).toBeNull()
		expect(data.messages).toHaveLength(1)
	})

	test("new bytes at a path replace the file, and a later version of it replaces its row", () => {
		const data = emptyRoom()
		const at = (seq: number, id: string, extra = {}): RoomEvent =>
			({ t: "file", seq, at: seq, by: { kind: "human" }, file: { id, name: "a.txt", size: 1, type: "text/plain", ...extra } }) as RoomEvent
		applyRoomEvent(data, at(1, "v1"))
		applyRoomEvent(data, at(2, "v2"))
		expect(data.files.map((f) => f.id)).toEqual(["v2"])
		applyRoomEvent(data, at(3, "v2", { size: 4 }))
		expect(data.files).toEqual([{ id: "v2", name: "a.txt", size: 4, type: "text/plain" }])
	})

	test("an event tag this client does not know, such as an old preview, changes nothing and moves the seq", () => {
		const data = emptyRoom()
		const old = { t: "preview", seq: 1, at: 1, messageId: "m1", preview: { url: "https://a.dev" } } as unknown as RoomEvent
		expect(applyRoomEvent(data, old)).toEqual({})
		expect(data.seq).toBe(1)
		expect(data.messages).toEqual([])
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
		expect(view.at(-1)).toMatchObject({ text: "hi", pending: true, clientId: "c9", id: "local:c9" })
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
		await until(() => store.state.connection === "open" && store.state.seq === LAST)
		const refused: string[] = []
		store.onMemberRefused((op, reason) => refused.push(`${op.op} ${op.slug} ${reason}`))
		const slugs = () => store.members().map((m) => `${m.slug}:${m.name}`)

		store.member({ op: "add", slug: "cy" as never, name: "cy" })
		store.member({ op: "rename", slug: fixtures.ada, name: "ada two" })
		expect(slugs()).toEqual(["ada:ada two", "bob:bob", "cy:cy"])
		await until(() => store.state.patches.length === 0)
		expect(store.state.members.map((m) => m.slug as string)).toEqual(["ada", "bob", "cy"])

		store.member({ op: "remove", slug: "bob" as never })
		store.member({ op: "remove", slug: "cy" as never })
		store.member({ op: "remove", slug: fixtures.ada })
		// All three go at once; the room takes two and refuses the last one standing.
		expect(store.members()).toEqual([])
		await until(() => refused.length === 1 && store.state.patches.length === 0)
		expect(refused).toEqual(["remove ada last"])
		expect(slugs()).toEqual(["ada:ada two"])
		store.close()
	})

	test("paints from the warm tier, then says hello with its lastSeq", async () => {
		const { mock, make } = setup()
		const warm = await freshWarm()
		// The device has synced to the snapshot's seq before.
		const snap = fixtures.roomSnapshot
		putMessages(warm, roomId, snap.messages)
		setLastSeq(warm, roomId, snap.seq)
		warm.put("meta", `room:${roomId}`, { readSeq: snap.readSeq, members: snap.members, tasks: snap.tasks, files: snap.files })
		await warm.flush()
		mock.store({ t: "message", id: "m-later" as MessageId, from: { kind: "agent", slug: fixtures.ada }, text: "later" })

		const { store } = await make(warm)
		await store.ready
		expect(store.state.messages.map((m) => m.text)).toEqual(snap.messages.map((m) => m.text))
		expect(store.state.tasks).toEqual(snap.tasks as never)
		await until(() => store.state.seq === LAST + 1)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: LAST })
		expect(store.messages().at(-1)?.text).toBe("later")
		await warm.flush()
		expect(await getLastSeq(warm, roomId)).toBe(LAST + 1)
		store.close()
	})

	test("every action applies and returns before any network work", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await store.ready
		await until(() => store.state.connection === "open" && store.state.seq === LAST)
		const before = mock.received.length
		const m1 = fixtures.roomSnapshot.messages[0].id
		const results = [
			store.send("hello there"),
			store.react(m1, "🎉"),
			store.edit(m1, "edited"),
			store.markRead(LAST),
			store.task({ op: "create", id: "t9", title: "ship" }),
		]
		for (const r of results) expect((r as unknown) instanceof Promise).toBe(false)
		// Nothing has crossed the fake network yet, and the view already shows every action.
		expect(mock.received.length).toBe(before)
		const view = store.messages()
		expect(view.at(-1)).toMatchObject({ text: "hello there", pending: true })
		expect(view[0]).toMatchObject({ text: "edited" })
		expect(view[0].reactions?.some((r) => r.by.kind === "human" && r.emoji === "🎉")).toBe(true)
		expect(store.readSeq()).toBe(LAST)
		expect(store.tasks().map((t) => t.id)).toContain("t9")

		// The room confirms each one, and every patch is dropped.
		await until(() => store.state.patches.length === 0)
		expect(store.state.messages.at(-1)).toMatchObject({ text: "hello there" })
		expect(store.state.messages[0].text).toBe("edited")
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
		warm.put("meta", `room:${roomId}`, { readSeq: 0, members: [], tasks: [], files: [] })
		await warm.flush()

		const { store } = await make(warm)
		await until(() => store.state.seq === 600)
		expect(mock.received[0]).toEqual({ t: "hello", lastSeq: 1 })
		// Memory holds the newest window. The disk holds the rest.
		expect(store.state.messages).toHaveLength(MAX_MESSAGES_IN_MEMORY)
		expect(store.state.messages[0].text).toBe("n401")
		expect(store.state.members.map((m) => m.slug)).toEqual([fixtures.ada, fixtures.bob])
		await warm.flush()
		expect(await getLastSeq(warm, roomId)).toBe(600)
		const stored = await newestMessages(warm, roomId, 1000)
		expect(stored).toHaveLength(600)
		expect(stored.some((m) => m.text === "stale")).toBe(false)
		store.close()
	})

	test("the window stays capped while following, pages older from disk, and caps again on follow", async () => {
		const events: RoomEvent[] = Array.from({ length: 150 }, (_, i) => ({ t: "message", seq: i + 1, at: i, id: `m${i + 1}` as MessageId, from: { kind: "human" }, text: `n${i + 1}` }))
		const { mock, make } = setup({ events })
		const warm = await freshWarm()
		const { store } = await make(warm)
		await until(() => store.state.seq === 150)
		// 200 live messages: the window grows past the cap only by the slack, then is cut back.
		for (let i = 151; i <= 350; i++) mock.store({ t: "message", id: `m${i}` as MessageId, from: { kind: "human" }, text: `n${i}` })
		await until(() => store.state.seq === 350)
		await store.settled()
		expect(store.state.messages.length).toBeLessThanOrEqual(MAX_MESSAGES_IN_MEMORY + WINDOW_SLACK)
		expect(store.state.messages.at(-1)?.text).toBe("n350")
		const before = store.state.messages.length
		// Scrolling up brings older ones back from IndexedDB, and live messages no longer cut them.
		expect(await store.loadOlder(50)).toBe(50)
		expect(store.state.messages.length).toBe(before + 50)
		mock.store({ t: "message", id: "m351" as MessageId, from: { kind: "human" }, text: "n351" })
		await until(() => store.state.seq === 351)
		expect(store.state.messages.length).toBe(before + 51)
		// Back at the end: the window is the newest MAX again.
		store.follow()
		expect(store.state.messages).toHaveLength(MAX_MESSAGES_IN_MEMORY)
		expect(store.state.messages.at(-1)?.text).toBe("n351")
		store.close()
	})

	test("a jump past the disk shows a history window that follows edits, pages both ways, and joins the live end", async () => {
		const events: RoomEvent[] = Array.from({ length: 600 }, (_, i) => ({ t: "message", seq: i + 1, at: i, id: `m${i + 1}` as MessageId, from: { kind: "human" }, text: `n${i + 1}` }))
		const { mock, make } = setup({ events })
		const warm = await freshWarm()
		const { store } = await make(warm)
		await until(() => store.state.seq === 600)
		await store.settled()
		await warm.flush()
		// The disk kept only the newest 100, as after a long absence.
		dropBefore(warm, roomId, 501)
		await warm.flush()
		const texts = () => store.messages().map((m) => m.text)

		// A message in memory is shown at once, with no question to the room.
		const asked = mock.received.length
		expect(await store.jumpTo(550)).toBe(true)
		expect(mock.received.length).toBe(asked)
		expect(store.state.history).toBeNull()

		expect(await store.jumpTo(100)).toBe(true)
		expect(texts()[0]).toBe(`n${100 - HISTORY_PAGE}`)
		expect(texts()).toContain("n100")
		expect(store.state.messages.at(-1)?.text).toBe("n600")
		// A live message goes to the live window; an edit of a shown message shows.
		mock.store({ t: "message", id: "m601" as MessageId, from: { kind: "human" }, text: "n601" })
		mock.store({ t: "edit", messageId: "m100" as MessageId, text: "edited" })
		await until(() => store.state.seq === 602)
		await store.settled()
		expect(texts()).not.toContain("n601")
		expect(texts()).toContain("edited")
		expect(store.state.messages.at(-1)?.text).toBe("n601")

		// Older pages come from the room, since the disk does not reach this far.
		expect(await store.loadOlder(20)).toBe(20)
		expect(texts()[0]).toBe(`n${100 - HISTORY_PAGE - 20}`)

		// At the end of the window, newer pages come in until they reach the live window.
		for (let i = 0; i < 20 && store.state.history; i++) {
			store.follow()
			await until(() => mock.received.at(-1)?.t === "history")
			await sleep(5)
		}
		expect(store.state.history).toBeNull()
		const joined = store.state.messages.map((m) => m.seq)
		const first = 100 - HISTORY_PAGE - 20
		// One contiguous list, from the oldest page to the newest live message.
		expect(joined).toEqual(Array.from({ length: 601 - first + 1 }, (_, i) => first + i))
		// Back at the live end, follow cuts the window as always.
		store.follow()
		expect(store.state.messages).toHaveLength(MAX_MESSAGES_IN_MEMORY)
		store.close()
	})

	test("a send from a history window goes back to the live end, and an unknown seq is not a jump", async () => {
		const events: RoomEvent[] = Array.from({ length: 300 }, (_, i) => ({ t: "message", seq: i + 1, at: i, id: `m${i + 1}` as MessageId, from: { kind: "human" }, text: `n${i + 1}` }))
		const { mock, make } = setup({ events })
		const { store } = await make()
		await until(() => store.state.seq === 300)
		await store.settled()
		expect(await store.jumpTo(5)).toBe(true)
		expect(store.state.history?.[0]?.text).toBe("n1")
		expect(await store.jumpTo(9999)).toBe(false)
		store.send("back")
		expect(store.state.history).toBeNull()
		expect(store.messages().at(-1)?.text).toBe("back")
		await until(() => mock.received.some((f) => f.t === "send"))
		store.close()
	})

	test("search asks the room and resolves to its page; paging passes the cursor", async () => {
		const events: RoomEvent[] = Array.from({ length: 30 }, (_, i) => ({ t: "message", seq: i + 1, at: i, id: `m${i + 1}` as MessageId, from: { kind: "human" }, text: i % 2 ? `odd apple ${i + 1}` : `even ${i + 1}` }))
		const { make } = setup({ events })
		const { store } = await make()
		// Asked before the socket is open: it waits for it.
		const first = await store.search("apple", undefined, 5)
		expect(first?.results.map((r) => r.seq)).toEqual([30, 28, 26, 24, 22])
		expect(first?.results[0]?.snippet).toBe("odd \u0002apple\u0003 30")
		const second = await store.search("apple", first!.next!, 5)
		expect(second?.results[0]?.seq).toBe(20)
		store.close()
		expect(await store.search("apple")).toBeNull()
	})

	test("a send names its uploads, shows its blob URLs until the room confirms it, then frees them", async () => {
		const revoked: string[] = []
		const original = URL.revokeObjectURL
		URL.revokeObjectURL = (url: string) => void revoked.push(url)
		try {
			const { mock, make } = setup()
			const { store } = await make()
			await store.ready
			await until(() => store.state.connection === "open")
			const attachments = [{ pendingId: "0199a8f0-0000-7000-8000-00000000000a", name: "a.png", type: "image/png", size: 1 }]
			const clientId = store.send("pic", { attachments, local: [{ src: "blob:one", name: "a.png", type: "image/png", size: 1 }] })
			const sent = store.messages().find((m) => m.clientId === clientId)
			expect(sent?.local?.map((f) => f.src)).toEqual(["blob:one"])
			await until(() => mock.received.some((f) => f.t === "send"))
			expect(mock.received.find((f) => f.t === "send")).toMatchObject({ attachments })
			await until(() => store.messages().some((m) => !m.pending && m.text === "pic"))
			const stored = store.messages().find((m) => m.text === "pic")!
			expect(stored.files?.map((f) => f.id)).toEqual([attachments[0]!.pendingId])
			expect(store.files().map((f) => f.id)).toContain(attachments[0]!.pendingId)
			expect(revoked).toEqual(["blob:one"])
		} finally {
			URL.revokeObjectURL = original
		}
	})

	test("a send the room refuses stays, marked failed with the reason, and is not sent again", async () => {
		const { mock, make } = setup()
		const { store, warm } = await make()
		await store.ready
		await until(() => store.state.connection === "open")
		const reason = "Attachment 'a.png' cannot be sent: attachment not found (removed or expired)."
		mock.refuseNextSend = reason
		const heard: string[] = []
		store.onSendRefused((r) => heard.push(r))
		const clientId = store.send("pic", { attachments: [{ pendingId: "0199a8f0-0000-7000-8000-00000000000b", name: "a.png", type: "image/png", size: 1 }] })
		await until(() => heard.length === 1)
		expect(heard).toEqual([reason])
		expect(store.messages().find((m) => m.clientId === clientId)).toMatchObject({ failed: true, reason })
		await warm.flush()
		expect((await outbox(warm, roomId)).some((i) => i.frame.clientId === clientId)).toBe(false)
		mock.drop()
		await until(() => store.state.connection === "open")
		await sleep(30)
		expect(mock.received.filter((f) => f.t === "send" && f.clientId === clientId).length).toBe(1)
	})

	test("an edit or delete of a message outside the window reaches the disk", async () => {
		const events: RoomEvent[] = Array.from({ length: 300 }, (_, i) => ({ t: "message", seq: i + 1, at: i, id: `m${i + 1}` as MessageId, from: { kind: "human" }, text: `n${i + 1}` }))
		const { mock, make } = setup({ events })
		const warm = await freshWarm()
		const { store } = await make(warm)
		await until(() => store.state.seq === 300)
		store.follow()
		expect(store.state.messages.some((m) => m.id === "m5")).toBe(false)
		mock.store({ t: "edit", messageId: "m5" as MessageId, text: "changed" })
		mock.store({ t: "delete", messageIds: ["m6" as MessageId], by: { kind: "human" } } as never)
		await until(() => store.state.seq === 302)
		await new Promise((r) => setTimeout(r, 30))
		await warm.flush()
		const disk = await newestMessages(warm, roomId, 1000)
		expect(disk.find((m) => m.id === "m5")?.text).toBe("changed")
		expect(disk.some((m) => m.id === "m6")).toBe(false)
		store.close()
	})

	test("applies 1,000 events with no task over 8 ms", async () => {
		const { schedule, durations } = timedSchedule()
		const { mock, make } = setup({ schedule, resetAfter: 5000 }, { schedule })
		const { store } = await make()
		await until(() => store.state.seq === LAST)

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
		await until(() => store.state.seq === LAST + 1000, 10_000)
		await store.settled()
		const replay = Math.max(...durations)

		Bun.gc(true)
		durations.length = 0
		for (const e of many(1000)) {
			const { seq: _, at: __, ...rest } = e
			mock.store(rest as never)
		}
		await until(() => store.state.seq === LAST + 2000, 10_000)
		await store.settled()
		const live = Math.max(...durations)

		console.log(`longest task: ${replay.toFixed(2)} ms on replay, ${live.toFixed(2)} ms live`)
		expect(store.state.messages.length).toBeLessThanOrEqual(MAX_MESSAGES_IN_MEMORY + WINDOW_SLACK)
		expect(store.state.messages.at(-1)?.text).toBe("bubble 1998")
		expect(store.state.messages.at(-1)?.reactions).toHaveLength(1)
		expect(replay).toBeLessThan(8)
		expect(live).toBeLessThan(8)
		store.close()
	})

	test("typing and status are shown, and cleared when the socket drops", async () => {
		const { mock, make } = setup()
		const { store } = await make()
		await until(() => store.state.seq === LAST)
		mock.broadcast({ t: "typing", who: [fixtures.ada] })
		mock.broadcast({ t: "status", slug: fixtures.ada, state: "typing" })
		await until(() => store.state.status[fixtures.ada] === "typing")
		expect(store.state.typing).toEqual([fixtures.ada])
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
})

describe("the user store", () => {
	test("one socket carries the look, memory, and Composio frames through the channel", async () => {
		const mock = createMockUser()
		const warm = await freshWarm()
		const channel = createUserChannel()
		const opened: number[] = []
		const memory: string[] = []
		channel.onOpen(() => opened.push(1))
		const stop = channel.on("memory_result", (f) => memory.push(f.reqId))
		expect(channel.send({ t: "theme", theme: null })).toBe(false)
		const store = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 }, channel })
		await until(() => store.state.synced)
		expect(opened).toHaveLength(1)
		// A frame another feature sends goes out on the store's own socket: the mock has one peer.
		expect(channel.send({ t: "memory", reqId: "q1", op: { op: "list" } } as never)).toBe(true)
		await until(() => mock.received.some((f) => f.t === "memory"))
		expect(mock.received.filter((f) => f.t === "hello")).toHaveLength(1)
		stop()
		store.close()
		expect(channel.send({ t: "theme", theme: null })).toBe(false)
		expect(memory).toEqual([])
	})

	test("chat edits apply at once, go out after a reconnect, and are confirmed", async () => {
		const mock = createMockUser()
		mock.online = false
		const warm = await freshWarm()
		const store = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		const roomIdNew = store.createChat("new chat")
		expect(roomIdNew as string).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
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

	test("a cache with a seq but no drive asks for a full snapshot", async () => {
		const warm = await freshWarm()
		setUserSeq(warm, 5)
		putChats(warm, [fixtures.chat])
		const mock = createMockUser()
		const store = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		await until(() => mock.received.some((f) => f.t === "hello"))
		expect(mock.received.find((f) => f.t === "hello")).toEqual({ t: "hello", lastSeq: 0 })
		store.close()
	})

	test("the drive paints from the cache after a reload, before the server answers", async () => {
		const warm = await freshWarm()
		const mock = createMockUser()
		mock.store({ t: "file", file: { id: "f1", name: "a.txt", size: 1, type: "text/plain" } })
		const first = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await until(() => first.homeFiles().length === 1)
		first.close()
		const seq = mock.log.at(-1)!.seq

		const second = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await second.ready
		expect(second.homeFiles().map((f) => f.name)).toEqual(["a.txt"])
		await until(() => second.state.synced)
		expect(mock.received.filter((f) => f.t === "hello").at(-1)).toEqual({ t: "hello", lastSeq: seq })
		second.close()
	})

	test("a second direct chat made before the list arrived is refused: it leaves the list and points at the first", async () => {
		const mock = createMockUser({ chats: [{ ...fixtures.chat, roomId: fixtures.otherRoomId, agents: ["id-ada"] }] })
		const store = createUserStore({ warm: await freshWarm(), url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		const second = store.createChat("ada", ["id-ada"])
		expect(store.chats().some((c) => c.roomId === second)).toBe(true)
		await until(() => store.state.refused[second] !== undefined)
		expect(store.state.refused[second]).toBe(fixtures.otherRoomId)
		expect(store.chats().map((c) => c.roomId)).toEqual([fixtures.otherRoomId])
		store.close()
	})

	test("creating a chat with the same agents as one there returns that chat and sends nothing", async () => {
		const mock = createMockUser({ chats: [{ ...fixtures.chat, roomId: fixtures.otherRoomId, agents: ["kiko", "id-ada"] }] })
		const store = createUserStore({ warm: await freshWarm(), url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		await until(() => store.state.synced)
		expect(store.createChat("kiko, ada", ["id-ada", "kiko"])).toBe(fixtures.otherRoomId)
		expect(store.state.patches).toEqual([])
		expect(mock.received.some((f) => f.t === "chat")).toBe(false)
		store.close()
	})

	test("chat edits made before the server answered survive a reload and go out after it", async () => {
		const warm = await freshWarm()
		const offline = createMockUser()
		offline.online = false
		const first = createUserStore({ warm, url: "ws://mock/user", connect: offline.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await first.ready
		const made = first.createChat("ada", ["id-ada"])
		first.pin(made, true)
		await warm.flush()
		first.close()

		const mock = createMockUser()
		const second = createUserStore({ warm, url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await second.ready
		expect(second.chats().find((c) => c.roomId === made)).toMatchObject({ title: "ada", pinned: true })
		await until(() => second.state.patches.length === 0)
		expect(second.state.chats.find((c) => c.roomId === made)).toMatchObject({ pinned: true })
		second.close()
	})

	test("opening chats tells the server once, after the user settles", async () => {
		const mock = createMockUser()
		const store = createUserStore({ warm: await freshWarm(), url: "ws://mock/user", connect: mock.connect, backoff: { baseMs: 5, maxMs: 20 } })
		await store.ready
		await until(() => store.state.synced)
		store.open(fixtures.roomId as RoomId)
		store.open(fixtures.otherRoomId as RoomId)
		await new Promise((r) => setTimeout(r, OPEN_DEBOUNCE_MS + 100))
		expect(mock.received.filter((f) => f.t === "open")).toEqual([{ t: "open", roomId: fixtures.otherRoomId }])
		store.close()
	})

	test("room ids are UUIDv7s", () => {
		expect(newRoomId(0, new Uint8Array(16)) as string).toBe("00000000-0000-7000-8000-000000000000")
	})
})

describe("composer cards", () => {
  test("typed system events survive snapshots, live delivery, and history storage", async () => {
    const message: Message = { id: "event1" as MessageId, seq: 1, at: 1, from: { kind: "system", reason: "created" }, text: "Sunny morning is ready.", goto: roomId, event: { kind: "created", roomId, title: "Sunny morning" } }
    const { make } = setup({ events: [{ t: "message", ...message }] })
    const { store, warm } = await make()
    await until(() => store.state.seq === 1)
    expect(store.messages()[0]?.event).toEqual(message.event)
    await warm.flush()
    expect((await newestMessages(warm, roomId, 20))[0]?.event).toEqual(message.event)
    store.close()
    warm.close()
  })

  test("an answer hides its question and echoes as a reply before the socket answers", async () => {
    const ask = { id: "question", from: "ada" as AgentSlug, text: "Tea or coffee?", messageId: "question-message" as MessageId }
    const { mock, make } = setup({ events: [{ t: "ask", seq: 1, at: 1, ...ask }] })
    const { store, warm } = await make()
    await until(() => store.asks().length === 1)
    store.suspend()
    store.answer(ask.id, "Coffee")
    expect(store.asks()).toEqual([])
    expect(store.messages().at(-1)).toMatchObject({ text: "Coffee", replyTo: ask.messageId, pending: true })
    store.answer(ask.id, "Tea")
    expect(store.messages().filter((m) => m.pending)).toHaveLength(1)
    store.resume()
    await until(() => mock.received.some((f) => f.t === "answer"))
    await until(() => store.messages().some((m) => m.text === "Coffee" && !m.pending))
    expect(store.messages().filter((m) => m.text === "Coffee")).toHaveLength(1)
    store.close()
    warm.close()
  })

  test("an open question paints from IndexedDB while offline", async () => {
    const ask = { id: "offline-question", from: "ada" as AgentSlug, text: "When?", messageId: "question-message" as MessageId }
    const warm = await freshWarm()
    warm.put("meta", `room:${roomId}`, { readSeq: 0, members: [], tasks: [], files: [], folders: [], asks: [ask] })
    setLastSeq(warm, roomId, 1)
    await warm.flush()
    const { make } = setup({}, { connect: () => ({ send() {}, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null }) })
    const { store } = await make(warm)
    await store.ready
    expect(store.asks()).toEqual([ask])
    store.close()
    warm.close()
  })
})

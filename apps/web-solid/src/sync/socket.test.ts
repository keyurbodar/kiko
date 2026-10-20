import { expect, test, spyOn } from "bun:test"
import { createSyncSocket, createUserChannel, PING, PONG, type SocketLike } from "./socket"

/** A connection the test controls. `answer` false makes it silent: no pong, no close event. */
function fakeServer() {
	const sockets: { s: SocketLike; sent: string[]; closed: boolean }[] = []
	let answer = true
	const connect = () => {
		const entry = { s: null as unknown as SocketLike, sent: [] as string[], closed: false }
		entry.s = {
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			send(data) {
				entry.sent.push(data)
				if (data === PING && answer) queueMicrotask(() => entry.s.onmessage?.({ data: PONG }))
			},
			close() {
				entry.closed = true
			},
		}
		sockets.push(entry)
		queueMicrotask(() => entry.s.onopen?.({}))
		return entry.s
	}
	return { connect, sockets, silence: () => (answer = false) }
}

test("a socket that goes silent without a close event is dropped and reconnected", async () => {
	const server = fakeServer()
	const socket = createSyncSocket({ url: "ws://x", connect: server.connect, hello: () => ({ t: "hello", lastSeq: 0 }), onFrame: () => {}, pingMs: 30, pongMs: 60 })
	await Bun.sleep(150)
	// Pings while alive are answered, so the first socket stays.
	expect(server.sockets).toHaveLength(1)
	expect(server.sockets[0]!.sent).toContain(PING)
	server.silence()
	await Bun.sleep(250)
	expect(server.sockets[0]!.closed).toBe(true)
	expect(server.sockets.length).toBeGreaterThanOrEqual(2)
	// The new socket said hello first, so the room replays what was missed.
	expect(JSON.parse(server.sockets[1]!.sent[0]!)).toEqual({ t: "hello", lastSeq: 0 })
	socket.close()
})

test("reconnect() on an open socket pings at once instead of waiting for silence", async () => {
	const server = fakeServer()
	const socket = createSyncSocket({ url: "ws://x", connect: server.connect, hello: () => ({ t: "hello", lastSeq: 0 }), onFrame: () => {}, pingMs: 60_000, pongMs: 60_000 })
	await Bun.sleep(20)
	expect(server.sockets[0]!.sent).not.toContain(PING)
	socket.reconnect()
	expect(server.sockets[0]!.sent).toContain(PING)
	socket.close()
})


test("one connection carries user frames and independent room subscriptions across reconnect", async () => {
	const server = fakeServer()
	const channel = createUserChannel()
	const heard: unknown[] = []
	let seq = 4
	const roomId = "room-a" as import("@kiko/protocol").RoomId
	const otherId = "room-b" as import("@kiko/protocol").RoomId
	const socket = createSyncSocket<import("@kiko/protocol").OwnerToClient>({
		url: "ws://localhost/api/ws",
		connect: server.connect,
		hello: () => ({ t: "hello", lastSeq: 8 }),
		onFrame: channel.deliver,
		onOpen: channel.opened,
		onStatus: channel.status,
		backoff: { baseMs: 1, maxMs: 1 },
	})
	const detach = channel.attach(socket.send)
	const room = channel.room({ roomId, lastSeq: () => seq, onFrame: (f) => heard.push(f), onOpen: () => {}, onStatus: () => {} })
	const other = channel.room({ roomId: otherId, lastSeq: () => 2, onFrame: () => { throw new Error("wrong room") }, onOpen: () => {}, onStatus: () => {} })
	const userFrames: unknown[] = []
	const off = channel.on("changed", (frame) => userFrames.push(frame))
	await Bun.sleep(5)
	expect(server.sockets).toHaveLength(1)
	const frames = () => server.sockets.at(-1)!.sent.map((f) => JSON.parse(f))
	expect(frames().slice(0, 3)).toEqual([
		{ t: "hello", lastSeq: 8 },
		{ t: "subscribe", roomId, lastSeq: 4 },
		{ t: "subscribe", roomId: otherId, lastSeq: 2 },
	])
	room.send({ t: "typing" })
	expect(frames().at(-1)).toEqual({ t: "room", roomId, frame: { t: "typing" } })
	server.sockets[0]!.s.onmessage?.({ data: JSON.stringify({ t: "room", roomId, frame: { t: "typing", slug: "ada" } }) })
	server.sockets[0]!.s.onmessage?.({ data: JSON.stringify({ t: "changed", what: "providers" }) })
	expect(heard).toEqual([{ t: "typing", slug: "ada" }])
	expect(userFrames).toEqual([{ t: "changed", what: "providers" }])
	other.close()
	expect(frames().at(-1)).toEqual({ t: "unsubscribe", roomId: otherId })
	seq = 9
	server.sockets[0]!.s.onclose?.({})
	expect(room.send({ t: "typing" })).toBe(false)
	await Bun.sleep(10)
	expect(server.sockets).toHaveLength(2)
	expect(frames()).toEqual([{ t: "hello", lastSeq: 8 }, { t: "subscribe", roomId, lastSeq: 9 }])
	room.close()
	expect(frames().at(-1)).toEqual({ t: "unsubscribe", roomId })
	expect(room.send({ t: "typing" })).toBe(false)
	off()
	detach()
	socket.close()
})

test("backoff grows through short opens and resets only after ten seconds open", () => {
	const scheduled: { run: () => void; delay: number; cleared: boolean }[] = []
	const timer = spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, delay: number) => {
		const task = { run, delay, cleared: false }
		scheduled.push(task)
		return task
	}) as unknown as typeof setTimeout)
	const clear = spyOn(globalThis, "clearTimeout").mockImplementation(((task: typeof scheduled[number]) => { task.cleared = true }) as unknown as typeof clearTimeout)
	let current: SocketLike
	const socket = createSyncSocket({ url: "ws://x", connect: () => (current = { send() {}, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null }), hello: () => ({ t: "hello", lastSeq: 0 }), onFrame() {}, random: () => 1 })
	try {
		current!.onopen?.({})
		const firstStable = scheduled.at(-1)!
		current!.onclose?.({})
		expect(firstStable.cleared).toBe(true)
		expect(scheduled.at(-1)!.delay).toBe(250)
		scheduled.at(-1)!.run()
		current!.onopen?.({})
		current!.onclose?.({})
		expect(scheduled.at(-1)!.delay).toBe(500)
		scheduled.at(-1)!.run()
		current!.onopen?.({})
		expect(scheduled.at(-1)!.delay).toBe(10_000)
		scheduled.at(-1)!.run()
		current!.onclose?.({})
		expect(scheduled.at(-1)!.delay).toBe(250)
	} finally {
		socket.close()
		timer.mockRestore()
		clear.mockRestore()
	}
})

import { expect, test } from "bun:test"
import { createSyncSocket, PING, PONG, type SocketLike } from "./socket"

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

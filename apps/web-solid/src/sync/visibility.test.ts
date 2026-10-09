import "fake-indexeddb/auto"
import { describe, expect, test } from "bun:test"
import type { MessageId } from "@yuki/protocol"
import * as fixtures from "@yuki/protocol/fixtures"
import { IDBFactory } from "fake-indexeddb"
import { openWarm } from "../warm/db"
import { createMockRoom } from "./mock-room"
import { createRoomStore } from "./room-store"
import { createThrottle } from "./visibility"

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean) {
	for (let i = 0; i < 400 && !fn(); i++) await tick(2)
	expect(fn()).toBe(true)
}

async function setup() {
	const warm = await openWarm({ userId: "vis", idb: new IDBFactory(), flushEveryMs: 5 })
	const mock = createMockRoom()
	let connects = 0
	const connect: typeof mock.connect = (url) => {
		connects++
		return mock.connect(url)
	}
	const store = createRoomStore({ roomId: fixtures.roomId, warm, url: "ws://mock/room", connect, backoff: { baseMs: 5, maxMs: 20 } })
	await store.ready
	await until(() => store.state.connection === "open")
	// A manual clock stands in for 30 seconds and 5 minutes.
	let timers: { at: number; run: () => void; id: number }[] = []
	let clock = 0
	let nextId = 1
	const throttle = createThrottle({
		room: store,
		setTimer: (run, ms) => {
			timers.push({ at: clock + ms, run, id: nextId })
			return nextId++
		},
		clearTimer: (h) => {
			timers = timers.filter((t) => t.id !== h)
		},
	})
	const advance = (ms: number) => {
		clock += ms
		for (const t of timers.filter((t) => t.at <= clock)) {
			timers = timers.filter((x) => x !== t)
			t.run()
		}
	}
	return { store, mock, setHidden: throttle.setHidden, advance, stop: throttle.stop, connects: () => connects }
}

describe("background tabs", () => {
	test("closes the room socket after 30 seconds hidden and resyncs from lastSeq on return", async () => {
		const t = await setup()
		const before = t.store.state.seq
		t.setHidden(true)
		t.advance(29_000)
		await tick()
		expect(t.store.state.connection).toBe("open")
		t.advance(1_000)
		await until(() => t.store.state.connection === "closed")
		expect(t.mock.peers).toBe(0)
		// Five minutes hidden: no retry, no new connection, no ping.
		const n = t.connects()
		const frames = t.mock.received.length
		t.store.typing()
		t.advance(5 * 60_000)
		await tick(60)
		expect(t.connects()).toBe(n)
		expect(t.mock.received.length).toBe(frames)
		expect(t.store.state.connection).toBe("closed")
		// A message lands while hidden. The return resyncs it from lastSeq.
		t.mock.store({ t: "message", id: "mv1" as MessageId, from: { kind: "agent", slug: fixtures.ada }, text: "while hidden" })
		t.setHidden(false)
		await until(() => t.store.state.connection === "open")
		expect(t.connects()).toBe(n + 1)
		await until(() => t.store.state.messages.some((m) => m.text === "while hidden"))
		expect(t.store.state.seq).toBeGreaterThan(before)
		t.stop()
		t.store.close()
	})

	test("coming back before 30 seconds keeps the same socket", async () => {
		const t = await setup()
		const n = t.connects()
		t.setHidden(true)
		t.advance(20_000)
		t.setHidden(false)
		t.advance(60_000)
		await tick(20)
		expect(t.store.state.connection).toBe("open")
		expect(t.connects()).toBe(n)
		t.stop()
		t.store.close()
	})
})

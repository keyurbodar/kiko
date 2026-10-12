import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomToClient } from "@yuki/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// A send must read about the same number of rows whether the room holds ten messages or thousands. The
// burst window and the unread count both grew with the room, so each send read about two rows per message
// once a burst or an agent's chatter had built up. A send reads about 160 rows, or about 660 once 500 unread
// agent messages exist: the mention scan reads at most MENTION_SCAN (500) by design. The bound sits between
// those and the growing cost, which is 2,000 or more at this size.
const MAX_ROWS_PER_SEND = 1000

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-reads-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

const ROOM = "01JZ8Q4T6MSENDREADS000001"

async function rowsRead(): Promise<number> {
	return (await (await fetch(`${origin}/reads/${ROOM}`)).json()) as number
}

test("rows read per human send stay flat as the burst window and the unread count grow", async () => {
	const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${ROOM}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
	while (!frames.some((f) => f.t === "events")) await Bun.sleep(5)

	// Sends in blocks of 100, measured block by block. Each block returns the rows read per send.
	let sent = 0
	const sendBlock = async () => {
		const before = await rowsRead()
		for (let i = 0; i < 100; i++, sent++) ws.send(JSON.stringify({ t: "send", clientId: `c${sent}`, text: `message ${sent} about nothing in particular` }))
		for (let i = 0; i < 6000 && frames.filter((f) => f.t === "ack").length < 100; i++) await Bun.sleep(5)
		frames.length = 0
		return (await rowsRead() - before) / 100
	}

	const perSend: number[] = []
	for (let block = 0; block < 30; block++) perSend.push(await sendBlock())
	expect(Math.max(...perSend)).toBeLessThanOrEqual(MAX_ROWS_PER_SEND)

	// An agent talks 2,000 times while the human has not read the chat, so every message counts as unread.
	await fetch(`${origin}/chatter/${ROOM}`, { method: "POST", body: "2000" })
	const after = await sendBlock()
	expect(after).toBeLessThanOrEqual(MAX_ROWS_PER_SEND)
	ws.close()
}, 600_000)

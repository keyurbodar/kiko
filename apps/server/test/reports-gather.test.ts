import { expect, test } from "bun:test"
import type { RoomEvent } from "@yuki/protocol"
import { RoomLog } from "../src/room/log"
import { Reports } from "../src/room/reports"
import { migrate } from "../src/room/schema"
import type { Signal } from "../src/room/signals"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"

function setup() {
	const sql = sqlStorage()
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	migrate(storage)
	const log = new RoomLog(storage, () => 1)
	log.setMeta("room_id", ROOM)
	const added: Signal[] = []
	const signals = { add: (s: Signal[]) => (added.push(...s), null) }
	const reports = new Reports({
		ctx: { waitUntil: () => {} } as never,
		env: {} as never,
		alarms: {} as never,
		log,
		members: {} as never,
		mail: {} as never,
		routines: { list: () => [] } as never,
		signals: signals as never,
		home: () => null,
	})
	/** A human reply to `replyTo`, gathered the way the room gathers a live event. */
	const reply = (replyTo: string): RoomEvent => log.addMessage({ from: { kind: "human" }, text: "yes please", replyTo: replyTo as never }).event!
	return { log, reports, added, reply }
}

test("a human reply that quotes an initiative bubble carries the bubble's seq as answers", () => {
	const { log, reports, added, reply } = setup()
	const nudge = log.addMessage({ from: { kind: "agent", slug: "ada" as never }, text: "the tax return is stuck. push it?", initiative: { reason: "stuck task" } })
	reports.gather([reply(nudge.id)])
	expect(added).toEqual([expect.objectContaining({ kind: "burst", answers: nudge.seq })])
})

test("a human reply that quotes an ordinary message carries no answers", () => {
	const { log, reports, added, reply } = setup()
	const plain = log.addMessage({ from: { kind: "agent", slug: "ada" as never }, text: "done with the list" })
	reports.gather([reply(plain.id)])
	expect(added).toHaveLength(1)
	expect(added[0]).not.toHaveProperty("answers")
})

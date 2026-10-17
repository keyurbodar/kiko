import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { BurstFlush } from "../src/room/burst-flush"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import type { MemberRow } from "../src/room/members"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada" } as MemberRow

function setup() {
	const sql = sqlWith(ROOM_STEPS)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	const log = new RoomLog(storage, () => 1)
	const received: { slug: string; envelopes: Envelope[] }[] = []
	const env = {
		AGENT: {
			idFromName: (name: string) => name,
			get: (name: string) => ({
				receive: async (envelopes: Envelope[]) => {
					received.push({ slug: name.split(":").at(-1)!, envelopes })
					return { refused: null }
				},
			}),
		},
	}
	const flush = new BurstFlush({
		env: env as never,
		log,
		mail: new Mail(storage, log, new Asks(sql)),
		deliveries: new Deliveries(storage, log),
		publish: () => {},
		agentHome: (_h, slug) => ({ ...home, slug }),
		delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
		ctx: {} as never,
		members: { list: () => [ada] } as never,
		burst: {} as never,
		home: () => home,
		chat: async () => ({ title: "t" }) as never,
		seedMembers: async () => {},
		drainMail: async () => {},
		startCheck: { arm: async () => {} } as never,
	})
	return { flush, log, received }
}

test("a retry gives the agent the same human messages again, as new deliveries, and stores nothing", async () => {
	const { flush, log, received } = setup()
	const first = log.addMessage({ from: { kind: "human" }, text: "plan my trip" })
	const second = log.addMessage({ from: { kind: "human" }, text: "to Lisbon", replyTo: first.id })
	const before = log.snapshot().messages.length
	await flush.redeliver("ada" as AgentSlug, [first.id, second.id], "err1")
	expect(received).toHaveLength(1)
	expect(received[0]!.slug).toBe("ada")
	expect(received[0]!.envelopes.map((e) => ({ id: e.id, rootId: e.rootId, body: e.body, replyTo: e.replyTo }))).toEqual([
		{ id: `human:${first.id}#err1`, rootId: first.id, body: "plan my trip", replyTo: undefined },
		{ id: `human:${second.id}#err1`, rootId: second.id, body: "to Lisbon", replyTo: first.id },
	])
	expect(log.snapshot().messages).toHaveLength(before)
})

test("the same error gives the same delivery ids, so a second click is the first", async () => {
	const { flush, log, received } = setup()
	const m = log.addMessage({ from: { kind: "human" }, text: "hi" })
	await flush.redeliver("ada" as AgentSlug, [m.id], "err1")
	await flush.redeliver("ada" as AgentSlug, [m.id], "err1")
	expect(received[0]!.envelopes[0]!.id).toBe(received[1]!.envelopes[0]!.id)
})

test("a message the human deleted is not run again", async () => {
	const { flush, log, received } = setup()
	const m = log.addMessage({ from: { kind: "human" }, text: "hi" })
	log.deleteMessages([m.id], { kind: "human" })
	await flush.redeliver("ada" as AgentSlug, [m.id], "err1")
	expect(received).toEqual([])
})

test("an agent that left the room gets nothing", async () => {
	const { flush, log, received } = setup()
	const m = log.addMessage({ from: { kind: "human" }, text: "hi" })
	await flush.redeliver("gone" as AgentSlug, [m.id], "err1")
	expect(received).toEqual([])
})

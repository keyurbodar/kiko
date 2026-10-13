import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import { RoomMail } from "../src/room/mail-drain"
import type { MemberRow } from "../src/room/members"
import { receive, type ReceiveDeps } from "../src/room/receive"
import { Reports } from "../src/room/reports"
import { SignalWindow } from "../src/room/signals"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada" } as MemberRow
const bob = { slug: "bob" } as MemberRow
const members = [ada, bob]

function setup(refusal: string | null) {
	const sql = sqlWith(ROOM_STEPS)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	const log = new RoomLog(storage, () => 1)
	const mail = new Mail(storage, log, new Asks(sql))
	const deliveries = new Deliveries(storage, log)
	const received: { slug: string; ids: string[] }[] = []
	const env = {
		AGENT: {
			idFromName: (name: string) => name,
			get: (name: string) => ({
				receive: async (envelopes: Envelope[]) => {
					received.push({ slug: name.split(":").at(-1)!, ids: envelopes.map((e) => e.id) })
					return { refused: refusal }
				},
			}),
		},
	}
	const deps: ReceiveDeps = {
		env: env as never,
		log,
		mail,
		deliveries,
		publish: () => {},
		agentHome: (_h, slug) => ({ ...home, slug }),
		delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
	}
	const texts = () => log.snapshot().messages.map((m) => m.text)
	return { deps, mail, log, received, texts, storage }
}

const human = (id: string): Envelope => ({ id, roomId: home.roomId, from: { kind: "human" }, body: "hi", hop: 0, rootId: id, seq: 1 })

test("a full inbox is no one's final answer: no notice, nothing marked", async () => {
	const { deps, mail, texts } = setup("full")
	expect(await receive(deps, home, ada, members, "t", [human("human:m1")])).toBe("full")
	expect(texts().filter((t) => /not delivered/.test(t))).toHaveLength(0)
	expect(mail.chainRoot("ada" as AgentSlug)).toBeNull()
})

test("a refused agent message gives back its hop and tells the sender", async () => {
	const { deps, mail, received } = setup("too_large")
	const members2 = [ada, bob]
	mail.delivered("ada" as AgentSlug, [human("r1")])
	expect(mail.send("ada" as AgentSlug, { id: "s1", to: "bob" as AgentSlug, text: "hello" }, members2)).toMatchObject({ ok: true })
	expect(mail.deliveries("r1")).toBe(1)
	const envelope: Envelope = { id: "agent:m9:bob", roomId: home.roomId, from: { kind: "agent", slug: "ada" as AgentSlug }, body: "x", hop: 1, rootId: "r1", seq: 1 }
	expect(await receive(deps, home, bob, members2, "t", [envelope])).toBe("refused")
	expect(received.map((r) => r.slug)).toEqual(["bob", "ada"])
	expect(received[1]!.ids).toEqual(["refused:agent:m9:bob"])
	expect(mail.deliveries("r1")).toBe(0)
})

test("an admitted message is marked delivered", async () => {
	const { deps, mail } = setup(null)
	expect(await receive(deps, home, ada, members, "t", [human("human:m1")])).toBe("admitted")
	expect(mail.chainRoot("ada" as AgentSlug)).toBe("human:m1")
})

test("a send the room has seen before is delivered once", async () => {
	const { deps, received } = setup(null)
	const pending: Promise<unknown>[] = []
	const room = new RoomMail({
		...deps,
		ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never,
		members: { list: () => members } as never,
		burst: { pending: () => false } as never,
		asks: { sent: () => {}, answer: () => null, answeredBy: () => null } as never,
		team: { doing: () => {} } as never,
		alarms: {} as never,
		home: () => home,
		title: async () => "t",
	})
	const send = { id: "s1", to: "bob" as AgentSlug, text: "hello" }
	expect(await room.send("ada" as AgentSlug, send, null)).toMatchObject({ ok: true })
	expect(await room.send("ada" as AgentSlug, send, null)).toMatchObject({ ok: true })
	await Promise.all(pending)
	expect(received.filter((r) => r.slug === "bob")).toHaveLength(1)
})

test("a send that failed after it was recorded is still delivered once when the agent retries", async () => {
	const { deps, received } = setup(null)
	const pending: Promise<unknown>[] = []
	let failing = true
	const room = new RoomMail({
		...deps,
		publish: () => {
			if (failing) throw new Error("publish failed")
		},
		ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never,
		members: { list: () => members } as never,
		burst: { pending: () => false } as never,
		asks: { sent: () => {}, answer: () => null, answeredBy: () => null } as never,
		team: { doing: () => {} } as never,
		alarms: {} as never,
		home: () => home,
		title: async () => "t",
	})
	const send = { id: "s1", to: "bob" as AgentSlug, text: "hello" }
	await expect(room.send("ada" as AgentSlug, send, null)).rejects.toThrow("publish failed")
	failing = false
	expect(await room.send("ada" as AgentSlug, send, null)).toMatchObject({ ok: true })
	await Promise.all(pending)
	expect(received.filter((r) => r.slug === "bob")).toHaveLength(1)
})

test("a held result batch keeps its opening time across retries", async () => {
	const sent: number[] = []
	let fail = true
	const signals = new SignalWindow(sqlWith(ROOM_STEPS), () => ROOM)
	signals.hold([{ kind: "routine_result", roomId: ROOM, at: 5_000, routineId: "r", occurrence: "o", outcome: "ok", seq: null }])
	const env = {
		USER: {
			idFromName: (n: string) => n,
			get: () => ({
				signals: async (batch: { openedAt: number }) => {
					sent.push(batch.openedAt)
					if (fail) throw new Error("user object down")
				},
			}),
		},
	}
	const reports = new Reports({ env: env as never, signals, home: () => home } as never)
	await expect(reports.sendResults()).rejects.toThrow()
	fail = false
	await new Promise((r) => setTimeout(r, 5))
	await reports.sendResults()
	expect(sent).toEqual([5_000, 5_000])
})

/** Ada asked bob. The ask timed out, so it is closed. Bob's reply to it is the answer the room has to relay. */
function closedAsk(s: ReturnType<typeof setup>) {
	const pending: Promise<unknown>[] = []
	const asks = new Asks(s.storage.sql)
	asks.open("ask1", "ada" as AgentSlug, "bob" as AgentSlug, 1)
	asks.sent("ask1", "m-ask1")
	asks.close("ask1")
	s.mail.delivered("bob" as AgentSlug, [human("human:m0")])
	const room = new RoomMail({
		...s.deps,
		ctx: { storage: s.storage, waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never,
		members: { list: () => members } as never,
		burst: { pending: () => false } as never,
		asks,
		team: { doing: () => {} } as never,
		alarms: {} as never,
		home: () => home,
		title: async () => "t",
	})
	return { room, asks, pending }
}

test("a closed ask's answer reaches its asker as mail", async () => {
	const s = setup(null)
	const { room, asks, pending } = closedAsk(s)
	s.log.addMessage({ from: { kind: "agent", slug: "bob" as AgentSlug }, text: "yes", run: { runId: "r1", attempt: 1, index: 0 } })
	room.answerAsks(home, "bob" as AgentSlug, "r1", ["agent:m-ask1:bob"])
	await Promise.all(pending)
	expect(asks.get("ask1")).toEqual({ state: "closed", answer: "yes" })
	expect(s.received.filter((r) => r.slug === "ada")).toHaveLength(1)
})

test("a closed ask whose answer the room refuses to relay keeps its answer, not consumed", async () => {
	const s = setup(null)
	const { room, asks, pending } = closedAsk(s)
	s.mail.stop()
	s.log.addMessage({ from: { kind: "agent", slug: "bob" as AgentSlug }, text: "yes", run: { runId: "r1", attempt: 1, index: 0 } })
	room.answerAsks(home, "bob" as AgentSlug, "r1", ["agent:m-ask1:bob"])
	await Promise.all(pending)
	expect(asks.get("ask1")).toEqual({ state: "closed", answer: null })
	expect(s.received.filter((r) => r.slug === "ada")).toHaveLength(0)
})

test("a closed ask gets the no-provider notice as mail", async () => {
	const s = setup(null)
	const { room, asks, pending } = closedAsk(s)
	const why = "(no answer: @bob cannot run, because the human has not connected Anthropic.)"
	room.answerHeard(home, "bob" as AgentSlug, ["agent:m-ask1:bob"], why, { id: "no_provider:bob:r1", seq: 9 })
	await Promise.all(pending)
	expect(asks.get("ask1")).toEqual({ state: "closed", answer: why })
	expect(s.received.filter((r) => r.slug === "ada").flatMap((r) => r.ids)).toEqual(["agent:no_provider:bob:r1:ada"])
})

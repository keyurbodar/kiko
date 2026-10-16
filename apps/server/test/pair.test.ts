import { expect, test } from "bun:test"
import { type AgentSlug, type Envelope, pairRoomId, type RoomId } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import { RoomMail } from "../src/room/mail-drain"
import type { MemberRow } from "../src/room/members"
import { type PairIn, RoomPair } from "../src/room/pair"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

const A = "ada" as AgentSlug
const B = "bob" as AgentSlug
const origin = "01J0000000000000000000000A" as RoomId
const pair = pairRoomId(A, B)
const member = (slug: AgentSlug) => ({ slug, name: slug }) as MemberRow

type Pushed = { room: string; slug: string; id: string; text: string }

/** Two rooms joined by a fake Worker: the origin holds ada, the pair room holds ada and bob. Each room is the real Mail, Asks, RoomMail and RoomPair over its own sql. */
function world() {
	const received: { room: string; slug: string; envelope: Envelope }[] = []
	const pushed: Pushed[] = []
	const rooms = new Map<string, { mailer: RoomMail; pairs: RoomPair }>()
	const env = {
		ROOM: {
			idFromName: (name: string) => name,
			get: (name: string) => {
				const room = rooms.get(name.slice(name.lastIndexOf(":") + 1))!
				return { pairIn: (userId: string, input: PairIn) => room.pairs.receive(userId, input), pairBack: (input: Parameters<RoomMail["pairBack"]>[0]) => room.mailer.pairBack(input) }
			},
		},
		AGENT: {
			idFromName: (name: string) => name,
			get: (name: string) => {
				const [, , room, slug] = name.split(":") as [string, string, string, string]
				return {
					receive: async (envelopes: Envelope[]) => {
						for (const envelope of envelopes) received.push({ room, slug, envelope })
						return { refused: null }
					},
					askAnswered: async (id: string, text: string) => void pushed.push({ room, slug, id, text }),
				}
			},
		},
	}
	const build = (roomId: RoomId, members: MemberRow[], chat: { pair?: true; title: string }) => {
		const sql = sqlWith(ROOM_STEPS)
		const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
		const log = new RoomLog(storage, () => 1)
		const asks = new Asks(sql)
		const mail = new Mail(storage, log, asks)
		const home = { userId: "alice", roomId }
		const pending: Promise<unknown>[] = []
		const ctx = { storage, waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never
		const shared = {
			env: env as never,
			log,
			mail,
			deliveries: new Deliveries(storage, log),
			publish: () => {},
			agentHome: (_h: unknown, slug: AgentSlug) => ({ ...home, slug }),
			delivery: (_m: unknown, _ms: unknown, _g: string, raw: Envelope[]) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
		}
		const list = { list: () => members } as never
		const mailer = new RoomMail({
			...shared,
			ctx,
			members: list,
			burst: { pending: () => false } as never,
			asks,
			team: { doing: () => {} } as never,
			alarms: { setWakeup: async () => {} } as never,
			home: () => home,
			title: async () => chat.title,
			pair: async (_from, to) => (to === B ? { ok: true, roomId: pair } : { ok: false, error: `no agent @${to}` }),
		})
		const pairs = new RoomPair({
			...shared,
			ctx,
			members: list,
			asks,
			adopt: () => home,
			chat: async () => ({ roomId, title: chat.title, ...chat }) as never,
			seedMembers: async () => {},
		})
		rooms.set(roomId, { mailer, pairs })
		const settle = async () => {
			while (pending.length) await pending.splice(0).reduce((a, p) => a.then(() => p), Promise.resolve())
		}
		return { log, asks, mail, mailer, home, settle, members, text: () => log.snapshot().messages.map((m) => ({ from: m.from.kind === "agent" ? m.from.slug : m.from.kind, text: m.text, to: m.to })) }
	}
	const r = build(origin, [member(A)], { title: "origin" })
	const p = build(pair, [member(A), member(B)], { pair: true, title: "@ada and @bob" })
	const inRoom = (room: string, slug: AgentSlug) => received.filter((x) => x.room === room && x.slug === slug).map((x) => x.envelope)
	return { r, p, inRoom, pushed }
}

test("a send to an agent that is not a member reaches it in the pair room and logs in the origin", async () => {
	const { r, p, inRoom } = world()
	expect(await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)).toEqual({ ok: true, to: [B] })
	await r.settle()
	expect(r.text()).toEqual([{ from: "ada", text: "@bob hi bob", to: "bob" }])
	expect(p.text()).toEqual([{ from: "ada", text: "@bob hi bob", to: "bob" }])
	const [envelope] = inRoom(pair, B)
	expect(envelope).toMatchObject({ roomId: pair, from: { kind: "agent", slug: "ada" }, body: "hi bob", hop: 1 })
	expect(inRoom(origin, B)).toEqual([])
	expect(r.asks.remote("s1:bob")).toMatchObject({ asker: "ada", state: "closed", answer: null })
})

test("a private send replayed is stored and delivered once", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	expect(p.text()).toHaveLength(1)
	expect(inRoom(pair, B)).toHaveLength(1)
})

test("bob's reply bubbles go back to ada as an agent envelope, logged in the origin though bob is not a member", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	const [sent] = inRoom(pair, B)
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(p.home, B, "r1", [sent!.id])
	await p.settle()
	await r.settle()
	expect(r.text().map((m) => `${m.from} to ${m.to}: ${m.text}`)).toEqual(["ada to bob: @bob hi bob", "bob to ada: @ada done"])
	const [back] = inRoom(origin, A)
	expect(back).toMatchObject({ roomId: origin, from: { kind: "agent", slug: "bob" }, body: "done", hop: 2, rootId: sent!.rootId })
	expect(r.asks.get("s1:bob")).toEqual({ state: "closed", answer: "done" })
	expect(inRoom(pair, A)).toEqual([])
})

test("bob's send_message to ada in the pair room is the answer: it goes back to the origin, not to ada there", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	expect(await p.mailer.send(B, { id: "b1", to: A, text: "here you go" }, null)).toEqual({ ok: true, to: [A] })
	await p.settle()
	await r.settle()
	expect(inRoom(pair, A)).toEqual([])
	expect(inRoom(origin, A).map((e) => e.body)).toEqual(["here you go"])
	expect(r.text().at(-1)).toEqual({ from: "bob", text: "@ada here you go", to: "ada" })
	expect(p.asks.get("s1:bob")).toEqual({ state: "closed", answer: "here you go" })
})

test("a waiting ask gets the answer as its result, and no mail", async () => {
	const { r, p, inRoom, pushed } = world()
	r.asks.open("a1", A, B, 1)
	await r.mailer.send(A, { id: "a1", to: B, text: "a question" }, "a1")
	await r.settle()
	const [sent] = inRoom(pair, B)
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "the answer", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(p.home, B, "r1", [sent!.id])
	await p.settle()
	await r.settle()
	expect(pushed).toEqual([{ room: origin, slug: "ada", id: "a1", text: "the answer" }])
	expect(inRoom(origin, A)).toEqual([])
	expect(r.asks.get("a1")).toEqual({ state: "answered", answer: "the answer" })
})

test("a run with nothing to say settles the ask with an empty answer and relays nothing", async () => {
	const { r, p, inRoom, pushed } = world()
	r.asks.open("a1", A, B, 1)
	await r.mailer.send(A, { id: "a1", to: B, text: "a question" }, "a1")
	await r.settle()
	p.mailer.answerAsks(p.home, B, "r1", [inRoom(pair, B)[0]!.id])
	await p.settle()
	await r.settle()
	expect(pushed).toEqual([{ room: origin, slug: "ada", id: "a1", text: "" }])
	expect(inRoom(origin, A)).toEqual([])
	expect(r.text()).toHaveLength(1)
})

test("an answer that arrives twice is taken once", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(p.home, B, "r1", [inRoom(pair, B)[0]!.id])
	await p.settle()
	await r.mailer.pairBack({ askId: "s1:bob", from: B, text: "done", rootId: "agent:ada", hop: 2 })
	await r.settle()
	expect(inRoom(origin, A)).toHaveLength(1)
	expect(r.text().filter((m) => m.from === "bob")).toHaveLength(1)
})

test("the human's stop in the origin drops the answer", async () => {
	const { r, p, inRoom } = world()
	const human: Envelope = { id: "human:m0", roomId: origin, from: { kind: "human" }, body: "go", hop: 0, rootId: "human:m0", seq: 1 }
	r.mail.delivered(A, [human])
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" }, null)
	await r.settle()
	r.mail.stop()
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(p.home, B, "r1", [inRoom(pair, B)[0]!.id])
	await p.settle()
	await r.settle()
	expect(inRoom(origin, A)).toEqual([])
	expect(r.text().filter((m) => m.from === "bob")).toEqual([])
})

test("a send to an agent the human does not have is refused with the error", async () => {
	const { r } = world()
	expect(await r.mailer.send(A, { id: "s1", to: "zed" as AgentSlug, text: "hi" }, null)).toEqual({ ok: false, error: "no agent @zed" })
	expect(r.text()).toEqual([])
})

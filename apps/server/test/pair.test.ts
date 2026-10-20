import { ownerRoomFixture } from "./owner-room-fixture"
import { expect, test } from "bun:test"
import { type AgentSlug, type Envelope, pairRoomId, type RoomId } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { MessageChains as Mail } from "../src/room/messaging"
import { RoomMessaging as RoomMail } from "../src/room/messaging"
import type { MemberRow } from "../src/room/members"
import { type PairIn, RoomPair } from "../src/room/pair"

const A = "ada" as AgentSlug
const B = "bob" as AgentSlug
const origin = "01J0000000000000000000000A" as RoomId
const pair = pairRoomId(A, B)
const member = (slug: AgentSlug) => ({ slug, name: slug }) as MemberRow

/** Two rooms joined by a fake Worker: the origin holds ada, the pair room holds ada and bob. Each room is the real Mail, Asks, RoomMail and RoomPair over its own sql. */
function world(options: { failDelivery?: () => boolean; refuseDelivery?: (slug: string) => boolean } = {}) {
	const received: { room: string; slug: string; envelope: Envelope }[] = []
	const rooms = new Map<string, { mailer: RoomMail; pairs: RoomPair }>()

 const services={
  room:(roomId:string)=>{const room=rooms.get(roomId)!;return {pairIn:(userId:string,input:PairIn)=>room.pairs.receive(userId,input),pairBack:(input:Parameters<RoomMail["pairBack"]>[0])=>room.mailer.pairBack(input)}},
  agent:(room:string,slug:string)=>({receive:async(envelopes:Envelope[])=>{
   if(options.failDelivery?.())throw new Error("temporary delivery outage")
   if(options.refuseDelivery?.(slug))return {refused:"too_large"}
   for(const envelope of envelopes)if(!received.some(r=>r.room===room&&r.slug===slug&&r.envelope.id===envelope.id))received.push({room,slug,envelope})
   return {refused:null}
  }})
 }

	const build = (roomId: RoomId, members: MemberRow[], chat: { pair?: true; title: string }) => {
		const { sql, storage, log } = ownerRoomFixture({ roomId, now: () => 1 })
		const asks = new Asks(sql)
		let mailer:RoomMail
  const mail = new Mail(storage,log,asks,()=>false,Date.now,delivery=>{pending.push(mailer.deliver(home,delivery))})
		const home = { userId: "alice", roomId }
		const pending: Promise<unknown>[] = []
		const wakeups: string[] = []
		const ctx = { storage, waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never
		const shared = {
			services: services as never,
			log,
			mail,
			deliveries: new Deliveries(storage, log),
			publish: () => {},
			agentHome: (_h: unknown, slug: AgentSlug) => ({ ...home, slug }),
			delivery: (_m: unknown, _ms: unknown, _g: string, raw: Envelope[]) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
		}
		const list = { list: () => members } as never
		mailer = new RoomMail({
			...shared,
			ctx,
			members: list,
			burst: { pending: () => false } as never,
			asks,
			team: { doing: () => {} } as never,
			alarms: { setWakeup: async (key: string) => { wakeups.push(key) } } as never,
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
		return { log, asks, mail, mailer, home, settle, members, wakeups, text: () => log.snapshot().messages.map((m) => ({ from: m.from.kind === "agent" ? m.from.slug : m.from.kind, text: m.text, to: m.to })) }
	}
	const r = build(origin, [member(A)], { title: "origin" })
	const p = build(pair, [member(A), member(B)], { pair: true, title: "@ada and @bob" })
	const inRoom = (room: string, slug: AgentSlug) => received.filter((x) => x.room === room && x.slug === slug).map((x) => x.envelope)
	return { r, p, inRoom }
}

test("a send to an agent that is not a member reaches it in the pair room and logs in the origin", async () => {
	const { r, p, inRoom } = world()
	expect(await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })).toEqual({ ok: true, to: [B] })
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
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	expect(p.text()).toHaveLength(1)
	expect(inRoom(pair, B)).toHaveLength(1)
})

test("bob's reply bubbles go back to ada as an agent envelope, logged in the origin though bob is not a member", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	const [sent] = inRoom(pair, B)
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(B, "r1", [sent!.id])
	await p.settle()
	await r.settle()
	expect(r.text().map((m) => `${m.from} to ${m.to}: ${m.text}`)).toEqual(["ada to bob: @bob hi bob", "bob to ada: @ada done"])
	const [back] = inRoom(origin, A)
	expect(back).toMatchObject({ roomId: origin, from: { kind: "agent", slug: "bob" }, body: "done", hop: 2, rootId: sent!.rootId })
	expect(r.asks.remote("s1:bob")).toEqual({ asker: "ada", state: "closed", answer: "done" })
	expect(inRoom(pair, A)).toEqual([])
})

test("bob's send_message to ada in the pair room is the answer: it goes back to the origin, not to ada there", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	expect(await p.mailer.send(B, { id: "b1", to: A, text: "here you go" })).toEqual({ ok: true, to: [A] })
	await p.settle()
	await r.settle()
	expect(inRoom(pair, A)).toEqual([])
	expect(inRoom(origin, A).map((e) => e.body)).toEqual(["here you go"])
	expect(r.text().at(-1)).toEqual({ from: "bob", text: "@ada here you go", to: "ada" })
	expect(p.asks.remote("s1:bob")).toEqual({ asker: "ada", state: "closed", answer: "here you go" })
})

test("an answer reaches the asker as mail, not as a pushed tool result", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "a1", to: B, text: "a question" })
	await r.settle()
	const [sent] = inRoom(pair, B)
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "the answer", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(B, "r1", [sent!.id])
	await p.settle()
	await r.settle()
	expect(inRoom(origin, A).map((e) => e.body)).toEqual(["the answer"])
	expect(r.asks.get("a1:bob")).toMatchObject({ state: "closed", answer: "the answer" })
})

test("a run with nothing to say settles the ask with an empty answer and adds no message", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "a1", to: B, text: "a question" })
	await r.settle()
	p.mailer.answerAsks(B, "r1", [inRoom(pair, B)[0]!.id])
	await p.settle()
	await r.settle()
	expect(inRoom(origin, A)).toEqual([])
	expect(r.text()).toHaveLength(1)
	expect(r.asks.get("a1:bob")).toMatchObject({ state: "closed", answer: "" })
})

test("an answer that arrives twice is taken once", async () => {
	const { r, p, inRoom } = world()
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(B, "r1", [inRoom(pair, B)[0]!.id])
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
	await r.mailer.send(A, { id: "s1", to: B, text: "hi bob" })
	await r.settle()
	r.mail.stop()
	p.log.addMessage({ from: { kind: "agent", slug: B }, text: "done", run: { runId: "r1", attempt: 1, index: 0 } })
	p.mailer.answerAsks(B, "r1", [inRoom(pair, B)[0]!.id])
	await p.settle()
	await r.settle()
	expect(inRoom(origin, A)).toEqual([])
	expect(r.text().filter((m) => m.from === "bob")).toEqual([])
})

test("a send to an agent the human does not have is refused with the error", async () => {
	const { r } = world()
	expect(await r.mailer.send(A, { id: "s1", to: "zed" as AgentSlug, text: "hi" })).toEqual({ ok: false, error: "no agent @zed" })
	expect(r.text()).toEqual([])
})


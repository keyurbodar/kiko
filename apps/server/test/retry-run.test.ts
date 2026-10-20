import { ownerRoomFixture } from "./owner-room-fixture"
import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { Room } from "../src/room/room-do"
import { Deliveries } from "../src/room/deliver"
import { MessageChains as Mail } from "../src/room/messaging"
import type { MemberRow } from "../src/room/members"

const ROOM = "01J0000000000000000000000A"
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada" } as MemberRow


function setup(){
 const { sql, storage, log } = ownerRoomFixture({ roomId: ROOM, now: ()=>1 })
 const received:{slug:string;envelopes:Envelope[]}[]=[]
 const dependencies={services:{agent:(_room:string,slug:string)=>({receive:async(envelopes:Envelope[])=>{received.push({slug,envelopes});return {refused:null}}})} as never,log,mail:new Mail(storage,log,new Asks(sql)),deliveries:new Deliveries(storage,log),publish:()=>{},agentHome:(_h:unknown,slug:AgentSlug)=>({...home,slug}),delivery:(_m:unknown,_ms:unknown,_g:string,raw:Envelope[])=>({envelopes:raw,brief:"",reactionsUpTo:0})}
 // The public retry operation resolves its error message before reaching this delivery path.
 const room=new Room({ctx:{id:{name:`room:alice:${ROOM}`},storage} as never,sql,env:{} as never,services:dependencies.services,broadcast:()=>{}})
 Object.assign(room,{log,receiver:dependencies,members:{list:()=>[ada]},home:()=>home,chat:async()=>({title:"t"})})
 return {flush:{redeliver:(slug:AgentSlug,ids:readonly string[],errorId:string)=>(room as unknown as {redeliver(slug:AgentSlug,ids:readonly string[],errorId:string):Promise<void>}).redeliver(slug,ids,errorId)},log,received}
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

import type { AgentSlug, Envelope, RoomEvent, } from "@kiko/protocol"
import type { OwnerServices } from "../owner/services"
import type { Deliveries } from "./deliver"
import type { RoomLog } from "./log"
import type { MessageChains } from "./messaging"
import type { MemberRow } from "./members"
import { markReactionsBriefed } from "./reactions"
import type { AgentHome } from "./home"
import type { Home } from "./home"


type Receipt = "admitted" | "full" | "refused"

export type ReceiveDeps = {
	services: OwnerServices
	log: RoomLog
	mail: MessageChains
	deliveries: Deliveries
	publish: (events: RoomEvent[]) => void
	agentHome: (home: Home, slug: AgentSlug, member: MemberRow) => AgentHome
	delivery: (member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) => { envelopes: Envelope[]; brief: string; reactionsUpTo: number }
}

type Refusal = { home: Home; to: AgentSlug; members: readonly MemberRow[]; title: string; raw: Envelope[]; first: Envelope; why: string }

const reasonText = (why: string) => (why === "too_large" ? "it was too large" : "its inbox could not take it")

const REFUSED: Record<Envelope["from"]["kind"], ((d: ReceiveDeps, r: Refusal) => Promise<void>) | null> = {
	human: async (d, r) => {
		for (const e of r.raw) {
			const event = d.deliveries.notice(`refused:${e.id}:${r.to}`, `Your message could not reach @${r.to}: ${reasonText(r.why)}. It stays in this chat.`)
			if (event) d.publish([event])
		}
	},
	agent: async (d, r) => {
		d.mail.refused(r.first.id, r.first.rootId)
		const from = r.first.from
		const sender = from.kind === "agent" ? r.members.find((m) => m.slug === from.slug) : undefined
		if (!sender) return
		const id = `refused:${r.first.id}`
		const notice: Envelope = { id, roomId: r.home.roomId, from: { kind: "system", reason: "run_budget" }, body: `your message to @${r.to} was not delivered: ${reasonText(r.why)}. send a shorter one, or put the detail in a file.`, hop: 0, rootId: id, seq: d.log.lastSeq() }
		const n = d.delivery(sender, r.members, r.title, [notice])
		await d.services.agent(r.home.roomId, sender.slug).receive(n.envelopes, n.brief, d.agentHome(r.home, sender.slug, sender))
	},
	system: null,
}

export async function receive(d: ReceiveDeps, home: Home, member: MemberRow, members: readonly MemberRow[], title: string, raw: Envelope[]): Promise<Receipt> {
	const first = raw[0]
	if (!first) throw new Error("receive: no envelopes")
	const delivery = d.delivery(member, members, title, raw)
	const { refused } = await d.services.agent(home.roomId, member.slug).receive(delivery.envelopes, delivery.brief, d.agentHome(home, member.slug, member))
	if (refused === "full") return "full"
	if (refused) {
		console.error(`${first.from.kind} delivery to ${member.slug} refused: ${refused}`)
		await REFUSED[first.from.kind]?.(d, { home, to: member.slug, members, title, raw, first, why: refused })
		return "refused"
	}
	d.mail.delivered(member.slug, delivery.envelopes)
	markReactionsBriefed(d.log, member.slug, delivery.reactionsUpTo)
	return "admitted"
}

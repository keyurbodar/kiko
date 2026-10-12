import type { AgentSlug, Envelope, RoomEvent, } from "@yuki/protocol"
import type { Env } from "../index"
import { agentStub } from "../lib/names"
import type { Deliveries } from "./deliver"
import type { RoomLog } from "./log"
import type { Mail } from "./mail"
import type { MemberRow } from "./members"
import { markReactionsBriefed } from "./reactions"
import type { AgentHome } from "./home"
import type { Home } from "./home"


/** "full" is the same for every sender: nothing was taken, the caller tries again later. Any other refusal is final and runs the sender's row of `REFUSED`. */
export type Receipt = "admitted" | "full" | "refused"

export type ReceiveDeps = {
	env: Env
	log: RoomLog
	mail: Mail
	deliveries: Deliveries
	publish: (events: RoomEvent[]) => void
	agentHome: (home: Home, slug: AgentSlug, member: MemberRow) => AgentHome
	delivery: (member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) => { envelopes: Envelope[]; brief: string; reactionsUpTo: number }
}

type Refusal = { home: Home; to: AgentSlug; members: readonly MemberRow[]; title: string; raw: Envelope[]; first: Envelope; why: string }

const reasonText = (why: string) => (why === "too_large" ? "it was too large" : "its inbox could not take it")

/** What a final refusal costs, by who sent it. A system wake has no row: its caller refunds the budget it reserved. */
const REFUSED: Record<Envelope["from"]["kind"], ((d: ReceiveDeps, r: Refusal) => Promise<void>) | null> = {
	// A refused batch of human messages is posted back to the human, one notice per message. The messages stay in the chat, so the human is not asked to send them again.
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
		await agentStub(d.env.AGENT, r.home.userId, r.home.roomId, sender.slug).receive(n.envelopes, n.brief, d.agentHome(r.home, sender.slug, sender))
	},
	system: null,
}

/** The one way an envelope reaches an agent: receive, then mark delivered only if the agent took it. */
export async function receive(d: ReceiveDeps, home: Home, member: MemberRow, members: readonly MemberRow[], title: string, raw: Envelope[]): Promise<Receipt> {
	const first = raw[0]
	if (!first) throw new Error("receive: no envelopes")
	const delivery = d.delivery(member, members, title, raw)
	const { refused } = await agentStub(d.env.AGENT, home.userId, home.roomId, member.slug).receive(delivery.envelopes, delivery.brief, d.agentHome(home, member.slug, member))
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

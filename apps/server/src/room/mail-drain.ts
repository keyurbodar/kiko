import type { AgentSlug, Envelope, RoomEvent, RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import type { Env } from "../index"
import { agentStub } from "../lib/names"
import type { Asks } from "./asks"
import type { Burst } from "./burst"
import { route } from "./deliver"
import type { Team } from "./team"
import type { MemberRow, Members } from "./members"
import type { RoomLog } from "./log"
import { type AgentSend, type Mail, messageIdOf, type QueuedMail } from "./mail"
import { markReactionsBriefed } from "./reactions"
import { DELIVERY_RETRY_MS } from "./wake-delivery"

export type AgentHome = { userId: string; roomId: RoomId; slug: AgentSlug; role?: string; lead?: boolean; private?: boolean }

export const MAIL_WAKEUP = "mail"

export type Home = { userId: string; roomId: RoomId }

export type MailOutcome = { ok: true; to: AgentSlug[] } | { ok: false; error: string }

export type MailDeps = {
	ctx: DurableObjectState
	env: Env
	log: RoomLog
	members: Members
	mail: Mail
	burst: Burst
	asks: Asks
	team: Team
	alarms: Alarms
	home: () => Home | null
	publish: (events: RoomEvent[]) => void
	title: (home: Home) => Promise<string>
	agentHome: (home: Home, slug: AgentSlug, member: MemberRow) => AgentHome
	delivery: (member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) => { envelopes: Envelope[]; brief: string; reactionsUpTo: number }
}

export class RoomMail {
	private draining = false

	constructor(private readonly d: MailDeps) {}

	async send(slug: AgentSlug, send: AgentSend, askId: string | null): Promise<MailOutcome> {
		const home = this.d.home()
		const members = this.d.members.list()
		if (!home || !members.some((m) => m.slug === slug)) return { ok: false, error: "not sent: you are not a member of this room." }
		const out = this.d.mail.send(slug, send, members)
		if (out.ok && out.fresh) this.d.team.doing(slug, `messaging ${send.to === "all" ? "everyone" : `@${send.to}`}`, Date.now())
		this.d.publish(out.events)
		if (!out.ok) return out
		if (askId) this.d.asks.sent(askId, out.send.messageId)
		const asked = askId || send.to === "all" ? null : out.fresh ? this.d.asks.answer(slug, send.to, send.text, send.id) : this.d.asks.answeredBy(send.id)
		if (asked) {
			this.pushAnswer(home, send.to as AgentSlug, asked, out.send.text)
			return { ok: true, to: out.send.recipients }
		}
		this.d.mail.queue(slug, out.send)
		this.d.ctx.waitUntil(this.drain())
		return { ok: true, to: out.send.recipients }
	}

	answerAsks(home: Home, slug: AgentSlug, runId: string, heard: readonly string[]): void {
		const asks = this.d.asks.unanswered(slug, heard.flatMap((id) => messageIdOf(id) ?? []))
		if (!asks.length) return
		const bubbles = this.d.ctx.storage.sql
			.exec<{ id: string; seq: number; text: string }>("SELECT id, seq, text FROM messages WHERE run_id = ? AND deleted_at IS NULL ORDER BY seq", runId)
			.toArray()
		const text = bubbles.map((b) => b.text).join("\n\n").trim()
		const last = bubbles.at(-1)
		if (!last || !text) return
		let relayed = false
		for (const ask of asks) {
			if (!this.d.asks.settle(ask.id, text)) continue
			if (ask.state === "open") {
				this.pushAnswer(home, ask.asker, ask.id, text)
				continue
			}
			const send = this.d.mail.relay(`answer:${ask.id}`, slug, ask.asker, { id: last.id, seq: last.seq, text })
			if (send) {
				this.d.mail.queue(slug, send)
				relayed = true
			}
		}
		if (relayed) this.d.ctx.waitUntil(this.drain())
	}

	async drain(): Promise<void> {
		const home = this.d.home()
		if (!home || this.draining) return
		this.draining = true
		try {
			for (;;) {
				const queued = this.d.mail.pending()
				if (!queued.length) return
				const held = this.burstAddressed(home)
				const heads = new Map<AgentSlug, QueuedMail>()
				for (const mail of queued) if (!heads.has(mail.to)) heads.set(mail.to, mail)
				const ready = [...heads.values()].filter((mail) => !held.has(mail.to))
				if (!ready.length) return await this.d.alarms.setWakeup(MAIL_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
				const results = await Promise.allSettled(ready.map((mail) => this.deliver(home, mail)))
				let failed = false
				results.forEach((result, i) => {
					const mail = ready[i]
					if (!mail) throw new Error("mail drain: settled result without mail")
					if (result.status === "fulfilled") {
						this.d.mail.done(mail.n)
						return
					}
					failed = true
					console.error(`agent mail delivery failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
				})
				if (failed) return await this.d.alarms.setWakeup(MAIL_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
			}
		} finally {
			this.draining = false
		}
	}

	burstAddressed(home: Home): Set<AgentSlug> {
		if (!this.d.burst.pending()) return new Set()
		const replyAuthor = (id: string) => {
			const from = this.d.log.message(id)?.from
			return from?.kind === "agent" ? from.slug : undefined
		}
		return new Set(route(this.d.burst.envelopes(home.roomId), this.d.members.list(), replyAuthor).keys())
	}

	private pushAnswer(home: Home, asker: AgentSlug, askId: string, text: string): void {
		this.d.ctx.waitUntil(
			agentStub(this.d.env.AGENT, home.userId, home.roomId, asker)
				.askAnswered(askId, text)
				.catch((e: unknown) => console.error(`ask answer push failed: ${e instanceof Error ? e.message : String(e)}`)),
		)
	}

	private async deliver(home: Home, mail: QueuedMail): Promise<void> {
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === mail.to)
		if (!member || this.d.mail.stopped(mail.send.rootId)) return
		const d = this.d.delivery(member, members, await this.d.title(home), [this.d.mail.envelope(home.roomId, mail.from, mail.send, mail.to)])
		const { refused } = await agentStub(this.d.env.AGENT, home.userId, home.roomId, mail.to).receive(d.envelopes, d.brief, this.d.agentHome(home, mail.to, member))
		if (refused === "full") throw new Error(`${mail.to}'s inbox is full`)
		if (refused) return this.refused(home, mail, refused)
		this.d.mail.delivered(mail.to, d.envelopes)
		markReactionsBriefed(this.d.log, mail.to, d.reactionsUpTo)
	}

	private async refused(home: Home, mail: QueuedMail, why: string): Promise<void> {
		console.error(`agent message to ${mail.to} refused: ${why}`)
		const envelopeId = this.d.mail.envelope(home.roomId, mail.from, mail.send, mail.to).id
		this.d.mail.refused(envelopeId, mail.send.rootId)
		const members = this.d.members.list()
		const sender = members.find((m) => m.slug === mail.from)
		if (!sender) return
		const id = `refused:${envelopeId}`
		const reason = why === "too_large" ? "it was too large" : "its inbox could not take it"
		const notice: Envelope = { id, roomId: home.roomId, from: { kind: "system", reason: "run_budget" }, body: `your message to @${mail.to} was not delivered: ${reason}. send a shorter one, or put the detail in a file.`, hop: 0, rootId: id, seq: this.d.log.lastSeq() }
		const d = this.d.delivery(sender, members, await this.d.title(home), [notice])
		await agentStub(this.d.env.AGENT, home.userId, home.roomId, mail.from).receive(d.envelopes, d.brief, this.d.agentHome(home, mail.from, sender))
	}
}

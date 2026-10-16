import type { AgentSlug } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import { agentStub } from "../lib/names"
import type { Asks } from "./asks"
import type { Burst } from "./burst"
import { route } from "./deliver"
import type { Home } from "./home"
import type { Team } from "./team"
import type { Members } from "./members"
import { type AgentSend, messageIdOf, type QueuedMail } from "./mail"
import { receive, type ReceiveDeps } from "./receive"
import { DELIVERY_RETRY_MS } from "./wake-delivery"

export const MAIL_WAKEUP = "mail"

export type MailOutcome = { ok: true; to: AgentSlug[] } | { ok: false; error: string }

export type MailDeps = ReceiveDeps & {
	ctx: DurableObjectState
	members: Members
	burst: Burst
	asks: Asks
	team: Team
	alarms: Alarms
	home: () => Home | null
	title: (home: Home) => Promise<string>
}

export class RoomMail {
	private draining = false

	constructor(private readonly d: MailDeps) {}

	async send(slug: AgentSlug, send: AgentSend, askId: string | null): Promise<MailOutcome> {
		const home = this.d.home()
		const members = this.d.members.list()
		if (!home || !members.some((m) => m.slug === slug)) return { ok: false, error: "not sent: you are not a member of this room." }
		const out = this.d.mail.send(slug, send, members, askId)
		if (out.ok) {
			const doing = askId && send.to !== "all" ? `waiting on @${send.to}` : `messaging ${send.to === "all" ? "everyone" : `@${send.to}`}`
			this.d.team.doing(slug, doing, Date.now(), askId && send.to !== "all" ? { kind: "waiting", on: send.to } : { kind: "tool", tool: "other", caption: doing })
		}
		this.d.publish(out.events)
		if (!out.ok) return out
		if (out.answered) this.answer(home, send.to as AgentSlug, out.answered, out.send.text)
		else this.d.ctx.waitUntil(this.drain())
		return { ok: true, to: out.send.recipients }
	}

	answerAsks(home: Home, slug: AgentSlug, runId: string, heard: readonly string[]): void {
		const bubbles = this.d.ctx.storage.sql
			.exec<{ id: string; seq: number; text: string }>("SELECT id, seq, text FROM messages WHERE run_id = ? AND deleted_at IS NULL ORDER BY seq", runId)
			.toArray()
		const text = bubbles.map((b) => b.text).join("\n\n").trim()
		const last = bubbles.at(-1)
		if (!last || !text) return this.nothingToAdd(home, slug, heard)
		this.answerHeard(home, slug, heard, text, { id: last.id, seq: last.seq })
	}

	/** A run with no reply bubbles (empty, `[skip]`, or only reactions, none of which become messages) has nothing to relay. Its asks settle with an empty answer, and a waiting `ask` returns that. */
	private nothingToAdd(home: Home, slug: AgentSlug, heard: readonly string[]): void {
		for (const ask of this.d.asks.unanswered(slug, heard.flatMap((id) => messageIdOf(id) ?? []))) {
			if (this.d.asks.settle(ask.id, "") && ask.state === "open") this.answer(home, ask.asker, ask.id, "")
		}
	}

	/** Answers the asks `slug` heard. An open ask gets the text pushed to its asker. A closed one gets it as mail, and is settled only once the mail is accepted, so a refused answer is not lost. */
	answerHeard(home: Home, slug: AgentSlug, heard: readonly string[], text: string, message: { id: string; seq: number }): void {
		let relayed = false
		for (const ask of this.d.asks.unanswered(slug, heard.flatMap((id) => messageIdOf(id) ?? []))) {
			if (ask.state === "open") {
				if (this.d.asks.settle(ask.id, text)) this.answer(home, ask.asker, ask.id, text)
				continue
			}
			if (!this.d.mail.relay(`answer:${ask.id}`, slug, ask.asker, { ...message, text })) continue
			this.d.asks.settle(ask.id, text)
			relayed = true
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

	/** A replay pushes again: the first push may have died with the caller that made it. */
	answer(home: Home, asker: AgentSlug, askId: string, text: string): void {
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
		const envelope = this.d.mail.envelope(home.roomId, mail.from, mail.send, mail.to)
		if ((await receive(this.d, home, member, members, await this.d.title(home), [envelope])) === "full") throw new Error(`${mail.to}'s inbox is full`)
	}
}

import type { AgentSlug, Envelope, RoomEvent, RoomId } from "@kiko/protocol"
import { checkSend, type Limit, limitError, limitNotice } from "./limits"
import type { Asks } from "./asks"
import { RECENT_MESSAGES } from "./message-position"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"

export type AgentSend = { id: string; to: AgentSlug | "all"; text: string }

type StoredSend = { messageId: string; seq: number; text: string; hop: number; rootId: string; recipients: AgentSlug[]; returns?: {id:string;remote:RoomId}[] }

export type SendOutcome = { ok: true; send: StoredSend; events: RoomEvent[] } | { ok: false; error: string; events: RoomEvent[] }

export type Chain = { rootId: string; hop: number }

type Remote = { room: RoomId; askId: string; back?: true }

type QueuedMail = { n: number; from: AgentSlug; to: AgentSlug; send: StoredSend; remote: Remote | null }

type Returned = { events: RoomEvent[]; asker: AgentSlug; queued: boolean }

const KEEP_SENDS_MS = 7 * 86_400_000
const PRUNE_EVERY_MS = 3_600_000

export function messageIdOf(envelopeId: string): string | null {
	if (!envelopeId.startsWith("agent:")) return null
	const end = envelopeId.lastIndexOf(":")
	return end > 6 ? envelopeId.slice(6, end) : null
}

export class MessageChains {
	private readonly chains = new Map<AgentSlug, { current: Chain; next?: Chain }>()
	private readonly stoppedRoots = new Set<string>()
	private readonly sql: SqlStorage
	private readonly admissions: Promise<void>[] = []

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
		private readonly asks: Asks,
		private readonly busy: (slug: AgentSlug) => boolean = () => false,
		private readonly now: () => number = Date.now,
		private readonly deliver: (mail: QueuedMail) => void|Promise<void> = () => {},
	) {
		this.sql = storage.sql
	}

	private storeSend(from: AgentSlug, input: AgentSend, pair: RoomId | null, text: string, recipients: AgentSlug[], rootId: string, hop: number): SendOutcome {
		const shown = `@${input.to} ${text}`
		const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown), to: input.to })
		const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop, rootId, recipients }
		this.count(rootId, recipients.length)
		const settled = pair || input.to === "all" ? false : this.asks.answer(from, input.to, text)
		const back = pair || input.to === "all" ? [] : this.asks.answerRemote(from, input.to, text)
		if (back.length) send.returns = back
		this.sql.exec("INSERT INTO agent_sends (id, send, at, room_id) VALUES (?1, ?2, ?3, ?4)", input.id, JSON.stringify(send), this.now(), this.log.roomId)
		for (const ask of back) this.giveBack(ask.id, from, input.to as AgentSlug, text, ask.remote, { rootId, hop })
		if (!back.length) this.enqueue(from, send, pair ? { room: pair, askId: `${input.id}:${input.to}` } : null)
		if (!back.length && !settled) for (const to of recipients) this.asks.expect(`${input.id}:${to}`, from, to, stored.id, this.now(), pair)
		this.prune()
		return { ok: true, send, events: stored.event ? [stored.event] : [] }
	}

	private resend(earlier: { send: string }, from: AgentSlug, input: AgentSend, pair: RoomId | null): SendOutcome {
		const send = JSON.parse(earlier.send) as StoredSend
		if (send.returns?.length) for (const ask of send.returns) this.giveBack(ask.id, from, input.to as AgentSlug, send.text, ask.remote, { rootId: send.rootId, hop: send.hop })
		else this.enqueue(from, send, pair ? { room: pair, askId: `${input.id}:${input.to}` } : null)
		return { ok: true, send, events: [] }
	}

	refused(envelopeId: string, rootId: string): void {
		this.storage.transactionSync(() => {
			if (this.sql.exec("SELECT 1 FROM mail_refused WHERE id = ?1 AND mail_refused.room_id = ?2", envelopeId, this.log.roomId).toArray().length) return
			this.sql.exec("INSERT INTO mail_refused (id, at, room_id) VALUES (?1, ?2, ?3)", envelopeId, this.now(), this.log.roomId)
			this.sql.exec("UPDATE root_counts SET deliveries = MAX(0, deliveries - 1) WHERE root_id = ?1 AND root_counts.room_id = ?2", rootId, this.log.roomId)
		})
	}

	stop(): void {
		for (const c of this.chains.values()) {
			this.stoppedRoots.add(c.current.rootId)
			if (c.next) this.stoppedRoots.add(c.next.rootId)
		}
	}
	delivered(slug: AgentSlug, envelopes: readonly Envelope[]): void {
		const last = envelopes.at(-1)
		if (!last) return
		const chain = { rootId: last.rootId, hop: last.hop }
		const current = this.chains.get(slug)
		if (current && this.busy(slug) && !envelopes.some((e) => e.from.kind === "human")) current.next = chain
		else this.chains.set(slug, { current: chain })
	}
	runEnded(slug: AgentSlug): void {
		const chain = this.chains.get(slug)
		if (chain?.next) this.chains.set(slug, { current: chain.next })
	}
	restore(slug: AgentSlug, envelopes: readonly Pick<Envelope, "rootId" | "hop">[]): void {
		const last = envelopes.at(-1)
		if (last) this.chains.set(slug, { current: { rootId: last.rootId, hop: last.hop } })
	}
	chain(slug: AgentSlug): Chain {
		return this.chains.get(slug)?.current ?? { rootId: `agent:${slug}`, hop: 0 }
	}
	chainRoot(slug: AgentSlug): string | null {
		return this.chains.get(slug)?.current.rootId ?? null
	}
	stopped(rootId: string): boolean {
		return this.stoppedRoots.has(rootId)
	}

	deliveries(rootId: string): number {
		return this.sql.exec<{ n: number }>("SELECT deliveries AS n FROM root_counts WHERE root_id = ?1 AND root_counts.room_id = ?2", rootId, this.log.roomId).toArray()[0]?.n ?? 0
	}

	send(from: AgentSlug, input: AgentSend, members: readonly { slug: AgentSlug }[], pair: RoomId | null = null): SendOutcome {
		return this.storage.transactionSync((): SendOutcome => {
			const earlier = this.sql.exec<{ send: string }>("SELECT send FROM agent_sends WHERE id = ?1 AND agent_sends.room_id = ?2", input.id, this.log.roomId).toArray()[0]
			if (earlier) {
				return this.resend(earlier, from, input, pair)
			}
			const text = input.text.trim()
			if (!text) return { ok: false, error: "not sent: the message is empty.", events: [] }
			if (input.to === from) return { ok: false, error: "not sent: you cannot message yourself.", events: [] }
			const others = members.filter((m) => m.slug !== from).map((m) => m.slug)
			if (!pair && input.to !== "all" && !others.includes(input.to)) {
				return { ok: false, error: `not sent: no agent @${input.to} in this room. members: ${others.map((s) => `@${s}`).join(", ") || "none"}.`, events: [] }
			}
			const recipients = pair ? [input.to as AgentSlug] : input.to === "all" ? others : [input.to]
			if (!recipients.length) return { ok: false, error: "not sent: you are the only agent in this room.", events: [] }
			const { rootId, hop: was } = this.chain(from)
			if (this.stopped(rootId)) return { ok: false, error: "not sent: the human pressed stop.", events: [] }
			const hop = was + 1
			const check = checkSend(hop, this.deliveries(rootId), recipients.length)
			if (!check.ok) return { ok: false, error: limitError(check.limit), events: this.trip(rootId, check.limit) }
			return this.storeSend(from, input, pair, text, recipients, rootId, hop)
		})
	}

	relay(id: string, from: AgentSlug, to: AgentSlug, message: { id: string; seq: number; text: string }): StoredSend | null {
		return this.storage.transactionSync(() => {
			const previous=this.replay(id,from);if(previous)return previous
			const { rootId, hop: was } = this.chain(from)
			const hop = was + 1
			if (this.stopped(rootId) || !checkSend(hop, this.deliveries(rootId), 1).ok) return null
			const send: StoredSend = { messageId: message.id, seq: message.seq, text: message.text, hop, rootId, recipients: [to] }
			this.count(rootId, 1)
			this.sql.exec("INSERT INTO agent_sends (id, send, at, room_id) VALUES (?1, ?2, ?3, ?4)", id, JSON.stringify(send), this.now(), this.log.roomId)
			this.enqueue(from, send)
			return send
		})
	}

	async settle(): Promise<void> {
		await Promise.all(this.admissions.splice(0))
	}

	private replay(id: string, from: AgentSlug, remote: Remote | null = null): StoredSend | null {
		const row = this.sql.exec<{ send: string }>("SELECT send FROM agent_sends WHERE id = ?1 AND agent_sends.room_id = ?2", id, this.log.roomId).toArray()[0]
		if (!row) return null
		const send = JSON.parse(row.send) as StoredSend
		this.enqueue(from, send, remote)
		return send
	}

	private enqueue(from: AgentSlug, send: StoredSend, remote: Remote | null = null): void {
		for (const to of send.recipients) this.admissions.push(Promise.resolve(this.deliver({ n: 0, from, to, send, remote })))
	}

	giveBack(askId: string, from: AgentSlug, to: AgentSlug, text: string, room: RoomId, chain?: Chain): void {
		this.storage.transactionSync(() => {
			const id = `back:${askId}`
			if (this.replay(id, from, { room, askId, back: true })) return
			const own = chain ?? { rootId: this.chain(from).rootId, hop: this.chain(from).hop + 1 }
			const send: StoredSend = { messageId: "", seq: 0, text, hop: own.hop, rootId: own.rootId, recipients: [to] }
			this.sql.exec("INSERT INTO agent_sends (id, send, at, room_id) VALUES (?1, ?2, ?3, ?4)", id, JSON.stringify(send), this.now(), this.log.roomId)
			this.enqueue(from, send, { room, askId, back: true })
		})
	}

	returned(askId: string, from: AgentSlug, text: string, chain: Chain): Returned | null {
		return this.storage.transactionSync((): Returned | null => {
			const ask = this.asks.remote(askId)
			if (!ask || this.stopped(chain.rootId)) return null
			if (ask.answer !== null) return { events: [], asker: ask.asker, queued: this.replay(`answer:${askId}`, from) !== null }
			this.asks.settle(askId, text)
			if (!text) return { events: [], asker: ask.asker, queued: false }
			const shown = `@${ask.asker} ${text}`
			const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown), to: ask.asker })
			const queued = checkSend(chain.hop, this.deliveries(chain.rootId), 1).ok
			if (queued) {
				const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop: chain.hop, rootId: chain.rootId, recipients: [ask.asker] }
				this.count(chain.rootId, 1)
				this.sql.exec("INSERT INTO agent_sends (id, send, at, room_id) VALUES (?1, ?2, ?3, ?4)", `answer:${askId}`, JSON.stringify(send), this.now(), this.log.roomId)
				this.enqueue(from, send)
			}
			return { events: stored.event ? [stored.event] : [], asker: ask.asker, queued }
		})
	}

	private count(rootId: string, deliveries: number): void {
		this.sql.exec(
			"INSERT INTO root_counts (root_id, deliveries, at, room_id) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(root_id, room_id) DO UPDATE SET deliveries = deliveries + excluded.deliveries, at = excluded.at",
			rootId,
			deliveries,
			this.now(), this.log.roomId,
		)
	}

	private prune(): void {
		const now = this.now()
		if (now - Number(this.log.meta("mail_pruned_at") ?? 0) < PRUNE_EVERY_MS) return
		for (const table of ["agent_sends", "root_counts", "mail_refused"]) this.sql.exec(`DELETE FROM ${table} WHERE at < ?1 AND ${table}.room_id = ?2`, now - KEEP_SENDS_MS, this.log.roomId)
		this.log.setMeta("mail_pruned_at", String(now))
	}

	envelope(roomId: RoomId, from: AgentSlug, send: StoredSend, to: AgentSlug): Envelope {
		return {
			id: `agent:${send.messageId}:${to}`,
			roomId,
			from: { kind: "agent", slug: from },
			body: send.text,
			hop: send.hop,
			rootId: send.rootId,
			seq: send.seq,
		}
	}

	private trip(rootId: string, limit: Limit): RoomEvent[] {
		const row = this.sql.exec<{ tripped: number }>("SELECT tripped FROM root_counts WHERE root_id = ?1 AND root_counts.room_id = ?2", rootId, this.log.roomId).toArray()[0]
		if (row?.tripped) return []
		this.sql.exec("INSERT INTO root_counts (root_id, deliveries, tripped, at, room_id) VALUES (?1, 0, 1, ?2, ?3) ON CONFLICT(root_id, room_id) DO UPDATE SET tripped = 1", rootId, this.now(), this.log.roomId)
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: limitNotice(limit) })
		return event ? [event] : []
	}
}

import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import type { Burst } from "./burst"
import { route } from "./deliver"
import { replyAddressees } from "./recipients"
import type { Home } from "./home"
import type { Team } from "./team"
import type { Members } from "./members"
import { receive, type ReceiveDeps } from "./receive"

type MailOutcome = { ok: true; to: AgentSlug[] } | { ok: false; error: string }

type MailDeps = ReceiveDeps & {
	ctx: DurableObjectState
	members: Members
	burst: Burst
	asks: Asks
	team: Team
	alarms: Alarms
	home: () => Home | null
	title: (home: Home) => Promise<string>
	pair: (from: AgentSlug, to: AgentSlug) => Promise<{ ok: true; roomId: RoomId } | { ok: false; error: string }>
}

export class RoomMessaging {
	constructor(private readonly d: MailDeps) {}

	async send(slug: AgentSlug, send: AgentSend): Promise<MailOutcome> {
		const home = this.d.home()
		const members = this.d.members.list()
		if (!home || !members.some((m) => m.slug === slug)) return { ok: false, error: "not sent: you are not a member of this room." }
		let pair: RoomId | null = null
		if (send.to !== "all" && send.to !== slug && !members.some((m) => m.slug === send.to)) {
			const made = await this.d.pair(slug, send.to).catch(() => ({ ok: false as const, error: `not sent: @${send.to} cannot be reached right now. try again.` }))
			if (!made.ok) return made
			pair = made.roomId
		}
		const out = this.d.mail.send(slug, send, members, pair)
		if (out.ok) {
			const doing = `messaging ${send.to === "all" ? "everyone" : `@${send.to}`}`
			this.d.team.doing(slug, doing, Date.now(), { kind: "tool", tool: "other", caption: doing })
		}
		this.d.publish(out.events)
		if (!out.ok) return out
		await this.d.mail.settle()
		return { ok: true, to: out.send.recipients }
	}

	async answerAsks(slug: AgentSlug, runId: string, heard: readonly string[]): Promise<void> {
		const bubbles = this.d.ctx.storage.sql
			.exec<{ id: string; seq: number; text: string }>(`SELECT id, seq, text FROM ${RECENT_MESSAGES} WHERE run_id = ? AND deleted_at IS NULL ORDER BY seq`, this.d.log.roomId, runId)
			.toArray()
		const text = bubbles
			.map((b) => b.text)
			.join("\n\n")
			.trim()
		const last = bubbles.at(-1)
		await this.relayHeard(slug, heard, text, last ? { id: last.id, seq: last.seq } : null)
	}

	async relayHeard(slug: AgentSlug, heard: readonly string[], text: string, message: { id: string; seq: number } | null): Promise<void> {
		let relayed = false
		for (const ask of this.d.asks.unanswered(
			slug,
			heard.flatMap((id) => messageIdOf(id) ?? []),
		)) {
			if (ask.remote) {
				this.d.mail.giveBack(ask.id, slug, ask.asker, text, ask.remote)
		await this.d.mail.settle()
				this.d.asks.settle(ask.id, text)
				relayed = true
				continue
			}
			if (!message) {
				this.d.asks.settle(ask.id, "")
				continue
			}
			if (!this.d.mail.relay(`answer:${ask.id}`, slug, ask.asker, { ...message, text })) continue
		await this.d.mail.settle()
			this.d.asks.settle(ask.id, text)
			relayed = true
		}
		void relayed
	}

	burstAddressed(home: Home): Set<AgentSlug> {
		if (!this.d.burst.pending()) return new Set()
		return new Set(route(this.d.burst.envelopes(home.roomId), this.d.members.list(), (id) => replyAddressees((at) => this.d.log.message(at), id)).keys())
	}

	async pairBack(input: { askId: string; from: AgentSlug; text: string } & Chain): Promise<void> {
		const home = this.d.home()
		if (!home) return
		const out = this.d.mail.returned(input.askId, input.from, input.text, input)
		if (!out) return
		this.d.publish(out.events)
		await this.d.mail.settle()
	}

	private async deliverRemote(home: Home, mail: QueuedMail, remote: NonNullable<QueuedMail["remote"]>): Promise<void> {
		const { rootId, hop, text } = mail.send
		const room = this.d.services.room(remote.room)
		if (remote.back) return await room.pairBack({ askId: remote.askId, from: mail.from, text, rootId, hop })
		if (this.d.mail.stopped(rootId)) return
		const receipt = await room.pairIn(home.userId, { askId: remote.askId, origin: home.roomId, from: mail.from, to: mail.to, text, rootId, hop })
		if (receipt === "full") throw new Error(`${mail.to}'s inbox is full`)
		if (receipt === "refused")
			await this.pairBack({
				askId: remote.askId,
				from: mail.to,
				text: `Your message to @${mail.to} could not be delivered. Check that the agent still exists and send a shorter message.`,
				rootId,
				hop,
			})
	}

	async deliver(home: Home, mail: QueuedMail): Promise<void> {
		if (mail.remote) return this.deliverRemote(home, mail, mail.remote)
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === mail.to)
		if (!member || this.d.mail.stopped(mail.send.rootId)) return
		const envelope = this.d.mail.envelope(home.roomId, mail.from, mail.send, mail.to)
		if ((await receive(this.d, home, member, members, await this.d.title(home), [envelope])) === "full") throw new Error(`${mail.to}'s inbox is full`)
	}
}

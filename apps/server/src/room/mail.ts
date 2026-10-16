import type { AgentSlug, Envelope, RoomEvent, RoomId } from "@kiko/protocol"
import { checkSend, type Limit, limitError, limitNotice } from "./limits"
import type { Asks } from "./asks"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"

export type AgentSend = { id: string; to: AgentSlug | "all"; text: string }

export type StoredSend = { messageId: string; seq: number; text: string; hop: number; rootId: string; recipients: AgentSlug[] }

/** `answered` is the ask this send answered, if any: its bubbles go to the asker, not to the inbox. */
export type SendOutcome = { ok: true; send: StoredSend; events: RoomEvent[]; answered: string | null } | { ok: false; error: string; events: RoomEvent[] }

export type Chain = { rootId: string; hop: number }

export type QueuedMail = { n: number; from: AgentSlug; to: AgentSlug; send: StoredSend }

export const KEEP_SENDS_MS = 7 * 86_400_000
const PRUNE_EVERY_MS = 3_600_000

export function messageIdOf(envelopeId: string): string | null {
	if (!envelopeId.startsWith("agent:")) return null
	const end = envelopeId.lastIndexOf(":")
	return end > 6 ? envelopeId.slice(6, end) : null
}

export class Mail {
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
		private readonly asks: Asks,
		private readonly busy: (slug: AgentSlug) => boolean = () => false,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
	}

	pending(): QueuedMail[] {
		return this.sql
			.exec<{ n: number; sender: string; send: string; recipient: string }>("SELECT n, sender, send, recipient FROM mail_queue ORDER BY n")
			.toArray()
			.map((r) => ({ n: r.n, from: r.sender as AgentSlug, to: r.recipient as AgentSlug, send: JSON.parse(r.send) as StoredSend }))
	}

	queued(): boolean {
		return this.sql.exec("SELECT 1 FROM mail_queue LIMIT 1").toArray().length > 0
	}

	done(n: number): void {
		this.sql.exec("DELETE FROM mail_queue WHERE n = ?", n)
	}

	refused(envelopeId: string, rootId: string): void {
		this.storage.transactionSync(() => {
			if (this.sql.exec("SELECT 1 FROM mail_refused WHERE id = ?", envelopeId).toArray().length) return
			this.sql.exec("INSERT INTO mail_refused (id, at) VALUES (?, ?)", envelopeId, this.now())
			this.sql.exec("UPDATE root_counts SET deliveries = max(0, deliveries - 1) WHERE root_id = ?", rootId)
		})
	}

	stop(): void {
		const now = this.now()
		this.sql.exec("INSERT OR IGNORE INTO stopped_roots (root_id, at) SELECT root_id, ? FROM agent_chains", now)
		this.sql.exec("INSERT OR IGNORE INTO stopped_roots (root_id, at) SELECT next_root_id, ? FROM agent_chains WHERE next_root_id IS NOT NULL", now)
	}

	delivered(slug: AgentSlug, envelopes: readonly Envelope[]): void {
		const last = envelopes.at(-1)
		if (!last) return
		const human = envelopes.some((e) => e.from.kind === "human")
		if (human || !this.busy(slug)) {
			this.sql.exec(
				`INSERT INTO agent_chains (slug, root_id, hop) VALUES (?, ?, ?)
				 ON CONFLICT(slug) DO UPDATE SET root_id = excluded.root_id, hop = excluded.hop,
				   next_root_id = NULL, next_hop = NULL`,
				slug,
				last.rootId,
				last.hop,
			)
		} else {
			this.sql.exec(
				`INSERT INTO agent_chains (slug, root_id, hop, next_root_id, next_hop) VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(slug) DO UPDATE SET next_root_id = excluded.next_root_id, next_hop = excluded.next_hop`,
				slug,
				last.rootId,
				last.hop,
				last.rootId,
				last.hop,
			)
		}
	}

	runEnded(slug: AgentSlug): void {
		this.sql.exec(
			`UPDATE agent_chains SET root_id = next_root_id, hop = next_hop,
			   next_root_id = NULL, next_hop = NULL
			 WHERE slug = ? AND next_root_id IS NOT NULL`,
			slug,
		)
	}

	chain(slug: AgentSlug): Chain {
		const row = this.sql.exec<{ root_id: string; hop: number }>("SELECT root_id, hop FROM agent_chains WHERE slug = ?", slug).toArray()[0]
		if (!row) return { rootId: `agent:${slug}`, hop: 0 }
		return { rootId: row.root_id, hop: row.hop }
	}

	chainRoot(slug: AgentSlug): string | null {
		return this.sql.exec<{ root_id: string }>("SELECT root_id FROM agent_chains WHERE slug = ?", slug).toArray()[0]?.root_id ?? null
	}

	stopped(rootId: string): boolean {
		return this.sql.exec("SELECT 1 FROM stopped_roots WHERE root_id = ?", rootId).toArray().length > 0
	}

	deliveries(rootId: string): number {
		return this.sql.exec<{ n: number }>("SELECT deliveries AS n FROM root_counts WHERE root_id = ?", rootId).toArray()[0]?.n ?? 0
	}

	/** Records the send, queues it for each recipient, and links it to `askId`, all in one transaction. A replay returns the first record and queues nothing. */
	send(from: AgentSlug, input: AgentSend, members: readonly { slug: AgentSlug }[], askId: string | null): SendOutcome {
		return this.storage.transactionSync((): SendOutcome => {
			const earlier = this.sql.exec<{ send: string }>("SELECT send FROM agent_sends WHERE id = ?", input.id).toArray()[0]
			if (earlier) return { ok: true, send: JSON.parse(earlier.send) as StoredSend, events: [], answered: this.asks.answeredBy(input.id) }
			const text = input.text.trim()
			if (!text) return { ok: false, error: "not sent: the message is empty.", events: [] }
			if (input.to === from) return { ok: false, error: "not sent: you cannot message yourself.", events: [] }
			const others = members.filter((m) => m.slug !== from).map((m) => m.slug)
			if (input.to !== "all" && !others.includes(input.to)) {
				return { ok: false, error: `not sent: no agent @${input.to} in this room. members: ${others.map((s) => `@${s}`).join(", ") || "none"}.`, events: [] }
			}
			const recipients = input.to === "all" ? others : [input.to]
			if (!recipients.length) return { ok: false, error: "not sent: you are the only agent in this room.", events: [] }
			const { rootId, hop: was } = this.chain(from)
			if (this.stopped(rootId)) return { ok: false, error: "not sent: the human pressed stop.", events: [] }
			const hop = was + 1
			const check = checkSend(hop, this.deliveries(rootId), recipients.length)
			if (!check.ok) return { ok: false, error: limitError(check.limit), events: this.trip(rootId, check.limit) }
			const shown = `@${input.to} ${text}`
			const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown), to: input.to })
			const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop, rootId, recipients }
			this.count(rootId, recipients.length)
			this.sql.exec("INSERT INTO agent_sends (id, send, at) VALUES (?, ?, ?)", input.id, JSON.stringify(send), this.now())
			if (askId) this.asks.sent(askId, stored.id)
			const heard = askId || input.to === "all" ? null : this.asks.answer(from, input.to, text, input.id)
			const answered = heard?.open ?? null
			if (!answered) this.enqueue(from, send)
			if (!askId && !heard?.answered) for (const to of recipients) this.asks.expect(`${input.id}:${to}`, from, to, stored.id, this.now())
			this.prune()
			return { ok: true, send, events: stored.event ? [stored.event] : [], answered }
		})
	}

	/** An answer to an ask, relayed to its asker as mail. Recorded and queued in one transaction, like `send`. */
	relay(id: string, from: AgentSlug, to: AgentSlug, message: { id: string; seq: number; text: string }): StoredSend | null {
		return this.storage.transactionSync(() => {
			if (this.sql.exec("SELECT 1 FROM agent_sends WHERE id = ?", id).toArray().length) return null
			const { rootId, hop: was } = this.chain(from)
			const hop = was + 1
			if (this.stopped(rootId) || !checkSend(hop, this.deliveries(rootId), 1).ok) return null
			const send: StoredSend = { messageId: message.id, seq: message.seq, text: message.text, hop, rootId, recipients: [to] }
			this.count(rootId, 1)
			this.sql.exec("INSERT INTO agent_sends (id, send, at) VALUES (?, ?, ?)", id, JSON.stringify(send), this.now())
			this.enqueue(from, send)
			return send
		})
	}

	private enqueue(from: AgentSlug, send: StoredSend): void {
		for (const to of send.recipients) this.sql.exec("INSERT INTO mail_queue (sender, send, recipient) VALUES (?, ?, ?)", from, JSON.stringify(send), to)
	}

	private count(rootId: string, deliveries: number): void {
		this.sql.exec(
			"INSERT INTO root_counts (root_id, deliveries, at) VALUES (?, ?, ?) ON CONFLICT(root_id) DO UPDATE SET deliveries = deliveries + excluded.deliveries, at = excluded.at",
			rootId,
			deliveries,
			this.now(),
		)
	}

	private prune(): void {
		const now = this.now()
		if (now - Number(this.log.meta("mail_pruned_at") ?? 0) < PRUNE_EVERY_MS) return
		for (const table of ["agent_sends", "root_counts", "stopped_roots", "mail_refused"]) this.sql.exec(`DELETE FROM ${table} WHERE at < ?`, now - KEEP_SENDS_MS)
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
		const row = this.sql.exec<{ tripped: number }>("SELECT tripped FROM root_counts WHERE root_id = ?", rootId).toArray()[0]
		if (row?.tripped) return []
		this.sql.exec("INSERT INTO root_counts (root_id, deliveries, tripped, at) VALUES (?, 0, 1, ?) ON CONFLICT(root_id) DO UPDATE SET tripped = 1", rootId, this.now())
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: limitNotice(limit) })
		return event ? [event] : []
	}
}

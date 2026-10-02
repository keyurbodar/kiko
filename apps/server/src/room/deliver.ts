import type { AgentSlug, Envelope, RoomEvent, RoomId, RunRef } from "@kiko/protocol"
import { autonomousRunAllowed, checkSend, type Limit, limitError, limitNotice, utcDay } from "./limits"
import type { RoomLog } from "./log"
import { type RecipientMember, resolveRecipients, tags } from "./recipients"
import { parseRichText } from "./rich-text"

/**
 * Architecture section 7.2 over a human burst. Each envelope goes to the members `resolveRecipients`
 * picks for it, and each member gets its own envelopes in one `receive()` call. A member that is not
 * in the result is not woken. `replyAuthor` names the agent whose bubble a message replies to.
 */
/**
 * True when no envelope of the burst names a recipient, so it went to the lead by default. Then the
 * other members get the burst too, after the lead's reply, to add to it or stay quiet (section 7.2).
 */
export function untagged(envelopes: readonly Envelope[], replyAuthor: (messageId: string) => AgentSlug | undefined): boolean {
	return envelopes.some((e) => !tags(e.body).length && !(e.replyTo && replyAuthor(e.replyTo)))
}

export function route(
	envelopes: readonly Envelope[],
	members: readonly RecipientMember[],
	replyAuthor: (messageId: string) => AgentSlug | undefined,
): Map<AgentSlug, Envelope[]> {
	const out = new Map<AgentSlug, Envelope[]>()
	for (const e of envelopes) {
		const replyToAgent = e.replyTo ? replyAuthor(e.replyTo) : undefined
		for (const slug of resolveRecipients({ text: e.body, ...(replyToAgent ? { replyToAgent } : {}) }, members)) {
			out.set(slug, [...(out.get(slug) ?? []), e])
		}
	}
	return out
}

// Architecture section 14. Deliveries from outside the room (reminders today) arrive
// at least once. Each has a stable id, and `deliveries` remembers every id the room
// has stored, so a repeat stores and sends nothing.

export type ReminderDelivery = {
	text: string
	/** `human`, or the agent slug the reminder is for. */
	target: string
}

export class Deliveries {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		storage.sql.exec("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	seen(id: string): boolean {
		return this.storage.sql.exec("SELECT 1 FROM deliveries WHERE id = ?", id).toArray().length > 0
	}

	/**
	 * Stores a reminder as a message from `system:reminder`. Returns the event to
	 * publish, or null when the id was delivered before.
	 *
	 * ASSUMPTION: an agent-target reminder is also a room message for now, addressed
	 * to the agent by name. The envelope to the agent's inbox comes with the delivery task.
	 */
	reminder(id: string, reminder: ReminderDelivery): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const text = reminder.target === "human" ? `reminder: ${reminder.text}` : `reminder for @${reminder.target}: ${reminder.text}`
			const { event } = this.log.addMessage({ from: { kind: "system", reason: "reminder" }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}
}

// Architecture section 6.3. An agent posts each closed block of its answer with the key
// `(runId, attempt, index)`. A repeated post stores nothing. A post with a higher attempt
// first deletes the bubbles of the earlier attempts of that run, because a run that
// restarted after a crash may write different text. A post from an older attempt is late
// and stores nothing.

/** The `UserDO.touchChat` argument after a run. */
export type Touch = { lastSeq: number; lastPreview: string; unread: number }

export class Bubbles {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		this.sql = storage.sql
		this.sql.exec("CREATE TABLE IF NOT EXISTS ended_runs (run_id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	/** Stores one bubble. Returns the events to publish: none for a repeat or a late attempt. */
	post(slug: AgentSlug, run: RunRef, block: string): RoomEvent[] {
		const latest = this.sql
			.exec<{ attempt: number | null }>("SELECT max(run_attempt) AS attempt FROM messages WHERE run_id = ?", run.runId)
			.one().attempt
		if (latest !== null && run.attempt < latest) return []
		const from = { kind: "agent", slug } as const
		const events: RoomEvent[] = []
		const earlier = this.log.earlierAttempts(run.runId, run.attempt)
		const deleted = earlier.length ? this.log.deleteMessages(earlier, from) : null
		if (deleted) events.push(deleted)
		const { event } = this.log.addMessage({ from, text: block, rich: parseRichText(block), run })
		if (event) events.push(event)
		return events
	}

	/** True once `markEnded` ran for the run. */
	ended(runId: string): boolean {
		return this.sql.exec("SELECT 1 FROM ended_runs WHERE run_id = ?", runId).toArray().length > 0
	}

	markEnded(runId: string): void {
		this.sql.exec("INSERT OR IGNORE INTO ended_runs (run_id, at) VALUES (?, ?)", runId, Date.now())
	}

	/** The chat list row after a run: the newest live message and the count of unread messages not from the human. */
	touch(): Touch {
		const last = this.sql
			.exec<{ text: string }>("SELECT text FROM messages WHERE deleted_at IS NULL ORDER BY seq DESC LIMIT 1")
			.toArray()[0]
		const { unread } = this.sql
			.exec<{ unread: number }>(
				"SELECT count(*) AS unread FROM messages WHERE deleted_at IS NULL AND seq > ? AND json_extract(sender, '$.kind') != 'human'",
				this.log.readSeq(),
			)
			.one()
		return { lastSeq: this.log.lastSeq(), lastPreview: last?.text ?? "", unread }
	}
}

// Architecture sections 7.5 and 7.7. Agent-to-agent messages. Every one goes through the room,
// which stores it in the log with its addressee, then delivers it with `hop + 1` and the sender's
// `rootId`. The room remembers each member's chain (the root and hop of its latest delivery), so
// a message sent during a run inherits that run's root, and the agent cannot set either number.
// A plain reply bubble (`Bubbles.post`) goes through none of this, so it wakes nobody.

/** One `send_message` or `broadcast` call. `id` is stable per tool call, so a repeat stores nothing. */
export type AgentSend = { id: string; to: AgentSlug | "all"; text: string; tainted: boolean }

/** A stored agent message and who it goes to. */
export type StoredSend = { messageId: string; seq: number; text: string; hop: number; rootId: string; tainted: boolean; recipients: AgentSlug[] }

export type SendOutcome = { ok: true; send: StoredSend; events: RoomEvent[] } | { ok: false; error: string; events: RoomEvent[] }

export class Mail {
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		this.sql = storage.sql
		this.sql.exec("CREATE TABLE IF NOT EXISTS agent_chains (slug TEXT PRIMARY KEY, root_id TEXT NOT NULL, hop INTEGER NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS root_counts (root_id TEXT PRIMARY KEY, deliveries INTEGER NOT NULL, tripped INTEGER NOT NULL DEFAULT 0)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS agent_sends (id TEXT PRIMARY KEY, send TEXT NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS autonomous_runs (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT NOT NULL, runs INTEGER NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS stopped_roots (root_id TEXT PRIMARY KEY)")
	}

	/**
	 * The human pressed stop (section 7.8). Every chain a member is on now is closed, so a send that a
	 * stopping run makes after its inbox was cleared delivers nothing. A human message starts a new root.
	 */
	stop(): void {
		this.sql.exec("INSERT OR IGNORE INTO stopped_roots (root_id) SELECT root_id FROM agent_chains")
	}

	/**
	 * Records what `slug` was handed, so its next send inherits the chain. The last envelope wins: a
	 * human message during an agent chain starts a new chain at hop 0. A human message also releases
	 * autonomous runs held for the day (section 7.7).
	 */
	delivered(slug: AgentSlug, envelopes: readonly Envelope[]): void {
		const last = envelopes.at(-1)
		if (!last) return
		this.sql.exec(
			"INSERT INTO agent_chains (slug, root_id, hop) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET root_id = excluded.root_id, hop = excluded.hop",
			slug,
			last.rootId,
			last.hop,
		)
		if (envelopes.some((e) => e.from.kind === "human")) this.sql.exec("DELETE FROM autonomous_runs")
	}

	/** True once the human pressed stop on `rootId`. */
	stopped(rootId: string): boolean {
		return this.sql.exec("SELECT 1 FROM stopped_roots WHERE root_id = ?", rootId).toArray().length > 0
	}

	/** The agent deliveries `rootId` has caused so far. */
	deliveries(rootId: string): number {
		return this.sql.exec<{ n: number }>("SELECT deliveries AS n FROM root_counts WHERE root_id = ?", rootId).toArray()[0]?.n ?? 0
	}

	/** Checks the limits, then stores the message and counts its deliveries. Returns the stored send for a repeated id. */
	send(from: AgentSlug, input: AgentSend, members: readonly { slug: AgentSlug }[]): SendOutcome {
		return this.storage.transactionSync((): SendOutcome => {
			const earlier = this.sql.exec<{ send: string }>("SELECT send FROM agent_sends WHERE id = ?", input.id).toArray()[0]
			if (earlier) return { ok: true, send: JSON.parse(earlier.send) as StoredSend, events: [] }
			const text = input.text.trim()
			if (!text) return { ok: false, error: "not sent: the message is empty.", events: [] }
			if (input.to === from) return { ok: false, error: "not sent: you cannot message yourself.", events: [] }
			const others = members.filter((m) => m.slug !== from).map((m) => m.slug)
			if (input.to !== "all" && !others.includes(input.to)) {
				return { ok: false, error: `not sent: no agent @${input.to} in this room. members: ${others.map((s) => `@${s}`).join(", ") || "none"}.`, events: [] }
			}
			const recipients = input.to === "all" ? others : [input.to]
			if (!recipients.length) return { ok: false, error: "not sent: you are the only agent in this room.", events: [] }
			const chain = this.sql.exec<{ root_id: string; hop: number }>("SELECT root_id, hop FROM agent_chains WHERE slug = ?", from).toArray()[0]
			const rootId = chain?.root_id ?? `agent:${from}`
			if (this.stopped(rootId)) return { ok: false, error: "not sent: the human pressed stop.", events: [] }
			const hop = (chain?.hop ?? 0) + 1
			const check = checkSend(hop, this.deliveries(rootId), recipients.length)
			if (!check.ok) return { ok: false, error: limitError(check.limit), events: this.trip(rootId, check.limit) }
			// The addressee is part of the stored text, as a Telegram mention. ASSUMPTION: no wire field for it.
			const shown = `@${input.to} ${text}`
			const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown) })
			const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop, rootId, tainted: input.tainted, recipients }
			this.sql.exec(
				"INSERT INTO root_counts (root_id, deliveries) VALUES (?, ?) ON CONFLICT(root_id) DO UPDATE SET deliveries = deliveries + excluded.deliveries",
				rootId,
				recipients.length,
			)
			this.sql.exec("INSERT INTO agent_sends (id, send) VALUES (?, ?)", input.id, JSON.stringify(send))
			return { ok: true, send, events: stored.event ? [stored.event] : [] }
		})
	}

	/** The envelope `send` becomes for one recipient. Its id is stable, so the inbox ignores a repeated delivery. */
	envelope(roomId: RoomId, from: AgentSlug, send: StoredSend, to: AgentSlug): Envelope {
		return {
			id: `agent:${send.messageId}:${to}`,
			roomId,
			from: { kind: "agent", slug: from },
			body: send.text,
			hop: send.hop,
			rootId: send.rootId,
			tainted: send.tainted,
			seq: send.seq,
		}
	}

	/** One system event per root, when a limit first trips. */
	private trip(rootId: string, limit: Limit): RoomEvent[] {
		const row = this.sql.exec<{ tripped: number }>("SELECT tripped FROM root_counts WHERE root_id = ?", rootId).toArray()[0]
		if (row?.tripped) return []
		this.sql.exec("INSERT INTO root_counts (root_id, deliveries, tripped) VALUES (?, 0, 1) ON CONFLICT(root_id) DO UPDATE SET tripped = 1", rootId)
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: limitNotice(limit) })
		return event ? [event] : []
	}

	/**
	 * Takes one of the day's autonomous runs (a scheduled or task-triggered wake, section 7.7). False
	 * means the wake is held until the next UTC day or the next human message.
	 */
	takeAutonomousRun(now: number): boolean {
		return this.storage.transactionSync(() => {
			const day = utcDay(now)
			const counter = this.sql.exec<{ day: string; runs: number }>("SELECT day, runs FROM autonomous_runs WHERE id = 1").toArray()[0] ?? null
			if (!autonomousRunAllowed(counter, day)) return false
			const runs = counter?.day === day ? counter.runs + 1 : 1
			this.sql.exec("INSERT INTO autonomous_runs (id, day, runs) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, runs = excluded.runs", day, runs)
			return true
		})
	}
}

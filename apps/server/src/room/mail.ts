import type { AgentSlug, Envelope, FileRef, RoomEvent, RoomId } from "@kiko/protocol"
import { attachedLine } from "./deliver"
import { autonomousRunAllowed, checkSend, type Limit, limitError, limitNotice, utcDay } from "./limits"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"
import { AUTO, type Authority, authorityOfAll, stamp } from "../lib/origin"

// Architecture sections 7.5 and 7.7. Agent-to-agent messages. Every one goes through the room,
// which stores it in the log with its addressee, then delivers it with `hop + 1` and the sender's
// `rootId`. The room remembers each member's chain (the root and hop of its latest delivery), so
// a message sent during a run inherits that run's root, and the agent cannot set either number.
// A plain reply bubble (`Bubbles.post`) goes through none of this, so it wakes nobody.

/** One `send_message` call, to one agent or to all. `id` is stable per tool call, so a repeat stores nothing. */
/** `files` are room paths, files or folders, handed over with the message. */
export type AgentSend = { id: string; to: AgentSlug | "all"; text: string; tainted: boolean; files?: readonly string[] }

/** A stored agent message and who it goes to. */
export type StoredSend = { messageId: string; seq: number; text: string; hop: number; rootId: string; tainted: boolean; recipients: AgentSlug[]; files?: readonly FileRef[]; authority?: Authority }

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
		this.sql.exec("CREATE TABLE IF NOT EXISTS auto_taken (id TEXT PRIMARY KEY, day TEXT NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS mail_queue (n INTEGER PRIMARY KEY, sender TEXT NOT NULL, send TEXT NOT NULL)")
		// Section 25.3: a chain carries its authority, so a message sent during a run inherits it.
		if (!this.sql.exec<{ name: string }>("PRAGMA table_info(agent_chains)").toArray().some((c) => c.name === "authority")) {
			this.sql.exec("ALTER TABLE agent_chains ADD COLUMN authority TEXT")
		}
	}

	/** Puts a stored send behind the mail still waiting. The room drains it in order (section 7.5). */
	queue(from: AgentSlug, send: StoredSend): void {
		this.sql.exec("INSERT INTO mail_queue (sender, send) VALUES (?, ?)", from, JSON.stringify(send))
	}

	/** The oldest mail still to deliver, or null. */
	next(): { n: number; from: AgentSlug; send: StoredSend } | null {
		const row = this.sql.exec<{ n: number; sender: string; send: string }>("SELECT n, sender, send FROM mail_queue ORDER BY n LIMIT 1").toArray()[0]
		return row ? { n: row.n, from: row.sender as AgentSlug, send: JSON.parse(row.send) as StoredSend } : null
	}

	/** Mail `n` reached every recipient it could. */
	done(n: number): void {
		this.sql.exec("DELETE FROM mail_queue WHERE n = ?", n)
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
			"INSERT INTO agent_chains (slug, root_id, hop, authority) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET root_id = excluded.root_id, hop = excluded.hop, authority = excluded.authority",
			slug,
			last.rootId,
			last.hop,
			JSON.stringify(authorityOfAll(envelopes)),
		)
		if (envelopes.some((e) => e.from.kind === "human")) this.sql.exec("DELETE FROM autonomous_runs")
	}

	/** The root of the chain `slug` is on now, or null. */
	chainRoot(slug: AgentSlug): string | null {
		return this.sql.exec<{ root_id: string }>("SELECT root_id FROM agent_chains WHERE slug = ?", slug).toArray()[0]?.root_id ?? null
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
	send(from: AgentSlug, input: AgentSend, members: readonly { slug: AgentSlug }[], files: readonly FileRef[] = []): SendOutcome {
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
			const chain = this.sql.exec<{ root_id: string; hop: number; authority: string | null }>("SELECT root_id, hop, authority FROM agent_chains WHERE slug = ?", from).toArray()[0]
			// A send with no recorded chain (the agent was never handed anything) has no human behind it.
			const authority: Authority = chain?.authority ? (JSON.parse(chain.authority) as Authority) : AUTO
			const rootId = chain?.root_id ?? `agent:${from}`
			if (this.stopped(rootId)) return { ok: false, error: "not sent: the human pressed stop.", events: [] }
			const hop = (chain?.hop ?? 0) + 1
			const check = checkSend(hop, this.deliveries(rootId), recipients.length)
			if (!check.ok) return { ok: false, error: limitError(check.limit), events: this.trip(rootId, check.limit) }
			// The addressee is part of the stored text, as a Telegram mention. ASSUMPTION: no wire field for it.
			const shown = `@${input.to} ${text}`
			const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown), tainted: input.tainted, ...(files.length ? { files } : {}) })
			const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop, rootId, tainted: input.tainted, recipients, authority, ...(files.length ? { files } : {}) }
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
			body: send.files?.length ? `${send.text}\n${attachedLine(send.files)}` : send.text,
			hop: send.hop,
			rootId: send.rootId,
			tainted: send.tainted,
			seq: send.seq,
			...stamp(send.authority ?? AUTO),
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
	 * Takes one of the room's runs for the day for envelope `id`, in one transaction. "paid": `id` took
	 * its run before (a retried delivery). "full": none left. `refund` gives a run back when the user's
	 * own budget refused it after the room's was taken.
	 */
	reserve(now: number, id: string): "ok" | "paid" | "full" {
		return this.storage.transactionSync(() => {
			const day = utcDay(now)
			if (this.sql.exec("SELECT 1 FROM auto_taken WHERE id = ?", id).toArray().length) return "paid"
			const counter = this.sql.exec<{ day: string; runs: number }>("SELECT day, runs FROM autonomous_runs WHERE id = 1").toArray()[0] ?? null
			if (!autonomousRunAllowed(counter, day)) return "full"
			const runs = counter?.day === day ? counter.runs + 1 : 1
			this.sql.exec("INSERT INTO autonomous_runs (id, day, runs) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, runs = excluded.runs", day, runs)
			this.sql.exec("DELETE FROM auto_taken WHERE day != ?", day)
			this.sql.exec("INSERT INTO auto_taken (id, day) VALUES (?, ?)", id, day)
			return "ok"
		})
	}

	refund(id: string): void {
		this.storage.transactionSync(() => {
			if (!this.sql.exec("DELETE FROM auto_taken WHERE id = ?", id).rowsWritten) return
			this.sql.exec("UPDATE autonomous_runs SET runs = max(0, runs - 1) WHERE id = 1")
		})
	}
}

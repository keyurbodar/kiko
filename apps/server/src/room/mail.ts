import type { AgentSlug, Envelope, RoomEvent, RoomId } from "@yuki/protocol"
import { autonomousRunAllowed, checkSend, type Limit, limitError, limitNotice, utcDay } from "./limits"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"
import { AUTO, type Authority, authorityOfAll, combine, stamp } from "@yuki/agent/authority"

export type AgentSend = { id: string; to: AgentSlug | "all"; text: string; tainted: boolean }

export type StoredSend = { messageId: string; seq: number; text: string; hop: number; rootId: string; tainted: boolean; recipients: AgentSlug[]; authority?: Authority }

export type SendOutcome = { ok: true; send: StoredSend; events: RoomEvent[]; fresh: boolean } | { ok: false; error: string; events: RoomEvent[] }

export type Chain = { rootId: string; hop: number; authority: Authority }

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
		private readonly busy: (slug: AgentSlug) => boolean = () => false,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
		this.sql.exec("CREATE TABLE IF NOT EXISTS agent_chains (slug TEXT PRIMARY KEY, root_id TEXT NOT NULL, hop INTEGER NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS root_counts (root_id TEXT PRIMARY KEY, deliveries INTEGER NOT NULL, tripped INTEGER NOT NULL DEFAULT 0)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS agent_sends (id TEXT PRIMARY KEY, send TEXT NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS autonomous_runs (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT NOT NULL, runs INTEGER NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS stopped_roots (root_id TEXT PRIMARY KEY)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS auto_taken (id TEXT PRIMARY KEY, day TEXT NOT NULL)")
		this.sql.exec("CREATE TABLE IF NOT EXISTS mail_queue (n INTEGER PRIMARY KEY, sender TEXT NOT NULL, send TEXT NOT NULL)")
		const chainColumns = new Set(this.sql.exec<{ name: string }>("PRAGMA table_info(agent_chains)").toArray().map((c) => c.name))
		if (!chainColumns.has("authority")) this.sql.exec("ALTER TABLE agent_chains ADD COLUMN authority TEXT")
		if (!chainColumns.has("next_root_id")) {
			this.sql.exec("ALTER TABLE agent_chains ADD COLUMN next_root_id TEXT")
			this.sql.exec("ALTER TABLE agent_chains ADD COLUMN next_hop INTEGER")
			this.sql.exec("ALTER TABLE agent_chains ADD COLUMN next_authority TEXT")
		}
		for (const table of ["root_counts", "agent_sends", "stopped_roots"]) {
			if (!this.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().some((c) => c.name === "at")) {
				this.sql.exec(`ALTER TABLE ${table} ADD COLUMN at INTEGER`)
				this.sql.exec(`UPDATE ${table} SET at = ?`, this.now())
			}
		}
		if (!this.sql.exec<{ name: string }>("PRAGMA table_info(mail_queue)").toArray().some((c) => c.name === "recipient")) {
			storage.transactionSync(() => {
				this.sql.exec("ALTER TABLE mail_queue ADD COLUMN recipient TEXT")
				for (const row of this.sql.exec<{ n: number; sender: string; send: string }>("SELECT n, sender, send FROM mail_queue ORDER BY n").toArray()) {
					for (const to of (JSON.parse(row.send) as StoredSend).recipients) this.sql.exec("INSERT INTO mail_queue (sender, send, recipient) VALUES (?, ?, ?)", row.sender, row.send, to)
					this.sql.exec("DELETE FROM mail_queue WHERE n = ?", row.n)
				}
			})
		}
	}

	queue(from: AgentSlug, send: StoredSend): void {
		this.storage.transactionSync(() => {
			for (const to of send.recipients) this.sql.exec("INSERT INTO mail_queue (sender, send, recipient) VALUES (?, ?, ?)", from, JSON.stringify(send), to)
		})
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

	stop(): void {
		const now = this.now()
		this.sql.exec("INSERT OR IGNORE INTO stopped_roots (root_id, at) SELECT root_id, ? FROM agent_chains", now)
		this.sql.exec("INSERT OR IGNORE INTO stopped_roots (root_id, at) SELECT next_root_id, ? FROM agent_chains WHERE next_root_id IS NOT NULL", now)
	}

	delivered(slug: AgentSlug, envelopes: readonly Envelope[]): void {
		const last = envelopes.at(-1)
		if (!last) return
		const human = envelopes.some((e) => e.from.kind === "human")
		const authority = authorityOfAll(envelopes) ?? AUTO
		if (human || !this.busy(slug)) {
			this.sql.exec(
				`INSERT INTO agent_chains (slug, root_id, hop, authority) VALUES (?, ?, ?, ?)
				 ON CONFLICT(slug) DO UPDATE SET root_id = excluded.root_id, hop = excluded.hop, authority = excluded.authority,
				   next_root_id = NULL, next_hop = NULL, next_authority = NULL`,
				slug,
				last.rootId,
				last.hop,
				JSON.stringify(authority),
			)
		} else {
			const held = this.sql.exec<{ a: string | null }>("SELECT next_authority AS a FROM agent_chains WHERE slug = ?", slug).toArray()[0]?.a
			this.sql.exec(
				`INSERT INTO agent_chains (slug, root_id, hop, authority, next_root_id, next_hop, next_authority) VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(slug) DO UPDATE SET next_root_id = excluded.next_root_id, next_hop = excluded.next_hop, next_authority = excluded.next_authority`,
				slug,
				last.rootId,
				last.hop,
				JSON.stringify(authority),
				last.rootId,
				last.hop,
				JSON.stringify(combine(held ? (JSON.parse(held) as Authority) : null, authority)),
			)
		}
		if (human) this.sql.exec("DELETE FROM autonomous_runs")
	}

	runEnded(slug: AgentSlug): void {
		this.sql.exec(
			`UPDATE agent_chains SET root_id = next_root_id, hop = next_hop, authority = next_authority,
			   next_root_id = NULL, next_hop = NULL, next_authority = NULL
			 WHERE slug = ? AND next_root_id IS NOT NULL`,
			slug,
		)
	}

	chain(slug: AgentSlug): Chain {
		const row = this.sql.exec<{ root_id: string; hop: number; authority: string | null }>("SELECT root_id, hop, authority FROM agent_chains WHERE slug = ?", slug).toArray()[0]
		if (!row) return { rootId: `agent:${slug}`, hop: 0, authority: AUTO }
		return { rootId: row.root_id, hop: row.hop, authority: row.authority ? (JSON.parse(row.authority) as Authority) : AUTO }
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

	send(from: AgentSlug, input: AgentSend, members: readonly { slug: AgentSlug }[]): SendOutcome {
		return this.storage.transactionSync((): SendOutcome => {
			const earlier = this.sql.exec<{ send: string }>("SELECT send FROM agent_sends WHERE id = ?", input.id).toArray()[0]
			if (earlier) return { ok: true, send: JSON.parse(earlier.send) as StoredSend, events: [], fresh: false }
			const text = input.text.trim()
			if (!text) return { ok: false, error: "not sent: the message is empty.", events: [] }
			if (input.to === from) return { ok: false, error: "not sent: you cannot message yourself.", events: [] }
			const others = members.filter((m) => m.slug !== from).map((m) => m.slug)
			if (input.to !== "all" && !others.includes(input.to)) {
				return { ok: false, error: `not sent: no agent @${input.to} in this room. members: ${others.map((s) => `@${s}`).join(", ") || "none"}.`, events: [] }
			}
			const recipients = input.to === "all" ? others : [input.to]
			if (!recipients.length) return { ok: false, error: "not sent: you are the only agent in this room.", events: [] }
			const { rootId, hop: was, authority } = this.chain(from)
			if (this.stopped(rootId)) return { ok: false, error: "not sent: the human pressed stop.", events: [] }
			const hop = was + 1
			const check = checkSend(hop, this.deliveries(rootId), recipients.length)
			if (!check.ok) return { ok: false, error: limitError(check.limit), events: this.trip(rootId, check.limit) }
			const shown = `@${input.to} ${text}`
			const stored = this.log.addMessage({ from: { kind: "agent", slug: from }, text: shown, rich: parseRichText(shown), tainted: input.tainted, to: input.to })
			const send: StoredSend = { messageId: stored.id, seq: stored.seq, text, hop, rootId, tainted: input.tainted, recipients, authority }
			this.count(rootId, recipients.length)
			this.sql.exec("INSERT INTO agent_sends (id, send, at) VALUES (?, ?, ?)", input.id, JSON.stringify(send), this.now())
			this.prune()
			return { ok: true, send, events: stored.event ? [stored.event] : [], fresh: true }
		})
	}

	relay(id: string, from: AgentSlug, to: AgentSlug, message: { id: string; seq: number; text: string; tainted: boolean }): StoredSend | null {
		return this.storage.transactionSync(() => {
			if (this.sql.exec("SELECT 1 FROM agent_sends WHERE id = ?", id).toArray().length) return null
			const { rootId, hop: was, authority } = this.chain(from)
			const hop = was + 1
			if (this.stopped(rootId) || !checkSend(hop, this.deliveries(rootId), 1).ok) return null
			const send: StoredSend = { messageId: message.id, seq: message.seq, text: message.text, hop, rootId, tainted: message.tainted, recipients: [to], authority }
			this.count(rootId, 1)
			this.sql.exec("INSERT INTO agent_sends (id, send, at) VALUES (?, ?, ?)", id, JSON.stringify(send), this.now())
			return send
		})
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
		for (const table of ["agent_sends", "root_counts", "stopped_roots"]) this.sql.exec(`DELETE FROM ${table} WHERE at < ?`, now - KEEP_SENDS_MS)
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
			tainted: send.tainted,
			seq: send.seq,
			...stamp(send.authority ?? AUTO),
		}
	}

	private trip(rootId: string, limit: Limit): RoomEvent[] {
		const row = this.sql.exec<{ tripped: number }>("SELECT tripped FROM root_counts WHERE root_id = ?", rootId).toArray()[0]
		if (row?.tripped) return []
		this.sql.exec("INSERT INTO root_counts (root_id, deliveries, tripped, at) VALUES (?, 0, 1, ?) ON CONFLICT(root_id) DO UPDATE SET tripped = 1", rootId, this.now())
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: limitNotice(limit) })
		return event ? [event] : []
	}

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

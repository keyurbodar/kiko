import type { AgentSlug, Approval, ApprovalState, Envelope, RoomEvent, RoomId } from "@yuki/protocol"
import type { RoomLog } from "./log"

// Architecture sections 9.2, 12, 16.3 and 25.3. yuki asks the human only when a run nobody asked
// for wants to act outside yuki, or wants to make or widen a routine. There is one kind of card. The
// human's ok is a grant: for 30 minutes that agent may use every `external` tool without asking again.
// A declined card goes back to the agent as an `approval_result` envelope. A card nobody answers
// closes quietly after 30 minutes and wakes nobody.
//
// No method an agent can reach changes a card's state. `request` only adds a pending card or finds an
// accepted one. `decide` is called from the human's socket, and `expire` from the room's alarm.

/** How long a card waits for the human, and how long an ok lasts. */
export const APPROVAL_TTL_MS = 30 * 60_000
export const GRANT_MS = 30 * 60_000
/** The room wakeup that expires cards and retries `approval_result` deliveries. */
export const APPROVALS_WAKEUP = "approvals"
/** ASSUMPTION: the snapshot carries the newest cards only. */
const SNAPSHOT_APPROVALS = 50
const MAX_SUMMARY = 200

/** A run nobody asked for wants `tool`. An `external` card shows as a 30-minute grant. */
export type ApprovalRequest = { callKey: string; tool: string; args: Record<string, unknown>; summary?: string; external: boolean }

/** What the asking tool gets back: the accepted card's id, or the text that ends the call. */
export type ApprovalAnswer = string | { refused: string }

// `run_id`, `args_key` and `used_by` are left from the one-shot card that matched exact arguments.
// Deployed rooms still have the columns; nothing reads them. ASSUMPTION: kept, since SQLite drops a
// NOT NULL column only by copying the table.
type Row = {
	id: string
	slug: string
	call_key: string
	tool: string
	summary: string
	state: ApprovalState
	expires_at: number
	delivered: number
	grant_ms: number | null
	grant_until: number | null
}

const toApproval = (r: Row): Approval => ({ id: r.id, slug: r.slug as AgentSlug, tool: r.tool, summary: r.summary, state: r.state, expiresAt: r.expires_at, ...(r.grant_ms ? { grantMs: r.grant_ms } : {}) })

/** A plain one-line summary of a tool call's arguments. */
export function summarize(args: Record<string, unknown>): string {
	const parts = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
	const text = parts.length ? parts.join(", ") : "no arguments"
	return (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text).replace(/\s+/g, " ")
}

const pending = (id: string) => ({
	refused: `waiting for the human: yuki posted card ${id}, so this did not run. do not retry it now and do not ask the human in a message; the card asks for you. if they answer, you get an approval_result.`,
})

export function listApprovals(storage: DurableObjectStorage): Approval[] {
	ensureTable(storage.sql)
	return storage.sql
		.exec<Row>("SELECT * FROM ws_approvals ORDER BY at DESC LIMIT ?", SNAPSHOT_APPROVALS)
		.toArray()
		.reverse()
		.map(toApproval)
}

// ASSUMPTION: the table is created here, not in schema.ts, so this file does not reorder the
// room's shared migration list. Every statement is safe on every start.
function ensureTable(sql: SqlStorage): void {
	sql.exec(`
		CREATE TABLE IF NOT EXISTS ws_approvals (
			id TEXT PRIMARY KEY,
			slug TEXT NOT NULL,
			run_id TEXT NOT NULL,
			call_key TEXT NOT NULL UNIQUE,
			tool TEXT NOT NULL,
			args_key TEXT NOT NULL,
			summary TEXT NOT NULL,
			state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'expired')),
			expires_at INTEGER NOT NULL,
			used_by TEXT,
			delivered INTEGER NOT NULL DEFAULT 1,
			at INTEGER NOT NULL
		);
		DROP INDEX IF EXISTS ws_approvals_match;
	`)
	if (!sql.exec<{ name: string }>("PRAGMA table_info(ws_approvals)").toArray().some((c) => c.name === "grant_ms")) {
		sql.exec("ALTER TABLE ws_approvals ADD COLUMN grant_ms INTEGER")
		sql.exec("ALTER TABLE ws_approvals ADD COLUMN grant_until INTEGER")
	}
}

export class RoomApprovals {
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
		ensureTable(this.sql)
	}

	private row(where: string, ...args: unknown[]): Row | undefined {
		return this.sql.exec<Row>(`SELECT * FROM ws_approvals WHERE ${where} LIMIT 1`, ...args).toArray()[0]
	}

	/**
	 * Agent `slug` asks. Safe to repeat: the same call gets the same answer. Returns the stored
	 * card event when this request posted one.
	 */
	request(slug: AgentSlug, req: ApprovalRequest): { answer: ApprovalAnswer; event: RoomEvent | null } {
		return this.storage.transactionSync(() => {
			const now = this.now()
			const granted = this.row("slug = ? AND state = 'accepted' AND grant_until > ? ORDER BY grant_until DESC", slug, now)
			if (granted) return { answer: granted.id, event: null }
			const asked = this.row("call_key = ?", req.callKey)
			if (asked) return { answer: asked.state === "pending" ? pending(asked.id) : { refused: `card ${asked.id} is ${asked.state}.` }, event: null }
			// One card at a time per agent: its ok covers whatever else the agent wanted meanwhile.
			const open = this.row("slug = ? AND state = 'pending' AND expires_at > ?", slug, now)
			if (open) return { answer: pending(open.id), event: null }
			const summary = req.summary ? req.summary.replace(/\s+/g, " ").slice(0, 400) : summarize(req.args)
			return this.post(slug, req.callKey, req.tool, summary, APPROVAL_TTL_MS, req.external ? GRANT_MS : null)
		})
	}

	private post(slug: AgentSlug, callKey: string, tool: string, summary: string, ttlMs: number, grantMs: number | null): { answer: ApprovalAnswer; event: RoomEvent } {
		const id = `ap_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`
		const now = this.now()
		this.sql.exec(
			"INSERT INTO ws_approvals (id, slug, run_id, call_key, tool, args_key, summary, state, expires_at, at, grant_ms) VALUES (?, ?, '', ?, ?, '', ?, 'pending', ?, ?, ?)",
			id,
			slug,
			callKey,
			tool,
			summary,
			now + ttlMs,
			now,
			grantMs,
		)
		const event = this.log.append(`agent:${slug}`, { t: "approval", approval: toApproval(this.row("id = ?", id)!) })
		return { answer: pending(id), event }
	}

	/** The human's `approve` frame. A card that is not pending changes nothing, so a repeat is a no-op. */
	decide(id: string, action: "accept" | "decline"): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const row = this.row("id = ? AND state = 'pending'", id)
			if (!row) return null
			const now = this.now()
			const state: ApprovalState = row.expires_at <= now ? "expired" : action === "accept" ? "accepted" : "declined"
			// Every ok is a grant, counted from the human's answer.
			if (state === "accepted") this.sql.exec("UPDATE ws_approvals SET grant_until = ? WHERE id = ?", now + GRANT_MS, row.id)
			return this.settle(row, state, "human")
		})
	}

	/** The alarm. Closes every pending card past its time. */
	expire(): RoomEvent[] {
		return this.storage.transactionSync(() =>
			this.sql
				.exec<Row>("SELECT * FROM ws_approvals WHERE state = 'pending' AND expires_at <= ?", this.now())
				.toArray()
				.map((row) => this.settle(row, "expired", "system:approval_result")),
		)
	}

	/** An expired card delivers nothing: nobody is woken to hear that nobody answered. */
	private settle(row: Row, state: ApprovalState, actor: string): RoomEvent {
		this.sql.exec("UPDATE ws_approvals SET state = ?, delivered = ? WHERE id = ?", state, state === "expired" ? 1 : 0, row.id)
		return this.log.append(actor, { t: "approval", approval: toApproval({ ...row, state }) })
	}

	/** The earliest time a pending card expires, or null. */
	nextExpiry(): number | null {
		return this.sql.exec<{ at: number | null }>("SELECT MIN(expires_at) AS at FROM ws_approvals WHERE state = 'pending'").one().at
	}

	/** Decided cards whose `approval_result` the agent has not admitted yet. */
	undelivered(roomId: RoomId): { slug: AgentSlug; id: string; envelope: Envelope }[] {
		return this.sql
			.exec<Row>("SELECT * FROM ws_approvals WHERE delivered = 0 AND state IN ('accepted', 'declined') ORDER BY at")
			.toArray()
			.map((r) => ({ slug: r.slug as AgentSlug, id: r.id, envelope: resultEnvelope(roomId, r, this.log.lastSeq()) }))
	}

	markDelivered(id: string): void {
		this.sql.exec("UPDATE ws_approvals SET delivered = 1 WHERE id = ?", id)
	}
}

/**
 * The human's answer as the agent reads it. The human gave it, so its origin is `human` (audit row 8).
 * It stays tainted: the summary is the agent's own words from a run that may have read outside content.
 */
export function resultEnvelope(roomId: RoomId, r: Pick<Row, "id" | "tool" | "summary" | "state">, seq: number): Envelope {
	const minutes = GRANT_MS / 60_000
	const body =
		r.state !== "accepted"
			? `error: the human declined ${r.tool} (card ${r.id}, ${r.summary}). do not do it. tell the human in one line that you did not.`
			: `the human accepted ${r.tool} (card ${r.id}, ${r.summary}). for the next ${minutes} minutes you may act outside yuki without asking. go on with the task now and tell the human what you did.`
	const id = `approval:${r.id}`
	return { id, roomId, from: { kind: "system", reason: "approval_result" }, body, hop: 0, rootId: id, tainted: true, seq, origin: "human" }
}

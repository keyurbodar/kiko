import type { AgentSlug, Approval, ApprovalState, Envelope, RoomEvent, RoomId } from "@kiko/protocol"
import type { RoomLog } from "./log"

// Architecture sections 9.2, 12.3 and 16.3 (P7-02). A tainted run's `external` tool call needs the
// human's ok. The trust gate asks the room through `request`: the room posts a card and the call
// ends as pending. Only the human's socket decides a card (`decide`); the decision goes back to the
// agent as an `approval_result` envelope. The agent's next call of the same tool with the same
// arguments finds the accepted record and runs, once.
//
// No method an agent can reach changes a card's state. `request` only adds a pending card or uses an
// accepted one. `decide` is called from the human's socket, and `expire` from the room's alarm.

/** Executor holds a paused execution for 4 minutes (section 12.3). A card lives as long. */
export const APPROVAL_TTL_MS = 240_000
/** The room wakeup that expires cards and retries `approval_result` deliveries. */
export const APPROVALS_WAKEUP = "approvals"
/** ASSUMPTION: the snapshot carries the newest cards only. */
const SNAPSHOT_APPROVALS = 50
const MAX_SUMMARY = 200

export type ApprovalRequest = {
	/** `conversation:callId`. The same call asking again gets the same answer. */
	callKey: string
	tool: string
	args: Record<string, unknown>
}

/** What the trust gate gets back: the accepted record's id, or the text that ends the call. */
export type ApprovalAnswer = string | { refused: string }

type Row = {
	id: string
	slug: string
	run_id: string
	tool: string
	args_key: string
	summary: string
	state: ApprovalState
	expires_at: number
	used_by: string | null
	delivered: number
}

const toApproval = (r: Row): Approval => ({ id: r.id, slug: r.slug as AgentSlug, tool: r.tool, summary: r.summary, state: r.state, expiresAt: r.expires_at })

/** A plain one-line summary of a tool call's arguments. */
export function summarize(args: Record<string, unknown>): string {
	const parts = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
	const text = parts.length ? parts.join(", ") : "no arguments"
	return (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text).replace(/\s+/g, " ")
}

/** Arguments with sorted keys, so the same call matches its card. */
function argsKey(tool: string, args: Record<string, unknown>): string {
	const sort = (v: unknown): unknown =>
		Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v
	return `${tool}:${JSON.stringify(sort(args))}`
}

const pending = (id: string, tool: string) => ({
	refused: `waiting for the human: kiko posted approval card ${id} for ${tool}. this call did not run. do not retry it now; you will get an approval_result when the human answers.`,
})

export function listApprovals(storage: DurableObjectStorage): Approval[] {
	ensureTable(storage.sql)
	return storage.sql
		.exec<Row>("SELECT * FROM ws_approvals ORDER BY at DESC LIMIT ?", SNAPSHOT_APPROVALS)
		.toArray()
		.reverse()
		.map(toApproval)
}

// ASSUMPTION: the table is created here, not in schema.ts, so this task does not reorder the
// room's shared migration list. `CREATE TABLE IF NOT EXISTS` is safe on every start.
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
		CREATE INDEX IF NOT EXISTS ws_approvals_match ON ws_approvals (slug, args_key, state);
	`)
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
	 * The trust gate of agent `slug` asks about one `external` call. Safe to repeat: the same
	 * `callKey` gets the same answer. Returns the stored card event when this call posted one.
	 */
	request(slug: AgentSlug, req: ApprovalRequest): { answer: ApprovalAnswer; event: RoomEvent | null } {
		return this.storage.transactionSync(() => {
			const used = this.row("used_by = ?", req.callKey)
			if (used) return { answer: used.id, event: null }
			const asked = this.row("call_key = ?", req.callKey)
			if (asked) return { answer: asked.state === "pending" ? pending(asked.id, asked.tool) : { refused: `approval ${asked.id} is ${asked.state}.` }, event: null }
			const key = argsKey(req.tool, req.args)
			const accepted = this.row("slug = ? AND args_key = ? AND state = 'accepted' AND used_by IS NULL ORDER BY at", slug, key)
			if (accepted) {
				this.sql.exec("UPDATE ws_approvals SET used_by = ? WHERE id = ?", req.callKey, accepted.id)
				return { answer: accepted.id, event: null }
			}
			const now = this.now()
			const open = this.row("slug = ? AND args_key = ? AND state = 'pending' AND expires_at > ?", slug, key, now)
			if (open) return { answer: pending(open.id, open.tool), event: null }
			const id = `ap_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`
			const runId = req.callKey.slice(0, req.callKey.lastIndexOf(":"))
			const summary = summarize(req.args)
			this.sql.exec(
				"INSERT INTO ws_approvals (id, slug, run_id, call_key, tool, args_key, summary, state, expires_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
				id,
				slug,
				runId,
				req.callKey,
				req.tool,
				key,
				summary,
				now + APPROVAL_TTL_MS,
				now,
			)
			const event = this.log.append(`agent:${slug}`, { t: "approval", approval: toApproval(this.row("id = ?", id)!) })
			return { answer: pending(id, req.tool), event }
		})
	}

	/** The human's `approve` frame. A card that is not pending changes nothing, so a repeat is a no-op. */
	decide(id: string, action: "accept" | "decline"): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const row = this.row("id = ? AND state = 'pending'", id)
			if (!row) return null
			const state: ApprovalState = row.expires_at <= this.now() ? "expired" : action === "accept" ? "accepted" : "declined"
			return this.settle(row, state, "human")
		})
	}

	/** The alarm. Expires every pending card past its time. */
	expire(): RoomEvent[] {
		return this.storage.transactionSync(() =>
			this.sql
				.exec<Row>("SELECT * FROM ws_approvals WHERE state = 'pending' AND expires_at <= ?", this.now())
				.toArray()
				.map((row) => this.settle(row, "expired", "system:approval_result")),
		)
	}

	private settle(row: Row, state: ApprovalState, actor: string): RoomEvent {
		this.sql.exec("UPDATE ws_approvals SET state = ?, delivered = 0 WHERE id = ?", state, row.id)
		return this.log.append(actor, { t: "approval", approval: toApproval({ ...row, state }) })
	}

	/** The earliest time a pending card expires, or null. */
	nextExpiry(): number | null {
		return this.sql.exec<{ at: number | null }>("SELECT MIN(expires_at) AS at FROM ws_approvals WHERE state = 'pending'").one().at
	}

	/** Decided cards whose `approval_result` the agent has not admitted yet. */
	undelivered(roomId: RoomId): { slug: AgentSlug; id: string; envelope: Envelope }[] {
		return this.sql
			.exec<Row>("SELECT * FROM ws_approvals WHERE delivered = 0 ORDER BY at")
			.toArray()
			.map((r) => ({ slug: r.slug as AgentSlug, id: r.id, envelope: resultEnvelope(roomId, r, this.log.lastSeq()) }))
	}

	markDelivered(id: string): void {
		this.sql.exec("UPDATE ws_approvals SET delivered = 1 WHERE id = ?", id)
	}
}

/**
 * The decision as the agent reads it. Tainted, so the run it starts stays gated: an accepted card
 * lets exactly the approved call through, and nothing else outside kiko.
 */
export function resultEnvelope(roomId: RoomId, r: Pick<Row, "id" | "tool" | "summary" | "state">, seq: number): Envelope {
	const body =
		r.state === "accepted"
			? `the human accepted ${r.tool} (approval ${r.id}, ${r.summary}). call ${r.tool} again with the same arguments now.`
			: r.state === "declined"
				? `error: the human declined ${r.tool} (approval ${r.id}, ${r.summary}). do not call it again. tell the human you did not do it.`
				: `error: approval ${r.id} for ${r.tool} expired before the human answered. ask the human again if it still matters.`
	const id = `approval:${r.id}`
	return { id, roomId, from: { kind: "system", reason: "approval_result" }, body, hop: 0, rootId: id, tainted: true, seq }
}

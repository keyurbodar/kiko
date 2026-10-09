import { type AgentSlug, type AgentState, CHIEF_HANDLE, type Member, type MemberOp, type MemberRefusal, type RoomEvent } from "@kiko/protocol"
import type { RoomLog } from "./log"

/** The built-in agent. It leads every room and cannot be removed. */
const CHIEF = "kiko"

// Architecture sections 7.2, 7.4, and 7.7. The agents of one room. A room has exactly one
// lead while it has any member. A removed member keeps its row with `removed_at` set, so
// account deletion still reaches its Durable Object and adding the slug again brings it back.
// `status` is the latest state the agent reported. A room made before the cleanup also has the
// columns `current_task` and `last_delivered_seq`, which nothing reads or writes any more.

/** Architecture section 7.7. */
export const MAX_MEMBERS = 8
const MAX_NAME = 60
// ASSUMPTION: the limits on a role and a model reference, the same as the user's agent list.
const MAX_ROLE = 500
const MAX_MODEL = 200
/** `@all` addresses everyone (section 7.2), so no agent may hold the slug. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["all", CHIEF_HANDLE])

/** One row of the table, as the room uses it. */
export type MemberRow = {
	slug: AgentSlug
	name: string
	role: string
	model: string
	lead: boolean
	status: AgentState
}

export type NewMember = { slug: AgentSlug; name: string; role?: string; model?: string }

type Row = {
	slug: string
	name: string
	role: string
	model: string
	lead: number
	status: string
}

const toRow = (r: Row): MemberRow => ({
	slug: r.slug as AgentSlug,
	name: r.name,
	role: r.role,
	model: r.model,
	lead: r.lead === 1,
	status: r.status as AgentState,
})

/** The wire form. `role` and `model` are left out when empty. */
export function toMember(m: MemberRow): Member {
	return { slug: m.slug, name: m.name, lead: m.lead, ...(m.role ? { role: m.role } : {}), ...(m.model ? { model: m.model } : {}) }
}

const clip = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max)

export type MemberResult = { ok: true; events: RoomEvent[] } | { ok: false; reason: MemberRefusal }

export class Members {
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		this.sql = storage.sql
		this.sql.exec(`CREATE TABLE IF NOT EXISTS members (
			slug TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			lead INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'idle',
			added_seq INTEGER NOT NULL, -- the seq of the event that added it, for join order
			removed_at INTEGER
		)`)
	}

	/** The current members, the lead first, then in the order they joined. */
	list(): MemberRow[] {
		return this.sql
			.exec<Row>("SELECT * FROM members WHERE removed_at IS NULL ORDER BY lead DESC, added_seq, slug")
			.toArray()
			.map(toRow)
	}

	/** Every slug that was ever a member, removed ones included. Account deletion wipes each one. */
	everyone(): AgentSlug[] {
		return this.sql
			.exec<{ slug: string }>("SELECT slug FROM members ORDER BY added_seq, slug")
			.toArray()
			.map((r) => r.slug as AgentSlug)
	}

	get(slug: string): MemberRow | null {
		const row = this.sql.exec<Row>("SELECT * FROM members WHERE slug = ? AND removed_at IS NULL", slug).toArray()[0]
		return row ? toRow(row) : null
	}

	/** True once the room has had a member. Seeding happens only before that. */
	seeded(): boolean {
		return this.sql.exec("SELECT 1 FROM members LIMIT 1").toArray().length > 0
	}

	/**
	 * Fills an empty room with its first agents, the first one as lead. Does nothing when the room
	 * has had members before, so a repeat after a crash stores nothing twice. Extra agents past the
	 * limit are dropped.
	 */
	seed(agents: readonly NewMember[]): RoomEvent[] {
		return this.storage.transactionSync(() => {
			if (this.seeded()) return []
			const events: RoomEvent[] = []
			for (const agent of agents.slice(0, MAX_MEMBERS)) {
				const result = this.addInside(agent, events.length === 0)
				if (result.ok) events.push(...result.events)
			}
			return events
		})
	}

	/** Applies one human change from the socket. */
	apply(op: MemberOp): MemberResult {
		return this.storage.transactionSync(() => {
			switch (op.op) {
				case "add":
					return this.addInside(op, this.list().length === 0)
				case "remove":
					return this.removeInside(op.slug)
				case "rename":
					return this.renameInside(op.slug, op.name)
			}
		})
	}

	private addInside(input: NewMember, lead: boolean): MemberResult {
		if (RESERVED_SLUGS.has(input.slug)) return { ok: false, reason: "reserved" }
		if (this.get(input.slug)) return { ok: false, reason: "exists" }
		if (this.list().length >= MAX_MEMBERS) return { ok: false, reason: "limit" }
		const row: MemberRow = {
			slug: input.slug,
			name: clip(input.name, MAX_NAME) || input.slug,
			role: clip(input.role, MAX_ROLE),
			model: clip(input.model, MAX_MODEL),
			lead,
			status: "idle",
		}
		const event = this.log.append("human", { t: "member", member: toMember(row) })
		this.sql.exec(
			`INSERT INTO members (slug, name, role, model, lead, status, added_seq, removed_at)
			 VALUES (?, ?, ?, ?, ?, 'idle', ?, NULL)
			 ON CONFLICT(slug) DO UPDATE SET name = excluded.name, role = excluded.role, model = excluded.model, lead = excluded.lead,
			   status = 'idle', added_seq = excluded.added_seq, removed_at = NULL`,
			row.slug,
			row.name,
			row.role,
			row.model,
			lead ? 1 : 0,
			event.seq,
		)
		return { ok: true, events: [event] }
	}

	/**
	 * Removes a member. Removing the lead makes the member who joined first the new lead.
	 * The kiko agent is the chief of every room and is never removed.
	 * ASSUMPTION: the last member cannot be removed, because a room keeps exactly one lead.
	 */
	private removeInside(slug: AgentSlug): MemberResult {
		const current = this.get(slug)
		if (!current) return { ok: false, reason: "unknown" }
		if (slug === CHIEF) return { ok: false, reason: "chief" }
		const rest = this.list().filter((m) => m.slug !== slug)
		if (!rest.length) return { ok: false, reason: "last" }
		const events: RoomEvent[] = [this.log.append("human", { t: "member_removed", slug })]
		this.sql.exec("UPDATE members SET removed_at = ?, lead = 0, status = 'idle' WHERE slug = ?", events[0]!.at, slug)
		if (current.lead) {
			const next = { ...rest[0]!, lead: true }
			events.push(this.log.append("human", { t: "member", member: toMember(next) }))
			this.sql.exec("UPDATE members SET lead = 1 WHERE slug = ?", next.slug)
		}
		return { ok: true, events }
	}

	private renameInside(slug: AgentSlug, name: string): MemberResult {
		const current = this.get(slug)
		if (!current) return { ok: false, reason: "unknown" }
		const next = clip(name, MAX_NAME)
		// An empty or unchanged name stores nothing, and the client's patch already matches.
		if (!next || next === current.name) return { ok: true, events: [] }
		const event = this.log.append("human", { t: "member", member: toMember({ ...current, name: next }) })
		this.sql.exec("UPDATE members SET name = ? WHERE slug = ?", next, slug)
		return { ok: true, events: [event] }
	}

	/** Stores the latest state an agent reported. Returns false when it did not change or the agent is not a member. */
	setStatus(slug: AgentSlug, status: AgentState): boolean {
		return this.sql.exec("UPDATE members SET status = ? WHERE slug = ? AND removed_at IS NULL AND status != ?", status, slug, status)
			.rowsWritten > 0
	}

}

/** The current members on the wire, for a `reset` snapshot. Reads nothing before the table exists. */
export function listMembers(storage: DurableObjectStorage): Member[] {
	const exists = storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members'").toArray().length > 0
	if (!exists) return []
	return storage.sql
		.exec<Row>("SELECT * FROM members WHERE removed_at IS NULL ORDER BY lead DESC, added_seq, slug")
		.toArray()
		.map((r) => toMember(toRow(r)))
}

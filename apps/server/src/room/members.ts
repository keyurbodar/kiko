import type { AgentSlug, AgentState, Member, MemberOp, MemberRefusal, RoomEvent } from "@kiko/protocol"
import type { RoomLog } from "./log"

import { CHIEF } from "./chief"

export const MAX_MEMBERS = 8
const MAX_NAME = 60
/** The brief shows a role whole, so the stored role is the text a member reads. */
export const MAX_ROLE = 400
const MAX_MODEL = 200
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["all"])

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

export function toMember(m: MemberRow): Member {
	return { slug: m.slug, name: m.name, lead: m.lead, ...(m.role ? { role: m.role } : {}), model: m.model }
}

const clip = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max)

export type MemberResult = { ok: true; events: RoomEvent[] } | { ok: false; reason: MemberRefusal }

export class Members {
 private readonly statuses=new Map<AgentSlug,AgentState>()
	private readonly sql: SqlStorage

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		this.sql = storage.sql
	}

	#busy: Map<AgentSlug, { name: string; status: AgentState }> | null = null

	/** The members that are not idle, in order. Kept in memory and rebuilt from the table after a wake, so reading it costs no rows. */
	busy(): ReadonlyMap<AgentSlug, { name: string; status: AgentState }> {
		this.#busy ??= new Map(this.list().filter((m) => m.status !== "idle").map((m) => [m.slug, { name: m.name, status: m.status }]))
		return this.#busy
	}

	list(): MemberRow[] {
		return this.sql
			.exec<Row>("SELECT * FROM members WHERE removed_at IS NULL ORDER BY lead DESC, added_seq, slug")
			.toArray()
			.map(row=>{const member=toRow(row);return {...member,status:this.statuses.get(member.slug)??"idle"}})
	}

	everyone(): AgentSlug[] {
		return this.sql
			.exec<{ slug: string }>("SELECT slug FROM members ORDER BY added_seq, slug")
			.toArray()
			.map((r) => r.slug as AgentSlug)
	}

	get(slug: string): MemberRow | null {
		const row = this.sql.exec<Row>("SELECT * FROM members WHERE slug = ? AND removed_at IS NULL", slug).toArray()[0]
		if(!row)return null
  const member=toRow(row);return {...member,status:this.statuses.get(member.slug)??"idle"}
	}

	seeded(): boolean {
		return this.sql.exec("SELECT 1 FROM members LIMIT 1").toArray().length > 0
	}

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
		this.#busy = null
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

	private removeInside(slug: AgentSlug): MemberResult {
		this.#busy = null
		const current = this.get(slug)
		if (!current) return { ok: false, reason: "unknown" }
		if (slug === CHIEF) return { ok: false, reason: "chief" }
		const rest = this.list().filter((m) => m.slug !== slug)
		const [successor] = rest
		if (!successor) return { ok: false, reason: "last" }
		const removed = this.log.append("human", { t: "member_removed", slug })
		const events: RoomEvent[] = [removed]
		this.sql.exec("UPDATE members SET removed_at = ?, lead = 0, status = 'idle' WHERE slug = ?", removed.at, slug)
		if (current.lead) {
			const next = { ...successor, lead: true }
			events.push(this.log.append("human", { t: "member", member: toMember(next) }))
			this.sql.exec("UPDATE members SET lead = 1 WHERE slug = ?", next.slug)
		}
		return { ok: true, events }
	}

	private renameInside(slug: AgentSlug, name: string): MemberResult {
		this.#busy = null
		const current = this.get(slug)
		if (!current) return { ok: false, reason: "unknown" }
		const next = clip(name, MAX_NAME)
		if (!next || next === current.name) return { ok: true, events: [] }
		const event = this.log.append("human", { t: "member", member: toMember({ ...current, name: next }) })
		this.sql.exec("UPDATE members SET name = ? WHERE slug = ?", next, slug)
		return { ok: true, events: [event] }
	}

	setStatus(slug: AgentSlug, status: AgentState): boolean {
  const member=this.get(slug)
  const changed=member!==null && member.status!==status
  if(changed)this.statuses.set(slug,status)
		if (changed && this.#busy) {
			if (status === "idle") this.#busy.delete(slug)
			else this.#busy.set(slug, { name: this.#busy.get(slug)?.name ?? this.get(slug)?.name ?? slug, status })
		}
		return changed
	}

}

export function listMembers(storage: DurableObjectStorage): Member[] {
	const exists = storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members'").toArray().length > 0
	if (!exists) return []
	return storage.sql
		.exec<Row>("SELECT * FROM members WHERE removed_at IS NULL ORDER BY lead DESC, added_seq, slug")
		.toArray()
		.map((r) => toMember(toRow(r)))
}

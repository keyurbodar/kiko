import type { AgentSlug, AgentState, Member, MemberOp, MemberRefusal, RoomEvent, TaskStatus } from "@kiko/protocol"
import type { RoomLog } from "./log"

import { CHIEF } from "./chief"

export const MAX_MEMBERS = 8
const MAX_NAME = 60
export const MAX_ROLE = 400
const MAX_MODEL = 200
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["all"])

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

function toMember(m: MemberRow): Member {
  return { slug: m.slug, name: m.name, lead: m.lead, ...(m.role ? { role: m.role } : {}), model: m.model }
}

const clip = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max)

export type MemberResult = { ok: true; events: RoomEvent[] } | { ok: false; reason: MemberRefusal }

export class Members {
  private readonly statuses = new Map<AgentSlug, AgentState>()
  private readonly sql: SqlStorage

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly log: RoomLog,
  ) {
    this.sql = storage.sql
  }

  #busy: Map<AgentSlug, { name: string; status: AgentState }> | null = null

  busy(): ReadonlyMap<AgentSlug, { name: string; status: AgentState }> {
    this.#busy ??= new Map(
      this.list()
        .filter((m) => m.status !== "idle")
        .map((m) => [m.slug, { name: m.name, status: m.status }]),
    )
    return this.#busy
  }

  list(): MemberRow[] {
    return this.sql
      .exec<Row>(
        "SELECT * FROM members WHERE removed_at IS NULL AND members.room_id = ?1 ORDER BY lead DESC, added_seq, slug",
        this.log.roomId,
      )
      .toArray()
      .map((row) => {
        const member = toRow(row)
        return { ...member, status: this.statuses.get(member.slug) ?? "idle" }
      })
  }

  everyone(): AgentSlug[] {
    return this.sql
      .exec<{ slug: string }>(
        "SELECT slug FROM members WHERE removed_at IS NULL AND members.room_id = ?1 ORDER BY added_seq, slug",
        this.log.roomId,
      )
      .toArray()
      .map((r) => r.slug as AgentSlug)
  }

  allSlugs(): AgentSlug[] {
    return this.sql
      .exec<{ slug: string }>(
        "SELECT slug FROM members WHERE members.room_id = ?1 ORDER BY added_seq, slug",
        this.log.roomId,
      )
      .toArray()
      .map((r) => r.slug as AgentSlug)
  }

  get(slug: string): MemberRow | null {
    const row = this.sql
      .exec<Row>(
        "SELECT * FROM members WHERE (slug = ?1 AND removed_at IS NULL) AND members.room_id = ?2",
        slug,
        this.log.roomId,
      )
      .toArray()[0]
    if (!row) return null
    const member = toRow(row)
    return { ...member, status: this.statuses.get(member.slug) ?? "idle" }
  }

  seeded(): boolean {
    return (
      this.sql.exec("SELECT 1 FROM members WHERE members.room_id = ?1 LIMIT 1", this.log.roomId).toArray().length > 0
    )
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
      "INSERT INTO members (slug, name, role, model, lead, status, added_seq, lead_seq, removed_at, room_id) VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?6, NULL, ?7) ON CONFLICT(slug, room_id) DO UPDATE SET name = excluded.name, role = excluded.role, model = excluded.model, lead = excluded.lead, status = 'idle', added_seq = excluded.added_seq, lead_seq = excluded.lead_seq, removed_at = NULL",
      row.slug,
      row.name,
      row.role,
      row.model,
      lead ? 1 : 0,
      event.seq,
      this.log.roomId,
    )
    return { ok: true, events: [event] }
  }

  private removeInside(slug: AgentSlug): MemberResult {
    this.#busy = null
    const current = this.get(slug)
    if (!current) return { ok: false, reason: "unknown" }
    if (slug === CHIEF) return { ok: false, reason: "chief" }
    const successor = this.list().find((m) => m.slug !== slug)
    if (!successor) return { ok: false, reason: "last" }
    const removed = this.log.append("human", { t: "member_removed", slug })
    const events: RoomEvent[] = [removed]
    this.sql.exec(
      "UPDATE members SET removed_at = ?1, lead = 0, status = 'idle' WHERE slug = ?2 AND members.room_id = ?3",
      removed.at,
      slug,
      this.log.roomId,
    )
    events.push(...this.releaseInside(slug))
    if (current.lead) {
      const next = { ...successor, lead: true }
      const promoted = this.log.append("human", { t: "member", member: toMember(next) })
      events.push(promoted)
      this.sql.exec(
        "UPDATE members SET lead = 1, lead_seq = ?3 WHERE slug = ?1 AND members.room_id = ?2",
        next.slug,
        this.log.roomId,
        promoted.seq,
      )
    }
    return { ok: true, events }
  }

  private releaseInside(slug: AgentSlug): RoomEvent[] {
    const owned = this.sql
      .exec<{ id: string; title: string; status: string; note: string | null }>(
        "SELECT id, title, status, note FROM ws_tasks WHERE (owner = ?1 AND status NOT IN ('done', 'cancelled')) AND ws_tasks.room_id = ?2 ORDER BY created_seq, id",
        slug,
        this.log.roomId,
      )
      .toArray()
    this.sql.exec(
      "UPDATE ws_tasks SET owner = NULL, unblocked_seq = NULL, woken_at = NULL WHERE (owner = ?1 AND status NOT IN ('done', 'cancelled')) AND ws_tasks.room_id = ?2",
      slug,
      this.log.roomId,
    )
    const events = owned.map((row) =>
      this.log.append("human", {
        t: "task",
        task: {
          id: row.id,
          title: row.title,
          status: row.status as TaskStatus,
          dependsOn: this.sql
            .exec<{ d: string }>(
              "SELECT depends_on AS d FROM ws_task_deps WHERE task_id = ?1 AND ws_task_deps.room_id = ?2 ORDER BY rowid",
              row.id,
              this.log.roomId,
            )
            .toArray()
            .map((r) => r.d),
          ...(row.note ? { note: row.note } : {}),
        },
      }),
    )
    this.sql.exec(
      "UPDATE agent_asks SET answer = ?1, state = 'closed' WHERE ((askee = ?2 OR asker = ?2) AND answer IS NULL) AND agent_asks.room_id = ?3",
      `@${slug} left the room before answering`,
      slug,
      this.log.roomId,
    )
    this.sql.exec("DELETE FROM team_leases WHERE slug = ?1 AND team_leases.room_id = ?2", slug, this.log.roomId)
    return events
  }

  private renameInside(slug: AgentSlug, name: string): MemberResult {
    this.#busy = null
    const current = this.get(slug)
    if (!current) return { ok: false, reason: "unknown" }
    const next = clip(name, MAX_NAME)
    if (!next || next === current.name) return { ok: true, events: [] }
    const event = this.log.append("human", { t: "member", member: toMember({ ...current, name: next }) })
    this.sql.exec("UPDATE members SET name = ?1 WHERE slug = ?2 AND members.room_id = ?3", next, slug, this.log.roomId)
    return { ok: true, events: [event] }
  }

  setStatus(slug: AgentSlug, status: AgentState): boolean {
    const member = this.get(slug)
    const changed = member !== null && member.status !== status
    if (changed) this.statuses.set(slug, status)
    if (changed && this.#busy) {
      if (status === "idle") this.#busy.delete(slug)
      else this.#busy.set(slug, { name: this.#busy.get(slug)?.name ?? this.get(slug)?.name ?? slug, status })
    }
    return changed
  }
}

export function listMembers(storage: DurableObjectStorage, roomId: string): Member[] {
  const exists =
    storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members'").toArray().length > 0
  if (!exists) return []
  return storage.sql
    .exec<Row>(
      "SELECT * FROM members WHERE removed_at IS NULL AND members.room_id = ?1 ORDER BY lead DESC, added_seq, slug",
      roomId,
    )
    .toArray()
    .map((r) => toMember(toRow(r)))
}

import type { AgentSlug } from "@kiko/protocol"
import type { RoomRoutine } from "../user/routines"

const ROUTINES_KEY = "routines"

export type Inflight = { routineId: string; occurrence: string; slug: AgentSlug; seq: number; started: boolean }

export class RoomRoutines {
  constructor(
    private readonly sql: SqlStorage,
    private readonly roomId: string,
    private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
  ) {}

  set(list: readonly RoomRoutine[]): void {
    this.meta.set(ROUTINES_KEY, JSON.stringify(list))
  }

  list(): RoomRoutine[] {
    return JSON.parse(this.meta.get(ROUTINES_KEY) ?? "[]") as RoomRoutine[]
  }

  follow(run: Omit<Inflight, "started">): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO routine_inflight (routine_id, occurrence, slug, seq, started, room_id) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
      run.routineId,
      run.occurrence,
      run.slug,
      run.seq,
      this.roomId,
    )
  }

  unfollow(run: Omit<Inflight, "started">): void {
    this.sql.exec(
      "DELETE FROM routine_inflight WHERE (routine_id = ?1 AND occurrence = ?2) AND routine_inflight.room_id = ?3",
      run.routineId,
      run.occurrence,
      this.roomId,
    )
  }

  started(slug: AgentSlug, seq: number): void {
    this.sql.exec(
      "UPDATE routine_inflight SET started = 1, seq = MAX(seq, ?1) WHERE (slug = ?2 AND started = 0) AND routine_inflight.room_id = ?3",
      seq,
      slug,
      this.roomId,
    )
  }

  ended(slug: AgentSlug): Inflight[] {
    const rows = this.sql
      .exec<{ routine_id: string; occurrence: string; slug: string; seq: number }>(
        "SELECT * FROM routine_inflight WHERE (slug = ?1 AND started = 1) AND routine_inflight.room_id = ?2",
        slug,
        this.roomId,
      )
      .toArray()
    this.sql.exec(
      "DELETE FROM routine_inflight WHERE (slug = ?1 AND started = 1) AND routine_inflight.room_id = ?2",
      slug,
      this.roomId,
    )
    return rows.map((r) => ({
      routineId: r.routine_id,
      occurrence: r.occurrence,
      slug: r.slug as AgentSlug,
      seq: r.seq,
      started: true,
    }))
  }

  dropped(slug: AgentSlug): Inflight[] {
    const rows = this.sql
      .exec<{ routine_id: string; occurrence: string; slug: string; seq: number; started: number }>(
        "SELECT * FROM routine_inflight WHERE slug = ?1 AND routine_inflight.room_id = ?2",
        slug,
        this.roomId,
      )
      .toArray()
    this.sql.exec("DELETE FROM routine_inflight WHERE slug = ?1 AND routine_inflight.room_id = ?2", slug, this.roomId)
    return rows.map((r) => ({
      routineId: r.routine_id,
      occurrence: r.occurrence,
      slug: r.slug as AgentSlug,
      seq: r.seq,
      started: r.started === 1,
    }))
  }
}

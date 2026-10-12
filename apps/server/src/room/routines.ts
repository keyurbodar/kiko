import type { AgentSlug } from "@yuki/protocol"
import type { RoomRoutine } from "../user/routines"


const ROUTINES_KEY = "routines"

export type Inflight = { routineId: string; occurrence: string; slug: AgentSlug; seq: number; started: boolean }

export class RoomRoutines {
	constructor(
		private readonly sql: SqlStorage,
		private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
	) {
	}

	set(list: readonly RoomRoutine[]): void {
		this.meta.set(ROUTINES_KEY, JSON.stringify(list))
	}

	list(): RoomRoutine[] {
		return JSON.parse(this.meta.get(ROUTINES_KEY) ?? "[]") as RoomRoutine[]
	}

	follow(run: Omit<Inflight, "started">): void {
		this.sql.exec("INSERT OR IGNORE INTO routine_inflight (routine_id, occurrence, slug, seq, started) VALUES (?, ?, ?, ?, 0)", run.routineId, run.occurrence, run.slug, run.seq)
	}

	unfollow(run: Omit<Inflight, "started">): void {
		this.sql.exec("DELETE FROM routine_inflight WHERE routine_id = ? AND occurrence = ?", run.routineId, run.occurrence)
	}

	started(slug: AgentSlug, seq: number): void {
		this.sql.exec("UPDATE routine_inflight SET started = 1, seq = max(seq, ?) WHERE slug = ? AND started = 0", seq, slug)
	}

	ended(slug: AgentSlug): Inflight[] {
		const rows = this.sql
			.exec<{ routine_id: string; occurrence: string; slug: string; seq: number }>("SELECT * FROM routine_inflight WHERE slug = ? AND started = 1", slug)
			.toArray()
		this.sql.exec("DELETE FROM routine_inflight WHERE slug = ? AND started = 1", slug)
		return rows.map((r) => ({ routineId: r.routine_id, occurrence: r.occurrence, slug: r.slug as AgentSlug, seq: r.seq, started: true }))
	}

	dropped(slug: AgentSlug): Inflight[] {
		const rows = this.sql.exec<{ routine_id: string; occurrence: string; slug: string; seq: number; started: number }>("SELECT * FROM routine_inflight WHERE slug = ?", slug).toArray()
		this.sql.exec("DELETE FROM routine_inflight WHERE slug = ?", slug)
		return rows.map((r) => ({ routineId: r.routine_id, occurrence: r.occurrence, slug: r.slug as AgentSlug, seq: r.seq, started: r.started === 1 }))
	}
}

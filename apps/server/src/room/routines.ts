import type { AgentSlug } from "@yuki/protocol"
import type { RoomRoutine } from "../user/routines"

// Architecture section 25.4. A room's event routines and the runs they started. `UserDO` owns the
// routines and pushes a copy of the room's event routines here, so the room gathers only the signals
// some routine looks at (signals.ts). The room also follows each routine run it delivered until the
// agent's run ends, and reports how.

const ROUTINES_KEY = "routines"

/** One routine run the room delivered and is following. */
export type Inflight = { routineId: string; occurrence: string; slug: AgentSlug; seq: number; started: boolean }

export class RoomRoutines {
	constructor(
		private readonly sql: SqlStorage,
		private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
	) {
		sql.exec("CREATE TABLE IF NOT EXISTS routine_inflight (routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, slug TEXT NOT NULL, seq INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (routine_id, occurrence))")
	}

	set(list: readonly RoomRoutine[]): void {
		this.meta.set(ROUTINES_KEY, JSON.stringify(list))
	}

	list(): RoomRoutine[] {
		return JSON.parse(this.meta.get(ROUTINES_KEY) ?? "[]") as RoomRoutine[]
	}

	/** A routine run handed to `slug`. It joins the agent's next run, which `started` marks. */
	follow(run: Omit<Inflight, "started">): void {
		this.sql.exec("INSERT OR IGNORE INTO routine_inflight (routine_id, occurrence, slug, seq, started) VALUES (?, ?, ?, ?, 0)", run.routineId, run.occurrence, run.slug, run.seq)
	}

	unfollow(run: Omit<Inflight, "started">): void {
		this.sql.exec("DELETE FROM routine_inflight WHERE routine_id = ? AND occurrence = ?", run.routineId, run.occurrence)
	}

	/** The agent began a run at log position `seq`: every routine run waiting for it is in it, and only what it posts after `seq` counts. */
	started(slug: AgentSlug, seq: number): void {
		this.sql.exec("UPDATE routine_inflight SET started = 1, seq = max(seq, ?) WHERE slug = ? AND started = 0", seq, slug)
	}

	/** The agent's run ended: the routine runs it carried, removed. */
	ended(slug: AgentSlug): Inflight[] {
		const rows = this.sql
			.exec<{ routine_id: string; occurrence: string; slug: string; seq: number }>("SELECT * FROM routine_inflight WHERE slug = ? AND started = 1", slug)
			.toArray()
		this.sql.exec("DELETE FROM routine_inflight WHERE slug = ? AND started = 1", slug)
		return rows.map((r) => ({ routineId: r.routine_id, occurrence: r.occurrence, slug: r.slug as AgentSlug, seq: r.seq, started: true }))
	}

	/** Every routine run the agent was given, started or not: the run that carried them failed. */
	dropped(slug: AgentSlug): Inflight[] {
		const rows = this.sql.exec<{ routine_id: string; occurrence: string; slug: string; seq: number; started: number }>("SELECT * FROM routine_inflight WHERE slug = ?", slug).toArray()
		this.sql.exec("DELETE FROM routine_inflight WHERE slug = ?", slug)
		return rows.map((r) => ({ routineId: r.routine_id, occurrence: r.occurrence, slug: r.slug as AgentSlug, seq: r.seq, started: r.started === 1 }))
	}
}

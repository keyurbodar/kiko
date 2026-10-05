import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import type { RoomRoutine } from "../user/routines"

// Architecture section 25.4. A room's event routines and the runs they started. `UserDO` owns the
// routines and pushes a copy of the room's event routines here, so matching an event costs no call.
// Events for one routine within `WINDOW_MS` of the first become one run, as the human burst does.
// The room also follows each routine run it delivered until the agent's run ends, and reports how.

export const ROUTINES_WAKEUP = "routine_events"
export const WINDOW_MS = 60_000
/** The most events one run lists. The rest are counted. */
const MAX_LINES = 20
/** Windows run per alarm pass. Each costs subrequests, and an invocation has 50 (section 17.3). */
const FLUSH_PER_PASS = 10
const ROUTINES_KEY = "routines"

/** What happened, as the agent reads it. Null for an event no routine looks at. */
export function eventLine(event: RoomEvent, nameOf: (slug: AgentSlug) => string): { kind: "task" | "message" | "file"; line: string; text?: string; path?: string; status?: string; from?: "human" | "agent" } | null {
	switch (event.t) {
		case "message":
			if (event.from.kind === "system") return null
			return {
				kind: "message",
				from: event.from.kind,
				text: event.text,
				line: `${event.from.kind === "human" ? "the human" : `@${nameOf(event.from.slug)}`} wrote: "${event.text.replace(/\s+/g, " ").slice(0, 200)}"`,
			}
		case "task":
			return { kind: "task", status: event.task.status, line: `task "${event.task.title}" is now ${event.task.status}${event.task.owner ? ` (owner @${event.task.owner})` : ""}` }
		case "file":
			return { kind: "file", path: event.file.name, line: `/${event.file.name} changed` }
		default:
			return null
	}
}

/** True when `routine` looks at this event. Pure. */
export function matches(routine: RoomRoutine, e: NonNullable<ReturnType<typeof eventLine>>): boolean {
	const t = routine.trigger
	if (t.on !== e.kind) return false
	switch (t.on) {
		case "task":
			return !t.status?.length || t.status.includes(e.status as never)
		case "message":
			return (t.from === "any" || t.from === e.from) && (!t.contains || (e.text ?? "").toLowerCase().includes(t.contains.toLowerCase()))
		case "file": {
			const prefix = t.path.replace(/^\/+|\/+$/g, "")
			return !prefix || e.path === prefix || (e.path ?? "").startsWith(`${prefix}/`)
		}
	}
}

/** `tainted`: a line came from an agent's act that may carry outside content (section 16), so the run starts tainted. */
export type Window = { routineId: string; openedAt: number; lines: string[]; more: number; tainted: boolean }

/** One routine run the room delivered and is following. */
export type Inflight = { routineId: string; occurrence: string; slug: AgentSlug; seq: number; started: boolean }

export class RoomRoutines {
	constructor(
		private readonly sql: SqlStorage,
		private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
	) {
		sql.exec("CREATE TABLE IF NOT EXISTS routine_windows (routine_id TEXT PRIMARY KEY, opened_at INTEGER NOT NULL, lines TEXT NOT NULL, more INTEGER NOT NULL DEFAULT 0, tainted INTEGER NOT NULL DEFAULT 0)")
		if (!sql.exec<{ name: string }>("PRAGMA table_info(routine_windows)").toArray().some((c) => c.name === "tainted")) sql.exec("ALTER TABLE routine_windows ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0")
		sql.exec("CREATE TABLE IF NOT EXISTS routine_inflight (routine_id TEXT NOT NULL, occurrence TEXT NOT NULL, slug TEXT NOT NULL, seq INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (routine_id, occurrence))")
	}

	set(list: readonly RoomRoutine[]): void {
		this.meta.set(ROUTINES_KEY, JSON.stringify(list))
	}

	list(): RoomRoutine[] {
		return JSON.parse(this.meta.get(ROUTINES_KEY) ?? "[]") as RoomRoutine[]
	}

	/**
	 * Adds every matching event to its routine's window. An agent's own acts never fire its own
	 * routines, and acts of a run that an event started fire none: one event starts at most one level
	 * of work, so two routines cannot feed each other. Returns the earliest time a window closes.
	 */
	add(
		events: readonly RoomEvent[],
		who: { actorOf: (seq: number) => string | null; eventRun: (slug: AgentSlug) => boolean; nameOf: (slug: AgentSlug) => string; cleanMessage: (id: string) => boolean },
		now: number,
	): number | null {
		const { actorOf, eventRun, nameOf, cleanMessage } = who
		const routines = this.list()
		if (!routines.length) return null
		let closes: number | null = null
		for (const event of events) {
			const e = eventLine(event, nameOf)
			if (!e) continue
			const actor = actorOf(event.seq)
			const agent = actor?.startsWith("agent:") ? (actor.slice(6) as AgentSlug) : null
			if (agent && eventRun(agent)) continue
			// What an agent wrote may carry outside content. Only its message, stored clean, does not.
			const tainted = agent !== null && !(event.t === "message" && cleanMessage(event.id))
			for (const r of routines) {
				if (agent === r.target || !matches(r, e)) continue
				const open = this.sql.exec<{ lines: string; more: number }>("SELECT lines, more FROM routine_windows WHERE routine_id = ?", r.id).toArray()[0]
				if (!open) {
					this.sql.exec("INSERT INTO routine_windows (routine_id, opened_at, lines, tainted) VALUES (?, ?, ?, ?)", r.id, now, JSON.stringify([e.line]), tainted ? 1 : 0)
					closes = Math.min(closes ?? Infinity, now + WINDOW_MS)
					continue
				}
				const lines = JSON.parse(open.lines) as string[]
				// A full window stops writing: "and more" says enough, and a busy chat costs no write per bubble.
				if (lines.length < MAX_LINES) this.sql.exec("UPDATE routine_windows SET lines = ?, tainted = max(tainted, ?) WHERE routine_id = ?", JSON.stringify([...lines, e.line]), tainted ? 1 : 0, r.id)
				else if (!open.more) this.sql.exec("UPDATE routine_windows SET more = 1, tainted = max(tainted, ?) WHERE routine_id = ?", tainted ? 1 : 0, r.id)
			}
		}
		return closes
	}

	/** Windows that closed by `now`. They stay until `closed` removes them, so a crash retries them. */
	due(now: number): Window[] {
		return this.sql
			.exec<{ routine_id: string; opened_at: number; lines: string; more: number; tainted: number }>("SELECT * FROM routine_windows WHERE opened_at <= ? ORDER BY opened_at LIMIT ?", now - WINDOW_MS, FLUSH_PER_PASS)
			.toArray()
			.map((r) => ({ routineId: r.routine_id, openedAt: r.opened_at, lines: JSON.parse(r.lines) as string[], more: r.more, tainted: r.tainted === 1 }))
	}

	closed(routineId: string): void {
		this.sql.exec("DELETE FROM routine_windows WHERE routine_id = ?", routineId)
	}

	nextClose(): number | null {
		const at = this.sql.exec<{ at: number | null }>("SELECT min(opened_at) AS at FROM routine_windows").one().at
		return at === null ? null : at + WINDOW_MS
	}

	/** A routine run handed to `slug`. It joins the agent's next run, which `started` marks. */
	follow(run: Omit<Inflight, "started">): void {
		this.sql.exec("INSERT OR IGNORE INTO routine_inflight (routine_id, occurrence, slug, seq, started) VALUES (?, ?, ?, ?, 0)", run.routineId, run.occurrence, run.slug, run.seq)
	}

	unfollow(run: Omit<Inflight, "started">): void {
		this.sql.exec("DELETE FROM routine_inflight WHERE routine_id = ? AND occurrence = ?", run.routineId, run.occurrence)
	}

	/** The agent began a run: every routine run waiting for it is in it. */
	started(slug: AgentSlug): void {
		this.sql.exec("UPDATE routine_inflight SET started = 1 WHERE slug = ? AND started = 0", slug)
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

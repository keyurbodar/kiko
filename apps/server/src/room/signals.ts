import type { RoomEvent } from "@yuki/protocol"
import * as Schema from "effect/Schema"
import type { RoomRoutine } from "../user/routines"

// Architecture section 25.4. The one bus for what happens in yuki that work nobody asked for may
// answer. A room gathers its signals for `WINDOW_MS` and sends them to `UserDO.signals` as one batch,
// as the human burst is one delivery; `UserDO` sends its own (a reminder fired, a watched page
// changed) to the same entry. Event routines consume it today. Anything that wants to start work on
// its own later subscribes here instead of reading a room.

/** Who did it. An agent's act carries whether a run that an event started did it (25.4). */
const By = Schema.Union([Schema.Struct({ kind: Schema.Literal("human") }), Schema.Struct({ kind: Schema.Literal("agent"), slug: Schema.String, name: Schema.String, eventRun: Schema.Boolean })])

const base = { roomId: Schema.String, at: Schema.Number, tainted: Schema.Boolean }

export const Signal = Schema.Union([
	/** A message the human sent. */
	Schema.Struct({ kind: Schema.Literal("burst"), ...base, seq: Schema.Number, text: Schema.String, by: By }),
	/** A message an agent posted: a finished bubble or a message to a teammate. Drafts are not signals. */
	Schema.Struct({ kind: Schema.Literal("agent_final"), ...base, seq: Schema.Number, text: Schema.String, by: By }),
	Schema.Struct({ kind: Schema.Literal("task"), ...base, seq: Schema.Number, title: Schema.String, status: Schema.String, owner: Schema.NullOr(Schema.String), by: Schema.NullOr(By) }),
	Schema.Struct({ kind: Schema.Literal("file"), ...base, seq: Schema.Number, path: Schema.String, by: Schema.NullOr(By) }),
	/** A routine run the room followed ended. */
	Schema.Struct({ kind: Schema.Literal("routine_result"), ...base, routineId: Schema.String, occurrence: Schema.String, outcome: Schema.Literals(["ok", "quiet", "failed", "timeout"]), seq: Schema.NullOr(Schema.Number) }),
	Schema.Struct({ kind: Schema.Literal("reminder_fired"), ...base, reminderId: Schema.String, target: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("watch_change"), ...base, routineId: Schema.String, url: Schema.String }),
])
export type Signal = typeof Signal.Type
export type SignalKind = Signal["kind"]

export const SignalBatch = Schema.Struct({ roomId: Schema.String, openedAt: Schema.Number, signals: Schema.Array(Signal), more: Schema.Number })
export type SignalBatch = typeof SignalBatch.Type

export const SIGNALS_WAKEUP = "routine_events"
export const WINDOW_MS = 60_000
/** The most signals one window keeps. The rest are counted, so a busy chat costs no write per bubble. */
export const MAX_SIGNALS = 20

type Act = Extract<Signal, { kind: "burst" | "agent_final" | "task" | "file" }>
type By = typeof By.Type

/** A room event as a signal. Null for an event nothing listens to. */
export function signalOf(event: RoomEvent, ctx: { roomId: string; at: number; by: By | null; tainted: boolean }): Act | null {
	const { roomId, at, by, tainted } = ctx
	switch (event.t) {
		case "message":
			if (event.from.kind === "system" || !by) return null
			return { kind: event.from.kind === "human" ? "burst" : "agent_final", roomId, at, tainted, seq: event.seq, text: event.text, by }
		case "task":
			return { kind: "task", roomId, at, tainted, seq: event.seq, title: event.task.title, status: event.task.status, owner: event.task.owner ?? null, by }
		case "file":
			return { kind: "file", roomId, at, tainted, seq: event.seq, path: event.file.name, by }
		default:
			return null
	}
}

/** What happened, as the agent reads it. */
export function signalLine(s: Act): string {
	switch (s.kind) {
		case "burst":
		case "agent_final":
			return `${s.by.kind === "human" ? "the human" : `@${s.by.name}`} wrote: "${s.text.replace(/\s+/g, " ").slice(0, 200)}"`
		case "task":
			return `task "${s.title}" is now ${s.status}${s.owner ? ` (owner @${s.owner})` : ""}`
		case "file":
			return `/${s.path} changed`
	}
}

/** True when `routine`'s trigger looks at this signal. Pure, and blind to who did it. */
export function matches(routine: RoomRoutine, s: Signal): boolean {
	const t = routine.trigger
	switch (t.on) {
		case "task":
			return s.kind === "task" && (!t.status?.length || t.status.includes(s.status as never))
		case "message": {
			if (s.kind !== "burst" && s.kind !== "agent_final") return false
			const from = s.kind === "burst" ? "human" : "agent"
			return (t.from === "any" || t.from === from) && (!t.contains || s.text.toLowerCase().includes(t.contains.toLowerCase()))
		}
		case "file": {
			if (s.kind !== "file") return false
			const prefix = t.path.replace(/^\/+|\/+$/g, "")
			return !prefix || s.path === prefix || s.path.startsWith(`${prefix}/`)
		}
	}
}

/**
 * The run a batch starts for one event routine, or null. An agent's own acts never fire its own
 * routines, and acts of a run that an event started fire none: one event starts at most one level of
 * work, so two routines cannot feed each other. The run is tainted when any act it lists is.
 */
export function routineRun(routine: RoomRoutine, batch: SignalBatch): { body: string; tainted: boolean } | null {
	const hits = batch.signals.filter((s): s is Act => {
		if (!matches(routine, s)) return false
		const by = "by" in s ? s.by : null
		return !(by?.kind === "agent" && (by.eventRun || by.slug === routine.target))
	})
	if (!hits.length) return null
	const lines = hits.slice(0, MAX_SIGNALS).map(signalLine)
	if (hits.length > MAX_SIGNALS || batch.more) lines.push("and more")
	return { body: `what happened:\n${lines.map((l) => `- ${l}`).join("\n")}`, tainted: hits.some((s) => s.tainted) }
}

/** The room's open window of signals. Rows stay until `sent` removes them, so a crash retries the batch. */
export class SignalWindow {
	constructor(
		private readonly sql: SqlStorage,
		private readonly roomId: () => string | null,
	) {
		sql.exec("CREATE TABLE IF NOT EXISTS signal_window (n INTEGER PRIMARY KEY, at INTEGER NOT NULL, signal TEXT NOT NULL)")
		sql.exec("CREATE TABLE IF NOT EXISTS signal_more (id INTEGER PRIMARY KEY CHECK (id = 1), more INTEGER NOT NULL)")
		sql.exec("DROP TABLE IF EXISTS routine_windows")
		sql.exec("CREATE TABLE IF NOT EXISTS signal_results (n INTEGER PRIMARY KEY, signal TEXT NOT NULL)")
	}

	/** Routine results go out at once, outside the window, and stay here until `released`, so a lost send retries. */
	hold(results: readonly Signal[]): void {
		for (const s of results) this.sql.exec("INSERT INTO signal_results (signal) VALUES (?)", JSON.stringify(s))
	}

	held(): { signals: Signal[]; upto: number } | null {
		const rows = this.sql.exec<{ n: number; signal: string }>("SELECT n, signal FROM signal_results ORDER BY n LIMIT ?", MAX_SIGNALS).toArray()
		return rows.length ? { signals: rows.map((r) => JSON.parse(r.signal) as Signal), upto: rows.at(-1)!.n } : null
	}

	released(upto: number): void {
		this.sql.exec("DELETE FROM signal_results WHERE n <= ?", upto)
	}

	/** Adds signals. Returns when the window closes if this opened it, else null. */
	add(signals: readonly Signal[], now: number): number | null {
		if (!signals.length) return null
		const open = this.openedAt()
		const kept = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM signal_window").one().n
		const room = Math.max(0, MAX_SIGNALS - kept)
		for (const s of signals.slice(0, room)) this.sql.exec("INSERT INTO signal_window (at, signal) VALUES (?, ?)", now, JSON.stringify(s))
		if (signals.length > room) this.sql.exec("INSERT INTO signal_more (id, more) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET more = more + excluded.more", signals.length - room)
		return open === null ? now + WINDOW_MS : null
	}

	private openedAt(): number | null {
		return this.sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM signal_window").one().at
	}

	/** The batch once its window closed by `now`. */
	due(now: number): { batch: SignalBatch; upto: number } | null {
		const openedAt = this.openedAt()
		const roomId = this.roomId()
		if (openedAt === null || openedAt > now - WINDOW_MS || !roomId) return null
		const rows = this.sql.exec<{ n: number; signal: string }>("SELECT n, signal FROM signal_window ORDER BY n").toArray()
		const more = this.sql.exec<{ more: number }>("SELECT more FROM signal_more").toArray()[0]?.more ?? 0
		return { batch: { roomId, openedAt, signals: rows.map((r) => JSON.parse(r.signal) as Signal), more }, upto: rows.at(-1)!.n }
	}

	/** The batch up to row `upto` reached `UserDO`. Signals added while it was on its way stay for the next window. */
	sent(upto: number): void {
		this.sql.exec("DELETE FROM signal_window WHERE n <= ?", upto)
		this.sql.exec("DELETE FROM signal_more")
	}

	nextClose(): number | null {
		const at = this.openedAt()
		return at === null ? null : at + WINDOW_MS
	}
}

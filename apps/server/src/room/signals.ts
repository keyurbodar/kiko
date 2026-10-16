import type { RoomEvent } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import type { RoomRoutine } from "../user/routines"


const By = Schema.Union([Schema.Struct({ kind: Schema.Literal("human") }), Schema.Struct({ kind: Schema.Literal("agent"), slug: Schema.String, name: Schema.String, eventRun: Schema.Boolean })])

const base = { roomId: Schema.String, at: Schema.Number }

export const Signal = Schema.Union([
	// answers: the seq of the initiative bubble this human message replies to.
	Schema.Struct({ kind: Schema.Literal("burst"), ...base, seq: Schema.Number, text: Schema.String, by: By, answers: Schema.optionalKey(Schema.Number) }),
	Schema.Struct({ kind: Schema.Literal("agent_final"), ...base, seq: Schema.Number, text: Schema.String, by: By }),
	Schema.Struct({ kind: Schema.Literal("routine_result"), ...base, routineId: Schema.String, occurrence: Schema.String, outcome: Schema.Literals(["ok", "quiet", "failed", "timeout"]), seq: Schema.NullOr(Schema.Number), text: Schema.optionalKey(Schema.String) }),
])
export type Signal = typeof Signal.Type

export const SignalBatch = Schema.Struct({ roomId: Schema.String, openedAt: Schema.Number, signals: Schema.Array(Signal), more: Schema.Number })
export type SignalBatch = typeof SignalBatch.Type

export const SIGNALS_WAKEUP = "routine_events"
const WINDOW_MS = 60_000
const MAX_SIGNALS = 20

type Act = Extract<Signal, { kind: "burst" | "agent_final" }>
type By = typeof By.Type

export function signalOf(event: RoomEvent, ctx: { roomId: string; at: number; by: By | null; answers?: number }): Act | null {
	const { roomId, at, by } = ctx
	switch (event.t) {
		case "message":
			if (event.from.kind === "system" || !by) return null
			if (event.from.kind === "human") return { kind: "burst", roomId, at, seq: event.seq, text: event.text, by, ...(ctx.answers === undefined ? {} : { answers: ctx.answers }) }
			return { kind: "agent_final", roomId, at, seq: event.seq, text: event.text, by }
		default:
			return null
	}
}

function signalLine(s: Act): string {
	switch (s.kind) {
		case "burst":
		case "agent_final":
			return `${s.by.kind === "human" ? "the human" : `@${s.by.name}`} wrote: "${s.text.replace(/\s+/g, " ").slice(0, 200)}"`
	}
}

export function matches(routine: RoomRoutine, s: Signal): boolean {
	const t = routine.trigger
	return s.kind === "burst" && (!t.contains || s.text.toLowerCase().includes(t.contains.toLowerCase()))
}

export function routineRun(routine: RoomRoutine, batch: SignalBatch): { body: string } | null {
	const hits = batch.signals.filter((s): s is Act => {
		if (!matches(routine, s)) return false
		const by = "by" in s ? s.by : null
		return !(by?.kind === "agent" && (by.eventRun || by.slug === routine.target))
	})
	if (!hits.length) return null
	const lines = hits.slice(0, MAX_SIGNALS).map(signalLine)
	if (hits.length > MAX_SIGNALS || batch.more) lines.push("and more")
	return { body: `what happened:\n${lines.map((l) => `- ${l}`).join("\n")}` }
}

export class SignalWindow {
	constructor(
		private readonly sql: SqlStorage,
		private readonly roomId: () => string | null,
	) {
	}

	hold(results: readonly Signal[]): void {
		for (const s of results) this.sql.exec("INSERT INTO signal_results (signal) VALUES (?)", JSON.stringify(s))
	}

	held(): { signals: Signal[]; upto: number } | null {
		const rows = this.sql.exec<{ n: number; signal: string }>("SELECT n, signal FROM signal_results ORDER BY n LIMIT ?", MAX_SIGNALS).toArray()
		const last = rows.at(-1)
		return last ? { signals: rows.map((r) => JSON.parse(r.signal) as Signal), upto: last.n } : null
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
		const last = rows.at(-1)
		if (!last) throw new Error("signal window opened without rows")
		return { batch: { roomId, openedAt, signals: rows.map((r) => JSON.parse(r.signal) as Signal), more }, upto: last.n }
	}

	/** The batch up to row `upto` reached `UserDO`. Signals added while it was on its way stay for the next window. */
	sent(upto: number, more: number): void {
		this.sql.exec("DELETE FROM signal_window WHERE n <= ?", upto)
		this.sql.exec("UPDATE signal_more SET more = more - ? WHERE id = 1", more)
		this.sql.exec("DELETE FROM signal_more WHERE more <= 0")
	}

	nextClose(): number | null {
		const at = this.openedAt()
		return at === null ? null : at + WINDOW_MS
	}
}

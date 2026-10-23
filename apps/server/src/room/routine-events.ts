import type { RoomEvent } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import type { RoomRoutine } from "../user/routines"

const By = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("human") }),
  Schema.Struct({ kind: Schema.Literal("agent"), slug: Schema.String, name: Schema.String, eventRun: Schema.Boolean }),
])

const base = { roomId: Schema.String, at: Schema.Number }

export const Signal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("burst"), ...base, seq: Schema.Number, text: Schema.String, by: By }),
  Schema.Struct({ kind: Schema.Literal("agent_final"), ...base, seq: Schema.Number, text: Schema.String, by: By }),
  Schema.Struct({
    kind: Schema.Literal("routine_result"),
    ...base,
    routineId: Schema.String,
    occurrence: Schema.String,
    outcome: Schema.Literals(["ok", "quiet", "failed", "timeout"]),
    seq: Schema.NullOr(Schema.Number),
  }),
])
export type Signal = typeof Signal.Type

export const SignalBatch = Schema.Struct({
  roomId: Schema.String,
  openedAt: Schema.Number,
  signals: Schema.Array(Signal),
  more: Schema.Number,
})
export type SignalBatch = typeof SignalBatch.Type

const MAX_SIGNALS = 20

type Act = Extract<Signal, { kind: "burst" | "agent_final" }>
type By = typeof By.Type

export function signalOf(event: RoomEvent, ctx: { roomId: string; at: number; by: By | null }): Act | null {
  const { roomId, at, by } = ctx
  switch (event.t) {
    case "message":
      if (event.from.kind === "system" || !by) return null
      if (event.from.kind === "human") return { kind: "burst", roomId, at, seq: event.seq, text: event.text, by }
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

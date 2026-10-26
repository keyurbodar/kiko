import type { RoomEvent } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import type { RoomRoutine } from "../user/routines"

const base = { roomId: Schema.String, at: Schema.Number }

export const Signal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("burst"), ...base, seq: Schema.Number, text: Schema.String }),
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

type Burst = Extract<Signal, { kind: "burst" }>

export function signalOf(event: RoomEvent, ctx: { roomId: string; at: number }): Burst | null {
  if (event.t !== "message" || event.from.kind !== "human") return null
  return { kind: "burst", roomId: ctx.roomId, at: ctx.at, seq: event.seq, text: event.text }
}

const signalLine = (s: Burst) => `the human wrote: "${s.text.replace(/\s+/g, " ").slice(0, 200)}"`

export function matches(routine: RoomRoutine, s: Signal): s is Burst {
  const t = routine.trigger
  return s.kind === "burst" && (!t.contains || s.text.toLowerCase().includes(t.contains.toLowerCase()))
}

export function routineRun(routine: RoomRoutine, batch: SignalBatch): { body: string } | null {
  const hits = batch.signals.filter((s): s is Burst => matches(routine, s))
  if (!hits.length) return null
  const lines = hits.slice(0, MAX_SIGNALS).map(signalLine)
  if (hits.length > MAX_SIGNALS || batch.more) lines.push("and more")
  return { body: `what happened:\n${lines.map((l) => `- ${l}`).join("\n")}` }
}

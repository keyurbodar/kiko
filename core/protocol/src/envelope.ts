import * as Schema from "effect/Schema"
import { Count, Id } from "./base"
import { AgentSlug, MessageId, RoomId } from "./brands"

export const SystemReason = Schema.Literals([
  "task_updated",
  "task_unblocked",
  "reminder",
  "run_budget",
  "limit",
  "files",
  "created",
  "routine",
  "stalled",
  "initiative",
  "divider",
  "system",
])
export type SystemReason = typeof SystemReason.Type

export const Human = Schema.Struct({ kind: Schema.Literal("human") })
export type Human = typeof Human.Type
export const AgentRef = Schema.Struct({ kind: Schema.Literal("agent"), slug: AgentSlug })
export type AgentRef = typeof AgentRef.Type
export const System = Schema.Struct({ kind: Schema.Literal("system"), reason: SystemReason })
export type System = typeof System.Type

export const Sender = Schema.Union([Human, AgentRef, System])
export type Sender = typeof Sender.Type
export const Actor = Schema.Union([Human, AgentRef])
export type Actor = typeof Actor.Type

export const Envelope = Schema.Struct({
  id: Id,
  roomId: RoomId,
  from: Sender,
  body: Schema.String,
  replyTo: Schema.optionalKey(MessageId),
  hop: Count,
  rootId: Id,
  seq: Count,
})
export type Envelope = typeof Envelope.Type

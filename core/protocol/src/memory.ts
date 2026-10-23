import * as Schema from "effect/Schema"
import { Count, Id } from "./base"

export const LifeLine = Schema.Struct({
  pos: Count,
  at: Count,
  text: Schema.String,
  source: Schema.String,
  pinned: Schema.Boolean,
  redacted: Schema.Boolean,
  supersededBy: Schema.optionalKey(Schema.NullOr(Count)),
})
export type LifeLine = typeof LifeLine.Type

export const MemoryModel = Schema.NullOr(Schema.Struct({ provider: Id, modelId: Id }))
export type MemoryModel = typeof MemoryModel.Type

export const MemoryOp = Schema.Union([
  Schema.Struct({ op: Schema.Literal("list"), before: Schema.optionalKey(Count), limit: Schema.optionalKey(Count) }),
  Schema.Struct({ op: Schema.Literal("view") }),
  Schema.Struct({ op: Schema.Literal("search"), query: Schema.String }),
  Schema.Struct({ op: Schema.Literal("zoom"), id: Id }),
  Schema.Struct({ op: Schema.Literal("note"), text: Id }),
  Schema.Struct({ op: Schema.Literal("pin"), pos: Count, pinned: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal("redact"), pos: Count }),
  Schema.Struct({ op: Schema.Literal("model") }),
  Schema.Struct({ op: Schema.Literal("set_model"), model: MemoryModel }),
])
export type MemoryOp = typeof MemoryOp.Type

export const MemoryResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), lines: Schema.Array(LifeLine), next: Schema.NullOr(Count) }),
  Schema.Struct({ ok: Schema.Literal(true), text: Schema.Array(Schema.String) }),
  Schema.Struct({ ok: Schema.Literal(true), model: MemoryModel }),
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type MemoryResult = typeof MemoryResult.Type

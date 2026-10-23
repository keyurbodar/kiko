import * as Schema from "effect/Schema"
import { Count } from "./base"
import { AgentSlug, RoomId } from "./ids"
import { ProviderInfo } from "./providers"
import { Trigger } from "./routines"

export const ROW_KINDS = ["routine", "soul", "provider"] as const

export const RoutineRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  roomId: RoomId,
  status: Schema.Literals(["active", "paused"]),
  trigger: Trigger,
  tz: Schema.String,
})
export type RoutineRow = typeof RoutineRow.Type

export const SoulRow = Schema.Struct({ id: AgentSlug, body: Schema.String, sha: Schema.String, at: Count })
export type SoulRow = typeof SoulRow.Type

export const ProviderRow = Schema.Struct({ id: Schema.String, ...ProviderInfo.fields })
export type ProviderRow = typeof ProviderRow.Type

export const RowKind = Schema.Literals(ROW_KINDS)
export type RowKind = typeof RowKind.Type

export const RowLists = Schema.Struct({
  routine: Schema.optionalKey(Schema.Array(RoutineRow)),
  soul: Schema.optionalKey(Schema.Array(SoulRow)),
  provider: Schema.optionalKey(Schema.Array(ProviderRow)),
})
export type RowLists = typeof RowLists.Type

export type UserRows = { routine: RoutineRow; soul: SoulRow; provider: ProviderRow }

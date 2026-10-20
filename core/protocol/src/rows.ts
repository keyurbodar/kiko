import type { AgentSlug, RoomId } from "./ids"
import type { ProviderInfo } from "./providers"
import type { Trigger } from "./routines"

export const ROW_KINDS = ["routine", "soul", "provider"] as const

export type RoutineRow = { id: string; name: string; roomId: RoomId; status: "active" | "paused"; trigger: Trigger; tz: string }

export type SoulRow = { id: AgentSlug; body: string; sha: string; at: number }

export type ProviderRow = ProviderInfo & { id: string }

export type UserRows = { routine: RoutineRow; soul: SoulRow; provider: ProviderRow }
export type RowKind = keyof UserRows

export type RowLists = { readonly [K in RowKind]?: readonly UserRows[K][] }

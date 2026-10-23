import type { ProviderRow, RoutineRow, SoulRow } from "./user"

export const ROW_KINDS = ["routine", "soul", "provider"] as const

export type UserRows = { routine: RoutineRow; soul: SoulRow; provider: ProviderRow }

// The keyed lists the user socket carries beside chats, agents, and the drive. Each kind names
// its row type, and every row has a stable `id`. The server sends a `row` or `row_removed` event
// when one changes, and the client keeps one collection per kind. A new list the interface shows
// is a new kind here, not a fetch.

import type { AgentSlug, RoomId } from "./ids"
import type { ProviderInfo } from "./providers"
import type { Trigger } from "./routines"

export const ROW_KINDS = ["routine", "soul", "provider"] as const

/** A routine the human can see: active or paused. */
export type RoutineRow = { id: string; name: string; roomId: RoomId; status: "active" | "paused"; trigger: Trigger; tz: string }

/** An agent's soul. The id is the agent's slug. */
export type SoulRow = { id: AgentSlug; body: string; sha: string; at: number }

/** A connected provider. The id is the provider. */
export type ProviderRow = ProviderInfo & { id: string }

export type UserRows = { routine: RoutineRow; soul: SoulRow; provider: ProviderRow }
export type RowKind = keyof UserRows

/** Each kind's rows, in the server's order. */
export type RowLists = { readonly [K in RowKind]?: readonly UserRows[K][] }

import type { AgentSlug, Envelope, SystemReason } from "@yuki/protocol"
import type { Chain } from "./mail"

// Architecture section 25.5. A wake is a run nobody's message started: a routine, a reminder, a task
// that came unblocked, a nudge. `RoomDO.wake` is the one place that hands one to an agent, and so the
// one place that takes the budgets, holds for the away pause, dedupes by id, refunds what a refused or
// held wake took, and keeps held wakes to retry.

/** Whose daily runs a wake spends. `room`: the room's loop budget and the user's. `user`: the user's only, for what the human set up. `paid`: neither, for what the human asked for just now. */
export type Budget = "room" | "user" | "paid"

export type Wake = {
	/** The envelope id and the delivery ledger's key. A second wake with the same id delivers nothing. */
	id: string
	to: AgentSlug
	why: SystemReason
	body: string
	/** The chain the run continues, with its origin. Null starts its own root as `auto`. */
	chain: Chain | null
	budget: Budget
	/** A held wake waits in the room and is retried when the budget resets or the human is back. */
	retry: boolean
	seq?: number
}

export type WakeResult = "delivered" | "held" | "refused" | "gone" | "duplicate"

/** Where the run sits in its chain: the chain's root and hop, or its own root when there is none or the human stopped it. */
export function wakeStamp(w: Pick<Wake, "id" | "chain">, stopped: (rootId: string) => boolean): Pick<Envelope, "rootId" | "hop" | "origin"> {
	const own = !w.chain || stopped(w.chain.rootId)
	return { rootId: own ? w.id : w.chain!.rootId, hop: own ? 0 : w.chain!.hop, origin: w.chain?.origin ?? "auto" }
}

/** How long a held wake waits. ASSUMPTION: a week, the same as the away pause. */
const KEEP_HELD_MS = 7 * 86_400_000
/** Held wakes retried in one pass. Each costs subrequests, and an invocation has 50 (section 17.3). */
export const HELD_PER_PASS = 10
export const HELD_WAKEUP = "held_wakes"

/** The outbox of held wakes, oldest first. */
export class HeldWakes {
	constructor(private readonly sql: SqlStorage) {
		sql.exec("CREATE TABLE IF NOT EXISTS held_wakes (id TEXT PRIMARY KEY, wake TEXT NOT NULL, at INTEGER NOT NULL)")
	}

	hold(w: Wake, now: number): void {
		this.sql.exec("INSERT OR IGNORE INTO held_wakes (id, wake, at) VALUES (?, ?, ?)", w.id, JSON.stringify(w), now)
	}

	has(id: string): boolean {
		return this.sql.exec("SELECT 1 FROM held_wakes WHERE id = ?", id).toArray().length > 0
	}

	any(): boolean {
		return this.sql.exec("SELECT 1 FROM held_wakes LIMIT 1").toArray().length > 0
	}

	/** The oldest held wakes that are still worth delivering. Older ones are dropped. */
	due(now: number, limit = HELD_PER_PASS): Wake[] {
		this.sql.exec("DELETE FROM held_wakes WHERE at < ?", now - KEEP_HELD_MS)
		return this.sql
			.exec<{ wake: string }>("SELECT wake FROM held_wakes ORDER BY at, id LIMIT ?", limit)
			.toArray()
			.map((r) => JSON.parse(r.wake) as Wake)
	}

	drop(id: string): void {
		this.sql.exec("DELETE FROM held_wakes WHERE id = ?", id)
	}
}

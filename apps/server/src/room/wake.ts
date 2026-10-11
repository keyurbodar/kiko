import type { AgentSlug, Envelope, SystemReason } from "@yuki/protocol"
import type { Chain } from "./mail"


export type Budget = "room" | "user" | "paid"

export type Wake = {
	id: string
	to: AgentSlug
	why: SystemReason
	body: string
	chain: Chain | null
	budget: Budget
	retry: boolean
	seq?: number
}

export type WakeResult = "delivered" | "held" | "refused" | "gone" | "duplicate"

export function wakeStamp(w: Pick<Wake, "id" | "chain">, stopped: (rootId: string) => boolean): Pick<Envelope, "rootId" | "hop" | "origin"> {
	const chain = w.chain
	if (!chain || stopped(chain.rootId)) return { rootId: w.id, hop: 0, origin: chain?.origin ?? "auto" }
	return { rootId: chain.rootId, hop: chain.hop, origin: chain.origin ?? "auto" }
}

const KEEP_HELD_MS = 7 * 86_400_000
export const HELD_PER_PASS = 10
export const HELD_WAKEUP = "held_wakes"

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

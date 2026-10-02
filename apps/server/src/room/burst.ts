import type { Envelope, Message, RoomId } from "@kiko/protocol"
import type { Alarms } from "../lib/alarm"

// Architecture section 6.1. Human messages wait in `pending` until the human pauses. The
// room delivers the whole burst in one `receive()` call per recipient. Rows leave `pending`
// only after the recipient admitted them, so a failed or repeated alarm delivers again, and
// the stable envelope ids make the repeat a no-op in the agent's inbox.

/** The wakeup key in `lib/alarm.ts`. */
export const BURST_WAKEUP = "burst"

// ASSUMPTION: the three numbers of the table in section 6.1. A per-user reply speed may override them later.
export const AFTER_MESSAGE_MS = 1_500
export const AFTER_TYPING_MS = 2_500
export const MAX_BURST_MS = 8_000

type Row = { id: string; seq: number; at: number; text: string; reply_to: string | null }

/** The wakeup for an event while a burst that began at `startedAt` is pending. A pure table. */
export function debounce(event: "message" | "typing", now: number, startedAt: number): number {
	const wait = event === "message" ? AFTER_MESSAGE_MS : AFTER_TYPING_MS
	return Math.min(now + wait, startedAt + MAX_BURST_MS)
}

/** The delivery id of one human message. Stable, so a repeated delivery stores nothing twice. */
export const envelopeId = (messageId: string) => `human:${messageId}`

export class Burst {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly alarms: Alarms,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
		this.sql.exec(`CREATE TABLE IF NOT EXISTS pending (
			id TEXT PRIMARY KEY,
			seq INTEGER NOT NULL,
			at INTEGER NOT NULL,
			text TEXT NOT NULL,
			reply_to TEXT
		)`)
	}

	private startedAt(): number | null {
		return this.sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM pending").one().at
	}

	/** Adds a stored human message to the burst and moves the wakeup. */
	async add(message: Pick<Message, "id" | "seq" | "text" | "replyTo">): Promise<void> {
		const now = this.now()
		this.sql.exec(
			"INSERT OR IGNORE INTO pending (id, seq, at, text, reply_to) VALUES (?, ?, ?, ?, ?)",
			message.id,
			message.seq,
			now,
			message.text,
			message.replyTo ?? null,
		)
		await this.alarms.setWakeup(BURST_WAKEUP, debounce("message", now, this.startedAt() ?? now))
	}

	/** The human is typing. Extends a pending burst and does nothing otherwise. */
	async typing(): Promise<void> {
		const startedAt = this.startedAt()
		if (startedAt === null) return
		await this.alarms.setWakeup(BURST_WAKEUP, debounce("typing", this.now(), startedAt))
	}

	/** One envelope per pending message, oldest first. */
	envelopes(roomId: RoomId): Envelope[] {
		return this.sql
			.exec<Row>("SELECT id, seq, at, text, reply_to FROM pending ORDER BY seq")
			.toArray()
			.map((r) => ({
				id: envelopeId(r.id),
				roomId,
				from: { kind: "human" },
				body: r.text,
				...(r.reply_to ? { replyTo: r.reply_to as Envelope["replyTo"] } : {}),
				hop: 0,
				rootId: r.id,
				tainted: false,
				seq: r.seq,
			}))
	}

	/** Removes the delivered messages. Messages that arrived during the delivery stay for the next one. */
	delivered(envelopes: readonly Envelope[]): void {
		for (const e of envelopes) this.sql.exec("DELETE FROM pending WHERE id = ?", e.rootId)
	}

	/** Messages that arrived during a delivery still have their own wakeup. A failed delivery retries after `ms`. */
	async retry(ms: number): Promise<void> {
		if (this.startedAt() !== null) await this.alarms.setWakeup(BURST_WAKEUP, this.now() + ms)
	}
}

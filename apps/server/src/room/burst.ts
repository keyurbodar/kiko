import type { Envelope, Message, RoomId } from "@kiko/protocol"
import type { Alarms } from "../lib/alarm"

// Architecture section 6.1. Human messages wait in `pending` until the human pauses. The
// room delivers the whole burst in one `receive()` call per recipient. Rows leave `pending`
// only after the recipient admitted them, so a failed or repeated alarm delivers again, and
// the stable envelope ids make the repeat a no-op in the agent's inbox.

/** The wakeup key in `lib/alarm.ts`. */
export const BURST_WAKEUP = "burst"

// ASSUMPTION: the three numbers of the table in section 6.1. A per-user reply speed may override them later.
export const AFTER_MESSAGE_MS = 1_000
export const AFTER_TYPING_MS = 2_500
/** A short message with no closing punctuation ("like how things", "if you") is a thought still going. */
export const AFTER_FRAGMENT_MS = 2_500
export const MAX_BURST_MS = 8_000

type Row = { id: string; seq: number; at: number; text: string; reply_to: string | null }

/**
 * True for a message that reads unfinished: three words or fewer, with no closing punctuation or emoji.
 * People who text in bursts break one thought over several of these.
 */
export function isFragment(text: string): boolean {
	const t = text.trim()
	if (!t) return false
	if (/[.!?…)\]"']$|\p{Extended_Pictographic}$/u.test(t)) return false
	return t.split(/\s+/).length <= 3
}

/** The wakeup for an event while a burst that began at `startedAt` is pending. A pure table. */
export function debounce(event: "message" | "typing" | "fragment", now: number, startedAt: number): number {
	const wait = event === "message" ? AFTER_MESSAGE_MS : event === "fragment" ? AFTER_FRAGMENT_MS : AFTER_TYPING_MS
	return Math.min(now + wait, startedAt + MAX_BURST_MS)
}

/**
 * The most of a burst one delivery carries. An agent's inbox refuses a delivery past 500 open rows or
 * 128 KB in one entry (agent/inbox.ts), and a refused burst would wait forever or be dropped. A burst
 * past either cap goes out in order, in several deliveries. ASSUMPTION: the numbers, well under the caps.
 */
export const MAX_DELIVERY_ENVELOPES = 100
export const MAX_DELIVERY_BYTES = 64 * 1024

/** The oldest envelopes of a burst that fit in one delivery. Always at least one. */
export function deliverable<T>(envelopes: readonly T[], maxCount = MAX_DELIVERY_ENVELOPES, maxBytes = MAX_DELIVERY_BYTES): T[] {
	let bytes = 0
	const out: T[] = []
	for (const e of envelopes) {
		bytes += new TextEncoder().encode(JSON.stringify(e)).length
		if (out.length && (out.length >= maxCount || bytes > maxBytes)) break
		out.push(e)
	}
	return out
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
		// `startedAt` runs on every human message; without this it reads the whole pending burst each time.
		this.sql.exec("CREATE INDEX IF NOT EXISTS pending_at ON pending (at)")
	}

	/** True while a human message waits for the burst to close. */
	pending(): boolean {
		return this.startedAt() !== null
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
		await this.alarms.setWakeup(BURST_WAKEUP, debounce(isFragment(message.text) ? "fragment" : "message", now, this.startedAt() ?? now))
	}

	/** The human is typing. Extends a pending burst and does nothing otherwise. */
	async typing(): Promise<void> {
		const startedAt = this.startedAt()
		if (startedAt === null) return
		await this.alarms.setWakeup(BURST_WAKEUP, debounce("typing", this.now(), startedAt))
	}

	/**
	 * One envelope per pending message, oldest first, at most `limit`. A flush delivers at most
	 * `MAX_DELIVERY_ENVELOPES`, so it reads only those: reading the whole backlog on every flush cost
	 * N²/100 row reads for N pending messages.
	 */
	envelopes(roomId: RoomId, limit = MAX_DELIVERY_ENVELOPES): Envelope[] {
		return this.sql
			.exec<Row>("SELECT id, seq, at, text, reply_to FROM pending ORDER BY seq LIMIT ?", limit)
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
				origin: "human",
			}))
	}

	/** Removes the delivered messages. Messages that arrived during the delivery stay for the next one. */
	delivered(envelopes: readonly Envelope[]): void {
		for (const e of envelopes) this.sql.exec("DELETE FROM pending WHERE id = ?", e.rootId)
	}

	/** Drops the whole burst, as when the room has nobody to deliver to. */
	clear(): void {
		this.sql.exec("DELETE FROM pending")
	}

	/** Messages that arrived during a delivery still have their own wakeup. A failed delivery retries after `ms`. */
	async retry(ms: number): Promise<void> {
		if (this.startedAt() !== null) await this.alarms.setWakeup(BURST_WAKEUP, this.now() + ms)
	}
}

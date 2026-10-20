import type { Envelope, Message, RoomId } from "@kiko/protocol"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
const MAX_ENTRY_BYTES = 256 * 1024
const MAX_OPEN = 1000

export const BURST_WAKEUP = "burst"

export const AFTER_MESSAGE_MS = 1_000
export const AFTER_TYPING_MS = 2_500
export const AFTER_FRAGMENT_MS = 2_500
export const MAX_BURST_MS = 8_000

type Row = { id: string; seq: number; at: number; text: string; reply_to: string | null; mentions: string }

const DANGLING = new Set(
	"a an the and or but so because cause if then than that which who whom whose when while where though although unless until since as nor yet plus also like with without of to for from in on at by about into onto over under after before between through during against toward towards via per".split(
		" ",
	),
)

export function isFragment(text: string): boolean {
	const t = text.trim().toLowerCase()
	if (!t) return false
	if (/(,|\.\.\.|…)$/.test(t)) return true
	const last = /([a-z']+)$/.exec(t)?.[1]
	return last !== undefined && DANGLING.has(last)
}

export function debounce(event: "message" | "typing" | "fragment", now: number, startedAt: number): number {
	const wait = event === "message" ? AFTER_MESSAGE_MS : event === "fragment" ? AFTER_FRAGMENT_MS : AFTER_TYPING_MS
	return Math.min(now + wait, startedAt + MAX_BURST_MS)
}

const MAX_DELIVERY_ENVELOPES = MAX_OPEN / 5
export const MAX_DELIVERY_BYTES = MAX_ENTRY_BYTES / 2

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

export const envelopeId = (messageId: string) => `human:${messageId}`

/** A human message waiting in the window: its envelope, and the slugs its whole text names. */
export type Pending = { envelope: Envelope; mentions: string[] }

export class Burst {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly alarms: Alarms,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
	}

	pending(): boolean {
		return this.sql.exec("SELECT 1 FROM pending LIMIT 1").toArray().length > 0
	}

	private startedAt(): number | null {
		// A pending row's seq is the order it was sent in, and it is staged with its message, so its seq follows the
		// message's at. The lowest seq therefore holds the window's first at, read through pending_seq.
		return this.sql.exec<{ at: number | null }>("SELECT at FROM pending ORDER BY seq LIMIT 1").one().at
	}

	/** Records a human message in the window, in the same transaction that stores the message. */
	stage(message: Pick<Message, "id" | "seq" | "text" | "replyTo">, mentions: readonly string[]): void {
		this.sql.exec(
			"INSERT OR IGNORE INTO pending (id, seq, at, text, reply_to, mentions) VALUES (?, ?, ?, ?, ?, ?)",
			message.id,
			message.seq,
			this.now(),
			message.text,
			message.replyTo ?? null,
			JSON.stringify(mentions),
		)
	}

	/** Sets the wakeup for a staged message: the window closes a pause after it, or at the cap. */
	async arm(text: string): Promise<void> {
		const now = this.now()
		await this.alarms.setWakeup(BURST_WAKEUP, debounce(isFragment(text) ? "fragment" : "message", now, this.startedAt() ?? now))
	}

	async typing(): Promise<void> {
		const startedAt = this.startedAt()
		if (startedAt === null) return
		await this.alarms.setWakeup(BURST_WAKEUP, debounce("typing", this.now(), startedAt))
	}

	/** The window's messages in send order. */
	envelopes(roomId: RoomId, limit = MAX_DELIVERY_ENVELOPES): Pending[] {
		return this.sql
			.exec<Row>("SELECT id, seq, at, text, reply_to, mentions FROM pending ORDER BY seq LIMIT ?", limit)
			.toArray()
			.map((r) => ({
				envelope: {
					id: envelopeId(r.id),
					roomId,
					from: { kind: "human" },
					body: r.text,
					...(r.reply_to ? { replyTo: r.reply_to as Envelope["replyTo"] } : {}),
					hop: 0,
					rootId: r.id,
					seq: r.seq,
				},
				mentions: JSON.parse(r.mentions) as string[],
			}))
	}

	delivered(envelopes: readonly Envelope[]): void {
		this.sql.exec("DELETE FROM pending WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(envelopes.map(e=>e.rootId)))
	}

	clear(): void {
		this.sql.exec("DELETE FROM pending")
	}

	async retry(ms: number): Promise<void> {
		if (this.pending()) await this.alarms.setWakeup(BURST_WAKEUP, this.now() + ms)
	}
}

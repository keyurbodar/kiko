import type { Envelope, Message, RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import { MAX_ENTRY_BYTES, MAX_OPEN } from "@yuki/agent/inbox"

export const BURST_WAKEUP = "burst"

export const AFTER_MESSAGE_MS = 1_000
export const AFTER_TYPING_MS = 2_500
export const AFTER_FRAGMENT_MS = 2_500
export const MAX_BURST_MS = 8_000

type Row = { id: string; seq: number; at: number; text: string; reply_to: string | null }

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

export const MAX_DELIVERY_ENVELOPES = MAX_OPEN / 5
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
		this.sql.exec("CREATE INDEX IF NOT EXISTS pending_at ON pending (at)")
	}

	pending(): boolean {
		return this.startedAt() !== null
	}

	private startedAt(): number | null {
		return this.sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM pending").one().at
	}

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

	async typing(): Promise<void> {
		const startedAt = this.startedAt()
		if (startedAt === null) return
		await this.alarms.setWakeup(BURST_WAKEUP, debounce("typing", this.now(), startedAt))
	}

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

	delivered(envelopes: readonly Envelope[]): void {
		for (const e of envelopes) this.sql.exec("DELETE FROM pending WHERE id = ?", e.rootId)
	}

	clear(): void {
		this.sql.exec("DELETE FROM pending")
	}

	async retry(ms: number): Promise<void> {
		if (this.startedAt() !== null) await this.alarms.setWakeup(BURST_WAKEUP, this.now() + ms)
	}
}

import type { AgentSlug, Envelope, RoomEvent, RunRef } from "@kiko/protocol"
import type { RoomLog } from "./log"
import { type RecipientMember, resolveRecipients } from "./recipients"
import { parseRichText } from "./rich-text"

/**
 * Architecture section 7.2 over a human burst. Each envelope goes to the members `resolveRecipients`
 * picks for it, and each member gets its own envelopes in one `receive()` call. A member that is not
 * in the result is not woken. `replyAuthor` names the agent whose bubble a message replies to.
 */
export function route(
	envelopes: readonly Envelope[],
	members: readonly RecipientMember[],
	replyAuthor: (messageId: string) => AgentSlug | undefined,
): Map<AgentSlug, Envelope[]> {
	const out = new Map<AgentSlug, Envelope[]>()
	for (const e of envelopes) {
		const replyToAgent = e.replyTo ? replyAuthor(e.replyTo) : undefined
		for (const slug of resolveRecipients({ text: e.body, ...(replyToAgent ? { replyToAgent } : {}) }, members)) {
			out.set(slug, [...(out.get(slug) ?? []), e])
		}
	}
	return out
}

// Architecture section 14. Deliveries from outside the room (reminders today) arrive
// at least once. Each has a stable id, and `deliveries` remembers every id the room
// has stored, so a repeat stores and sends nothing.

export type ReminderDelivery = {
	text: string
	/** `human`, or the agent slug the reminder is for. */
	target: string
}

export class Deliveries {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		storage.sql.exec("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	seen(id: string): boolean {
		return this.storage.sql.exec("SELECT 1 FROM deliveries WHERE id = ?", id).toArray().length > 0
	}

	/**
	 * Stores a reminder as a message from `system:reminder`. Returns the event to
	 * publish, or null when the id was delivered before.
	 *
	 * ASSUMPTION: an agent-target reminder is also a room message for now, addressed
	 * to the agent by name. The envelope to the agent's inbox comes with the delivery task.
	 */
	reminder(id: string, reminder: ReminderDelivery): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const text = reminder.target === "human" ? `reminder: ${reminder.text}` : `reminder for @${reminder.target}: ${reminder.text}`
			const { event } = this.log.addMessage({ from: { kind: "system", reason: "reminder" }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}
}

// Architecture section 6.3. An agent posts each closed block of its answer with the key
// `(runId, attempt, index)`. A repeated post stores nothing. A post with a higher attempt
// first deletes the bubbles of the earlier attempts of that run, because a run that
// restarted after a crash may write different text. A post from an older attempt is late
// and stores nothing.

/** The `UserDO.touchChat` argument after a run. */
export type Touch = { lastSeq: number; lastPreview: string; unread: number }

export class Bubbles {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		this.sql = storage.sql
		this.sql.exec("CREATE TABLE IF NOT EXISTS ended_runs (run_id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	/** Stores one bubble. Returns the events to publish: none for a repeat or a late attempt. */
	post(slug: AgentSlug, run: RunRef, block: string): RoomEvent[] {
		const latest = this.sql
			.exec<{ attempt: number | null }>("SELECT max(run_attempt) AS attempt FROM messages WHERE run_id = ?", run.runId)
			.one().attempt
		if (latest !== null && run.attempt < latest) return []
		const from = { kind: "agent", slug } as const
		const events: RoomEvent[] = []
		const earlier = this.log.earlierAttempts(run.runId, run.attempt)
		const deleted = earlier.length ? this.log.deleteMessages(earlier, from) : null
		if (deleted) events.push(deleted)
		const { event } = this.log.addMessage({ from, text: block, rich: parseRichText(block), run })
		if (event) events.push(event)
		return events
	}

	/** True once `markEnded` ran for the run. */
	ended(runId: string): boolean {
		return this.sql.exec("SELECT 1 FROM ended_runs WHERE run_id = ?", runId).toArray().length > 0
	}

	markEnded(runId: string): void {
		this.sql.exec("INSERT OR IGNORE INTO ended_runs (run_id, at) VALUES (?, ?)", runId, Date.now())
	}

	/** The chat list row after a run: the newest live message and the count of unread messages not from the human. */
	touch(): Touch {
		const last = this.sql
			.exec<{ text: string }>("SELECT text FROM messages WHERE deleted_at IS NULL ORDER BY seq DESC LIMIT 1")
			.toArray()[0]
		const { unread } = this.sql
			.exec<{ unread: number }>(
				"SELECT count(*) AS unread FROM messages WHERE deleted_at IS NULL AND seq > ? AND json_extract(sender, '$.kind') != 'human'",
				this.log.readSeq(),
			)
			.one()
		return { lastSeq: this.log.lastSeq(), lastPreview: last?.text ?? "", unread }
	}
}

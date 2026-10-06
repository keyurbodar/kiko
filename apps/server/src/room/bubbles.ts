import type { AgentSlug, MessageId, RoomEvent, RunRef } from "@kiko/protocol"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"

// Architecture section 6.3. An agent posts each closed block of its answer with the key
// `(runId, attempt, index)`. A repeated post stores nothing. A post with a higher attempt
// first deletes the bubbles of the earlier attempts of that run, because a run that
// restarted after a crash may write different text. A post from an older attempt is late
// and stores nothing.

const REPLY_TAG = /^\[reply:([^\]\s]+)\]\s*/

/**
 * An agent answers one message inline, as a Telegram reply, by starting a bubble with
 * `[reply:<messageId>]`. The tag never shows: it becomes the bubble's `replyTo`, which the room keeps
 * only when the message exists.
 */
export function replyTag(block: string): { text: string; replyTo?: string } {
	const m = REPLY_TAG.exec(block)
	return m ? { text: block.slice(m[0].length).trim(), replyTo: m[1]! } : { text: block }
}

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
	post(slug: AgentSlug, run: RunRef, block: string, tainted = false): RoomEvent[] {
		const latest = this.sql
			.exec<{ attempt: number | null }>("SELECT max(run_attempt) AS attempt FROM messages WHERE run_id = ?", run.runId)
			.one().attempt
		if (latest !== null && run.attempt < latest) return []
		const from = { kind: "agent", slug } as const
		const events: RoomEvent[] = []
		const earlier = this.log.earlierAttempts(run.runId, run.attempt)
		const deleted = earlier.length ? this.log.deleteMessages(earlier, from) : null
		if (deleted) events.push(deleted)
		const { text, replyTo } = replyTag(block)
		if (!text) return events
		const target = replyTo && this.log.message(replyTo) ? { replyTo: replyTo as MessageId } : {}
		const { event } = this.log.addMessage({ from, text, rich: parseRichText(text), run, tainted, ...target })
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
}

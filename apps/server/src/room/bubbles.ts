import type { AgentSlug, MessageId, RoomEvent, RunRef } from "@yuki/protocol"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"

// Architecture section 6.3. An agent posts each closed block of its answer with the key
// `(runId, attempt, index)`. A repeated post stores nothing. A run that restarted after a crash
// posts its blocks again under a higher attempt, because it may write different text. A block
// it writes again unchanged keeps its bubble where it was: deleting it and posting a copy put
// the agent's earlier messages under whatever the human sent since, as if they were replayed.
// The first block that differs deletes the earlier attempts' bubbles from its index on, and
// the run's end deletes any the restart never wrote again. A post from an older attempt is
// late and stores nothing.

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
	post(slug: AgentSlug, run: RunRef, block: string, initiative?: { reason: string }): RoomEvent[] {
		const latest = this.sql
			.exec<{ attempt: number | null }>("SELECT max(run_attempt) AS attempt FROM messages WHERE run_id = ?", run.runId)
			.one().attempt
		if (latest !== null && run.attempt < latest) return []
		const from = { kind: "agent", slug } as const
		const events: RoomEvent[] = []
		const { text, replyTo } = replyTag(block)
		const target = replyTo && this.log.message(replyTo) ? { replyTo: replyTo as MessageId } : {}
		if (text && this.log.adoptBubble(run, text, target.replyTo ?? null)) return events
		const earlier = this.log.earlierAttempts(run.runId, run.attempt, run.index)
		const deleted = earlier.length ? this.log.deleteMessages(earlier, from) : null
		if (deleted) events.push(deleted)
		// A block with nothing to draw, such as a lone `---` the splitter cut out, is not a bubble.
		const rich = parseRichText(text)
		if (!text || !rich.length) return events
		const { event } = this.log.addMessage({ from, text, rich, run, ...target, ...(initiative ? { initiative } : {}) })
		if (event) events.push(event)
		return events
	}

	/** Deletes the bubbles of earlier attempts that the run's last attempt never wrote again. */
	settle(slug: AgentSlug, runId: string): RoomEvent | null {
		const latest = this.sql
			.exec<{ attempt: number | null }>("SELECT max(run_attempt) AS attempt FROM messages WHERE run_id = ?", runId)
			.one().attempt
		if (latest === null) return null
		const stale = this.log.earlierAttempts(runId, latest)
		return stale.length ? this.log.deleteMessages(stale, { kind: "agent", slug }) : null
	}

	/** True once `markEnded` ran for the run. */
	ended(runId: string): boolean {
		return this.sql.exec("SELECT 1 FROM ended_runs WHERE run_id = ?", runId).toArray().length > 0
	}

	markEnded(runId: string): void {
		this.sql.exec("INSERT OR IGNORE INTO ended_runs (run_id, at) VALUES (?, ?)", runId, Date.now())
	}
}

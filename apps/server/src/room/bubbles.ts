import type { AgentSlug, MessageId, RoomEvent, RunRef } from "@kiko/protocol"
import { RECENT_MESSAGES } from "./message-position"
import type { RoomLog } from "./log"
import { type ImageFile, parseRichText } from "@kiko/protocol/markdown"


const REPLY_TAG = /^\[reply:([^\]\s]+)\]\s*/

export function replyTag(block: string): { text: string; replyTo?: string } {
	const m = REPLY_TAG.exec(block)
	const replyTo = m?.[1]
	return m && replyTo !== undefined ? { text: block.slice(m[0].length).trim(), replyTo } : { text: block }
}

export class Bubbles {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly log: RoomLog,
		private readonly imageFile: ImageFile,
	) {
		this.sql = storage.sql
	}

	post(slug: AgentSlug, run: RunRef, block: string, initiative?: { reason: string }): RoomEvent[] {
		const latest = this.sql
			.exec<{ attempt: number | null }>(`SELECT MAX(run_attempt) AS attempt FROM ${RECENT_MESSAGES} WHERE run_id = ?`, this.log.roomId, run.runId)
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
		const rich = parseRichText(text, this.imageFile)
		if (!text || !rich.length) return events
		const { event } = this.log.addMessage({ from, text, rich, run, ...target, ...(initiative ? { initiative } : {}) })
		if (event) events.push(event)
		return events
	}

	settle(slug: AgentSlug, runId: string): RoomEvent | null {
		const latest = this.sql
			.exec<{ attempt: number | null }>(`SELECT MAX(run_attempt) AS attempt FROM ${RECENT_MESSAGES} WHERE run_id = ?`, this.log.roomId, runId)
			.one().attempt
		if (latest === null) return null
		const stale = this.log.earlierAttempts(runId, latest)
		return stale.length ? this.log.deleteMessages(stale, { kind: "agent", slug }) : null
	}

	ended(runId: string): boolean {
		return this.sql.exec(`SELECT 1 FROM ${RECENT_MESSAGES} WHERE run_id = ? LIMIT 1`, this.log.roomId, runId).toArray().length > 0
	}
}

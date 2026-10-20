import type { AgentSlug, MessageId, RoomEvent } from "@kiko/protocol"
import { escapeXml } from "@kiko/agent/text"
import type { Pending } from "./burst"
import type { RoomLog } from "./log"

const ALLOWED = [
	"👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "🙏", "👏", "🎉", "🤔", "👀", "💯", "✅", "👌", "🙌",
	"😁", "😅", "🥰", "😍", "🤯", "🤝", "💪", "🫡", "✍️", "⚡", "🏆", "👋", "😎", "🤣", "😊", "❤️‍🔥",
] as const

const bare = (emoji: string) => emoji.replace(/[︎️]|\uD83C[\uDFFB-\uDFFF]/g, "")
const CANONICAL = new Map<string, string>(ALLOWED.map((e) => [bare(e), e]))

function allowedReaction(emoji: string): string | null {
	return CANONICAL.get(bare(emoji.trim())) ?? null
}

export function defaultTarget(sql: SqlStorage, roomId: string, pending: readonly Pending[]): MessageId | null {
	const row = sql
		.exec<{ id: string }>(
			"SELECT id FROM messages WHERE (deleted_at IS NULL AND JSON_EXTRACT(sender, '$.kind') = 'human' AND NOT id IN (SELECT value FROM json_each(?2))) AND messages.room_id = ?1 ORDER BY seq DESC LIMIT 1", roomId, JSON.stringify(pending.map(({ envelope }) => envelope.rootId)),
		)
		.toArray()[0]
	return (row?.id as MessageId | undefined) ?? null
}

export function agentReact(log: RoomLog, sql: SqlStorage, slug: AgentSlug, emoji: string, messageId: string | undefined, pending: readonly Pending[], deliveryId: string): RoomEvent | null {
  if (log.reactionDelivered(deliveryId)) return null
	const allowed = allowedReaction(emoji)
	if (!allowed) return null
	const target = (messageId as MessageId | undefined) ?? defaultTarget(sql, log.roomId, pending)
	if (!target) return null
	return log.react(target, { kind: "agent", slug }, allowed, deliveryId)
}

const cursorKey = (slug: AgentSlug) => `reactions_briefed:${slug}`
const MAX_LINES = 10
const QUOTE = 60

export type ReactionNote = { by: string; emoji: string; text: string }

const MAX_REACTIONS_BYTES = 1024

function reactionLines(notes: readonly ReactionNote[]): string | null {
	if (!notes.length) return null
	const kept: string[] = []
	let bytes = 0
	let left = notes.length
	for (const { by, emoji, text } of [...notes].reverse()) {
		const quote = text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text
		const line = `- ${by} reacted ${emoji} to your "${quote}"`
		const size = new TextEncoder().encode(escapeXml(line)).length + 1
		if (kept.length === MAX_LINES || bytes + size > MAX_REACTIONS_BYTES) break
		kept.unshift(line)
		bytes += size
		left--
	}
	if (left) kept.unshift(`- and ${left} more`)
	return `reactions since your last turn:\n${kept.join("\n")}`
}

export function reactionBrief(log: RoomLog, sql: SqlStorage, slug: AgentSlug): { text: string | null; upTo: number } {
	const since = Number(log.meta(cursorKey(slug)) ?? 0)
	const upTo = sql.exec<{ seq: number }>("SELECT coalesce(max(seq), 0) AS seq FROM events WHERE room_id = ? AND kind = 'react'", log.roomId).one().seq
	const rows = sql
		.exec<{ actor: string; emoji: string; text: string }>(
			"SELECT r.actor, r.emoji, m.text FROM reactions AS r JOIN messages AS m ON m.room_id = r.room_id AND m.seq = CAST(r.message_id AS INTEGER) AND m.id = r.message_id WHERE ((m.deleted_at IS NULL AND JSON_EXTRACT(m.sender, '$.kind') = 'agent' AND JSON_EXTRACT(m.sender, '$.slug') = ?1 AND r.actor <> ?2 AND EXISTS(SELECT 1 FROM events AS e WHERE (e.kind = 'react' AND e.seq > ?3 AND e.actor = r.actor AND JSON_EXTRACT(e.payload, '$.messageId') = r.message_id) AND e.room_id = ?4)) AND r.room_id = ?4) AND m.room_id = ?4 ORDER BY r.at",
			slug,
			`agent:${slug}`,
			since, log.roomId,
		)
		.toArray()
	const notes = rows.map((r) => ({ by: r.actor === "human" ? "the human" : `@${r.actor.slice("agent:".length)}`, emoji: r.emoji, text: r.text }))
	return { text: reactionLines(notes), upTo }
}

export function markReactionsBriefed(log: RoomLog, slug: AgentSlug, upTo: number): void {
	if (upTo > Number(log.meta(cursorKey(slug)) ?? 0)) log.setMeta(cursorKey(slug), String(upTo))
}

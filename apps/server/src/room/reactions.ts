import type { AgentSlug, MessageId, RoomEvent } from "@yuki/protocol"
import type { RoomLog } from "./log"

const ALLOWED = [
	"👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "🙏", "👏", "🎉", "🤔", "👀", "💯", "✅", "👌", "🙌",
	"😁", "😅", "🥰", "😍", "🤯", "🤝", "💪", "🫡", "✍️", "⚡", "🏆", "👋", "😎", "🤣", "😊", "❤️‍🔥",
] as const

const bare = (emoji: string) => emoji.replace(/[︎️]|\uD83C[\uDFFB-\uDFFF]/g, "")
const CANONICAL = new Map<string, string>(ALLOWED.map((e) => [bare(e), e]))

export function allowedReaction(emoji: string): string | null {
	return CANONICAL.get(bare(emoji.trim())) ?? null
}

export function defaultTarget(sql: SqlStorage): MessageId | null {
	const row = sql
		.exec<{ id: string }>(
			`SELECT id FROM messages
			 WHERE deleted_at IS NULL AND json_extract(sender, '$.kind') = 'human'
			   AND id NOT IN (SELECT id FROM pending)
			 ORDER BY seq DESC LIMIT 1`,
		)
		.toArray()[0]
	return (row?.id as MessageId | undefined) ?? null
}

export function agentReact(log: RoomLog, sql: SqlStorage, slug: AgentSlug, emoji: string, messageId?: string): RoomEvent | null {
	const allowed = allowedReaction(emoji)
	if (!allowed) return null
	const target = (messageId as MessageId | undefined) ?? defaultTarget(sql)
	if (!target) return null
	return log.react(target, { kind: "agent", slug }, allowed)
}

const cursorKey = (slug: AgentSlug) => `reactions_briefed:${slug}`
const MAX_LINES = 10
const QUOTE = 60

export type ReactionNote = { by: string; emoji: string; text: string }

export function reactionLines(notes: readonly ReactionNote[]): string | null {
	if (!notes.length) return null
	const lines = notes.slice(-MAX_LINES).map(({ by, emoji, text }) => {
		const quote = text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text
		return `- ${by} reacted ${emoji} to your "${quote}"`
	})
	return `reactions since your last turn:\n${lines.join("\n")}`
}

export function reactionBrief(log: RoomLog, sql: SqlStorage, slug: AgentSlug): { text: string | null; upTo: number } {
	const since = Number(log.meta(cursorKey(slug)) ?? 0)
	const upTo = log.lastSeq()
	const rows = sql
		.exec<{ actor: string; emoji: string; text: string }>(
			`SELECT r.actor, r.emoji, m.text FROM reactions r JOIN messages m ON m.id = r.message_id
			 WHERE m.deleted_at IS NULL AND json_extract(m.sender, '$.kind') = 'agent' AND json_extract(m.sender, '$.slug') = ?
			   AND r.actor != ?
			   AND EXISTS (SELECT 1 FROM events e WHERE e.kind = 'react' AND e.seq > ? AND e.actor = r.actor
			               AND json_extract(e.payload, '$.messageId') = r.message_id)
			 ORDER BY r.at`,
			slug,
			`agent:${slug}`,
			since,
		)
		.toArray()
	const notes = rows.map((r) => ({ by: r.actor === "human" ? "the human" : `@${r.actor.slice("agent:".length)}`, emoji: r.emoji, text: r.text }))
	return { text: reactionLines(notes), upTo }
}

export function markReactionsBriefed(log: RoomLog, slug: AgentSlug, upTo: number): void {
	if (upTo > Number(log.meta(cursorKey(slug)) ?? 0)) log.setMeta(cursorKey(slug), String(upTo))
}

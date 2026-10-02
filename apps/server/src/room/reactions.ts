import type { AgentSlug, MessageId, RoomEvent } from "@kiko/protocol"
import type { RoomLog } from "./log"

// Architecture section 6.5. An agent reacts inline with `[react:<emoji>]`. The splitter strips the
// tag, the outbox calls `RoomDO.react`, and this file decides what is stored. A reaction is a
// stored `react` event like a human's. It never starts a run: only a human message joins a burst.
// The author agent learns of reactions on its messages from its next brief (section 7.4).

/**
 * The emoji an agent may react with. ASSUMPTION: the quick reactions of the client's message menu
 * plus the common acks of a chat app. The model writes whatever it likes; anything else is dropped.
 */
const ALLOWED = [
	"👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "🙏", "👏", "🎉", "🤔", "👀", "💯", "✅", "👌", "🙌",
	"😁", "😅", "🥰", "😍", "🤯", "🤝", "💪", "🫡", "✍️", "⚡", "🏆", "👋", "😎", "🤣", "😊", "❤️‍🔥",
] as const

/** Variation selectors and skin tones are optional in what a model writes. */
const bare = (emoji: string) => emoji.replace(/[︎️]|\uD83C[\uDFFB-\uDFFF]/g, "")
const CANONICAL = new Map<string, string>(ALLOWED.map((e) => [bare(e), e]))

/** The stored form of an allowed emoji, or null when the emoji is not on the list. */
export function allowedReaction(emoji: string): string | null {
	return CANONICAL.get(bare(emoji.trim())) ?? null
}

/**
 * The message a reaction without an id lands on: the newest live human message the agents have
 * been handed, so a message still waiting in the burst is never the target.
 *
 * ASSUMPTION: "the last human message of the burst being answered" is read as the newest human
 * message no longer pending. A message queued behind a run that already posted a bubble (section
 * 6.2) counts as handed over, so a reaction written late in that run may land on it.
 */
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

/**
 * Stores an agent's reaction. One per agent per message: a second emoji replaces the first, the
 * same emoji again stores nothing. Returns the event to publish, or null when the emoji is not
 * allowed, the target is missing, or nothing changed.
 */
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

/** One brief line per reaction, newest last. Pure, so a test can pin the wording. */
export function reactionLines(notes: readonly ReactionNote[]): string | null {
	if (!notes.length) return null
	const lines = notes.slice(-MAX_LINES).map(({ by, emoji, text }) => {
		const quote = text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text
		return `- ${by} reacted ${emoji} to your "${quote}"`
	})
	return `reactions since your last turn:\n${lines.join("\n")}`
}

/**
 * The reactions others put on `slug`'s messages since its last brief, as brief text, and the seq
 * to pass to `markReactionsBriefed` once the delivery is admitted. A reaction later taken back is
 * left out. The delivery code (P6-01) appends `text` to the brief it builds for `slug`.
 */
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

/** The brief that carried reactions up to `upTo` was admitted. They are not repeated. */
export function markReactionsBriefed(log: RoomLog, slug: AgentSlug, upTo: number): void {
	if (upTo > Number(log.meta(cursorKey(slug)) ?? 0)) log.setMeta(cursorKey(slug), String(upTo))
}

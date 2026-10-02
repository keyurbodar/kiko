import type { Actor, MessageId, Sender, Task } from "@kiko/protocol"
import type { MemberRow } from "./members"

// Architecture section 7.4. The workspace brief the room attaches to every delivery. The agent
// prepends it to its input as a `<context>` block, so the text is for a model to read. It holds the
// room goal, the members with their status, the receiving member's tasks, and what happened in the
// room since that member's last delivery: at most 30 messages, and the reactions.

/** Section 7.4. */
export const BRIEF_MESSAGES = 30
// ASSUMPTION: a missed message is cut to this many characters in the brief. The full text is in the log.
const MAX_LINE = 400

export type BriefMessage = { id: MessageId; seq: number; from: Sender; text: string }
export type BriefReaction = { seq: number; messageId: MessageId; by: Actor; emoji: string | null }

export type BriefView = {
	/** ASSUMPTION: the chat title until the workspace stores a goal of its own. */
	goal: string
	members: readonly MemberRow[]
	/** The member's open tasks and the tasks that block them. Empty until the task board (P6-02). */
	tasks: readonly Task[]
	/** Messages since the member's last delivery, oldest first. `buildBrief` keeps the newest 30. */
	messages: readonly BriefMessage[]
	reactions: readonly BriefReaction[]
}

/** The header of the missed-message section. The fake agent of the `team-routing` suite looks for it. */
export const MISSED_HEADER = "since your last turn:"

const who = (from: Sender) => (from.kind === "human" ? "human" : from.kind === "agent" ? `@${from.slug}` : `system (${from.reason})`)
/** Message text is escaped, so it cannot close the `<context>` block or forge a tag (section 16.2). */
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const oneLine = (text: string) => {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE)}...` : flat
}

/** The brief for `member`. Pure: the room gathers the view from its tables. */
export function buildBrief(member: MemberRow, view: BriefView): string {
	const lines = [`room goal: ${oneLine(view.goal) || "none yet"}`, `you are @${member.slug}${member.lead ? ", the lead" : ""}.`, "members:"]
	for (const m of view.members) {
		const parts = [m.lead ? "lead" : null, m.role ? oneLine(m.role) : null, m.status, m.currentTask ? `on ${m.currentTask}` : null]
		lines.push(`- @${m.slug} (${m.name}): ${parts.filter(Boolean).join(", ")}`)
	}
	lines.push("your tasks:")
	if (view.tasks.length) for (const t of view.tasks) lines.push(`- ${t.id} [${t.status}] ${oneLine(t.title)}${t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : ""}`)
	else lines.push("- none")
	const missed = view.messages.slice(-BRIEF_MESSAGES)
	if (missed.length || view.reactions.length) {
		lines.push(MISSED_HEADER)
		if (view.messages.length > missed.length) lines.push("- (older messages not shown)")
		for (const m of missed) lines.push(`- [${m.id}] ${who(m.from)}: ${escape(oneLine(m.text))}`)
		for (const r of view.reactions) {
			lines.push(r.emoji === null ? `- ${who(r.by)} removed a reaction from [${r.messageId}]` : `- ${who(r.by)} reacted ${r.emoji} to [${r.messageId}]`)
		}
	}
	return lines.join("\n")
}

/**
 * Reads the view for `member` from the room's tables. Leaves out the member's own messages and
 * reactions, which it already knows, and the messages in `delivering`, which arrive as envelopes.
 */
export function readBriefView(sql: SqlStorage, member: MemberRow, members: readonly MemberRow[], goal: string, delivering: ReadonlySet<number>): BriefView {
	const rows = sql
		.exec<{ id: string; seq: number; sender: string; text: string }>(
			// One more than the brief shows, so it can say that older messages were left out.
			`SELECT id, seq, sender, text FROM messages WHERE seq > ? AND deleted_at IS NULL
			 AND NOT (json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ?) ORDER BY seq DESC LIMIT ?`,
			member.lastDeliveredSeq,
			member.slug,
			BRIEF_MESSAGES + 1 + delivering.size,
		)
		.toArray()
		.filter((r) => !delivering.has(r.seq))
		.reverse()
	const messages = rows.map((r) => ({ id: r.id as MessageId, seq: r.seq, from: JSON.parse(r.sender) as Sender, text: r.text }))
	const reactions = sql
		.exec<{ seq: number; actor: string; payload: string }>(
			"SELECT seq, actor, payload FROM events WHERE kind = 'react' AND seq > ? AND actor != ? ORDER BY seq",
			member.lastDeliveredSeq,
			`agent:${member.slug}`,
		)
		.toArray()
		.map((r) => {
			const e = JSON.parse(r.payload) as { messageId: MessageId; by: Actor; emoji: string | null }
			return { seq: r.seq, messageId: e.messageId, by: e.by, emoji: e.emoji }
		})
		.slice(-BRIEF_MESSAGES)
	return { goal, members, tasks: [], messages, reactions }
}

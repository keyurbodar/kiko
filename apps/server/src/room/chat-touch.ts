import { type ChatLast, messageLast, mentionsHuman, oneLine } from "@yuki/protocol"
import type { FileRef, Sender } from "@yuki/protocol"
import type { RoomLog } from "./log"

/** The `UserDO.touchChat` argument. */
export type Touch = { lastSeq: number; lastPreview: string; unread: number; last?: ChatLast; mentions: number; group: boolean }

/** Meta key of the newest member change (`RoomDO.memberOp`), as `MemberActivity` JSON. */
export const MEMBER_ACTIVITY = "member_activity"
/** Meta key of the human's handle (`humanHandle`), set from the session on every socket. */
export const HUMAN_HANDLE = "human_handle"
export type MemberActivity = { seq: number; at: number; kind: "joined" | "left"; name: string }

/** How many unread agent messages the mention count reads, newest first. */
const MENTION_SCAN = 500
/** A quoted message in `reacted ❤️ to "..."` is short. */
const QUOTE = 40

type Candidate = { seq: number; last: ChatLast }

/**
 * The chat list row of a room (section 9.2): its newest activity, its unread messages, and the
 * unread messages that mention the human. The newest activity is the newest of: a live message, an
 * agent's reaction to a human message that still stands, a pending approval, and a member joining
 * or leaving. A deleted newest message falls back to the one before it. Reads only; the room calls
 * it after each change and sends the result to `UserDO.touchChat`.
 */
export function chatTouch(sql: SqlStorage, log: RoomLog): Touch {
	const names = new Map(sql.exec<{ slug: string; name: string; removed_at: number | null }>("SELECT slug, name, removed_at FROM members").toArray().map((r) => [r.slug, r]))
	const nameOf = (slug: string) => names.get(slug)?.name ?? slug
	const group = [...names.values()].filter((m) => m.removed_at === null).length > 1
	const candidates: Candidate[] = []

	const message = sql
		.exec<{ seq: number; at: number; sender: string; text: string; files: string | null }>(
			"SELECT seq, at, sender, text, files FROM messages WHERE deleted_at IS NULL ORDER BY seq DESC LIMIT 1",
		)
		.toArray()[0]
	if (message) {
		const from = JSON.parse(message.sender) as Sender
		const files = message.files ? (JSON.parse(message.files) as FileRef[]) : undefined
		candidates.push({
			seq: message.seq,
			last: messageLast({ from: from.kind, ...(from.kind === "agent" ? { name: nameOf(from.slug) } : {}), text: message.text, ...(files ? { files } : {}), at: message.at }),
		})
	}

	// Only the newest agent reaction counts, and only while it still stands on a live human message.
	const react = sql
		.exec<{ seq: number; at: number; actor: string; payload: string }>("SELECT seq, at, actor, payload FROM events WHERE kind = 'react' AND actor LIKE 'agent:%' ORDER BY seq DESC LIMIT 1")
		.toArray()[0]
	if (react) {
		const { messageId, emoji } = JSON.parse(react.payload) as { messageId: string; emoji: string | null }
		const target = sql
			.exec<{ text: string; sender: string; emoji: string | null }>(
				`SELECT m.text, m.sender, (SELECT emoji FROM reactions WHERE message_id = m.id AND actor = ?) AS emoji
				 FROM messages m WHERE m.id = ? AND m.deleted_at IS NULL`,
				react.actor,
				messageId,
			)
			.toArray()[0]
		if (emoji && target && target.emoji === emoji && (JSON.parse(target.sender) as Sender).kind === "human") {
			const slug = react.actor.slice("agent:".length)
			candidates.push({ seq: react.seq, last: { from: "agent", name: nameOf(slug), kind: "react", emoji, text: oneLine(target.text, QUOTE), at: react.at } })
		}
	}

	const approval = sql
		.exec<{ seq: number; at: number; payload: string }>(
			"SELECT seq, at, payload FROM events WHERE kind = 'approval' AND json_extract(payload, '$.approval.state') = 'pending' ORDER BY seq DESC LIMIT 1",
		)
		.toArray()[0]
	if (approval) {
		const { id, slug } = (JSON.parse(approval.payload) as { approval: { id: string; slug: string } }).approval
		const open = sql.exec("SELECT 1 FROM ws_approvals WHERE id = ? AND state = 'pending'", id).toArray().length > 0
		if (open) candidates.push({ seq: approval.seq, last: { from: "agent", name: nameOf(slug), kind: "approval", at: approval.at } })
	}

	const member = log.meta(MEMBER_ACTIVITY)
	if (member) {
		const m = JSON.parse(member) as MemberActivity
		candidates.push({ seq: m.seq, last: { from: "agent", name: m.name, kind: m.kind, at: m.at } })
	}

	let last = candidates.sort((a, b) => b.seq - a.seq)[0]?.last
	if (!last && group) {
		const first = sql.exec<{ at: number }>("SELECT at FROM events ORDER BY seq LIMIT 1").toArray()[0]
		last = { from: "human", kind: "created", at: first?.at ?? 0 }
	}

	const readSeq = log.readSeq()
	const { unread } = sql
		.exec<{ unread: number }>(
			"SELECT count(*) AS unread FROM messages WHERE deleted_at IS NULL AND seq > ? AND json_extract(sender, '$.kind') != 'human'",
			readSeq,
		)
		.one()
	// A handle an agent also holds would make every tag of that agent a mention, so it counts as none.
	const stored = log.meta(HUMAN_HANDLE)
	const handle = stored && !names.has(stored) ? stored : null
	const mentions = sql
		.exec<{ text: string; reply_sender: string | null }>(
			`SELECT m.text, r.sender AS reply_sender FROM messages m LEFT JOIN messages r ON r.id = m.reply_to
			 WHERE m.deleted_at IS NULL AND m.seq > ? AND json_extract(m.sender, '$.kind') = 'agent' ORDER BY m.seq DESC LIMIT ?`,
			readSeq,
			MENTION_SCAN,
		)
		.toArray()
		.filter((m) => mentionsHuman(m.text, handle, m.reply_sender !== null && (JSON.parse(m.reply_sender) as Sender).kind === "human")).length

	return { lastSeq: log.lastSeq(), lastPreview: message?.text ?? "", unread, ...(last ? { last } : {}), mentions, group }
}

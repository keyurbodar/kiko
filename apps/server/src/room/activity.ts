import { type ChatLast, messageLast, mentionsHuman, oneLine, type RichText } from "@kiko/protocol"
import type { FileRef, Sender } from "@kiko/protocol"
import { LISTED_MESSAGE, type RoomLog } from "./log"

type RoomActivity = { lastSeq: number; lastPreview: string; unread: number; last?: ChatLast; mentions?: number; group: boolean }

export const MEMBER_ACTIVITY = "member_activity"
export const HUMAN_HANDLE = "human_handle"
export type MemberActivity = { seq: number; at: number; kind: "joined" | "left"; name: string }

const MENTION_SCAN = 500
const QUOTE = 40

type Candidate = { seq: number; last: ChatLast }

type Posted = { seq: number; at: number; from: Sender; text: string; to?: unknown; rich?: RichText | undefined; files?: readonly FileRef[] | undefined }

function messageCandidate(m: Posted, nameOf: (slug: string) => string): Candidate {
	const { from, files } = m
	return {
		seq: m.seq,
		last: messageLast({
			from: from.kind,
			...(from.kind === "agent" ? { name: nameOf(from.slug) } : {}),
			text: m.text,
			...(m.rich ? { rich: m.rich, mentionName: nameOf } : {}),
			...(files?.length ? { files } : {}),
			at: m.at,
		}),
	}
}

/** The touch for one bubble that just landed: no scan, so a bubble in a long run costs the same as the first. Mentions stay as they are until the run ends. Mail between agents is counted but not quoted as the last line. */
function bubbleTouch(sql: SqlStorage, log: RoomLog, row: Posted): RoomActivity {
	const name = (slug: string) => sql.exec<{ name: string }>("SELECT name FROM members WHERE slug = ?1 AND members.room_id = ?2", slug, log.roomId).toArray()[0]?.name ?? slug
	const group = (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL AND members.room_id = ?1", log.roomId).one().n ?? 0) > 1
	return { lastSeq: log.lastSeq(), lastPreview: row.text, unread: log.unread(), ...(row.to === undefined ? { last: messageCandidate(row, name).last } : {}), group }
}

export function roomActivity(sql: SqlStorage, log: RoomLog): RoomActivity {
	const names = new Map(
		sql
			.exec<{ slug: string; name: string; removed_at: number | null }>("SELECT slug, name, removed_at FROM members WHERE members.room_id = ?1", log.roomId)
			.toArray()
			.map((r) => [r.slug, r]),
	)
	const nameOf = (slug: string) => names.get(slug)?.name ?? slug
	const group = [...names.values()].filter((m) => m.removed_at === null).length > 1
	const candidates: Candidate[] = []

	const message = sql
		.exec<{ seq: number; at: number; sender: string; text: string; rich: string | null; files: string | null }>(
			`SELECT seq, at, sender, text, rich, files FROM messages WHERE (deleted_at IS NULL AND ${LISTED_MESSAGE}) AND messages.room_id = ?1 ORDER BY seq DESC LIMIT 1`, log.roomId,
		)
		.toArray()[0]
	if (message)
		candidates.push(
			messageCandidate(
				{
					...message,
					from: JSON.parse(message.sender) as Sender,
					rich: message.rich ? (JSON.parse(message.rich) as RichText) : undefined,
					files: message.files ? (JSON.parse(message.files) as FileRef[]) : undefined,
				},
				nameOf,
			),
		)

	const react = sql
		.exec<{ seq: number; at: number; actor: string; payload: string }>(
			"SELECT seq, at, actor, payload FROM events WHERE (kind = 'react' AND actor LIKE 'agent:%') AND events.room_id = ?1 ORDER BY seq DESC LIMIT 1", log.roomId,
		)
		.toArray()[0]
	if (react) {
		const { messageId, emoji } = JSON.parse(react.payload) as { messageId: string; emoji: string | null }
		const target = sql
			.exec<{ text: string; sender: string; emoji: string | null }>(
				"SELECT m.text, m.sender, (SELECT emoji FROM reactions WHERE (message_id = m.id AND actor = ?1) AND reactions.room_id = ?3) AS emoji FROM messages AS m WHERE (m.id = ?2 AND m.deleted_at IS NULL) AND m.room_id = ?3",
				react.actor,
				messageId, log.roomId,
			)
			.toArray()[0]
		if (emoji && target && target.emoji === emoji && (JSON.parse(target.sender) as Sender).kind === "human") {
			const slug = react.actor.slice("agent:".length)
			candidates.push({ seq: react.seq, last: { from: "agent", name: nameOf(slug), kind: "react", emoji, text: oneLine(target.text, QUOTE), at: react.at } })
		}
	}

	const member = log.meta(MEMBER_ACTIVITY)
	if (member) {
		const m = JSON.parse(member) as MemberActivity
		candidates.push({ seq: m.seq, last: { from: "agent", name: m.name, kind: m.kind, at: m.at } })
	}

	let last = candidates.sort((a, b) => b.seq - a.seq)[0]?.last
	if (!last && group) {
		const first = sql.exec<{ at: number }>("SELECT at FROM events WHERE events.room_id = ?1 ORDER BY seq LIMIT 1", log.roomId).toArray()[0]
		last = { from: "human", kind: "created", at: first?.at ?? 0 }
	}

	const readSeq = log.readSeq()
	const unread = log.unread()
	const stored = log.meta(HUMAN_HANDLE)
	const handle = stored && !names.has(stored) ? stored : null
	const mentions = sql
		.exec<{ text: string; reply_sender: string | null }>(
			"SELECT m.text, r.sender AS reply_sender FROM messages AS m LEFT JOIN messages AS r ON r.id = m.reply_to AND r.room_id = ?3 WHERE (m.deleted_at IS NULL AND m.seq > ?1 AND JSON_EXTRACT(m.sender, '$.kind') = 'agent' AND m.addressed IS NULL) AND m.room_id = ?3 ORDER BY m.seq DESC LIMIT ?2",
			readSeq,
			MENTION_SCAN, log.roomId,
		)
		.toArray()
		.filter((m) => mentionsHuman(m.text, handle, m.reply_sender !== null && (JSON.parse(m.reply_sender) as Sender).kind === "human")).length

	return { lastSeq: log.lastSeq(), lastPreview: message?.text ?? "", unread, ...(last ? { last } : {}), mentions, group }
}

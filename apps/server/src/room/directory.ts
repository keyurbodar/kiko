import type { OwnerServices } from "../owner/services"
import type { Chat, ChatLast, ChatOp, RoomId } from "@kiko/protocol"

const MAX_TITLE = 200
const MAX_AGENTS = 20

export type Touch = {
	lastSeq: number
	lastPreview: string
	unread: number
	/** The newest activity. Absent from a room that predates it. */
	last?: ChatLast
	mentions?: number
	group?: boolean
}

export type ChatChange = { t: "chat"; chat: Chat } | { t: "chat_removed"; roomId: RoomId }

const clip = (text: string, max: number) => text.trim().slice(0, max)

export class RoomDirectory {
	constructor(
		private readonly sql: SqlStorage,
		private readonly services: OwnerServices,
	) {}
	get(roomId: string): Chat | null {
		if (!this.sql.exec("SELECT 1 FROM room_directory WHERE room_id = ?", roomId).toArray().length) return null
		return this.services.room(roomId).chatView()
	}
	list(includePairs = false): Chat[] {
		return this.sql
			.exec<{ room_id: string }>("SELECT room_id FROM room_directory")
			.toArray()
			.flatMap((row) => {
				const chat = this.get(row.room_id)
				return chat && (includePairs || !chat.pair) ? [chat] : []
			})
			.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.roomId.localeCompare(b.roomId))
	}
	search(query: string): Chat[] {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
		return words.length
			? this.list()
					.filter((c) => words.every((w) => c.title.toLowerCase().includes(w)))
					.slice(0, 50)
			: []
	}
	apply(op: ChatOp, now: number, pair = false): ChatChange | null {
		const chat = next(this.get(op.roomId), op, now, pair)
		if (chat === null) return null
		if (chat === undefined) {
			this.sql.exec("DELETE FROM room_directory WHERE room_id = ?", op.roomId)
			return { t: "chat_removed", roomId: op.roomId }
		}
		this.sql.exec("INSERT OR IGNORE INTO room_directory (room_id) VALUES (?)", op.roomId)
		this.services.room(op.roomId).saveChat(chat)
		return { t: "chat", chat: this.get(op.roomId)! }
	}
	agents(roomId: string, agents: readonly string[]): ChatChange | null {
		const current = this.get(roomId)
		if (!current) return null
		const ids = agentIds(agents)
		if ((current.agents ?? []).length === ids.length && ids.every((id) => current.agents?.includes(id))) return null
		this.services.room(roomId).saveChat({ ...current, agents: ids })
		return { t: "chat", chat: this.get(roomId)! }
	}
}

function next(current: Chat | null, op: ChatOp, now: number, pair: boolean): Chat | null | undefined {
	switch (op.op) {
		case "create":
			if (current) return null
			return {
				roomId: op.roomId,
				title: clip(op.title, MAX_TITLE),
				pinned: false,
				muted: false,
				lastSeq: 0,
				lastPreview: "",
				unread: 0,
				updatedAt: now,
				...(op.agents?.length ? { agents: agentIds(op.agents) } : {}),
				...(pair ? { pair: true as const, private: true as const } : {}),
			}
		case "rename": {
			const title = clip(op.title, MAX_TITLE)
			if (!current || current.title === title) return null
			return current.group ? { ...current, title, last: { from: "human", kind: "renamed", text: title, at: now }, updatedAt: now } : { ...current, title }
		}
		case "pin":
			return current && current.pinned !== op.pinned ? { ...current, pinned: op.pinned } : null
		case "mute":
			return current && current.muted !== op.muted ? { ...current, muted: op.muted } : null
		case "private":
			return current && (current.private ?? false) !== op.private ? { ...current, ...(op.private ? { private: true } : { private: undefined }) } : null
		case "delete":
			return current ? undefined : null
	}
}

/** Distinct ids, capped. A chat's agents are a set: a repeat adds nothing. */
const agentIds = (agents: readonly string[]): string[] => [...new Set(agents.map((id) => id.slice(0, 64)))].slice(0, MAX_AGENTS)

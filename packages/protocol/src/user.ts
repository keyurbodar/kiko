// Architecture section 9.1. The frames on the user socket. It resumes by a
// per-user sequence, the same way the room socket does.
//
// This file covers the chat index. Reminders, provider sign-in, settings, and
// memory join these unions in the tasks that build them.

import type { RoomId } from "./ids"
import type { MemoryOp, MemoryResult } from "./memory"

/** One row of the chat list. */
export type Chat = {
	roomId: RoomId
	title: string
	pinned: boolean
	muted: boolean
	/** The room's sequence at the end of its last run. */
	lastSeq: number
	lastPreview: string
	unread: number
	/** Epoch milliseconds. */
	updatedAt: number
}

// ASSUMPTION: chat edits travel on the user socket as one `chat` frame, the
// way task edits travel on the room socket.
export type ChatOp =
	| { op: "create"; roomId: RoomId; title: string }
	| { op: "rename"; roomId: RoomId; title: string }
	| { op: "pin"; roomId: RoomId; pinned: boolean }
	| { op: "mute"; roomId: RoomId; muted: boolean }
	| { op: "delete"; roomId: RoomId }

type Stored = {
	/** Only increases for a user. */
	seq: number
	/** Epoch milliseconds. */
	at: number
}

/** A stored change in a user's own data. */
export type UserEvent =
	/** A chat was added or changed. */
	| (Stored & { t: "chat"; chat: Chat })
	| (Stored & { t: "chat_removed"; roomId: RoomId })
	/** The user's theme changed. `theme` is the theme JSON text, or null after a reset. */
	| (Stored & { t: "theme"; theme: string | null })

export type UserSnapshot = {
	/** The sequence this snapshot is current to. */
	seq: number
	chats: readonly Chat[]
	/** The stored theme JSON text, or null when the user has none. */
	theme?: string | null
}

export type ClientToUser =
	| { t: "hello"; lastSeq: number }
	| { t: "chat"; op: ChatOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	/** Saves the user's one theme (JSON text, 32 KB at most), or clears it with null. */
	| { t: "theme"; theme: string | null }
	/** Searches chat titles. Message text is searched per room. */
	| { t: "search"; query: string }

export type UserToClient =
	| { t: "events"; events: readonly UserEvent[] }
	/** Sent when `lastSeq` is too old to replay. */
	| { t: "reset"; snapshot: UserSnapshot }
	/** The answer to one `memory` request. Sent only to the socket that asked. */
	| { t: "memory_result"; reqId: string; result: MemoryResult }
	/** Not stored. The answer to `search` for one socket, best match first. */
	| { t: "search"; query: string; chats: readonly Chat[] }

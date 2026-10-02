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

export type UserSnapshot = {
	/** The sequence this snapshot is current to. */
	seq: number
	chats: readonly Chat[]
}

/**
 * A user's Executor Cloud connection as the client may see it. Architecture section 12.1.
 * It never holds a token or a key.
 */
export type ExecutorStatus = {
	connected: boolean
	kind: "oauth" | "api_key" | null
	/** A sign-in was started and its callback has not arrived yet. */
	pending: boolean
	/** Epoch milliseconds when the access token expires. Null when unknown. */
	expiresAt: number | null
	/** Epoch milliseconds when the access token was issued or last refreshed. Null when unknown. */
	issuedAt: number | null
	/** True when a refresh token is stored. */
	refreshable: boolean
	/** The Executor organization the connection belongs to. Absent until the server reports it. */
	organization?: string
	/** How many sealed Executor rows the user has. Zero after a disconnect. */
	rows: number
}

export type ExecutorResult =
	| {
			ok: true
			status: ExecutorStatus
			/** After `connectExecutor` without a key: open this to sign in at Executor. */
			authorizeUrl?: string
			/** After `executorStatus` with `tools`: the names `tools/list` returned. */
			tools?: readonly string[]
	  }
	| { ok: false; error: string }

export type ClientToUser =
	| { t: "hello"; lastSeq: number }
	| { t: "chat"; op: ChatOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	/** Searches chat titles. Message text is searched per room. */
	| { t: "search"; query: string }
	/** Starts the Executor sign-in, or stores a pasted Executor API key. */
	| { t: "connectExecutor"; reqId: string; apiKey?: string }
	/** Deletes every Executor row for the user. */
	| { t: "disconnectExecutor"; reqId: string }
	/** `refresh` forces a token refresh. `tools` calls `tools/list` with the stored credential. */
	| { t: "executorStatus"; reqId: string; refresh?: boolean; tools?: boolean }

export type UserToClient =
	| { t: "events"; events: readonly UserEvent[] }
	/** Sent when `lastSeq` is too old to replay. */
	| { t: "reset"; snapshot: UserSnapshot }
	/** The answer to one `memory` request. Sent only to the socket that asked. */
	| { t: "memory_result"; reqId: string; result: MemoryResult }
	/** Not stored. The answer to `search` for one socket, best match first. */
	| { t: "search"; query: string; chats: readonly Chat[] }
	/**
	 * The answer to one Executor request, sent only to the socket that asked. Without
	 * `reqId` it goes to every socket, when a sign-in finishes in the browser.
	 */
	| { t: "executor"; reqId?: string; result: ExecutorResult }

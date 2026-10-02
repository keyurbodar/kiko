// Architecture section 9.1. The frames on the user socket. It resumes by a
// per-user sequence, the same way the room socket does.
//
// This file covers the chat index. Reminders, provider sign-in, settings, and
// memory join these unions in the tasks that build them.

import type { AgentSlug, RoomId } from "./ids"
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
	/** The ids of the agents the chat was created with. Absent for a chat made without any. */
	agents?: readonly string[]
}

/**
 * One of the user's agents. A user-level record: a name, a handle, a one-line prompt,
 * and a model reference. The room-side membership comes with the team tasks.
 */
export type Agent = {
	id: string
	name: string
	slug: AgentSlug
	prompt: string
	/** A `provider/model` reference from the catalog. */
	model: string
}

export type AgentOp = { op: "create"; agent: Agent }

// ASSUMPTION: chat edits travel on the user socket as one `chat` frame, the
// way task edits travel on the room socket.
export type ChatOp =
	| { op: "create"; roomId: RoomId; title: string; agents?: readonly string[] }
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
	/** An agent was added. */
	| (Stored & { t: "agent"; agent: Agent })
	/** The user's theme changed. `theme` is the theme JSON text, or null after a reset. */
	| (Stored & { t: "theme"; theme: string | null })

export type UserSnapshot = {
	/** The sequence this snapshot is current to. */
	seq: number
	chats: readonly Chat[]
	agents?: readonly Agent[]
	/** The stored theme JSON text, or null when the user has none. */
	theme?: string | null
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
	| { t: "agent"; op: AgentOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	/** Saves the user's one theme (JSON text, 32 KB at most), or clears it with null. */
	| { t: "theme"; theme: string | null }
	/** Searches chat titles. Message text is searched per room. */
	| { t: "search"; query: string }
	/** Starts the Executor sign-in, or stores a pasted Executor API key. */
	| { t: "connectExecutor"; reqId: string; apiKey?: string }
	/** Deletes every Executor row for the user. */
	| { t: "disconnectExecutor"; reqId: string }
	/** `refresh` forces a token refresh. `tools` calls `tools/list` with the stored credential. */
	| { t: "executorStatus"; reqId: string; refresh?: boolean; tools?: boolean }
	/** Starts a provider sign-in (architecture 11.4). `loginId` is the client's own id for it. */
	| { t: "login.start"; loginId: string; provider: string }
	/** The answer to one `login.prompt`. */
	| { t: "login.answer"; loginId: string; promptId: string; value: string }
	/** The user gave up. Closing the socket does the same. */
	| { t: "login.cancel"; loginId: string }

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
	// Provider sign-in. Not stored. Sent only to the socket that started the login.
	| { t: "login.notify"; loginId: string; event: LoginEvent }
	| { t: "login.prompt"; loginId: string; promptId: string; prompt: LoginPrompt }
	/** The credential is stored. `provider` is the row the credentials list shows, never a token. */
	| { t: "login.done"; loginId: string; provider: { provider: string; kind: "api_key" | "oauth"; last4: string } }
	| { t: "login.error"; loginId: string; reason: LoginErrorReason; message: string }

/** What a sign-in flow tells the user. The same shapes as pi-ai's `AuthEvent`. */
export type LoginEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code"
			userCode: string
			verificationUri: string
			intervalSeconds?: number
			expiresInSeconds?: number
	  }
	| { type: "progress"; message: string }

/** What a sign-in flow asks the user. The same shapes as pi-ai's `AuthPrompt`, without its signal. */
export type LoginPrompt =
	| { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }

export type LoginErrorReason =
	/** The provider has no sign-in flow that kiko runs on Workers. */
	| "unsupported"
	/** Subscription sign-in is off on this server (`PROVIDER_OAUTH`). */
	| "disabled"
	/** No login with this id is running. It finished, timed out, or the server restarted. */
	| "unknown"
	| "cancelled"
	| "timeout"
	/** The flow itself failed, for example a wrong code. */
	| "failed"

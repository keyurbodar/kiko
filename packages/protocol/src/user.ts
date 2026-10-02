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

export type ClientToUser =
	| { t: "hello"; lastSeq: number }
	| { t: "chat"; op: ChatOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	/** Searches chat titles. Message text is searched per room. */
	| { t: "search"; query: string }
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

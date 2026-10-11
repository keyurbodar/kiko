// Architecture section 9.1. The frames on the user socket. It resumes by a
// per-user sequence, the same way the room socket does.
//
// This file covers the chat index. Reminders, provider sign-in, settings, and
// memory join these unions in the tasks that build them.

import type { ChatLast } from "./activity"
import type { ExtensionInfo, ExtensionOp, ExtensionProposal, ExtensionResult } from "./extensions"
import type { AgentSlug, RoomId } from "./ids"
import type { MemoryOp, MemoryResult } from "./memory"
import type { FileOp, FileRef } from "./room"

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
	/** The user's yuki chat. It is always there and cannot be deleted. */
	yuki?: true
	/** A private chat (architecture section 7.10): agents in it save no memory, change no soul, and write nothing to /home. */
	private?: boolean
	/**
	 * A temporary chat (architecture section 7.11): what the new chat button opens. It lives in the
	 * tab strip, never in the chat list, and is deleted when its tab closes, unless it became a group.
	 */
	temp?: true
	/** The newest activity, for the row's second line. Absent on rows stored before it existed. */
	last?: ChatLast
	/** Unread messages that mention the human or reply to them. Absent when none. */
	mentions?: number
	/** More than one agent: the row names who did what. */
	group?: true
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
	| { op: "create"; roomId: RoomId; title: string; agents?: readonly string[]; temp?: true }
	/** A temporary chat became a group: it joins the list with this title and these agents. */
	| { op: "keep"; roomId: RoomId; title: string; agents: readonly string[] }
	| { op: "rename"; roomId: RoomId; title: string }
	| { op: "pin"; roomId: RoomId; pinned: boolean }
	| { op: "mute"; roomId: RoomId; muted: boolean }
	| { op: "private"; roomId: RoomId; private: boolean }
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
	// The user's drive, /home (architecture section 18.3): the same events as a room's files.
	| (Stored & { t: "file"; file: FileRef })
	| (Stored & { t: "file_removed"; ids: readonly string[] })
	| (Stored & { t: "folders"; folders: readonly string[] })
	// Extensions (architecture section 24): installed ones and installs that wait for the human.
	| (Stored & { t: "extension"; extension: ExtensionInfo })
	| (Stored & { t: "extension_removed"; name: string })
	| (Stored & { t: "extension_proposal"; proposal: ExtensionProposal })
	| (Stored & { t: "extension_proposal_removed"; id: string })

export type UserSnapshot = {
	/** The sequence this snapshot is current to. */
	seq: number
	chats: readonly Chat[]
	agents?: readonly Agent[]
	/** The stored theme JSON text, or null when the user has none. */
	theme?: string | null
	/** The user's drive, /home. */
	home: { files: readonly FileRef[]; folders: readonly string[] }
	/** The chat the user was last in, so a new device opens there. The yuki chat when that one is gone. */
	lastChat?: RoomId
	/** Installed extensions, without their code. */
	extensions?: readonly ExtensionInfo[]
	/** Installs that wait for the human, newest last. */
	proposals?: readonly ExtensionProposal[]
}

/** A user's Composio connection as the client may see it. It never holds the key. */
export type ComposioStatus = {
	connected: boolean
	/** How many Composio rows the user has. Zero after a disconnect. */
	rows: number
}

export type ComposioResult =
	| {
			ok: true
			status: ComposioStatus
			/** After `connectComposio`, or `composioStatus` with `tools`: the tools agents get, listed then learned. */
			tools?: readonly string[]
			/** With `composioStatus`'s `tools`: those agents get as `read`. */
			readOnly?: readonly string[]
	  }
	| { ok: false; error: string }

export type ClientToUser =
	| { t: "hello"; lastSeq: number }
	| { t: "chat"; op: ChatOp }
	/** The user is in this chat now. Stored, not broadcast, so the next device opens it (`lastChat`). */
	| { t: "open"; roomId: RoomId }
	| { t: "agent"; op: AgentOp }
	| { t: "memory"; reqId: string; op: MemoryOp }
	/** Saves the user's one theme (JSON text, 32 KB at most), or clears it with null. */
	| { t: "theme"; theme: string | null }
	/** Searches chat titles. Message text is searched per room. */
	| { t: "search"; query: string }
	/** Stores a pasted Composio project key once Composio accepts it and opens a session with it. */
	| { t: "connectComposio"; reqId: string; apiKey: string }
	/** Deletes every Composio row for the user. */
	| { t: "disconnectComposio"; reqId: string }
	/** `tools` lists the tools with the stored key. */
	| { t: "composioStatus"; reqId: string; tools?: boolean }
	/** Starts a provider sign-in (architecture 11.4). `loginId` is the client's own id for it. */
	| { t: "login.start"; loginId: string; provider: string }
	/** The answer to one `login.prompt`. */
	| { t: "login.answer"; loginId: string; promptId: string; value: string }
	/** The user gave up. Closing the socket does the same. */
	| { t: "login.cancel"; loginId: string }
	/** `rm`, `mv`, or `mkdir` on the user's drive. */
	| { t: "home"; op: FileOp }
	/** One change to the user's extensions, or a read of the catalog or of an extension's code. */
	| { t: "extension"; reqId: string; op: ExtensionOp }

export type UserToClient =
	| { t: "events"; events: readonly UserEvent[] }
	/** Sent when `lastSeq` is too old to replay. */
	| { t: "reset"; snapshot: UserSnapshot }
	/** The answer to one `memory` request. Sent only to the socket that asked. */
	| { t: "memory_result"; reqId: string; result: MemoryResult }
	/** Not stored. The answer to `search` for one socket, best match first. */
	| { t: "search"; query: string; chats: readonly Chat[] }
	/**
	 * The answer to one Composio request. Without `reqId` it goes to the user's other sockets,
	 * after a connect or a disconnect.
	 */
	| { t: "composio"; reqId?: string; result: ComposioResult }
	// Provider sign-in. Not stored. Sent only to the socket that started the login.
	| { t: "login.notify"; loginId: string; event: LoginEvent }
	| { t: "login.prompt"; loginId: string; promptId: string; prompt: LoginPrompt }
	/** The credential is stored. `provider` is the row the credentials list shows, never a token. */
	| { t: "login.done"; loginId: string; provider: { provider: string; kind: "api_key" | "oauth"; last4: string } }
	| { t: "login.error"; loginId: string; reason: LoginErrorReason; message: string }
	/**
	 * Not stored. Sent only to the socket whose chat `create` was a second direct chat with one
	 * agent. Nothing was made; `existing` is the agent's one direct chat.
	 */
	| { t: "chat_refused"; roomId: RoomId; existing: RoomId }
	/** Not stored. Sent only to the socket whose `home` frame changed nothing. */
	| { t: "home_refused"; op: FileOp; reason: string }
	/** Not stored. The display names of a chat's agents that are typing now, sent when the set changes. */
	| { t: "typing"; roomId: RoomId; names: readonly string[] }
	/** The answer to one `extension` frame, sent only to the socket that asked. */
	| { t: "extension_result"; reqId: string; result: ExtensionResult }

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
	/** The provider has no sign-in flow that yuki runs on Workers. */
	| "unsupported"
	/** Subscription sign-in is off on this server (`PROVIDER_OAUTH`). */
	| "disabled"
	/** No login with this id is running. It finished, timed out, or the server restarted. */
	| "unknown"
	| "cancelled"
	| "timeout"
	/** The flow itself failed, for example a wrong code. */
	| "failed"

// Architecture section 9.2. The frames on the room socket, the stored events
// they carry, and the snapshot a client gets when it is too far behind.
// Every frame is one JSON object with a `t` tag.

import type { Actor, Sender } from "./envelope"
import type { AgentSlug, MessageId, RoomId } from "./ids"
import type { RichText } from "./rich-text"

// ASSUMPTION: the three states. `typing` is the model writing text, `working`
// is a tool running. The architecture names the type and not its members.
export type AgentState = "idle" | "typing" | "working"

/** A file in the room's index. Bytes are fetched over HTTP by `id`. */
export type FileRef = {
	id: string
	name: string
	/** Bytes. */
	size: number
	/** MIME type. */
	type: string
}

/**
 * A file the human uploaded when they picked it, which the room has not claimed yet (architecture
 * section 18.1). A `send` names it, and the room moves it into the chat's files as it stores the message.
 */
export type PendingAttachment = {
	/** The id the client chose for the upload. The claimed file keeps it. */
	pendingId: string
	name: string
	/** MIME type. */
	type: string
	/** Bytes. Must equal what was uploaded. */
	size: number
}

/** One actor has at most one reaction on a message. */
export type Reaction = { by: Actor; emoji: string }

/** The key that makes an agent bubble idempotent. Architecture section 6.3. */
export type RunRef = { runId: string; attempt: number; index: number }

/** A message as the human sees it, with every later edit and reaction applied. */
export type Message = {
	id: MessageId
	/** The sequence of the event that stored it. */
	seq: number
	/** Epoch milliseconds. */
	at: number
	from: Sender
	text: string
	/** Present on agent messages. The client renders this and not `text`. */
	rich?: RichText
	replyTo?: MessageId
	files?: readonly FileRef[]
	/** Present on agent bubbles. */
	run?: RunRef
	editedAt?: number
	reactions?: readonly Reaction[]
	/** A chat this message points to, such as the one yuki just made. The client opens it. */
	goto?: RoomId
	/** The words of `replyTo` the sender picked to answer, as Telegram's quote does. */
	quote?: string
	/** The teammate an agent addressed with `send_message` or `ask`, or every other agent. Absent on a reply meant for the human. */
	to?: AgentSlug | "all"
}

export type Member = {
	slug: AgentSlug
	/** The display name. The slug never changes. */
	name: string
	lead: boolean
	/** What the agent does in the room, in the human's words. */
	role?: string
	/** A `provider/model` reference from the catalog. */
	model?: string
}

/**
 * A human's change to the room's agents (architecture section 7.7: at most 8). The slug never
 * changes; `rename` changes the display name. Adding a slug that was removed brings it back.
 */
export type MemberOp =
	| { op: "add"; slug: AgentSlug; name: string; role?: string; model?: string }
	| { op: "remove"; slug: AgentSlug }
	| { op: "rename"; slug: AgentSlug; name: string }

/**
 * A human's change to the room's files, as on a Linux shell. Folders are path prefixes and exist
 * while they hold files. `mv` into an existing folder keeps the name; `mv` of a file onto a file
 * replaces it. `rm` of a folder needs `recursive`.
 */
export type FileOp = { op: "rm"; paths: readonly string[]; recursive?: boolean } | { op: "mv"; from: string; to: string } | { op: "mkdir"; path: string }

/** Why the room refused a `files` frame, in lowercase, for the human. */
export type FileRefusal = string

/** Why the room refused a `member` frame. */
export type MemberRefusal = "limit" | "exists" | "unknown" | "last" | "reserved" | "chief"

/** Architecture section 7.6. */
export type TaskStatus = "todo" | "doing" | "blocked" | "review" | "done" | "cancelled"

export type Task = {
	id: string
	title: string
	status: TaskStatus
	owner?: AgentSlug
	dependsOn: readonly string[]
	note?: string
}

// ASSUMPTION: the shape of a human's task edit. The client generates the id,
// so a new task exists locally before the server answers.
export type TaskOp =
	| { op: "create"; id: string; title: string; owner?: AgentSlug; dependsOn?: readonly string[] }
	| { op: "update"; id: string; title?: string; status?: TaskStatus; owner?: AgentSlug | null; note?: string }
	| { op: "delete"; id: string }

// ASSUMPTION: the fields of an approval card. Architecture section 12.3 fixes
// the flow and the 4 minute expiry, and not the card.
export type ApprovalState = "pending" | "accepted" | "declined" | "expired"

export type Approval = {
	id: string
	slug: AgentSlug
	/** The tool the agent wants to call. */
	tool: string
	/** What the agent wants to do, in one line: a plain summary of the arguments. */
	summary: string
	state: ApprovalState
	/** Epoch milliseconds. */
	expiresAt: number
	/** Set on a card whose ok lets the agent act outside yuki for this long (section 25.3). */
	grantMs?: number
}

type Stored = {
	/** Only increases within a room. */
	seq: number
	/** Epoch milliseconds. */
	at: number
}

/** A stored change in a room. A client applies events in `seq` order. */
export type RoomEvent =
	/** A new message. `clientId` echoes the `send` that made it, so the sender drops its pending patch. */
	| ({ t: "message"; clientId?: string } & Message)
	| (Stored & { t: "edit"; messageId: MessageId; text: string; rich?: RichText })
	/** More than one id when a new attempt replaces an earlier attempt's bubbles. */
	| (Stored & { t: "delete"; messageIds: readonly MessageId[] })
	/** `emoji` is null when the actor removes its reaction. */
	| (Stored & { t: "react"; messageId: MessageId; by: Actor; emoji: string | null })
	/** The human has read up to `upTo`, on any device. */
	| (Stored & { t: "read"; upTo: number })
	/** A member was added or changed. */
	| (Stored & { t: "member"; member: Member })
	| (Stored & { t: "member_removed"; slug: AgentSlug })
	/** A task was added or changed. */
	| (Stored & { t: "task"; task: Task })
	| (Stored & { t: "task_removed"; id: string })
	/** An approval card was posted or changed state. */
	| (Stored & { t: "approval"; approval: Approval })
	/** A file was added, replaced, or moved. A move keeps the id and changes `name`. */
	| (Stored & { t: "file"; file: FileRef })
	/** Files were deleted. */
	| (Stored & { t: "file_removed"; ids: readonly string[] })
	/** The folders changed. The whole list, since a move or an rm changes many at once. */
	| (Stored & { t: "folders"; folders: readonly string[] })
	/** Architecture section 11.3. The agent started no run: the user has no credential for `provider`. */
	| (Stored & { t: "no_provider"; slug: AgentSlug; provider: string })

/** The room's current state. It replaces everything the client holds for the room. */
export type RoomSnapshot = {
	/** The sequence this snapshot is current to. */
	seq: number
	readSeq: number
	members: readonly Member[]
	/** The newest messages, oldest first. */
	messages: readonly Message[]
	tasks: readonly Task[]
	approvals: readonly Approval[]
	files: readonly FileRef[]
	/** Every folder, empty ones included. */
	folders: readonly string[]
}

/**
 * One message that matched. `snippet` is a few words around the match, and every matched word is
 * wrapped in `SNIPPET_OPEN` and `SNIPPET_CLOSE` (search.ts), so the client highlights exactly what the index matched.
 */
export type SearchHit = { id: MessageId; seq: number; at: number; from: Sender; snippet: string }

/** A hit from `GET /api/search`, which searches every chat: the hit and the chat it is in. */
export type ChatSearchHit = SearchHit & { roomId: RoomId }

/**
 * The answer of `GET /api/search?q=&before=&limit=`, newest first. `next` is the `before` (a time in
 * epoch ms) for the following page, or null at the end. `partial` is true when the user has more
 * chats than one search reaches, and only the most recently active were searched.
 */
export type ChatSearchPage = { results: readonly ChatSearchHit[]; next: number | null; partial: boolean }

export type ClientToRoom =
	| { t: "hello"; lastSeq: number }
	/**
	 * `attachments` are claimed from the pending uploads. `files` is what a client from before
	 * 2026-10-09 sends: files it stored itself. The room accepts them for one release, and only
	 * when each one is already in the chat's files.
	 */
	| { t: "send"; clientId: string; text: string; replyTo?: MessageId; quote?: string; attachments?: readonly PendingAttachment[]; files?: readonly FileRef[] }
	| { t: "react"; messageId: MessageId; emoji: string | null }
	| { t: "edit"; messageId: MessageId; text: string }
	| { t: "delete"; messageId: MessageId }
	| { t: "read"; seq: number }
	| { t: "typing" }
	| { t: "stop" }
	/** The model the chat's agents use, as `provider/model`, for one agent or all of them. Applies from the next run. */
	| { t: "model"; ref: string; slug?: AgentSlug }
	| { t: "approve"; approvalId: string; action: "accept" | "decline" }
	| { t: "task"; op: TaskOp }
	| { t: "member"; op: MemberOp }
	| { t: "files"; op: FileOp }
	/** Searches this room's live messages, newest first. `before` is the `next` of the previous page. */
	| { t: "search"; query: string; before?: number; limit?: number }
	/**
	 * A window of live messages around `seq`: up to `before` messages older than `seq`, then up to
	 * `after` messages at or after it. For jumping to a message the client does not hold, and for paging
	 * past what the client stored.
	 */
	| { t: "history"; seq: number; before: number; after: number }

export type RoomToClient =
	| { t: "events"; events: readonly RoomEvent[] }
	| { t: "ack"; clientId: string; id: MessageId; seq: number }
	/** Sent when `lastSeq` is too old to replay. */
	| { t: "reset"; snapshot: RoomSnapshot }
	/** Not stored. The agents that are typing now. */
	| { t: "typing"; who: readonly AgentSlug[] }
	/**
	 * Not stored. A long block that is still growing. The final message replaces it.
	 * DEVIATION: `slug` is added to the section 9.2 frame, so the client knows whose bubble it draws.
	 */
	| { t: "draft"; slug: AgentSlug; runId: string; index: number; text: string }
	/** Not stored. */
	| { t: "status"; slug: AgentSlug; state: AgentState; doing?: string }
	/** Not stored. Sent only to the socket whose `member` frame changed nothing, so it can drop its optimistic patch. */
	| { t: "member_refused"; op: MemberOp; reason: MemberRefusal }
	/** Not stored. Sent only to the socket whose `send` stored nothing because its attachments could not be claimed. */
	| { t: "send_refused"; clientId: string; reason: string }
	/** Not stored. Sent only to the socket whose `files` frame changed nothing. */
	| { t: "files_refused"; op: FileOp; reason: FileRefusal }
	/** Not stored. The answer to `search` for one socket. `next` is the `before` for the following page, or null at the end. */
	| { t: "search"; query: string; before?: number; results: readonly SearchHit[]; next: number | null }
	/** Not stored. The answer to `history` for one socket, oldest first. Fewer than asked for means that end of the room was reached. */
	| { t: "history"; seq: number; before: number; after: number; messages: readonly Message[] }

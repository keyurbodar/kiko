
import type { Actor, Sender } from "./envelope"
import type { AgentSlug, MessageId, RoomId } from "./ids"
import type { RichText } from "./rich-text"

export type AgentState = "idle" | "typing" | "working"

export type FileRef = {
	id: string
	name: string
	size: number
	type: string
}

export type PendingAttachment = {
	pendingId: string
	name: string
	type: string
	size: number
}

export type Reaction = { by: Actor; emoji: string }

export type RunRef = { runId: string; attempt: number; index: number }

export type Message = {
	id: MessageId
	seq: number
	at: number
	from: Sender
	text: string
	rich?: RichText
	replyTo?: MessageId
	files?: readonly FileRef[]
	run?: RunRef
	editedAt?: number
	reactions?: readonly Reaction[]
	goto?: RoomId
	quote?: string
	to?: AgentSlug | "all"
	initiative?: { reason: string }
}

export type Member = {
	slug: AgentSlug
	name: string
	lead: boolean
	role?: string
	model?: string
}

export type MemberOp =
	| { op: "add"; slug: AgentSlug; name: string; role?: string; model?: string }
	| { op: "remove"; slug: AgentSlug }
	| { op: "rename"; slug: AgentSlug; name: string }

export type FileOp = { op: "rm"; paths: readonly string[]; recursive?: boolean } | { op: "mv"; from: string; to: string } | { op: "mkdir"; path: string }

type FileRefusal = string

export type MemberRefusal = "limit" | "exists" | "unknown" | "last" | "reserved" | "chief"

export type TaskStatus = "todo" | "doing" | "blocked" | "review" | "done" | "cancelled"

export type Task = {
	id: string
	title: string
	status: TaskStatus
	owner?: AgentSlug
	dependsOn: readonly string[]
	note?: string
}

export type TaskOp =
	| { op: "create"; id: string; title: string; owner?: AgentSlug; dependsOn?: readonly string[] }
	| { op: "update"; id: string; title?: string; status?: TaskStatus; owner?: AgentSlug | null; note?: string }
	| { op: "delete"; id: string }

type Stored = {
	seq: number
	at: number
}

export type RoomEvent =
	| ({ t: "message"; clientId?: string } & Message)
	| (Stored & { t: "edit"; messageId: MessageId; text: string; rich?: RichText })
	| (Stored & { t: "delete"; messageIds: readonly MessageId[] })
	| (Stored & { t: "react"; messageId: MessageId; by: Actor; emoji: string | null })
	| (Stored & { t: "read"; upTo: number })
	| (Stored & { t: "member"; member: Member })
	| (Stored & { t: "member_removed"; slug: AgentSlug })
	| (Stored & { t: "task"; task: Task })
	| (Stored & { t: "task_removed"; id: string })
	| (Stored & { t: "file"; file: FileRef })
	| (Stored & { t: "file_removed"; ids: readonly string[] })
	| (Stored & { t: "folders"; folders: readonly string[] })
	| (Stored & { t: "no_provider"; slug: AgentSlug; provider: string })

export type RoomSnapshot = {
	seq: number
	readSeq: number
	members: readonly Member[]
	messages: readonly Message[]
	tasks: readonly Task[]
	files: readonly FileRef[]
	folders: readonly string[]
}

export type SearchHit = { id: MessageId; seq: number; at: number; from: Sender; snippet: string }

export type ChatSearchHit = SearchHit & { roomId: RoomId }

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
	| { t: "model"; ref: string; slug?: AgentSlug }
	| { t: "task"; op: TaskOp }
	| { t: "member"; op: MemberOp }
	| { t: "files"; op: FileOp }
	| { t: "search"; query: string; before?: number; limit?: number }
	| { t: "history"; seq: number; before: number; after: number }

export type RoomToClient =
	| { t: "events"; events: readonly RoomEvent[] }
	| { t: "ack"; clientId: string; id: MessageId; seq: number }
	| { t: "reset"; snapshot: RoomSnapshot }
	| { t: "typing"; who: readonly AgentSlug[] }
	/**
	 * Not stored. A long block that is still growing. The final message replaces it.
	 * DEVIATION: `slug` is added to the section 9.2 frame, so the client knows whose bubble it draws.
	 */
	| { t: "draft"; slug: AgentSlug; runId: string; index: number; text: string }
	| { t: "status"; slug: AgentSlug; state: AgentState; doing?: string }
	/** Not stored. Sent only to the socket whose `member` frame changed nothing, so it can drop its optimistic patch. */
	| { t: "member_refused"; op: MemberOp; reason: MemberRefusal }
	/** Not stored. Sent only to the socket whose `send` stored nothing because its attachments could not be claimed. */
	| { t: "send_refused"; clientId: string; reason: string }
	| { t: "files_refused"; op: FileOp; reason: FileRefusal }
	| { t: "search"; query: string; before?: number; results: readonly SearchHit[]; next: number | null }
	| { t: "history"; seq: number; before: number; after: number; messages: readonly Message[] }


import type { Actor, Sender } from "./envelope"
import type { KikoError } from "./errors"
import type { AgentSlug, MessageId, RoomId } from "./ids"
import type { RichText } from "./rich-text"

export type AgentState = "idle" | "typing" | "working"

export type ToolKind = "read" | "edit" | "search" | "run" | "web" | "other"

type WorkerState = "running" | "done" | "failed" | "stopped"

export type WorkerRow = {
	id: string
	task: string
	status: WorkerState
	step: string | null
	steps: number
	startedAt: number
}

export type Activity =
	| { kind: "writing" }
	| { kind: "tool"; tool: ToolKind; caption: string }
	| { kind: "waiting"; on: AgentSlug }
	| { kind: "failed"; caption: string }
	| { kind: "background"; workers: readonly WorkerRow[] }

export type AgentStatus = { slug: AgentSlug; state: AgentState; doing?: string; activity?: Activity }

export type SystemEvent =
	| { kind: "created"; roomId: RoomId; title: string }
	| { kind: "delegated"; from: AgentSlug; to: AgentSlug; title: string }
	| { kind: "routine"; title: string }
	| { kind: "agent_message"; from: AgentSlug; to: AgentSlug }
	| { kind: "activity"; count: number }
	| { kind: "routine_created"; agent: AgentSlug; title: string; byAgent?: true; private: true }
	| { kind: "model_changed"; agent: AgentSlug; model: string; private: true }
	| { kind: "compacted"; agent: AgentSlug; private: true }
	| { kind: "group_formed"; private: true }
	| { kind: "member_added"; slug: AgentSlug; name: string; private: true }
	| { kind: "member_removed"; slug: AgentSlug; name: string; private: true }
	| { kind: "run_error"; slug: AgentSlug; reason: RunErrorKind; actions: readonly RunErrorAction[]; private: true }

/** An event kind a newer server sent. Only its kind is kept. */
export type UnknownSystemEvent = { kind: string }

export type HumanQuestion = { id: string; header: string; question: string; options: readonly { label: string; description?: string; value?: string }[]; multiSelect?: boolean; allowCustomAnswer?: boolean }
export type HumanAnswers = Record<string, string | readonly string[]>
export type HumanAsk = { id: string; from: AgentSlug; text: string; options?: readonly string[]; questions?: readonly HumanQuestion[]; messageId: MessageId }

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

export type ReplyPreview = { seq: number; from: Actor; text: string; gone?: true }

export type Message = {
	id: MessageId
	seq: number
	at: number
	from: Sender
	text: string
	rich?: RichText
	replyTo?: MessageId
	/** What `replyTo` pointed at when the room last read it, so a reply shows its quote even when the original is not loaded. */
	reply?: ReplyPreview
	files?: readonly FileRef[]
	run?: RunRef
	editedAt?: number
	reactions?: readonly Reaction[]
	goto?: RoomId
	quote?: string
	to?: AgentSlug | "all"
	initiative?: { reason: string }
	event?: SystemEvent | UnknownSystemEvent
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

export type MemberRefusal = "limit" | "exists" | "unknown" | "last" | "reserved" | "chief" | "kiko"

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
	| (Stored & { t: "ask" } & HumanAsk)
	| (Stored & { t: "ask_resolved"; id: string; how: "answered" | "skipped" })

export type RoomSnapshot = {
	seq: number
	readSeq: number
	members: readonly Member[]
	messages: readonly Message[]
	tasks: readonly Task[]
	files: readonly FileRef[]
	folders: readonly string[]
	agents?: readonly AgentStatus[]
	asks?: readonly HumanAsk[]
}

export type SearchHit = { id: MessageId; seq: number; at: number; from: Sender; snippet: string }

export type ChatSearchHit = SearchHit & { roomId: RoomId }

export type ChatSearchPage = { results: readonly ChatSearchHit[]; next: number | null; partial: boolean }

export type ClientToRoom =
	| { t: "hello"; lastSeq: number }
	/** `attachments` are claimed from the pending uploads. */
	| { t: "send"; clientId: string; text: string; replyTo?: MessageId; quote?: string; attachments?: readonly PendingAttachment[] }
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
	| { t: "answer"; id: string; value: string | HumanAnswers }
	| { t: "skip"; id: string }
	/** Runs the input again that a `run_error` message reports. `messageId` is that message. */
	| { t: "retry"; messageId: MessageId }

export type RunErrorKind = "no_key" | "invalid_key" | "quota" | "rate_limit" | "model_not_found" | "network" | "overloaded" | "timeout" | "refused" | "too_long" | "other"

/** What the human can do about a failed run. The client draws one button for each. */
export type RunErrorAction = "retry" | "change_model" | "open_settings"

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
	| ({ t: "status" } & AgentStatus)
	/** Not stored. Sent only to the socket whose `member` frame changed nothing, so it can drop its optimistic patch. */
	| { t: "member_refused"; op: MemberOp; reason: MemberRefusal }
	/** Not stored. Sent only to the socket whose `send` stored nothing because its attachments could not be claimed. */
	| { t: "send_refused"; clientId: string; reason: string }
	| { t: "task_refused"; op: TaskOp; reason: string }
	/** Not stored. Something the human must know about, as one toast. */
	| { t: "error"; error: KikoError }
	| { t: "files_refused"; op: FileOp; reason: FileRefusal }
	| { t: "search"; query: string; before?: number; results: readonly SearchHit[]; next: number | null }
	| { t: "history"; seq: number; before: number; after: number; messages: readonly Message[] }

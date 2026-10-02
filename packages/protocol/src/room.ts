// Architecture section 9.2. The frames on the room socket, the stored events
// they carry, and the snapshot a client gets when it is too far behind.
// Every frame is one JSON object with a `t` tag.

import type { Actor, Sender } from "./envelope"
import type { AgentSlug, MessageId } from "./ids"
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
	/** Intrinsic pixels, for images and video. */
	width?: number
	height?: number
	thumbhash?: string
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
}

export type Member = {
	slug: AgentSlug
	/** The display name. The slug never changes. */
	name: string
	lead: boolean
}

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
	/** What the agent wants to do, in one line. */
	summary: string
	state: ApprovalState
	/** Epoch milliseconds. */
	expiresAt: number
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
	| (Stored & { t: "file"; file: FileRef })

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
}

export type SearchHit = { id: MessageId; seq: number; snippet: string }

export type ClientToRoom =
	| { t: "hello"; lastSeq: number }
	| { t: "send"; clientId: string; text: string; replyTo?: MessageId; files?: readonly FileRef[] }
	| { t: "react"; messageId: MessageId; emoji: string | null }
	| { t: "edit"; messageId: MessageId; text: string }
	| { t: "delete"; messageId: MessageId }
	| { t: "read"; seq: number }
	| { t: "typing" }
	| { t: "stop" }
	| { t: "approve"; approvalId: string; action: "accept" | "decline" }
	| { t: "task"; op: TaskOp }
	/** Searches this room's live messages, newest first. `before` is the `next` of the previous page. */
	| { t: "search"; query: string; before?: number; limit?: number }

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
	| { t: "status"; slug: AgentSlug; state: AgentState }
	/** Not stored. The answer to `search` for one socket. `next` is the `before` for the following page, or null at the end. */
	| { t: "search"; query: string; before?: number; results: readonly SearchHit[]; next: number | null }

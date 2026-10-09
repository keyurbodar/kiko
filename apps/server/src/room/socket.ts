// The room socket. Architecture sections 9.2 and 9.3. Every frame is checked
// against the protocol schema here, at the edge, and the log trusts what it gets.
// The object can hibernate between any two frames, so a socket's state lives in
// its attachment and the room's state lives in SQLite. Nothing here is kept in memory.

import type { AgentSlug, ClientToRoom, MemberOp, MemberRefusal, RoomEvent, RoomToClient, TaskOp, FileOp } from "@kiko/protocol"
import { ClientToRoom as ClientToRoomSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import type { RoomLog } from "./log"
import type { SearchOptions, SearchPage } from "./search"

/** Per-socket state. It survives hibernation. */
export type Attachment = {
	/** True after `hello` is answered. Only ready sockets get broadcasts. */
	ready: boolean
	/** The time by which the socket must say hello (`lib/hello-deadline.ts`). */
	helloBy?: number
}

/** What the socket needs from the room. */
export interface SocketRoom {
	readonly log: RoomLog
	/** Sends stored events to every ready socket. */
	publish(events: readonly RoomEvent[]): void
	/** The human is typing. Not stored. */
	humanTyping(): void
	/** The human pressed stop. Drops the pending burst and stops every agent's run (section 6.2). Not stored. */
	stop(): void
	/** Searches the room's live messages. */
	search(query: string, options?: SearchOptions): SearchPage
	/** Adds, removes, or renames an agent (section 7.7) and publishes the change. Returns why it was refused, or null. */
	memberOp(op: MemberOp): MemberRefusal | null
	/** A human's `rm` or `mv` on the room's files. The refusal for the socket, or null. */
	fileOp(op: FileOp): string | null
	/** A human's task board change (section 7.6). Publishes what it stored. */
	taskOp(op: TaskOp): void
	/** A human's decision on an approval card (P7-02). Publishes the change; a repeat does nothing. */
	approve(id: string, action: "accept" | "decline"): void
	/** The model one agent, or every agent, uses from its next run. Not stored here; each agent stores it. */
	setModel(ref: string, slug?: AgentSlug): void
}

/** Close code for a frame that breaks the protocol. */
export const BAD_FRAME = 1008
const MAX_FRAME = 64 * 1024
// ASSUMPTION: the limits on a message and on a reaction.
export const MAX_TEXT = 16_000
const MAX_EMOJI = 32
/** The most messages one `history` frame returns on each side. */
export const MAX_HISTORY = 100

const decode = Schema.decodeUnknownSync(ClientToRoomSchema)

export function attachment(ws: WebSocket): Attachment {
	return (ws.deserializeAttachment() as Attachment | null) ?? { ready: false }
}

export function send(ws: WebSocket, frame: RoomToClient): void {
	try {
		ws.send(JSON.stringify(frame))
	} catch {
		// The socket closed between the check and the send. Its client resumes with hello.
	}
}

/** Parses one raw frame. Returns null for anything that breaks the protocol. */
export function parse(raw: string | ArrayBuffer): ClientToRoom | null {
	if (typeof raw !== "string" || raw.length > MAX_FRAME) return null
	let frame: ClientToRoom
	try {
		frame = decode(JSON.parse(raw))
	} catch {
		return null
	}
	switch (frame.t) {
		case "send":
			return frame.text.length <= MAX_TEXT && (frame.text.trim() !== "" || !!frame.files?.length) ? frame : null
		case "edit":
			return frame.text.length <= MAX_TEXT && frame.text.trim() !== "" ? frame : null
		case "react":
			return frame.emoji === null || (frame.emoji.length > 0 && frame.emoji.length <= MAX_EMOJI && !/\s/.test(frame.emoji))
				? frame
				: null
		case "member":
			return frame.op.op === "remove" || frame.op.name.trim() !== "" ? frame : null
		default:
			return frame
	}
}

export function handleFrame(room: SocketRoom, ws: WebSocket, raw: string | ArrayBuffer): void {
	const frame = parse(raw)
	if (!frame) {
		ws.close(BAD_FRAME, "bad frame")
		return
	}
	const event = apply(room, ws, frame)
	if (event) room.publish([event])
}

/** Applies one frame and returns the event it stored, if any. */
function apply(room: SocketRoom, ws: WebSocket, frame: ClientToRoom): RoomEvent | null {
	const { log } = room
	const human = { kind: "human" } as const
	switch (frame.t) {
		case "hello":
			send(ws, log.catchUp(frame.lastSeq))
			ws.serializeAttachment({ ...attachment(ws), ready: true } satisfies Attachment)
			return null
		case "send": {
			const replyTo = frame.replyTo && log.message(frame.replyTo) ? frame.replyTo : undefined
			const stored = log.addMessage({
				from: human,
				text: frame.text,
				clientId: frame.clientId,
				...(replyTo ? { replyTo } : {}),
				// A quote belongs to a reply: the words the human picked from the message they answer.
				...(replyTo && frame.quote?.trim() ? { quote: frame.quote.trim() } : {}),
				...(frame.files ? { files: frame.files } : {}),
			})
			send(ws, { t: "ack", clientId: frame.clientId, id: stored.id, seq: stored.seq })
			return stored.event
		}
		case "edit":
			// The human edits only their own messages.
			return log.message(frame.messageId)?.from.kind === "human" ? log.editMessage(frame.messageId, frame.text) : null
		case "delete":
			// ASSUMPTION: the human may delete any message in their own room, an agent's bubble included.
			return log.deleteMessages([frame.messageId], human)
		case "react":
			return log.react(frame.messageId, human, frame.emoji)
		case "read":
			return log.markRead(frame.seq)
		case "typing":
			room.humanTyping()
			return null
		case "search": {
			const page = room.search(frame.query.slice(0, 200), { before: frame.before, limit: frame.limit })
			send(ws, { t: "search", query: frame.query, ...(frame.before !== undefined ? { before: frame.before } : {}), ...page })
			return null
		}
		case "catalog":
			// The media catalog is gone. An older client still asks, so it gets an empty last page. The protocol phase removes the frame.
			send(ws, { t: "catalog", kind: frame.kind, ...(frame.before !== undefined ? { before: frame.before } : {}), items: [], next: null })
			return null
		case "history": {
			const messages = log.around(frame.seq, Math.min(frame.before, MAX_HISTORY), Math.min(frame.after, MAX_HISTORY))
			send(ws, { t: "history", seq: frame.seq, before: frame.before, after: frame.after, messages })
			return null
		}
		case "stop":
			room.stop()
			return null
		case "model":
			room.setModel(frame.ref, frame.slug)
			return null
		case "member": {
			const refused = room.memberOp(frame.op)
			if (refused) send(ws, { t: "member_refused", op: frame.op, reason: refused })
			return null
		}
		case "files": {
			const refused = room.fileOp(frame.op)
			if (refused) send(ws, { t: "files_refused", op: frame.op, reason: refused })
			return null
		}
		case "task":
			room.taskOp(frame.op)
			return null
		case "approve":
			// Only a human holds a room socket, so only the human decides a card (P7-02).
			room.approve(frame.approvalId, frame.action)
			return null
	}
}

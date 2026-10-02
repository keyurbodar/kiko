// The room socket. Architecture sections 9.2 and 9.3. Every frame is checked
// against the protocol schema here, at the edge, and the log trusts what it gets.
// The object can hibernate between any two frames, so a socket's state lives in
// its attachment and the room's state lives in SQLite. Nothing here is kept in memory.

import type { ClientToRoom, MemberOp, MemberRefusal, RoomEvent, RoomToClient } from "@kiko/protocol"
import { ClientToRoom as ClientToRoomSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import type { RoomLog } from "./log"
import type { CatalogPage } from "./catalog"
import type { SearchPage } from "./search"

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
	search(query: string, before?: number, limit?: number): SearchPage
	/** The links or the media sent in the room. */
	catalog(kind: "links" | "media", before?: number, limit?: number): CatalogPage
	/** Adds, removes, or renames an agent (section 7.7) and publishes the change. Returns why it was refused, or null. */
	memberOp(op: MemberOp): MemberRefusal | null
}

/** Close code for a frame that breaks the protocol. */
export const BAD_FRAME = 1008
const MAX_FRAME = 64 * 1024
// ASSUMPTION: the limits on a message and on a reaction.
export const MAX_TEXT = 16_000
const MAX_EMOJI = 32

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
			const page = room.search(frame.query.slice(0, 200), frame.before, frame.limit)
			send(ws, { t: "search", query: frame.query, ...(frame.before !== undefined ? { before: frame.before } : {}), ...page })
			return null
		}
		case "catalog": {
			const page = room.catalog(frame.kind, frame.before, frame.limit)
			send(ws, { t: "catalog", kind: frame.kind, ...(frame.before !== undefined ? { before: frame.before } : {}), ...page })
			return null
		}
		case "stop":
			room.stop()
			return null
		case "member": {
			const refused = room.memberOp(frame.op)
			if (refused) send(ws, { t: "member_refused", op: frame.op, reason: refused })
			return null
		}
		case "approve":
		case "task":
			// Owned by later tasks: approvals (P7), the task board (P6).
			return null
	}
}

import type { AgentSlug, ClientToRoom, MemberOp, MemberRefusal, RoomEvent, RoomToClient, TaskOp, FileOp } from "@kiko/protocol"
import { ClientToRoom as ClientToRoomSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import type { RoomLog } from "./log"
import type { CatalogPage } from "./catalog"
import type { SearchOptions, SearchPage } from "./search"

export type Attachment = {
	ready: boolean
	helloBy?: number
}

export interface SocketRoom {
	readonly log: RoomLog
	publish(events: readonly RoomEvent[]): void
	humanTyping(): void
	stop(): void
	search(query: string, options?: SearchOptions): SearchPage
	catalog(kind: "links" | "media", before?: number, limit?: number): CatalogPage
	memberOp(op: MemberOp): MemberRefusal | null
	fileOp(op: FileOp): string | null
	taskOp(op: TaskOp): void
	approve(id: string, action: "accept" | "decline"): void
	setModel(ref: string, slug?: AgentSlug): void
}

export const BAD_FRAME = 1008
const MAX_FRAME = 64 * 1024
export const MAX_TEXT = 16_000
const MAX_EMOJI = 32
export const MAX_HISTORY = 100

const decode = Schema.decodeUnknownSync(ClientToRoomSchema)

export function attachment(ws: WebSocket): Attachment {
	return (ws.deserializeAttachment() as Attachment | null) ?? { ready: false }
}

export function send(ws: WebSocket, frame: RoomToClient): void {
	try {
		ws.send(JSON.stringify(frame))
	} catch {
	}
}

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
				...(replyTo && frame.quote?.trim() ? { quote: frame.quote.trim() } : {}),
				...(frame.files ? { files: frame.files } : {}),
			})
			send(ws, { t: "ack", clientId: frame.clientId, id: stored.id, seq: stored.seq })
			return stored.event
		}
		case "edit":
			return log.message(frame.messageId)?.from.kind === "human" ? log.editMessage(frame.messageId, frame.text) : null
		case "delete":
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
		case "catalog": {
			const page = room.catalog(frame.kind, frame.before, frame.limit)
			send(ws, { t: "catalog", kind: frame.kind, ...(frame.before !== undefined ? { before: frame.before } : {}), ...page })
			return null
		}
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
			room.approve(frame.approvalId, frame.action)
			return null
	}
}

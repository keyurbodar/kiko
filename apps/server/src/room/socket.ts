import { MAX_FRAME, MAX_MESSAGE_TEXT, sendFits } from "@kiko/protocol"
import type { AgentSlug, ClientToRoom, MemberOp, MemberRefusal, MessageId, RoomEvent, RoomToClient, TaskOp, FileOp, ThinkingLevel } from "@kiko/protocol"
import { ClientToRoom as ClientToRoomSchema } from "@kiko/protocol/schema"
import { Schema } from "effect"
import type { RoomLog } from "./log"
import { parseRichText } from "./rich-text"
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
	memberOp(op: MemberOp): MemberRefusal | null
	fileOp(op: FileOp): string | null
	humanSend(frame: Extract<ClientToRoom, { t: "send" }>): Promise<{ ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string }>
	taskOp(op: TaskOp): string | null | void
	setModel(ref: string, slug?: AgentSlug, thinking?: ThinkingLevel): void
	answerAsk(id: string, value: string | import("@kiko/protocol").HumanAnswers): Promise<void>
	skipAsk(id: string): Promise<void>
}

export const BAD_FRAME = 1008
const MAX_EMOJI = 32
export const MAX_HISTORY = 100

const decode = Schema.decodeUnknownSync(ClientToRoomSchema)

const RETIRED = new Set(["catalog"])

export function retired(raw: string | ArrayBuffer): boolean {
	if (typeof raw !== "string" || raw.length > MAX_FRAME) return false
	try {
		const t = (JSON.parse(raw) as { t?: unknown } | null)?.t
		return typeof t === "string" && RETIRED.has(t)
	} catch {
		return false
	}
}

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
		case "send": {
			const refs = frame.attachments ?? []
			return sendFits(frame.text, refs) && (frame.text.trim() !== "" || refs.length > 0) ? frame : null
		}
		case "edit":
			// An edit cannot carry a file, so it stays within the bubble limit.
			return frame.text.length <= MAX_MESSAGE_TEXT && sendFits(frame.text) && frame.text.trim() !== "" ? frame : null
		case "answer":
			return typeof frame.value === "string"
        ? frame.value.length <= MAX_MESSAGE_TEXT && sendFits(frame.value) && frame.value.trim() !== "" ? frame : null
        : sendFits("", [frame.value]) ? frame : null
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

export async function handleFrame(room: SocketRoom, ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
	const frame = parse(raw)
	if (!frame) {
		if (!retired(raw)) ws.close(BAD_FRAME, "bad frame")
		return
	}
	const events = await apply(room, ws, frame)
	if (events) room.publish(Array.isArray(events) ? events : [events])
}

async function apply(room: SocketRoom, ws: WebSocket, frame: ClientToRoom): Promise<RoomEvent | readonly RoomEvent[] | null> {
	const { log } = room
	const human = { kind: "human" } as const
	switch (frame.t) {
		case "hello":
			send(ws, log.catchUp(frame.lastSeq))
			ws.serializeAttachment({ ...attachment(ws), ready: true } satisfies Attachment)
			return null
		case "send": {
			const out = await room.humanSend(frame)
			if ("refused" in out) {
				send(ws, { t: "send_refused", clientId: frame.clientId, reason: out.refused })
				return null
			}
			send(ws, { t: "ack", clientId: frame.clientId, ...out.ack })
			return out.events
		}
		case "edit":
			return log.message(frame.messageId)?.from.kind === "human" ? log.editMessage(frame.messageId, frame.text, parseRichText(frame.text)) : null
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
		case "history": {
			const messages = log.around(frame.seq, Math.min(frame.before, MAX_HISTORY), Math.min(frame.after, MAX_HISTORY))
			send(ws, { t: "history", seq: frame.seq, before: frame.before, after: frame.after, messages })
			return null
		}
		case "stop":
			room.stop()
			return null
		case "model":
			room.setModel(frame.ref, frame.slug, frame.thinking)
			return null
		case "answer":
			await room.answerAsk(frame.id, frame.value)
			return null
		case "skip":
			await room.skipAsk(frame.id)
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
		case "task": {
			const reason = room.taskOp(frame.op)
			if (reason) send(ws, { t: "task_refused", op: frame.op, reason })
			return null
		}
	}
}

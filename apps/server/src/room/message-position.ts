import type { MessageId } from "@kiko/protocol"

const roomKey = (roomId: string) => Array.from(new TextEncoder().encode(roomId), (byte) => byte.toString(16).padStart(2, "0")).join("")

export function messageIdAt(roomId: string, seq: number): MessageId {
	return `${seq}.${roomKey(roomId)}` as MessageId
}

export function messageSeq(roomId: string, id: string): number {
	const seq = Number(id.slice(0, id.indexOf(".")))
	return Number.isSafeInteger(seq) && seq > 0 && messageIdAt(roomId, seq) === id ? seq : -1
}

export function messageSeqs(roomId: string, ids: readonly string[]): string {
	return JSON.stringify(ids.map((id) => messageSeq(roomId, id)).filter((seq) => seq > 0))
}

export const RECENT_MESSAGES = "(SELECT * FROM messages WHERE room_id = ?)"

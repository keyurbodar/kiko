import { messageIdAt, messageSeq } from "@kiko/protocol"

export { messageIdAt, messageSeq }

export function messageSeqs(roomId: string, ids: readonly string[]): string {
	return JSON.stringify(ids.map((id) => messageSeq(roomId, id)).filter((seq) => seq > 0))
}

export const RECENT_MESSAGES = "(SELECT * FROM messages WHERE room_id = ?)"

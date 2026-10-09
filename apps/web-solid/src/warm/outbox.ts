// Sends that the room has not acknowledged yet. A send is written here before
// it goes on the socket, and removed on its `ack`. Outbox writes skip the idle
// wait, so a send survives a tab closed right after it.

import type { ClientToRoom, RoomId } from "@yuki/protocol"
import type { Warm } from "./db"

export type OutboxItem = {
	roomId: RoomId
	frame: Extract<ClientToRoom, { t: "send" }>
	/** Epoch milliseconds. Resends go out in this order. */
	createdAt: number
}

export function addToOutbox(warm: Warm, item: OutboxItem): Promise<void> {
	warm.put("outbox", item.frame.clientId, item)
	return warm.flush()
}

export function removeFromOutbox(warm: Warm, clientId: string): Promise<void> {
	warm.delete("outbox", clientId)
	return warm.flush()
}

/** Oldest first. Every room when `roomId` is left out. */
export async function outbox(warm: Warm, roomId?: RoomId): Promise<OutboxItem[]> {
	const items = await warm.getAll<OutboxItem>("outbox")
	return items.filter((i) => !roomId || i.roomId === roomId).sort((a, b) => a.createdAt - b.createdAt)
}

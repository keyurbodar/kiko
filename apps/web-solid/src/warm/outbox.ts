import type { ClientToRoom, RoomId } from "@kiko/protocol"
import type { Warm } from "./db"

export type OutboxItem = {
  roomId: RoomId
  frame: Extract<ClientToRoom, { t: "send" }>
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

export async function outbox(warm: Warm, roomId?: RoomId): Promise<OutboxItem[]> {
  const items = await warm.getAll<OutboxItem>("outbox")
  return items.filter((i) => !roomId || i.roomId === roomId).sort((a, b) => a.createdAt - b.createdAt)
}

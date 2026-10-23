import type { Message, RoomId } from "@kiko/protocol"
import type { KeyRange, Warm } from "./db"

const BOOT_WINDOW = 50
export const KEEP_ON_DISK = 2000

export const roomRange = (roomId: RoomId, from = -Infinity, to = Infinity): KeyRange => ({
  lower: [roomId, from],
  upper: [roomId, to],
})
const lastSeqKey = (roomId: RoomId) => `lastSeq:${roomId}`

export function putMessages(warm: Warm, roomId: RoomId, messages: readonly Message[]) {
  for (const m of messages) warm.put("messages", [roomId, m.seq], m)
}

export function deleteMessages(warm: Warm, roomId: RoomId, seqs: readonly number[]) {
  for (const seq of seqs) warm.delete("messages", [roomId, seq])
}

export async function newestMessages(warm: Warm, roomId: RoomId, limit = BOOT_WINDOW): Promise<Message[]> {
  const rows = await warm.newest<Message>("messages", roomRange(roomId), limit)
  return rows.toReversed()
}

export async function messagesBefore(warm: Warm, roomId: RoomId, seq: number, limit: number): Promise<Message[]> {
  const rows = await warm.newest<Message>("messages", roomRange(roomId, -Infinity, seq - 1), limit)
  return rows.toReversed()
}

export function dropBefore(warm: Warm, roomId: RoomId, seq: number) {
  if (seq > 0) warm.deleteRange("messages", roomRange(roomId, -Infinity, seq - 1))
}

export function clearRoom(warm: Warm, roomId: RoomId) {
  warm.deleteRange("messages", roomRange(roomId))
  warm.delete("meta", lastSeqKey(roomId))
}

export async function getLastSeq(warm: Warm, roomId: RoomId): Promise<number> {
  return (await warm.get<number>("meta", lastSeqKey(roomId))) ?? 0
}

export function setLastSeq(warm: Warm, roomId: RoomId, seq: number) {
  warm.put("meta", lastSeqKey(roomId), seq)
}

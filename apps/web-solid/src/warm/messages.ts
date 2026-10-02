// One row per message, keyed by [roomId, seq]. Architecture section 19.2.
// The room's `lastSeq` lives in `meta`, so a socket can resume from it.

import type { Message, RoomId } from "@kiko/protocol"
import type { KeyRange, Warm } from "./db"

/** The boot paint reads this many. */
export const BOOT_WINDOW = 50

const roomRange = (roomId: RoomId, from = -Infinity, to = Infinity): KeyRange => ({
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

/** The newest `limit` messages, oldest first, read with a reverse cursor. */
export async function newestMessages(warm: Warm, roomId: RoomId, limit = BOOT_WINDOW): Promise<Message[]> {
	const rows = await warm.newest<Message>("messages", roomRange(roomId), limit)
	return rows.reverse()
}

/** Up to `limit` messages before `seq`, oldest first. For scrolling back without the network. */
export async function messagesBefore(warm: Warm, roomId: RoomId, seq: number, limit: number): Promise<Message[]> {
	const rows = await warm.newest<Message>("messages", roomRange(roomId, -Infinity, seq - 1), limit)
	return rows.reverse()
}

/** Keeps only the newest `keep` messages of a room. */
export async function trimRoom(warm: Warm, roomId: RoomId, keep: number) {
	const kept = await warm.newest<Message>("messages", roomRange(roomId), keep)
	if (kept.length < keep) return
	const oldestKept = kept[kept.length - 1].seq
	warm.deleteRange("messages", roomRange(roomId, -Infinity, oldestKept - 1))
}

/** Drops a room's messages and cursor, as on a `reset` frame or a deleted chat. */
export function clearRoom(warm: Warm, roomId: RoomId) {
	warm.deleteRange("messages", roomRange(roomId))
	warm.delete("meta", lastSeqKey(roomId))
}

/** 0 when the room has never synced on this device. */
export async function getLastSeq(warm: Warm, roomId: RoomId): Promise<number> {
	return (await warm.get<number>("meta", lastSeqKey(roomId))) ?? 0
}

export function setLastSeq(warm: Warm, roomId: RoomId, seq: number) {
	warm.put("meta", lastSeqKey(roomId), seq)
}

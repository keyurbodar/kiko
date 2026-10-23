import { eventRow } from "../chat/lib/event-line"
import type { ChatMessage } from "../lib/types"

export type RoomWindow = {
  live: boolean
  seq: number
}

function roomSettled(room: RoomWindow | undefined, lastSeq: number | undefined): boolean {
  if (!room || lastSeq === undefined) return false
  return room.seq >= lastSeq && (lastSeq > 0 || room.live)
}

export function roomEmpty(
  room: RoomWindow | undefined,
  messages: readonly ChatMessage[],
  lastSeq: number | undefined,
): boolean {
  return roomSettled(room, lastSeq) && messages.every((m) => m.event && eventRow(m, String) === null)
}

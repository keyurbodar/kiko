import { eventRow } from "../../chat/lib/event-line";
import type { ChatMessage } from "../../lib/types";

/** The room state that says whether the window of messages on screen is final. */
export type RoomWindow = {
  /** False until the warm tier has painted. */
  loaded: boolean;
  connection: string;
  /** The newest event the room has applied. */
  seq: number;
};

/**
 * A room counts as settled once its window is final: the room's cursor has reached the newest event
 * the chat list holds, and the socket is open when the chat list holds nothing at all.
 *
 * `loaded` only says the warm tier answered, and `connection: "open"` only says the handshake
 * finished. A cold client is loaded, open, and empty at once until the server's snapshot lands, so
 * either one alone painted the empty state over a chat that had plenty to show. `lastSeq` is the
 * chat list's newest event for the room; undefined means the list has not said what the room holds,
 * which is not the same fact as a room that holds nothing.
 */
export function roomSettled(room: RoomWindow | undefined, lastSeq: number | undefined): boolean {
  if (!room?.loaded) return false;
  if (lastSeq === undefined) return false;
  return room.seq >= lastSeq && (lastSeq > 0 || room.connection === "open");
}

/** A room is empty only once it is settled and every message it holds draws no row. */
export function roomEmpty(room: RoomWindow | undefined, messages: readonly ChatMessage[], lastSeq: number | undefined): boolean {
  return roomSettled(room, lastSeq) && messages.every((m) => m.event && eventRow(m, String) === null);
}

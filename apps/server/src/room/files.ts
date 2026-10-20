// The room's file index: `FileIndex` over the room's tables, with
// every change stored as one event in the room log, in the same transaction as the rows.

import type { RoomEvent } from "@kiko/protocol"
import { FileIndex, ROOM_TABLES } from "../files/file-index"
import { actorKey, type RoomLog } from "./log"

export {
  baseName,
  type FsChange,
  type FsEntry,
  type FsFail,
  type NewFile,
  type PutResult,
} from "../files/file-index"

export function roomFiles(storage: DurableObjectStorage, log: RoomLog): FileIndex<RoomEvent> {
  return new FileIndex<RoomEvent>(storage, ROOM_TABLES, (author, body) => log.append(author, body), actorKey, log.roomId)
}

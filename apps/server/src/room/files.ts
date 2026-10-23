import type { RoomEvent } from "@kiko/protocol"
import { FileIndex, ROOM_TABLES } from "../files/file-index"
import type { RoomLog } from "./log"
import { actorKey } from "./actor-key"

export { baseName, type FsChange, type FsEntry, type FsFail, type NewFile, type PutResult } from "../files/file-index"

export function roomFiles(storage: DurableObjectStorage, log: RoomLog): FileIndex<RoomEvent> {
  return new FileIndex<RoomEvent>(
    storage,
    ROOM_TABLES,
    (author, body) => log.append(author, body),
    actorKey,
    log.roomId,
  )
}

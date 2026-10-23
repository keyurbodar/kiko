import type { RoomId } from "./ids"
import type { ClientToRoom, RoomToClient } from "./room"
import type { ClientToUser, UserToClient } from "./user"

export type ClientToOwner =
  | ClientToUser
  | { t: "room"; roomId: RoomId; frame: ClientToRoom }
  | { t: "subscribe"; roomId: RoomId; lastSeq: number }
  | { t: "unsubscribe"; roomId: RoomId }

export type OwnerToClient = UserToClient | { t: "room"; roomId: RoomId; frame: RoomToClient }

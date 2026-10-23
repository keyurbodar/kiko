import * as Schema from "effect/Schema"
import { Count } from "./base"
import { RoomId } from "./ids"
import { ClientToRoom, RoomToClient } from "./room"
import { ClientToUser, UserToClient } from "./user"

export const ClientToOwner = Schema.Union([
  ClientToUser,
  Schema.Struct({ t: Schema.Literal("room"), roomId: RoomId, frame: ClientToRoom }),
  Schema.Struct({ t: Schema.Literal("subscribe"), roomId: RoomId, lastSeq: Count }),
  Schema.Struct({ t: Schema.Literal("unsubscribe"), roomId: RoomId }),
])
export type ClientToOwner = typeof ClientToOwner.Type

export const OwnerToClient = Schema.Union([
  UserToClient,
  Schema.Struct({ t: Schema.Literal("room"), roomId: RoomId, frame: RoomToClient }),
])
export type OwnerToClient = typeof OwnerToClient.Type

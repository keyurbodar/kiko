// Bundled by the round-trip test. A client that imports only types.
import type { ClientToRoom, RoomToClient } from "@kiko/protocol"

export type Outgoing = ClientToRoom
export type Incoming = RoomToClient

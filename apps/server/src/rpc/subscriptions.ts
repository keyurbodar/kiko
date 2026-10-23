import { NotFoundError, ProtocolError, type RoomId } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import type { Room } from "../room/room-do"
import type { User } from "../user/user-do"
import { ownerAttachment, socketView, subscribe, unsubscribe } from "../owner/socket"
import { encodeItems, type StreamKey } from "./streams"
import type { RequestId } from "./wire"

const MAX_ROOM_STREAMS = 32

export interface StreamHost {
  user(): User
  room(roomId: RoomId): Room
}

const synchronized = (ws: WebSocket, stream: StreamKey, requestId: RequestId) => {
  const text = encodeItems(stream, requestId, [{ kind: "synchronized" }])
  if (text) ws.send(text)
}

const roomMissing = () => new NotFoundError({ resource: "room", message: "That chat does not exist." })

export function makeStreams(host: StreamHost) {
  return {
    user: Effect.fn("Streams.user")(function* (ws: WebSocket, requestId: RequestId, afterSequence: number) {
      subscribe(ws, { requestId, stream: "user", cursor: afterSequence })
      yield* host.user().subscribe(socketView(ws), afterSequence)
      synchronized(ws, "user", requestId)
    }),
    room: Effect.fn("Streams.room")(function* (
      ws: WebSocket,
      requestId: RequestId,
      roomId: RoomId,
      afterSequence: number,
    ) {
      const saved = ownerAttachment(ws)
      if (!saved.user.ready) return yield* new ProtocolError({ message: "Subscribe to the user stream first." })
      if (Object.keys(saved.rooms).length >= MAX_ROOM_STREAMS && !saved.rooms[roomId])
        return yield* new ProtocolError({ message: "Too many open chats on this connection." })
      if (!(yield* Effect.promise(() => host.user().getChat(roomId)))) return yield* roomMissing()
      saved.rooms[roomId] = { ready: false }
      ws.serializeAttachment(saved)
      const stream: StreamKey = `room:${roomId}`
      subscribe(ws, { requestId, stream, cursor: afterSequence })
      const opened = yield* Effect.promise(() =>
        host.room(roomId).subscribe(socketView(ws, roomId), afterSequence, saved.handle),
      )
      if (!opened) {
        unsubscribe(ws, requestId)
        return yield* roomMissing()
      }
      synchronized(ws, stream, requestId)
    }),
  }
}

export type Streams = ReturnType<typeof makeStreams>

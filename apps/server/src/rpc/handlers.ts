import {
  DuplicateChatError,
  NotFoundError,
  ProtocolError,
  RefusedError,
  StorageError,
  type OwnerRpcs,
  type RoomId,
} from "@kiko/protocol"
import * as Effect from "effect/Effect"
import type * as Rpc from "effect/rpc/Rpc"
import type { Room } from "../room/room-do"
import type { User } from "../user/user-do"
import { ownerAttachment, socketView } from "../owner/socket"
import { capture, replyOf, type Captured } from "./capture"
import { encodeItems, type StreamKey, type Subscription } from "./streams"
import type { RequestId } from "./wire"

export interface RpcHost {
  user(): User
  room(roomId: RoomId): Room
}

export type Cx = { readonly host: RpcHost; readonly ws: WebSocket; readonly requestId: RequestId }

type Of<Tag extends OwnerRpcs["_tag"]> = Extract<OwnerRpcs, { readonly _tag: Tag }>
type Handler<R> = (payload: Rpc.Payload<R>, cx: Cx) => Effect.Effect<Rpc.SuccessExit<R>, Rpc.ErrorExit<R>>
export type Handlers = { readonly [Tag in OwnerRpcs["_tag"]]?: Handler<Of<Tag>> }

const MAX_ROOM_STREAMS = 32

const noticeOf = (captured: Captured) => {
  const frame = replyOf(captured, "error")
  const error = frame?.error as { _tag?: unknown; message?: unknown } | undefined
  if (!error) return null
  const message = typeof error.message === "string" ? error.message : "Kiko could not do that."
  return error._tag === "ProtocolError" ? new ProtocolError({ message }) : new StorageError({ message })
}

const settle = (captured: Captured) =>
  Effect.gen(function* () {
    if (captured.closed !== null) return yield* new ProtocolError({ message: captured.closed })
    const notice = noticeOf(captured)
    if (notice) return yield* notice
  })

function subscribe(ws: WebSocket, sub: Subscription): void {
  const saved = ownerAttachment(ws)
  saved.rpc = [...(saved.rpc ?? []).filter((s) => s.stream !== sub.stream), sub]
  ws.serializeAttachment(saved)
}

export function unsubscribe(ws: WebSocket, requestId: RequestId): void {
  const saved = ownerAttachment(ws)
  const sub = saved.rpc?.find((s) => s.requestId === requestId)
  if (!sub || !saved.rpc) return
  saved.rpc = saved.rpc.filter((s) => s !== sub)
  if (sub.stream === "user") saved.user = { ...saved.user, ready: false }
  else delete saved.rooms[sub.stream.slice("room:".length)]
  ws.serializeAttachment(saved)
}

const synchronized = (ws: WebSocket, stream: StreamKey, requestId: RequestId) => {
  const text = encodeItems(stream, requestId, [{ kind: "synchronized" }])
  if (text) ws.send(text)
}

const userStream: Handler<Of<"user.subscribe">> = ({ afterSequence }, { host, ws, requestId }) =>
  Effect.gen(function* () {
    subscribe(ws, { requestId, stream: "user", cursor: afterSequence ?? 0 })
    yield* Effect.promise(() =>
      host.user().webSocketMessage(socketView(ws), JSON.stringify({ t: "hello", lastSeq: afterSequence ?? 0 })),
    )
    if (!ownerAttachment(ws).user.ready) return yield* new StorageError({ message: "Kiko could not open your chats." })
    synchronized(ws, "user", requestId)
  })

const roomStream: Handler<Of<"room.subscribe">> = ({ roomId, afterSequence }, { host, ws, requestId }) =>
  Effect.gen(function* () {
    const saved = ownerAttachment(ws)
    if (!saved.user.ready) return yield* new ProtocolError({ message: "Subscribe to the user stream first." })
    if (Object.keys(saved.rooms).length >= MAX_ROOM_STREAMS && !saved.rooms[roomId])
      return yield* new ProtocolError({ message: "Too many open chats on this connection." })
    if (!(yield* Effect.promise(() => host.user().getChat(roomId))))
      return yield* new NotFoundError({ resource: "room", message: "That chat does not exist." })
    saved.rooms[roomId] = { ready: false }
    ws.serializeAttachment(saved)
    const stream: StreamKey = `room:${roomId}`
    subscribe(ws, { requestId, stream, cursor: afterSequence ?? 0 })
    yield* Effect.promise(() =>
      host.room(roomId).subscribe(socketView(ws, roomId), afterSequence ?? 0, ownerAttachment(ws).handle),
    )
    if (!ownerAttachment(ws).rooms[roomId]?.ready) {
      unsubscribe(ws, requestId)
      return yield* new NotFoundError({ resource: "room", message: "That chat does not exist." })
    }
    synchronized(ws, stream, requestId)
  })

const chatCommand: Handler<Of<"chat.command">> = ({ op }, { host, ws }) =>
  Effect.gen(function* () {
    const captured = yield* Effect.promise(() =>
      capture(socketView(ws), (view) => host.user().webSocketMessage(view, JSON.stringify({ t: "chat", op }))),
    )
    const refused = replyOf(captured, "chat_refused")
    if (refused)
      return yield* new DuplicateChatError({
        roomId: op.roomId,
        existing: refused.existing as RoomId,
        message: "A chat with these agents already exists.",
      })
    yield* settle(captured)
  })

const roomSend: Handler<Of<"room.send">> = ({ roomId, commandId, ...message }, { host, ws }) =>
  Effect.gen(function* () {
    if (!ownerAttachment(ws).rooms[roomId]?.ready)
      return yield* new ProtocolError({ message: "Subscribe to the chat before sending to it." })
    const captured = yield* Effect.promise(() =>
      capture(socketView(ws, roomId), (view) =>
        host.room(roomId).webSocketMessage(view, JSON.stringify({ t: "send", clientId: commandId, ...message })),
      ),
    )
    const refused = replyOf(captured, "send_refused")
    if (refused) return yield* new RefusedError({ reason: "send", message: String(refused.reason) })
    yield* settle(captured)
    const ack = replyOf(captured, "ack")
    if (!ack) return yield* new StorageError({ message: "Kiko could not save that message." })
    return { id: ack.id as Rpc.SuccessExit<Of<"room.send">>["id"], seq: Number(ack.seq) }
  })

export const HANDLERS: Handlers = {
  "user.subscribe": userStream,
  "room.subscribe": roomStream,
  "chat.command": chatCommand,
  "room.send": roomSend,
}

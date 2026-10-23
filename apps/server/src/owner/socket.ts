import { NotFoundError } from "@kiko/protocol"
import * as Exit from "effect/Exit"
import type { Attachment as RoomAttachment } from "../room/commands"
import { streamFrame, type StreamKey, type Subscription } from "../rpc/streams"
import { codecs, exitFrame, type RequestId } from "../rpc/wire"

type UserAttachment = { ready: boolean; workerOrigin?: string; pcSession?: string }
type OwnerAttachment = {
  user: UserAttachment
  rooms: Record<string, RoomAttachment>
  handle?: string
  pcSession?: string
  rpc: Subscription[]
}

export function ownerAttachment(ws: WebSocket): OwnerAttachment {
  return ws.deserializeAttachment() as OwnerAttachment
}

export function openAttachment(handle: string | undefined): OwnerAttachment {
  return { user: { ready: false }, rooms: {}, rpc: [], ...(handle ? { handle } : {}) }
}

export function subscribe(ws: WebSocket, sub: Subscription): void {
  const saved = ownerAttachment(ws)
  saved.rpc = [...saved.rpc.filter((s) => s.stream !== sub.stream), sub]
  ws.serializeAttachment(saved)
}

export function unsubscribe(ws: WebSocket, requestId: RequestId): Subscription | null {
  const saved = ownerAttachment(ws)
  const sub = saved.rpc.find((s) => s.requestId === requestId)
  if (!sub) return null
  saved.rpc = saved.rpc.filter((s) => s !== sub)
  if (sub.stream === "user") saved.user = { ...saved.user, ready: false }
  else delete saved.rooms[sub.stream.slice("room:".length)]
  ws.serializeAttachment(saved)
  return sub
}

function forward(target: WebSocket, stream: StreamKey, raw: string | ArrayBuffer | ArrayBufferView): void {
  if (typeof raw !== "string") {
    try {
      target.send(raw)
    } catch {}
    return
  }
  const saved = ownerAttachment(target)
  const sub = saved.rpc.find((s) => s.stream === stream)
  if (!sub) return
  const { text, cursor } = streamFrame(sub, raw)
  if (cursor !== sub.cursor) {
    sub.cursor = cursor
    target.serializeAttachment(saved)
  }
  if (text === null) return
  try {
    target.send(text)
  } catch {}
}

function endRoomStream(target: WebSocket, roomId: string): void {
  const sub = ownerAttachment(target).rpc.find((s) => s.stream === `room:${roomId}`)
  if (!sub) return
  unsubscribe(target, sub.requestId)
  const exit = Exit.fail(new NotFoundError({ resource: "room", message: "That chat was deleted." }))
  try {
    target.send(exitFrame(sub.requestId, codecs("room.subscribe")?.encodeExit(exit)))
  } catch {}
}

const views = new WeakMap<WebSocket, Map<string, WebSocket>>()

export function socketView(ws: WebSocket, roomId?: string): WebSocket {
  let sockets = views.get(ws)
  if (!sockets) {
    sockets = new Map()
    views.set(ws, sockets)
  }
  const key = roomId ?? "user"
  const existing = sockets.get(key)
  if (existing) return existing
  const stream: StreamKey = roomId === undefined ? "user" : `room:${roomId}`
  const view = new Proxy(ws, {
    get(target, property) {
      if (property === "serializeAttachment")
        return (value: UserAttachment | RoomAttachment) => {
          const saved = ownerAttachment(target)
          if (roomId === undefined) saved.user = value
          else saved.rooms[roomId] = value
          target.serializeAttachment(saved)
        }
      if (property === "deserializeAttachment")
        return () => {
          const saved = ownerAttachment(target)
          return roomId === undefined ? saved.user : (saved.rooms[roomId] ?? { ready: false })
        }
      if (property === "send") return (raw: string | ArrayBuffer | ArrayBufferView) => forward(target, stream, raw)
      if (property === "close" && roomId !== undefined) return () => endRoomStream(target, roomId)
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  sockets.set(key, view)
  return view
}

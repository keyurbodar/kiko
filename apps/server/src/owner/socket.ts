import { HELLO_TIMEOUT_REASON } from "@kiko/durable/hello-deadline"
import type { Attachment as RoomAttachment } from "../room/socket"

type UserAttachment = { ready: boolean; helloBy?: number }
type OwnerAttachment = {
  user: UserAttachment
  rooms: Record<string, RoomAttachment>
  handle?: string
}

export function ownerAttachment(ws: WebSocket): OwnerAttachment {
  return ws.deserializeAttachment() as OwnerAttachment
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
      if (property === "send" && roomId !== undefined)
        return (raw: string) => target.send(JSON.stringify({ t: "room", roomId, frame: JSON.parse(raw) }))
      if (property === "close" && roomId !== undefined)
        return (code?: number, reason?: string) => {
          const saved = ownerAttachment(target)
          delete saved.rooms[roomId]
          target.serializeAttachment(saved)
          try {
            target.close(code, reason)
          } catch {}
        }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  sockets.set(key, view)
  return view
}

export async function waitForHello(ws: WebSocket): Promise<void> {
  const attachment = ws.deserializeAttachment() as UserAttachment
  if (attachment.helloBy === undefined) return
  await scheduler.wait(Math.max(0, attachment.helloBy - Date.now()))
  const current = ws.deserializeAttachment() as UserAttachment
  if (current.ready) return
  try {
    ws.close(4408, HELLO_TIMEOUT_REASON)
  } catch {}
}

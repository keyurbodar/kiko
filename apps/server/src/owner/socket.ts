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
  if (!sockets) { sockets = new Map(); views.set(ws, sockets) }
  const key = roomId ?? "user"
  const existing = sockets.get(key)
  if (existing) return existing
  const view = new Proxy(ws, {
    get(target, property) {
      if (property === "serializeAttachment") return (value: UserAttachment | RoomAttachment) => {
        const saved = ownerAttachment(target)
        if (roomId === undefined) saved.user = value
        else saved.rooms[roomId] = value
        target.serializeAttachment(saved)
      }
      if (property === "deserializeAttachment") return () => {
        const saved = ownerAttachment(target)
        return roomId === undefined ? saved.user : saved.rooms[roomId] ?? { ready: false }
      }
      if (property === "send" && roomId !== undefined) return (raw: string) => target.send(JSON.stringify({ t: "room", roomId, frame: JSON.parse(raw) }))
      if (property === "close" && roomId !== undefined) return (code?: number, reason?: string) => {
        const saved = ownerAttachment(target)
        delete saved.rooms[roomId]
        target.serializeAttachment(saved)
        // A room closes its view to refuse a frame. The client must see that close, or it never learns
        // the frame was bad.
        try { target.close(code, reason) } catch {}
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  sockets.set(key, view)
  return view
}

import type { Message, RoomToClient } from "@kiko/protocol"
import { newRoomId } from "@kiko/protocol"
import type { RoomHandle, Session } from "./client"
import { VerifyError } from "./client"

type Truthy<T> = Exclude<Awaited<T>, false | null | undefined | 0 | "">

export async function poll<T>(what: string, test: () => T | Promise<T>, ms = 30_000, every = 200): Promise<Truthy<T>> {
  const end = Date.now() + ms
  for (;;) {
    const got = await test()
    if (got) return got as Truthy<T>
    if (Date.now() > end) throw new VerifyError(`timed out after ${ms / 1000}s waiting for ${what}`)
    await Bun.sleep(every)
  }
}

export async function newRoom(
  s: Session,
  title: string,
  agents?: string[],
): Promise<{ roomId: string; room: RoomHandle & { id: string } }> {
  const roomId = newRoomId()
  const user = await s.user()
  user.send({ t: "chat", op: { op: "create", roomId, title, ...(agents ? { agents } : {}) } as never })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = Object.assign(await s.room(roomId), { id: roomId as string })
  await room.expect((f) => f.t === "events" || f.t === "reset")
  return { roomId, room }
}

function frames(room: RoomHandle) {
  return room.raw.log.flatMap((e) => (e.dir === "in" ? [e.frame as RoomToClient] : []))
}

export function messages(room: RoomHandle): Message[] {
  const byId = new Map<string, Message>()
  for (const f of frames(room)) if (f.t === "events") for (const e of f.events) if (e.t === "message") byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

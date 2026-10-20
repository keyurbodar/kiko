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

export async function newRoom(s: Session, title: string, agents?: string[]): Promise<{ roomId: string; room: RoomHandle & { id: string } }> {
  const roomId = newRoomId()
  const user = await s.user()
  user.send({ t: "chat", op: { op: "create", roomId, title, ...(agents ? { agents } : {}) } as never })
  await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
  const room = Object.assign(await s.room(roomId), { id: roomId as string })
  await room.expect((f) => f.t === "events" || f.t === "reset")
  return { roomId, room }
}

export const frames = (room: RoomHandle) => room.raw.log.flatMap((e) => (e.dir === "in" ? [e.frame as RoomToClient] : []))

export const idles = (room: RoomHandle) => frames(room).filter((f) => f.t === "status" && f.state === "idle").length

export const statuses = (room: RoomHandle) => frames(room).flatMap((f) => (f.t === "status" ? [f.state] : []))

export function messages(room: RoomHandle): Message[] {
  const byId = new Map<string, Message>()
  for (const f of frames(room)) if (f.t === "events") for (const e of f.events) if (e.t === "message") byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => a.seq - b.seq)
}

export const agentTexts = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent").map((m) => m.text)

export function agentText(room: RoomHandle, from = 0): string {
  return room.raw.log
    .slice(from)
    .flatMap((entry) => {
      const frame = entry.frame as RoomToClient
      if (entry.dir !== "in" || frame.t !== "events") return []
      return frame.events.flatMap((e) => (e.t === "message" && e.from.kind === "agent" ? [e.text] : []))
    })
    .join("\n")
}

export function seen(room: RoomHandle): { all: Message[]; live: Message[]; deleted: number } {
  const all: Message[] = []
  const gone = new Set<string>()
  for (const f of frames(room)) {
    if (f.t !== "events") continue
    for (const e of f.events) {
      if (e.t === "message" && e.from.kind === "agent" && !all.some((m) => m.id === e.id)) all.push(e)
      if (e.t === "delete") for (const id of e.messageIds) gone.add(id)
    }
  }
  const live = all.filter((m) => !gone.has(m.id)).sort((a, b) => a.seq - b.seq)
  return { all, live, deleted: all.filter((m) => gone.has(m.id)).length }
}

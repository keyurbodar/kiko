import { newRoomId } from "@kiko/protocol"
import type { RoomEvent, RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"



type Reminder = { id: string; dueUtc: number; status: string; lastFired: number | null; text: string }

const reminderMessages = (f: RoomToClient): RoomEvent[] =>
  f.t === "events" ? f.events.filter((e) => e.t === "message" && e.from.kind === "system" && e.from.reason === "reminder") : []

function wall(at: number, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(at)
}

const suite: Suite = {
  name: "reminders",
  async run(v) {
    const s = await v.as("reminders")
    const base = v.url
    async function api<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(new URL(`api/${path}`, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie: s.cookie, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!res.ok) throw new VerifyError(`${path} answered ${res.status}: ${await res.text()}`)
      return (await res.json()) as T
    }
    const find = async (id: string) => (await api<Reminder[]>("reminders")).find((r) => r.id === id)
    async function until(id: string, done: (r: Reminder) => boolean, what: string): Promise<Reminder> {
      const end = Date.now() + 10_000
      for (;;) {
        const r = await find(id)
        if (r && done(r)) return r
        if (Date.now() > end) throw new VerifyError(`timed out waiting for ${what}. last row: ${JSON.stringify(r)}`)
        await new Promise((ok) => setTimeout(ok, 200))
      }
    }

    const roomId = newRoomId()
    const user = await s.user()
    user.send({ t: "chat", op: { op: "create", roomId: roomId as never, title: "reminders check" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")

    try {
      const once = await api<Reminder>("reminders", {
        text: "stretch",
        time: new Date(Date.now() + 3000).toISOString(),
        tz: "UTC",
        roomId,
      })
      const posted = reminderMessages(await room.expect((f) => reminderMessages(f).length > 0, 10_000))
      expectEqual(
        posted.map((e) => e.t === "message" && e.text),
        ["reminder: stretch"],
        "the reminder message",
      )
      const done = await until(once.id, (r) => r.status === "done", "the one-off to be done")
      expectEqual(done.lastFired, once.dueUtc, "last_fired")

      await api<Reminder>(`reminders/${once.id}/rewind`, {})
      await until(once.id, (r) => r.status === "done", "the replayed alarm")
      await room.expectNone((f) => reminderMessages(f).length > 0, 1500)

      const tz = "America/New_York"
      const daily = await api<Reminder>("reminders", {
        text: "water the plants",
        time: new Date(Date.now() + 3000).toISOString(),
        tz,
        rrule: "FREQ=DAILY",
        roomId,
      })
      await room.expect((f) => reminderMessages(f).length > 0, 10_000)
      const moved = await until(daily.id, (r) => r.lastFired !== null, "the daily row to move")
      expectEqual(moved.status, "active", "the daily status")
      expectEqual(moved.lastFired, daily.dueUtc, "the daily last_fired")
      const [beforeDay, beforeTime] = wall(daily.dueUtc, tz).split(" ")
      const [afterDay, afterTime] = wall(moved.dueUtc, tz).split(" ")
      expectEqual(afterTime, beforeTime, "the local time of the next occurrence")
      const next = new Date(`${beforeDay}T00:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 1)
      expectEqual(afterDay, next.toISOString().slice(0, 10), "the local day of the next occurrence")
      await room.expectNone((f) => reminderMessages(f).length > 0, 1000)
      await api(`reminders/${daily.id}/cancel`, {})
    } finally {
      user.send({ t: "chat", op: { op: "delete", roomId: roomId as never } })
    }
  },
}

export default suite

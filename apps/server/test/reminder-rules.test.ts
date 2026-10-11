import { expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import { type DeliverRun, type Reminder, Reminders, type RunDelivery } from "../src/user/reminders"
import { sqlStorage } from "./sql-shim"

// `Reminders` over bun:sqlite with fake ports: the rules that decide what a schedule or a watch
// hands to the room (architecture sections 14 and 25.4).

const ROOM = "01J0000000000000000000000R" as RoomId
const MIN = 60_000

function setup(results: RunDelivery[] = [], pages: string[] = []) {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE chats (room_id TEXT PRIMARY KEY)")
  sql.exec("INSERT INTO chats (room_id) VALUES (?)", ROOM)
  const clock = { now: Date.UTC(2026, 9, 10, 12) }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms
  const runs: { deliveryId: string; body: string }[] = []
  const posted: string[] = []
  const deliverRun: DeliverRun = async ({ deliveryId, body }) => {
    runs.push({ deliveryId, body })
    return results.shift() ?? "delivered"
  }
  const reminders = new Reminders(sql, alarms, async (id: string, _r: Reminder) => void posted.push(id), () => clock.now, {
    deliverRun,
    watch: async () => ({ ok: true, text: pages.shift() ?? "same" }),
    notice: async () => {},
    gate: { away: () => false },
  })
  return { sql, clock, reminders, runs, posted }
}

test("a held watch run keeps the old fingerprint, so the next check reports the change", async () => {
  const { clock, reminders, runs } = setup(["held", "delivered"], ["page one", "page two", "page two"])
  const { routine } = await reminders.createRoutine("u", { name: "watch", instructions: "say what changed", trigger: { on: "watch", url: "https://example.com", everyMinutes: 15 }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  for (let i = 0; i < 3; i++) {
    clock.now = reminders.get(routine.id)!.dueUtc
    await reminders.fire()
  }
  expect(runs.length).toBe(2)
  expect(runs.every((r) => r.body.includes("page two"))).toBe(true)
})

test("a reminder for the human repeats at most every 30 minutes, like one for an agent", async () => {
  const { reminders } = setup()
  const make = (target?: string) => reminders.create("u", { text: "ping", time: new Date(Date.UTC(2026, 9, 10, 13)).toISOString(), tz: "UTC", rrule: "FREQ=MINUTELY", roomId: ROOM, ...(target ? { target } : {}) })
  await expect(make()).rejects.toThrow("at most every 30 minutes")
  await expect(make("yuki")).rejects.toThrow("at most every 30 minutes")
})

test("a stored minutely reminder for the human posts at most once in 30 minutes", async () => {
  const { sql, clock, reminders, posted } = setup()
  const start = clock.now
  sql.exec(
    "INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, created_at) VALUES ('r', 'ping', ?, 'UTC', 'FREQ=MINUTELY', ?, 'human', 'human', 'active', ?)",
    start,
    ROOM,
    start,
  )
  for (let m = 0; m < 60; m++) {
    clock.now = start + m * MIN
    await reminders.fire()
  }
  expect(posted.length).toBe(2)
})

test("aging the initiative clock moves an agent's own reminder with it, a day at a time", async () => {
  const { clock, reminders } = setup()
  const HOUR = 60 * MIN
  // "Tomorrow morning" set before dawn is more than one day out.
  const own = await reminders.create("u", { text: "bring the checklist", time: new Date(clock.now + 28 * HOUR).toISOString(), tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "yuki" })
  const human = await reminders.create("u", { text: "call mom", time: new Date(clock.now + 28 * HOUR).toISOString(), tz: "UTC", roomId: ROOM })
  await reminders.devAge(24 * HOUR)
  expect(reminders.get(own.id)!.dueUtc).toBe(clock.now + 4 * HOUR)
  await reminders.devAge(24 * HOUR)
  expect(reminders.get(own.id)!.dueUtc).toBe(clock.now)
  expect(reminders.get(human.id)!.dueUtc).toBe(clock.now + 28 * HOUR)
})

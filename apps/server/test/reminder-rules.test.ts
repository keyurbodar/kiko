import { expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import { MAX_FAILS, type DeliverRun, type Reminder, Reminders, type RunDelivery } from "../src/user/reminders"
import { sqlWith } from "./sql-shim"
import { USER_STEPS } from "../src/user/schema"

const ROOM = "01J0000000000000000000000R" as RoomId
const MIN = 60_000
const DAY = 86_400_000

function setup(results: RunDelivery[] = [], pages: string[] = [], deliverFails = false, runFails = false) {
  const sql = sqlWith(USER_STEPS)
  sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'plans', 0)", ROOM)
  const clock = { now: Date.UTC(2026, 9, 10, 12) }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms
  const runs: { deliveryId: string; body: string }[] = []
  const posted: string[] = []
  const notices: string[] = []
  const away = { now: false }
  const deliverRun: DeliverRun = async ({ deliveryId, body }) => {
    runs.push({ deliveryId, body })
    if (runFails) throw new Error("room unreachable")
    return results.shift() ?? "delivered"
  }
  const reminders = new Reminders(sql, alarms, async (id: string, _r: Reminder) => {
    if (deliverFails) throw new Error("room unreachable")
    posted.push(id)
  }, () => clock.now, {
    deliverRun,
    watch: async () => ({ ok: true, text: pages.shift() ?? "same" }),
    notice: async (_roomId, _id, text) => void notices.push(text),
    gate: { away: () => away.now },
  })
  return { sql, clock, reminders, runs, posted, notices, away }
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

test("a routine run is held, not delivered, while the human is away", async () => {
  const { clock, reminders, runs, away } = setup()
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + MIN).toISOString(), rrule: "FREQ=DAILY" }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  away.now = true
  expect(await reminders.runNow(routine.id)).toBe("held")
  expect(runs).toEqual([])
  away.now = false
  expect(await reminders.runNow(routine.id)).toBe("delivered")
  expect(runs).toHaveLength(1)
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
  const own = await reminders.create("u", { text: "bring the checklist", time: new Date(clock.now + 28 * HOUR).toISOString(), tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "yuki" })
  const human = await reminders.create("u", { text: "call mom", time: new Date(clock.now + 28 * HOUR).toISOString(), tz: "UTC", roomId: ROOM })
  await reminders.devAge(24 * HOUR)
  expect(reminders.get(own.id)!.dueUtc).toBe(clock.now + 4 * HOUR)
  await reminders.devAge(24 * HOUR)
  expect(reminders.get(own.id)!.dueUtc).toBe(clock.now)
  expect(reminders.get(human.id)!.dueUtc).toBe(clock.now + 28 * HOUR)
})

test("snooze moves only time reminders, and a paused time routine stays paused", async () => {
  const { clock, reminders } = setup()
  const message = await reminders.createRoutine("u", { name: "talk", instructions: "say hi", trigger: { on: "message", from: "human" }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  await expect(reminders.snooze(message.routine.id, new Date(clock.now + MIN).toISOString())).rejects.toThrow("snooze works on time reminders")
  const timed = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + DAY).toISOString() }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  await reminders.updateRoutine(timed.routine.id, { status: "paused" })
  const snoozed = await reminders.snooze(timed.routine.id, new Date(clock.now + 2 * DAY).toISOString())
  expect(snoozed?.status).toBe("paused")
})

test("a refused routine run counts toward auto-pause", async () => {
  const { clock, reminders } = setup(["refused", "refused", "refused"])
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + DAY).toISOString() }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  for (let i = 0; i < MAX_FAILS; i++) await reminders.runNow(routine.id)
  expect(reminders.get(routine.id)?.status).toBe("paused")
})

test("a routine whose delivery throws counts toward auto-pause, like a refused run", async () => {
  const { clock, reminders, notices } = setup([], [], false, true)
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + DAY).toISOString() }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  for (let i = 0; i < MAX_FAILS; i++) await reminders.runNow(routine.id)
  expect(reminders.get(routine.id)?.status).toBe("paused")
  expect(notices.length).toBe(1)
})

test("a chat holds at most 100 reminders, and a full chat refuses one more", async () => {
  const { clock, reminders } = setup()
  const at = new Date(clock.now + DAY).toISOString()
  for (let i = 0; i < 100; i++) await reminders.create("u", { text: `note ${i}`, time: at, tz: "UTC", roomId: ROOM })
  await expect(reminders.create("u", { text: "one too many", time: at, tz: "UTC", roomId: ROOM })).rejects.toThrow("this chat already has 100 reminders. cancel one first.")
})

test("a time more than a year away is refused for a reminder and for a snooze", async () => {
  const { clock, reminders } = setup()
  const far = "9999-12-31T00:00:00Z"
  await expect(reminders.create("u", { text: "far", time: far, tz: "UTC", roomId: ROOM })).rejects.toThrow("more than a year away")
  const near = await reminders.create("u", { text: "near", time: new Date(clock.now + 300 * DAY).toISOString(), tz: "UTC", roomId: ROOM })
  await expect(reminders.snooze(near.id, far)).rejects.toThrow("more than a year away")
})

test("a one-off reminder that keeps failing is marked failed after three tries, and the human is told once", async () => {
  const { clock, reminders, notices } = setup([], [], true)
  const reminder = await reminders.create("u", { text: "water", time: new Date(clock.now + MIN).toISOString(), tz: "UTC", roomId: ROOM })
  clock.now += MIN
  for (let i = 0; i < 5; i++) await reminders.fire()
  expect(reminders.get(reminder.id)?.status).toBe("failed")
  expect(notices.length).toBe(1)
})

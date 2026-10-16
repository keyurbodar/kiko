import { expect, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import { MAX_FAILS, type DeliverRun, Reminders, type RunDelivery } from "../src/user/reminders"
import { sqlWith } from "./sql-shim"
import { USER_STEPS } from "../src/user/schema"

const ROOM = "01J0000000000000000000000R" as RoomId
const MIN = 60_000
const DAY = 86_400_000

function setup(results: RunDelivery[] = [], runFails = false) {
  const sql = sqlWith(USER_STEPS)
  sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'plans', 0)", ROOM)
  const clock = { now: Date.UTC(2026, 9, 10, 12) }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms
  const runs: { deliveryId: string; body: string }[] = []
  const notices: string[] = []
  const away = { now: false }
  const deliverRun: DeliverRun = async ({ deliveryId, body }) => {
    runs.push({ deliveryId, body })
    if (runFails) throw new Error("room unreachable")
    return results.shift() ?? "delivered"
  }
  const reminders = new Reminders(sql, alarms, () => clock.now, {
    deliverRun,
    notice: async (_roomId, _id, text) => void notices.push(text),
    gate: { away: () => away.now },
  })
  return { sql, clock, reminders, runs, notices, away }
}

test("a routine run is held, not delivered, while the human is away", async () => {
  const { clock, reminders, runs, away } = setup()
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + MIN).toISOString(), rrule: "FREQ=DAILY" }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" })
  away.now = true
  expect(await reminders.runNow(routine.id)).toBe("held")
  expect(runs).toEqual([])
  away.now = false
  expect(await reminders.runNow(routine.id)).toBe("delivered")
  expect(runs).toHaveLength(1)
})

const timeRoutine = (at: number, extra: Record<string, unknown> = {}) => ({ name: "water", instructions: "tell the human to drink water", trigger: { on: "time" as const, at: new Date(at).toISOString(), ...extra }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" })

test("a one-time routine runs once at its time, then is done, like a reminder did", async () => {
  const { clock, reminders, runs } = setup()
  const { routine } = await reminders.createRoutine("u", timeRoutine(clock.now + 5 * MIN))
  await reminders.fire()
  expect(runs).toEqual([])
  clock.now += 5 * MIN
  await reminders.fire()
  await reminders.fire()
  expect(runs.map((r) => r.deliveryId)).toEqual([`${routine.id}:${routine.dueUtc}`])
  expect(runs[0]!.body).toContain("tell the human to drink water")
  expect(reminders.get(routine.id)).toMatchObject({ status: "done", lastFired: routine.dueUtc })
})

test("a one-time routine that is a day late still runs, a repeating one skips what it missed", async () => {
  const { clock, reminders, runs } = setup()
  const once = await reminders.createRoutine("u", timeRoutine(clock.now + MIN))
  const daily = await reminders.createRoutine("u", { ...timeRoutine(clock.now + MIN, { rrule: "FREQ=DAILY" }), name: "daily" })
  clock.now += DAY + MIN
  await reminders.fire()
  expect(runs.map((r) => r.deliveryId)).toEqual([`${once.routine.id}:${once.routine.dueUtc}`])
  expect(reminders.get(daily.routine.id)).toMatchObject({ status: "active", dueUtc: daily.routine.dueUtc + 2 * DAY })
})

test("a routine repeats at most every 30 minutes", async () => {
  const { reminders } = setup()
  const at = Date.UTC(2026, 9, 10, 13)
  await expect(reminders.createRoutine("u", timeRoutine(at, { rrule: "FREQ=MINUTELY" }))).rejects.toThrow("at most every 30 minutes")
})

test("a routine with a trigger kiko dropped is refused, and resuming a stored one says why", async () => {
  const { sql, clock, reminders } = setup()
  const watch = { on: "watch" as const, url: "https://example.com", everyMinutes: 15 }
  await expect(reminders.createRoutine("u", { ...timeRoutine(clock.now + DAY), trigger: watch as never })).rejects.toThrow("no longer supported")
  const { routine } = await reminders.createRoutine("u", timeRoutine(clock.now + DAY))
  sql.exec("UPDATE reminders SET trigger = ?, status = 'paused', due_utc = 0 WHERE id = ?", JSON.stringify(watch), routine.id)
  await expect(reminders.updateRoutine(routine.id, { status: "active" })).rejects.toThrow("no longer supported")
  expect(await reminders.runNow(routine.id)).toBeNull()
  await reminders.fire()
  expect(reminders.get(routine.id)?.status).toBe("paused")
})

test("a refused routine run counts toward auto-pause", async () => {
  const { clock, reminders } = setup(["refused", "refused", "refused"])
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + DAY).toISOString() }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" })
  for (let i = 0; i < MAX_FAILS; i++) await reminders.runNow(routine.id)
  expect(reminders.get(routine.id)?.status).toBe("paused")
})

test("a routine whose delivery throws counts toward auto-pause, like a refused run", async () => {
  const { clock, reminders, notices } = setup([], true)
  const { routine } = await reminders.createRoutine("u", { name: "daily", instructions: "check in", trigger: { on: "time", at: new Date(clock.now + DAY).toISOString() }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" })
  for (let i = 0; i < MAX_FAILS; i++) await reminders.runNow(routine.id)
  expect(reminders.get(routine.id)?.status).toBe("paused")
  expect(notices.length).toBe(1)
})

test("one cap covers every routine: 50 per agent in a chat, one-time or not", async () => {
  const { clock, reminders } = setup()
  for (let i = 0; i < 50; i++) await reminders.createRoutine("u", { ...timeRoutine(clock.now + DAY), name: `note ${i}` })
  await expect(reminders.createRoutine("u", timeRoutine(clock.now + DAY))).rejects.toThrow("@kiko already has 50 routines in this chat. cancel one first.")
})

test("a time more than a year away is refused", async () => {
  const { reminders } = setup()
  await expect(reminders.createRoutine("u", timeRoutine(Date.parse("9999-12-31T00:00:00Z")))).rejects.toThrow("more than a year away")
})

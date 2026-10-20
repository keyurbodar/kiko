import { afterEach, expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { createRegistry, Harness } from "@earendil-works/pi-durable"
import { JOURNAL_STEPS, JournalStorage } from "@kiko/agent/journal"
import type { RoomId } from "@kiko/protocol"
import { Clock } from "../src/owner/clock"
import { RoutineSchedules, scheduledDeadline, type RoutineScheduler } from "../src/owner/schedules"
import { Reminders, type RunDelivery } from "../src/user/reminders"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const context = BACKGROUND_CONTEXT
const ROOM = "01J0000000000000000000000R" as RoomId
const opened = new Set<Harness>()
afterEach(async () => {
  await Promise.all([...opened].map((harness) => harness.close(context)))
  opened.clear()
})

async function setup(result: RunDelivery = "delivered") {
  const sql = sqlWith([...USER_STEPS, ...JOURNAL_STEPS])
  sql.exec("INSERT INTO room_directory (room_id) VALUES (?)", ROOM)
  const clock = { now: Date.UTC(2026, 9, 10, 12) }
  const delivered: string[] = []
  let scheduler: RoutineScheduler = { sync: async () => { throw new Error("scheduler not attached") } }
  const reminders = new Reminders(sql, { sync: (entries) => scheduler.sync(entries) }, () => clock.now, {
    deliverRun: async ({ requestId, deliveryId }) => {
      expect(requestId).toBe(deliveryId)
      delivered.push(requestId)
      return result
    },
    notice: async () => {}, gate: { away: () => false },
  })
  async function open() {
    const schedules = new RoutineSchedules((input) => reminders.fireScheduled(input))
    const registry = createRegistry()
    registry.install(schedules.extension)
    const storage = JournalStorage.open({ sql, transactionSync: <T>(fn: () => T) => fn() } as DurableObjectStorage, "schedules")
    const harness = await Harness.open(storage, { models: createModels(), registry, now: () => clock.now }, context)
    opened.add(harness)
    const root = await harness.root(context, { agent: { extensions: [schedules.extension] } })
    scheduler = schedules.bind(harness, root.id)
    return harness
  }
  const harness = await open()
  const create = (runAt = clock.now + 60_000, rrule?: string) => reminders.createRoutine("owner", {
    name: "water", instructions: "drink water", trigger: { on: "time", at: new Date(runAt).toISOString(), ...(rrule ? { rrule } : {}) },
    roomId: ROOM, target: "kiko", createdBy: "human", tz: "UTC",
  })
  const finish = async (h: Harness) => {
    const { tasks } = await h.inspect(context)
    await Promise.all(tasks.map(({ record }) => h.waitForTask(record.id, context)))
  }
  return { sql, clock, reminders, delivered, harness, create, open, finish }
}

test("35 routines use one Clock alarm and all deliver at the exact minute after reopening", async () => {
  const t = await setup()
  const runAt = t.clock.now + 60_000
  const routines = []
  let loaded: Harness | undefined = t.harness
  let alarm: number | null = null
  let alarmsSet = 0
  const clock = new Clock({
    getAlarm: async () => alarm,
    setAlarm: async (at) => { alarm = Number(at); alarmsSet++ },
    deleteAlarm: async () => { alarm = null },
  }, async () => ({
    loaded: loaded ? [{ id: "kiko", tasks: (await loaded.inspect(context)).tasks, scheduledDeadline }] : [],
    unloaded: loaded ? [] : [runAt],
  }), () => t.clock.now)
  for (let i = 0; i < 35; i++) {
    routines.push((await t.create(runAt)).routine)
    await clock.refresh()
  }
  expect(alarm).toBe(runAt)
  expect(alarmsSet).toBe(1)
  const live = await t.harness.inspect(context)
  expect(live.tasks).toHaveLength(35)
  expect(new Set(live.tasks.map(scheduledDeadline))).toEqual(new Set([runAt]))
  t.harness.resume()
  await t.harness.close(context)
  loaded = undefined
  await clock.refresh()
  t.clock.now = runAt - 1
  const before = await t.open()
  loaded = before
  await clock.refresh()
  before.resume()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(t.delivered).toEqual([])
  expect(alarm).toBe(runAt)
  expect(alarmsSet).toBe(1)
  await before.close(context)
  loaded = undefined
  t.clock.now = runAt
  expect(alarm).toBe(t.clock.now)
  alarm = null
  const due = await t.open()
  loaded = due
  await t.finish(due)
  await clock.refresh()
  expect(alarmsSet).toBe(1)
  expect(alarm).toBeNull()
  expect(t.delivered.sort()).toEqual(routines.map((r) => `${r.id}:${runAt}`).sort())
  expect(t.reminders.list().every((r) => r.status === "done")).toBe(true)
  await t.reminders.rearm()
  const again = await t.open()
  await t.finish(again)
  expect(t.delivered).toHaveLength(35)
  expect((await again.inspect(context)).tasks).toEqual([])
})

test("retiming, pausing, and deleting remove obsolete durable tasks", async () => {
  const t = await setup()
  const a = (await t.create()).routine
  const b = (await t.create()).routine
  const c = (await t.create()).routine
  const later = t.clock.now + 120_000
  await t.reminders.updateRoutine(a.id, { trigger: { on: "time", at: new Date(later).toISOString() } })
  await t.reminders.updateRoutine(b.id, { status: "paused" })
  await t.reminders.deleteRoutine(c.id)
  await t.harness.close(context)
  t.clock.now = later
  const due = await t.open()
  await t.finish(due)
  expect(t.delivered).toEqual([`${a.id}:${later}`])
  expect(t.reminders.runs(b.id)).toEqual([])
  expect(t.reminders.runs(c.id)).toEqual([])
})

test("a repeating routine creates just its next exact occurrence", async () => {
  const t = await setup()
  const routine = (await t.create(undefined, "FREQ=DAILY")).routine
  await t.harness.close(context)
  t.clock.now = routine.dueUtc
  const due = await t.open()
  await t.finish(due)
  expect(t.delivered).toEqual([`${routine.id}:${routine.dueUtc}`])
  const next = routine.dueUtc + 86_400_000
  expect(t.reminders.get(routine.id)?.dueUtc).toBe(next)
  expect((await due.inspect(context)).tasks.map(scheduledDeadline)).toEqual([next])
})

test("a refused one-time delivery finishes without a retry task", async () => {
  const t = await setup("refused")
  const { routine } = await t.create()
  await t.harness.close(context)
  t.clock.now = routine.dueUtc
  const due = await t.open()
  await t.finish(due)
  expect(t.reminders.runs(routine.id)[0]?.status).toBe("failed")
  expect((await due.inspect(context)).tasks).toEqual([])
  await t.reminders.rearm()
  expect((await due.inspect(context)).tasks).toEqual([])
  expect(t.delivered).toHaveLength(1)
})


test("an interrupted delivery replays with the same requestId and creates one run", async () => {
  const sql = sqlWith(JOURNAL_STEPS)
  const attempts: string[] = []
  const runs = new Set<string>()
  const arrived = Promise.withResolvers<void>()
  let first = true
  async function open() {
    const schedules = new RoutineSchedules(async ({ requestId }, signal) => {
      attempts.push(requestId)
      runs.add(requestId)
      if (!first) return
      first = false
      arrived.resolve()
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
    })
    const registry = createRegistry()
    registry.install(schedules.extension)
    const storage = JournalStorage.open({ sql, transactionSync: <T>(fn: () => T) => fn() } as DurableObjectStorage, "schedules")
    const harness = await Harness.open(storage, { models: createModels(), registry }, context)
    opened.add(harness)
    const root = await harness.root(context, { agent: { extensions: [schedules.extension] } })
    return { harness, scheduler: schedules.bind(harness, root.id) }
  }
  const input = { routineId: "water", runAt: Date.now() - 1 }
  const a = await open()
  await a.scheduler.sync([input])
  a.harness.resume()
  await arrived.promise
  await a.harness.close(context)
  const b = await open()
  const live = await b.harness.inspect(context)
  expect(live.tasks).toHaveLength(1)
  expect(live.tasks[0]?.record.state.checkpoint).toEqual({ phase: "deliver" })
  await Promise.all(live.tasks.map(({ record }) => b.harness.waitForTask(record.id, context)))
  await b.scheduler.sync([input])
  expect((await b.harness.inspect(context)).tasks).toEqual([])
  expect(attempts).toEqual([`water:${input.runAt}`, `water:${input.runAt}`])
  expect(runs.size).toBe(1)
})

test("an empty scheduler stays idle for a simulated day", async () => {
  const t = await setup()
  const before = t.sql.exec<{ n: number }>("SELECT count(*) AS n FROM journal").one().n
  t.clock.now += 86_400_000
  t.harness.resume()
  await t.harness.waitForIdle(context)
  expect((await t.harness.inspect(context)).tasks).toEqual([])
  expect(t.sql.exec<{ n: number }>("SELECT count(*) AS n FROM journal").one().n).toBe(before)
})

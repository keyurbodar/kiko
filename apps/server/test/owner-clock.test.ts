import { expect, test } from "bun:test"
import { MemoryStorage, ROOT_CONVERSATION_ID, type TaskId, type TaskInspection } from "@earendil-works/pi-durable"
import { Clock, createServiceClock, runDue, type ClockSnapshot } from "../src/owner/clock"

function fixture() {
  let now = Date.UTC(2026, 9, 20)
  let alarm: number | null = null
  let writes = 0
  let sets = 0
  let snapshot: ClockSnapshot = { loaded: [], unloaded: [] }
  const clock = new Clock({
    getAlarm: async () => alarm,
    setAlarm: async (at) => { alarm = +at; writes++; sets++ },
    deleteAlarm: async () => { alarm = null; writes++ },
  }, () => snapshot, () => now)
  return {
    clock,
    snapshot: (value: ClockSnapshot) => { snapshot = value },
    advance: (ms: number) => { now += ms },
    now: () => now,
    alarm: () => alarm,
    writes: () => writes,
    sets: () => sets,
  }
}

const memory = new MemoryStorage()
async function task(state: TaskInspection["state"] = { kind: "running" }, abortRequested = false): Promise<TaskInspection> {
  return {
    record: { id: await memory.mintId<TaskId>(), conversationId: ROOT_CONVERSATION_ID, kind: "test", version: 1, input: null, background: false, abortRequested, state: { status: "running", checkpoint: null } },
    state,
  }
}

test("24 simulated idle hours write no rows and arm no alarms", async () => {
  const f = fixture()
  for (let minute = 0; minute < 24 * 60; minute++) {
    await f.clock.refresh()
    f.advance(60_000)
  }
  expect({ alarm: f.alarm(), writes: f.writes(), sets: f.sets() }).toEqual({ alarm: null, writes: 0, sets: 0 })
})

test("35 loaded schedules at the same exact minute arm once", async () => {
  const f = fixture()
  const at = f.now() + 35 * 60_000
  const tasks = await Promise.all(Array.from({ length: 35 }, () => task()))
  f.snapshot({ loaded: [{ id: "agent", tasks, scheduledDeadline: () => at }], unloaded: [] })
  await Promise.all(Array.from({ length: 35 }, () => f.clock.refresh()))
  expect(f.alarm()).toBe(at)
  expect(f.sets()).toBe(1)
  f.snapshot({ loaded: [], unloaded: [at] })
  await f.clock.refresh()
  expect(f.sets()).toBe(1)
})

test("blocked tasks do not wake; aborts use recovery instead of future sleep", async () => {
  const f = fixture()
  f.snapshot({ loaded: [{ id: "blocked", tasks: [await task({ kind: "blocked", reason: "missing_task" })], scheduledDeadline: () => f.now() + 10_000 }], unloaded: [] })
  await f.clock.refresh()
  expect(f.alarm()).toBeNull()
  f.snapshot({ loaded: [{ id: "aborted", tasks: [await task(undefined, true)], scheduledDeadline: () => f.now() + 600_000 }], unloaded: [] })
  await f.clock.refresh()
  expect(f.alarm()).toBe(f.now() + 60_000)
})

test("runnable task recovery is not postponed by refresh and clears on settlement", async () => {
  const f = fixture()
  f.snapshot({ loaded: [{ id: "active", tasks: [await task()], scheduledDeadline: () => undefined }], unloaded: [] })
  await f.clock.refresh()
  const deadline = f.alarm()
  f.advance(10_000)
  await f.clock.refresh()
  expect(f.alarm()).toBe(deadline)
  expect(f.sets()).toBe(1)
  f.snapshot({ loaded: [], unloaded: [] })
  await f.clock.refresh()
  expect(f.alarm()).toBeNull()
})

test("the earliest loaded, unloaded, queued, hello or lease deadline wins", async () => {
  const f = fixture()
  const at = f.now()
  f.snapshot({ loaded: [{ id: "loaded", tasks: [await task()], scheduledDeadline: () => at + 9000 }], unloaded: [at + 8000], lease: at + 7000, hello: at + 6000, queued: at + 5000 })
  await f.clock.refresh()
  expect(f.alarm()).toBe(at + 5000)
  f.snapshot({ loaded: [], unloaded: [at + 8000], lease: at + 7000, hello: at + 6000 })
  await f.clock.refresh()
  expect(f.alarm()).toBe(at + 6000)
})

function serviceClock() {
  const values = new Map<string, string>()
  let projected: number | undefined
  let writes = 0
  const clock = createServiceClock({
    metadata: { get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); writes++ }, delete: (key) => { values.delete(key); writes++ } },
    publish: async (at, persist) => { persist(); projected = at },
  })
  return { clock, values, projected: () => projected, writes: () => writes }
}

test("a failed due handler retains its durable deadline for Cloudflare retry and never schedules a new one", async () => {
  const f = serviceClock()
  await f.clock.setWakeup("burst", 100)
  const writes = f.writes()
  await expect(runDue(f.clock, await f.clock.dueWakeups(100), { burst: () => { throw new Error("failed delivery") } })).rejects.toThrow("Clock handlers failed")
  expect(f.clock.deadline("burst")).toBe(100)
  expect(f.projected()).toBe(100)
  expect(f.writes()).toBe(writes)
  let delivered = 0
  await runDue(f.clock, await f.clock.dueWakeups(100), { burst: () => { delivered++ } })
  expect(delivered).toBe(1)
  expect(f.clock.deadline("burst")).toBeUndefined()
  expect(f.projected()).toBeUndefined()
})

test("a handler's replacement deadline survives its successful acknowledgment", async () => {
  const f = serviceClock()
  await f.clock.setWakeup("burst", 100)
  await runDue(f.clock, await f.clock.dueWakeups(100), { burst: () => f.clock.setWakeup("burst", 200) })
  expect(f.clock.deadline("burst")).toBe(200)
  expect(f.projected()).toBe(200)
})

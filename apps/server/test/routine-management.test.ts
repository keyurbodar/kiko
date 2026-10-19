import { expect, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import { sha256Hex } from "@kiko/durable/hash"
import { routineLine, routinesExtension, type RoutinesPort } from "../src/agent/extensions/routines"
import { Reminders, type DeliverRun } from "../src/user/reminders"
import { routineResult } from "../src/user/routines"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000R" as RoomId
const MIN = 60_000

function setup(deliverRun: DeliverRun = async () => "delivered") {
  const sql = sqlWith(USER_STEPS)
  sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'plans', 0)", ROOM)
  const clock = { now: Date.UTC(2026, 9, 10, 12) }
  const reminders = new Reminders(sql, { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms, () => clock.now, {
    deliverRun,
    notice: async () => {},
    gate: { away: () => false },
  })
  const port: RoutinesPort = {
    list: async () => reminders.list(),
    delete: async (id) => { await reminders.deleteRoutine(id); return { ok: true } },
    cancel: (id) => routineResult(async () => {
      const routine = await reminders.cancel(id)
      return routine ? { routine } : null
    }),
    createRoutine: (input) => routineResult(() => reminders.createRoutine("owner", { ...input, target: input.target ?? "kiko", roomId: ROOM, tz: "UTC", createdBy: "kiko" })),
    updateRoutine: (id, patch) => routineResult(() => reminders.updateRoutine(id, patch)),
    runRoutine: (id) => reminders.runNow(id),
    runs: async (id) => reminders.runs(id),
    origin: async () => "https://kiko.test",
    addRecipe: async () => ({ ok: false, error: "not used" }),
  }
  const extension = routinesExtension(() => port)
  const call = async (name: string, args: unknown = {}) => {
    const tool = extension.tools?.find((t) => t.name === name)
    if (!tool || !("execute" in tool)) throw new Error(`missing tool ${name}`)
    const execute = tool.execute as (args: unknown, api: unknown) => Promise<{ output: { text?: string }[]; isError?: boolean }>
    return execute(args, { conversationId: "c", callId: "1" })
  }
  const create = () => reminders.createRoutine("owner", { name: "water", instructions: "tell the human to drink water", trigger: { on: "time", at: new Date(clock.now + MIN).toISOString() }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" })
  return { sql, clock, reminders, call, create }
}

test("listing includes completed and failed routines with instructions and last run details", async () => {
  const { sql, clock, reminders, call, create } = setup()
  const { routine } = await create()
  const failed = await create()
  sql.exec("UPDATE reminders SET status = 'failed', fails = 3 WHERE id = ?", failed.routine.id)
  const cancelled = await create()
  await reminders.cancel(cancelled.routine.id)
  clock.now += MIN
  await reminders.fire()
  await reminders.finishRun(routine.id, String(routine.dueUtc), "failed", null)
  const result = await call("list_routines")
  const output = result.output[0]!.text!
  expect(output).toContain(`${routine.id}: routine "water" (done)`)
  expect(output).toContain(`${failed.routine.id}: routine "water" (failed)`)
  expect(output).toContain("instructions: tell the human to drink water")
  expect(output).toContain(`last run failed, started ${new Date(clock.now).toISOString()}, ended ${new Date(clock.now).toISOString()}`)
  expect(output).toContain("consecutive failures 3")
  expect(output).not.toContain(cancelled.routine.id)
})

test("overdue one-time routines can be edited and paused, but need a future trigger to resume", async () => {
  const { clock, reminders, call, create } = setup()
  const { routine } = await create()
  clock.now += 2 * MIN
  expect((await call("update_routine", { id: routine.id, instructions: "take a break" })).isError).toBeUndefined()
  expect(reminders.get(routine.id)?.text).toBe("take a break")
  expect((await call("update_routine", { id: routine.id, status: "paused" })).isError).toBeUndefined()
  expect((await call("update_routine", { id: routine.id, status: "active" })).isError).toBe(true)
  const trigger = { on: "time", at: new Date(clock.now + MIN).toISOString() }
  expect((await call("update_routine", { id: routine.id, trigger, status: "active" })).isError).toBeUndefined()
  expect(reminders.get(routine.id)).toMatchObject({ status: "active", dueUtc: clock.now + MIN })
})

test("a completed one-time routine can be rescheduled and runs at its new time", async () => {
  const { clock, reminders, call, create } = setup()
  const { routine } = await create()
  clock.now += MIN
  await reminders.fire()
  expect((await call("update_routine", { id: routine.id, status: "active" })).isError).toBe(true)
  expect((await call("update_routine", { id: routine.id, trigger: { on: "time", at: new Date(clock.now - MIN).toISOString() } })).isError).toBe(true)
  expect((await call("update_routine", { id: routine.id, trigger: { on: "time", at: new Date(clock.now + MIN).toISOString() } })).isError).toBeUndefined()
  expect(reminders.get(routine.id)?.status).toBe("active")
  clock.now += MIN
  await reminders.fire()
  expect(reminders.runs(routine.id)).toHaveLength(2)
  expect(reminders.get(routine.id)?.status).toBe("done")
})

test("converting to a webhook returns its working URL once", async () => {
  const { reminders, call, create } = setup()
  const { routine } = await create()
  const converted = await call("update_routine", { id: routine.id, trigger: { on: "webhook" } })
  expect(converted.isError).toBeUndefined()
  const token = converted.output[0]!.text!.match(/https:\/\/kiko.test\/api\/hooks\/([a-f0-9]+)/)?.[1]
  expect(token).toHaveLength(48)
  expect(reminders.byHook(await sha256Hex(token!))?.id).toBe(routine.id)
  expect((await call("update_routine", { id: routine.id, instructions: "check the webhook" })).output[0]!.text).not.toContain("/api/hooks/")
})

test("cancellation succeeds again on replay and cancels failed rows", async () => {
  const { sql, reminders, call, create } = setup()
  const { routine } = await create()
  sql.exec("UPDATE reminders SET status = 'failed' WHERE id = ?", routine.id)
  for (let i = 0; i < 2; i++) {
    expect(await call("cancel_routine", { id: routine.id })).toEqual({ output: [{ type: "text", text: "cancelled" }] })
  }
  expect(reminders.get(routine.id)?.status).toBe("cancelled")
  expect((await call("cancel_routine", { id: "missing" })).isError).toBe(true)
})

test("a live inventory never claims an empty run history when history was not queried", async () => {
  const { create } = setup()
  const { routine } = await create()
  expect(routineLine(routine)).not.toContain("no runs yet")
  expect(routineLine(routine, [])).toContain("no runs yet")
})


test("delete_routine permanently removes cancelled instructions and history and is safe to replay", async () => {
  const { reminders, call, create } = setup()
  const { routine } = await create()
  await reminders.runNow(routine.id)
  await reminders.cancel(routine.id)
  const [run] = reminders.runs(routine.id)
  expect(run).toBeDefined()
  for (let i = 0; i < 2; i++) expect(await call("delete_routine", { id: routine.id })).toEqual({ output: [{ type: "text", text: "deleted" }] })
  expect(reminders.get(routine.id)).toBeNull()
  expect(reminders.runs(routine.id)).toEqual([])
  await reminders.finishRun(routine.id, run!.occurrence, "done", 1)
  expect(reminders.runs(routine.id)).toEqual([])
})


test("deletion purges recipe and loop links along with the routine", async () => {
  const { sql, reminders, create } = setup()
  const { routine } = await create()
  sql.exec("INSERT INTO recipe_links (routine_id, install_id) VALUES (?, 'install')", routine.id)
  sql.exec("INSERT INTO loop_reminders (reminder_id, loop_id) VALUES (?, 42)", routine.id)
  await reminders.deleteRoutine(routine.id)
  expect(sql.exec("SELECT * FROM recipe_links").toArray()).toEqual([])
  expect(sql.exec("SELECT * FROM loop_reminders").toArray()).toEqual([])
})

test("a deleted routine in an already selected due batch never delivers or recreates history", async () => {
  const delivered: string[] = []
  let arrived!: () => void
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { arrived = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  const { clock, reminders, create } = setup(async ({ routine }) => {
    delivered.push(routine.id)
    arrived()
    await held
    return "delivered"
  })
  const a = (await create()).routine
  const b = (await create()).routine
  clock.now += MIN
  const firing = reminders.fire()
  await waiting
  const deleted = delivered[0] === a.id ? b : a
  await reminders.deleteRoutine(deleted.id)
  release()
  await firing
  expect(delivered).toHaveLength(1)
  expect(reminders.get(deleted.id)).toBeNull()
  expect(reminders.runs(deleted.id)).toEqual([])
})


test("a delivery settling after deletion cannot recreate the routine or run history", async () => {
  let arrived!: () => void
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { arrived = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  const { reminders, create } = setup(async () => {
    arrived()
    await held
    return "refused"
  })
  const { routine } = await create()
  const running = reminders.runNow(routine.id)
  await waiting
  let deleted = false
  const deletion = reminders.deleteRoutine(routine.id).then(() => { deleted = true })
  await Promise.resolve()
  expect(deleted).toBe(false)
  release()
  await deletion
  await running
  expect(reminders.get(routine.id)).toBeNull()
  expect(reminders.runs(routine.id)).toEqual([])
})

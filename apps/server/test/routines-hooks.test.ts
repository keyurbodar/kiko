import { expect, spyOn, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import { sha256Hex } from "@kiko/durable/hash"
import { Reminders } from "../src/user/reminders"
import { RoutineWiring } from "../src/user/routines-wiring"
import { sqlWith } from "./sql-shim"
import { OWNER_STEPS } from "../src/owner/schema"

const ROOM = "01J0000000000000000000000R" as RoomId

function routines() {
  const sql = sqlWith(OWNER_STEPS)
  sql.exec("INSERT INTO room_directory (room_id) VALUES (?)", ROOM)
  const scheduler = { sync: async () => {} }
  const reminders = new Reminders(sql, scheduler, () => Date.now())
  const wiring = new RoutineWiring({ reminders, setRoutines: async () => {}, routineCreated: async () => {} })
  return { sql, reminders, wiring }
}

const hook = { name: "hook", instructions: "say hi", trigger: { on: "webhook" as const }, tz: "UTC", roomId: ROOM, target: "kiko", createdBy: "human" }
const timed = { on: "time" as const, at: new Date(Date.now() + 86_400_000).toISOString() }

test("a webhook token finds its routine by hash, and a wrong token finds none", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", hook)
  if (!made.ok || !made.token) throw new Error("no webhook token")
  expect(t.reminders.byHook(await sha256Hex(made.token))?.id).toBe(made.routine.id)
  expect(t.reminders.byHook(await sha256Hex("0".repeat(48)))).toBeNull()
})

test("the hook lookup reads the index, not the table", () => {
  const t = routines()
  const plan = t.sql.exec<{ detail: string }>("EXPLAIN QUERY PLAN SELECT * FROM reminders WHERE hook_hash = ? AND status = 'active'", "x").toArray()
  expect(plan.map((r) => r.detail).join(" ")).toContain("reminders_hook")
})

test("deleting a chat cancels its webhook routines, so the token stops working", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", hook)
  if (!made.ok || !made.token) throw new Error("no webhook token")
  await t.reminders.cancelRoom(ROOM)
  expect(t.reminders.byHook(await sha256Hex(made.token))).toBeNull()
})

test("cancelling a webhook routine stops its token", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", hook)
  if (!made.ok || !made.token) throw new Error("no webhook token")
  await t.wiring.cancelRoutine(made.routine.id)
  expect(t.reminders.byHook(await sha256Hex(made.token))).toBeNull()
})

test("editing a webhook's trigger keeps its token and mints none", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", hook)
  if (!made.ok || !made.token) throw new Error("no webhook token")
  const random = spyOn(crypto, "getRandomValues")
  const out = await t.wiring.updateRoutine(made.routine.id, { trigger: { on: "webhook" } })
  const mints = random.mock.calls.length
  random.mockRestore()
  expect(out.ok).toBe(true)
  expect(mints).toBe(0)
  expect(t.reminders.byHook(await sha256Hex(made.token))).not.toBeNull()
})

test("a routine that becomes a webhook gets a token that finds it", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", { ...hook, trigger: timed })
  if (!made.ok) throw new Error(made.error)
  const out = await t.wiring.updateRoutine(made.routine.id, { trigger: { on: "webhook" } })
  if (!out.ok || !out.token) throw new Error("no webhook token")
  expect(t.reminders.byHook(await sha256Hex(out.token))?.id).toBe(made.routine.id)
})

test("deleting an agent purges its routine instructions and run history", async () => {
  const t = routines()
  const made = await t.wiring.createRoutine("u", { ...hook, target: "radar" })
  if (!made.ok) throw new Error(made.error)
  t.sql.exec("INSERT INTO routine_runs (routine_id, occurrence, started_at, status) VALUES (?, 'one', 1, 'done')", made.routine.id)
  await t.reminders.cancelAgent("radar")
  expect(t.sql.exec("SELECT * FROM reminders").toArray()).toEqual([])
  expect(t.sql.exec("SELECT * FROM routine_runs").toArray()).toEqual([])
})

import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import type { Env } from "../src/index"
import { sha256Hex } from "@yuki/durable/hash"
import { Reminders } from "../src/user/reminders"
import { RoutineWiring } from "../src/user/routines-wiring"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000R" as RoomId

test("a webhook routine is not created when its lookup row cannot be stored", async () => {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE chats (room_id TEXT PRIMARY KEY)")
  sql.exec("INSERT INTO chats (room_id) VALUES (?)", ROOM)
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms
  const reminders = new Reminders(sql, alarms, async () => {}, () => Date.now())
  const AUTH_DB = { prepare: () => ({ bind: () => ({ run: async () => Promise.reject(new Error("d1 unavailable")) }) }) }
  const wiring = new RoutineWiring({ env: { AUTH_DB } as unknown as Env, reminders, extensions: {} as never })
  const out = await wiring.createRoutine("u", { name: "hook", instructions: "say hi", trigger: { on: "webhook" }, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  expect(out.ok).toBe(false)
  expect(reminders.list()).toEqual([])
})

// A real lookup table, so a test can count the rows a webhook leaves behind.
function authDb(db: Database, failInserts = false) {
  return {
    prepare: (query: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (failInserts && query.startsWith("insert")) throw new Error("d1 unavailable")
          db.query(query).run(...(args as never[]))
        },
      }),
    }),
  }
}

function timedRoutines(failInserts = false) {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE chats (room_id TEXT PRIMARY KEY)")
  sql.exec("INSERT INTO chats (room_id) VALUES (?)", ROOM)
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as Alarms
  const reminders = new Reminders(sql, alarms, async () => {}, () => Date.now())
  const db = new Database(":memory:")
  db.exec('CREATE TABLE "hooks" (token_hash TEXT PRIMARY KEY, user_id TEXT, routine_id TEXT, created_at INTEGER)')
  const AUTH_DB = authDb(db, failInserts)
  const wiring = new RoutineWiring({ env: { AUTH_DB } as unknown as Env, reminders, extensions: {} as never })
  const hookRows = () => db.query('SELECT routine_id FROM "hooks"').all() as { routine_id: string }[]
  const hookHash = (id: string) => (sql.exec<{ hook_hash: string | null }>("SELECT hook_hash FROM reminders WHERE id = ?", id).toArray()[0]?.hook_hash ?? null)
  return { sql, reminders, wiring, db, hookRows, hookHash }
}

const timed = { on: "time" as const, at: "2030-01-01T09:00:00Z" }

test("a routine that becomes a webhook is unchanged when its lookup row cannot be stored", async () => {
  const t = timedRoutines(true)
  const made = await t.wiring.createRoutine("u", { name: "hook", instructions: "say hi", trigger: timed, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  if (!made.ok) throw new Error(made.error)
  const before = t.reminders.get(made.routine.id)
  const out = await t.wiring.updateRoutine(made.routine.id, { trigger: { on: "webhook" } })
  expect(out.ok).toBe(false)
  expect(t.reminders.get(made.routine.id)).toEqual(before)
  expect(t.hookHash(made.routine.id)).toBeNull()
  expect(t.hookRows()).toEqual([])
})

test("a routine that becomes a webhook leaves exactly one lookup row, even after an earlier stale one", async () => {
  const t = timedRoutines()
  const made = await t.wiring.createRoutine("u", { name: "hook", instructions: "say hi", trigger: timed, tz: "UTC", roomId: ROOM, target: "yuki", createdBy: "human" })
  if (!made.ok) throw new Error(made.error)
  t.db.query('INSERT INTO "hooks" (token_hash, user_id, routine_id, created_at) VALUES (?, ?, ?, ?)').run("stale", "u", made.routine.id, 1)
  const out = await t.wiring.updateRoutine(made.routine.id, { trigger: { on: "webhook" } })
  if (!out.ok) throw new Error(out.error)
  expect(t.hookRows()).toEqual([{ routine_id: made.routine.id }])
  expect(t.db.query('SELECT token_hash FROM "hooks"').all()).toEqual([{ token_hash: await sha256Hex(out.token!) }])
})

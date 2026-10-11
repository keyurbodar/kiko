import { expect, test } from "bun:test"
import type { RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import type { Env } from "../src/index"
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

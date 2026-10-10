import { expect, test } from "bun:test"
import { Loops } from "@yuki/memory/loops"
import { InitiativeEngine, type WakeInput } from "../src/initiative/engine"
import { slotOf } from "../src/initiative/attention/rhythm"
import type { WakeResult } from "../src/room/wake"
import { sqlStorage } from "./sql-shim"

// Section 26.6: a wake whose result never came back must not block nudges, and a batch the bus
// delivers twice must not count twice.

function world(answer: WakeResult = "delivered") {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
  const loops = new Loops(sql, (fn) => fn())
  const wakes: WakeInput[] = []
  const engine = new InitiativeEngine({
    sql,
    loops,
    tz: () => "UTC",
    level: () => "digest",
    away: () => false,
    budget: () => 5,
    title: (id) => (id === "r1" ? "Taxes" : null),
    home: () => null,
    routines: () => [],
    judge: () => null,
    wake: async (_room, input) => {
      wakes.push(input)
      return answer
    },
    count: () => {},
    setWakeup: async () => {},
    clearWakeup: async () => {},
  })
  return { sql, loops, engine, wakes }
}

test("a wake the room calls a duplicate with no result on its way moves the item on, so the next nudge is a new wake", async () => {
  const { sql, engine, wakes } = world("duplicate")
  const old = Date.now() - 30 * 86_400_000
  sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?)", "r1", JSON.stringify({ open: 1, oldest: [{ id: "t1", title: "file the tax return", status: "doing", owner: "ada", updatedAt: old }] }))
  engine.devRhythm("now")
  await engine.pass()
  expect(wakes.length).toBe(1)
  engine.devAge(30 * 86_400_000)
  engine.devRhythm("now")
  await engine.pass()
  expect(wakes.length).toBe(2)
  expect(wakes[1]!.id).not.toBe(wakes[0]!.id)
})

test("a burst the bus delivers twice touches a loop once", async () => {
  const { loops, engine } = world()
  const opened = loops.open({ kind: "intention", owner: "human", source: "tool", certainty: "explicit", text: "file the tax return", room: "r1" })
  if (!opened.ok) throw new Error("open failed")
  const before = loops.get(opened.id)!.mentions
  const batch = { roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "burst" as const, roomId: "r1", at: Date.now(), tainted: false, seq: 7, text: "the tax return is due soon", by: { kind: "human" as const } }] }
  await engine.signals(batch)
  await engine.signals(batch)
  expect(loops.get(opened.id)!.mentions).toBe(before + 1)
})

test("a time zone the runtime does not know reads as UTC instead of throwing", () => {
  const at = Date.UTC(2026, 9, 10, 13)
  expect(slotOf(at, "Not/AZone")).toBe(slotOf(at, "UTC"))
})

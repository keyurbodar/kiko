import { expect, test } from "bun:test"
import { Loops } from "@yuki/memory/loops"
import { INITIATIVE_RUN, InitiativeEngine, REMINDER_RUN, type WakeInput } from "../src/initiative/engine"
import { slotOf } from "../src/initiative/attention/rhythm"
import type { SignalBatch } from "../src/room/signals"
import type { WakeResult } from "../src/room/wake"
import { sqlStorage } from "./sql-shim"

function world(answer: WakeResult = "delivered") {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, status TEXT NOT NULL, last_fired INTEGER)")
  const loops = new Loops(sql, (fn) => fn())
  const wakes: WakeInput[] = []
  const counts: Record<string, number> = {}
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
    judged: () => false,
    wake: async (_room, input) => {
      wakes.push(input)
      return answer
    },
    count: (delta) => {
      for (const [k, n] of Object.entries(delta)) counts[k] = (counts[k] ?? 0) + n
    },
    setWakeup: async () => {},
    clearWakeup: async () => {},
  })
  return { sql, loops, engine, wakes, counts }
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
  const batch = { roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "burst" as const, roomId: "r1", at: Date.now(), seq: 7, text: "the tax return is due soon", by: { kind: "human" as const } }] }
  await engine.signals(batch)
  await engine.signals(batch)
  expect(loops.get(opened.id)!.mentions).toBe(before + 1)
})

test("a time zone the runtime does not know reads as UTC instead of throwing", () => {
  const at = Date.UTC(2026, 9, 10, 13)
  expect(slotOf(at, "Not/AZone")).toBe(slotOf(at, "UTC"))
})

test("a promise whose reminder just fired is not nudged until that run reports, and a run that posted keeps it", async () => {
  const { sql, loops, engine, wakes } = world()
  const opened = loops.open({ kind: "commitment", owner: "ada", source: "tool", certainty: "explicit", text: "bring the passport checklist", room: "r1", due: new Date(Date.now() - 3_600_000).toISOString() })
  if (!opened.ok) throw new Error("open failed")
  engine.link("rem1", opened.id)
  sql.exec("INSERT INTO reminders (id, status, last_fired) VALUES ('rem1', 'done', ?)", Date.now())
  engine.devAge(86_400_000)
  engine.devRhythm("now")
  await engine.pass()
  expect(wakes.length).toBe(0)
  const result = (outcome: "ok" | "quiet") => ({ roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "routine_result" as const, roomId: "r1", at: Date.now(), routineId: REMINDER_RUN, occurrence: "rem1", outcome, seq: null }] })
  await engine.signals(result("quiet"))
  expect(loops.get(opened.id)!.status).toBe("open")
  await engine.pass()
  expect(wakes.length).toBe(1)

  const kept = loops.open({ kind: "commitment", owner: "ada", source: "tool", certainty: "explicit", text: "send the dentist list", room: "r1" })
  if (!kept.ok) throw new Error("open failed")
  engine.link("rem2", kept.id)
  sql.exec("INSERT INTO reminders (id, status, last_fired) VALUES ('rem2', 'done', ?)", Date.now())
  await engine.signals({ ...result("ok"), signals: [{ ...result("ok").signals[0]!, occurrence: "rem2" }] })
  expect(loops.get(kept.id)!.status).toBe("done")
})

test("a human who chats about other things after a nudge did not engage with it; a reply quoting it did", async () => {
  const outcome = async (answers?: number) => {
    const { sql, engine, wakes, counts } = world()
    // 13:14 is a minute the old deadline got wrong: its last step ran past the active hour and the window closed an hour out.
    const now = Date.UTC(2026, 9, 10, 13, 14)
    sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?)", "r1", JSON.stringify({ open: 1, oldest: [{ id: "t1", title: "file the tax return", status: "doing", owner: "ada", updatedAt: now - 30 * 86_400_000 }] }))
    engine.devRhythm("now", now)
    await engine.pass(now)
    const wake = wakes[0]
    if (!wake) throw new Error("no nudge")
    const batch = (signals: SignalBatch["signals"]) => ({ roomId: "r1", openedAt: now, more: 0, signals })
    await engine.signals(batch([{ kind: "routine_result", roomId: "r1", at: now, routineId: INITIATIVE_RUN, occurrence: wake.id, outcome: "ok", seq: 10, text: "the tax return task is stuck. want me to push it?" }]), now)
    const at = now + 3_600_000
    await engine.signals(batch([{ kind: "burst", roomId: "r1", at, seq: 11, text: "what should I cook tonight", by: { kind: "human" } }]), at)
    await engine.signals(batch([{ kind: "burst", roomId: "r1", at: at + 60_000, seq: 12, text: "yes please", by: { kind: "human" }, ...(answers === undefined ? {} : { answers }) }]), at + 60_000)
    await engine.pass(now + 7 * 86_400_000)
    return { engaged: counts.initiative_engaged ?? 0, ignored: counts.initiative_ignored ?? 0 }
  }
  expect(await outcome()).toEqual({ engaged: 0, ignored: 1 })
  expect(await outcome(10)).toEqual({ engaged: 1, ignored: 0 })
})

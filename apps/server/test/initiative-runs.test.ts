import { expect, test } from "bun:test"
import { Loops } from "@kiko/memory/loops"
import { INITIATIVE_RUN, InitiativeEngine, type Level, REMINDER_RUN, type WakeInput } from "../src/initiative/engine"
import type { WakeResult } from "../src/room/wake"
import { sqlWith } from "./sql-shim"
import { USER_STEPS } from "../src/user/schema"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 16, 13)
const base = { kind: "intention" as const, owner: "human", source: "tool" as const }

function world(opts: { level?: Level } = {}) {
  const sql = sqlWith(USER_STEPS)
  const loops = new Loops(sql, (fn) => fn())
  const wakes: { room: string; input: WakeInput }[] = []
  const armed: (number | null)[] = []
  const counts: Record<string, number> = {}
  let answer: WakeResult | "busy" = "delivered"
  const engine = new InitiativeEngine({
    sql,
    loops,
    tz: () => "UTC",
    level: () => opts.level ?? "digest",
    title: (id) => (id === "r1" ? "Taxes" : id === "r2" ? "Other" : null),
    home: () => "kiko",
    wake: async (room, input) => {
      wakes.push({ room, input })
      return answer
    },
    count: (delta) => {
      for (const [k, n] of Object.entries(delta)) counts[k] = (counts[k] ?? 0) + n
    },
    setWakeup: async (at) => void armed.push(at),
    clearWakeup: async () => void armed.push(null),
  })
  const open = (text: string, due: string | undefined, room = "r1", extra: Record<string, unknown> = {}) => {
    const out = loops.open({ ...base, text, room, at: NOW - 5 * DAY, ...(due ? { due } : {}), ...extra })
    if (!out.ok) throw new Error("open failed")
    return out.id
  }
  return { sql, loops, engine, wakes, armed, counts, open, answer: (a: WakeResult | "busy") => void (answer = a) }
}

test("the daily pass wakes the chat's lead about the oldest loop that is due, and no other", async () => {
  const { engine, wakes, open } = world()
  open("send the tax summary", "2026-10-10")
  const oldest = open("file the tax return", "2026-10-01", "r2")
  open("renew the passport", "2026-12-01")
  open("learn the cello", undefined)
  const report = await engine.pass(NOW)
  expect(wakes.length).toBe(1)
  expect(wakes[0]!.room).toBe("r2")
  expect(wakes[0]!.input.to).toBeNull()
  expect(wakes[0]!.input.body).toContain(`L${oldest}`)
  expect(report.woke.map((w) => w.result)).toEqual(["delivered"])
})

test("a loop with no chat goes to the Kiko chat, and one in a private or deleted chat is skipped", async () => {
  const { engine, wakes, open } = world()
  open("call the bank", "2026-10-01", "r9")
  open("book the dentist", "2026-10-05", "")
  await engine.pass(NOW)
  expect(wakes.map((w) => w.room)).toEqual(["kiko"])
})

test("a wake that is busy, gone or refused is tried again in an hour, not a day", async () => {
  for (const result of ["busy", "gone", "refused"] as const) {
    const { engine, wakes, armed, answer, open } = world()
    open("file the tax return", "2026-10-01")
    answer(result)
    const first = await engine.pass(NOW)
    expect(first.retryAt).toBe(NOW + HOUR)
    expect(armed.at(-1)).toBe(NOW + HOUR)
    expect(await engine.arm(NOW + 1_000)).toBe(NOW + HOUR)
    answer("delivered")
    await engine.pass(NOW + HOUR)
    expect(wakes.length).toBe(2)
    expect(wakes[1]!.input.id).toBe(wakes[0]!.input.id)
    expect(armed.at(-1)! - (NOW + HOUR)).toBeGreaterThan(HOUR)
  }
})

test("a loop nudged in the last three days waits, and the next oldest goes first", async () => {
  const { engine, wakes, open } = world()
  const a = open("file the tax return", "2026-10-01")
  const b = open("send the tax summary", "2026-10-05")
  await engine.pass(NOW)
  await engine.pass(NOW + DAY)
  await engine.pass(NOW + 2 * DAY)
  await engine.pass(NOW + 3 * DAY + HOUR)
  expect(wakes.map((w) => w.input.body.match(/L(\d+)/)?.[1])).toEqual([String(a), String(b), String(a)])
})

test("the daily pass runs at nine in the owner's time zone", async () => {
  const { engine, armed } = world()
  expect(await engine.arm(Date.UTC(2026, 9, 16, 10))).toBe(Date.UTC(2026, 9, 17, 9))
  expect(armed.at(-1)).toBe(Date.UTC(2026, 9, 17, 9))
})

test("levels off and chat never wake a chat and arm no pass", async () => {
  for (const level of ["off", "chat"] as const) {
    const { engine, wakes, armed, open } = world({ level })
    open("file the tax return", "2026-10-01")
    await engine.pass(NOW)
    expect(wakes.length).toBe(0)
    expect(armed.at(-1)).toBeNull()
  }
})

test("a promise is raised with the agent that made it, and that agent speaking keeps it", async () => {
  const { loops, engine, wakes, open } = world()
  const promise = open("send the passport checklist", "2026-10-10", "r1", { owner: "ada", kind: "commitment" })
  await engine.pass(NOW)
  expect(wakes[0]!.input.to).toBe("ada")
  const result = (occurrence: string, outcome: "ok" | "quiet") => ({ roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "routine_result" as const, roomId: "r1", at: NOW, routineId: INITIATIVE_RUN, occurrence, outcome, seq: null }] })
  engine.results(result(wakes[0]!.input.id, "quiet"))
  expect(loops.get(promise)!.status).toBe("open")
  engine.results(result(wakes[0]!.input.id, "ok"))
  expect(loops.get(promise)!.status).toBe("done")
})

test("a nudge to the lead about the human's own loop leaves that loop open", async () => {
  const { loops, engine, wakes, open } = world()
  const plan = open("file the tax return", "2026-10-01")
  await engine.pass(NOW)
  engine.results({ roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "routine_result", roomId: "r1", at: NOW, routineId: INITIATIVE_RUN, occurrence: wakes[0]!.input.id, outcome: "ok", seq: 3 }] })
  expect(loops.get(plan)!.status).toBe("open")
})

test("a plan with no date that nobody mentioned for a month closes in the pass", async () => {
  const { loops, engine, wakes, counts, open } = world()
  const stale = open("learn the cello", undefined, "r1", { at: NOW - 40 * DAY })
  const dated = open("file the tax return", "2026-10-20", "r1", { at: NOW - 40 * DAY })
  const report = await engine.pass(NOW)
  expect(report.expired).toBe(1)
  expect(counts.loops_closed).toBe(1)
  expect(loops.get(stale)!.status).toBe("dropped")
  expect(loops.get(dated)!.status).toBe("open")
  expect(wakes.length).toBe(0)
})

test("a promise whose reminder just fired is not nudged until that run reports, and a run that posted keeps it", async () => {
  const { sql, loops, engine, wakes } = world()
  const opened = loops.open({ kind: "commitment", owner: "ada", source: "tool", text: "bring the passport checklist", room: "r1", due: new Date(NOW - HOUR).toISOString() })
  if (!opened.ok) throw new Error("open failed")
  engine.link("rem1", opened.id)
  sql.exec("INSERT INTO reminders (id, text, due_utc, tz, room_id, target, created_by, status, last_fired, created_at) VALUES ('rem1', 'taxes', 0, 'UTC', 'r1', 'kiko', 'human', 'done', ?, 0)", NOW)
  await engine.pass(NOW + 1_000)
  expect(wakes.length).toBe(0)
  const result = (occurrence: string, outcome: "ok" | "quiet") => ({ roomId: "r1", openedAt: 1, more: 0, signals: [{ kind: "routine_result" as const, roomId: "r1", at: NOW, routineId: REMINDER_RUN, occurrence, outcome, seq: null }] })
  engine.results(result("rem1", "quiet"))
  expect(loops.get(opened.id)!.status).toBe("open")
  await engine.pass(NOW + 2_000)
  expect(wakes.length).toBe(1)

  const kept = loops.open({ kind: "commitment", owner: "ada", source: "tool", text: "send the dentist list", room: "r1" })
  if (!kept.ok) throw new Error("open failed")
  engine.link("rem2", kept.id)
  engine.results(result("rem2", "ok"))
  expect(loops.get(kept.id)!.status).toBe("done")
})

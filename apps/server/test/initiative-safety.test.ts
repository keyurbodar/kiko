import { expect, test } from "bun:test"
import { Life } from "@yuki/memory/life"
import { Loops } from "@yuki/memory/loops"
import { INITIATIVE_RUN, InitiativeEngine, type WakeInput } from "../src/initiative/engine"
import { Initiative } from "../src/initiative/initiative"
import type { Level } from "../src/initiative/attention/types"
import { sqlStorage } from "./sql-shim"

const base = { kind: "intention" as const, owner: "human", source: "tool" as const }

function world(opts: { level?: Level; titles?: Record<string, string | null>; judged?: boolean } = {}) {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, status TEXT NOT NULL, last_fired INTEGER)")
  const settings = new Map<string, string>()
  const loops = new Loops(sql, (fn) => fn())
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  const titles: Record<string, string | null> = { r1: "Taxes", r2: "Other", ...opts.titles }
  const title = (id: string) => titles[id] ?? null
  let level: Level = opts.level ?? "digest"
  const wakes: WakeInput[] = []
  const engine = new InitiativeEngine({
    sql,
    loops,
    tz: () => "UTC",
    level: () => level,
    away: () => false,
    budget: () => 5,
    title,
    home: () => null,
    routines: () => [],
    judge: () => (opts.judged ? ((async () => ({})) as never) : null),
    judged: () => opts.judged === true,
    wake: async (_room, input) => {
      wakes.push(input)
      return "delivered"
    },
    count: () => {},
    setWakeup: async () => {},
    clearWakeup: async () => {},
  })
  const initiative = new Initiative({
    loops,
    life,
    judge: () => null,
    title,
    off: () => level === "off",
    count: () => {},
    close: (id, status, at, room) => loops.close(id, status, at, room),
    noticed: (roomId, skip) => engine.noticed(roomId, skip),
    nudges: (roomId) => engine.nudges(roomId),
    answered: (roomId, loop, messageId, at) => engine.answered(roomId, loop, messageId, at),
  })
  return { sql, loops, life, engine, initiative, wakes, setLevel: (l: Level) => void (level = l) }
}

const burst = (text: string) => ({ text })

test("related lines skip loops of a private or deleted chat", async () => {
  const { loops, initiative } = world({ titles: { r3: null } })
  loops.open({ ...base, certainty: "explicit", text: "book the dentist appointment soon", room: "r3" })
  loops.open({ ...base, certainty: "explicit", text: "book the dentist appointment checkup", room: "r2" })
  const view = await initiative.brief("r1", "ada", burst("I need to book the dentist appointment"))
  expect(view.related.length).toBe(1)
  expect(view.related[0]).toContain("checkup")
})

test("initiative off gives a run no lines at all", async () => {
  const { loops, initiative } = world({ level: "off" })
  loops.open({ ...base, owner: "ada", kind: "commitment", certainty: "explicit", text: "send the tax summary", room: "r1" })
  loops.open({ ...base, certainty: "explicit", text: "file the tax return by sunday", room: "r1" })
  loops.open({ ...base, certainty: "explicit", text: "the tax return needs the receipts", room: "r2" })
  expect(await initiative.brief("r1", "ada", burst("tax return receipts"))).toEqual({ owe: [], related: [], noticed: [] })
})

test("on their plate leaves out tentative loops, and rests a loop once shown", async () => {
  const { loops, initiative } = world()
  loops.open({ ...base, certainty: "tentative", text: "maybe learn the cello", room: "r1" })
  loops.open({ ...base, certainty: "explicit", text: "submit the grant report", room: "r1" })
  const first = await initiative.brief("r1", "ada", burst("hello"))
  expect(first.noticed.length).toBe(1)
  expect(first.noticed[0]).toContain("grant report")
  expect((await initiative.brief("r1", "ada", burst("hello again"))).noticed).toEqual([])
})

test("an agent closes only loops of its own chat", () => {
  const { loops } = world()
  const mine = loops.open({ ...base, certainty: "explicit", text: "call the plumber", room: "r1" })
  const theirs = loops.open({ ...base, certainty: "explicit", text: "call the bank", room: "r2" })
  if (!mine.ok || !theirs.ok) throw new Error("open failed")
  expect(loops.close(theirs.id, "done", Date.now(), "r1")).toBe(false)
  expect(loops.get(theirs.id)?.status).toBe("open")
  expect(loops.close(mine.id, "done", Date.now(), "r1")).toBe(true)
})

test("a private or deleted chat forgets its loops, and a forgotten turn forgets its summary loops", () => {
  const { loops } = world()
  loops.open({ ...base, certainty: "explicit", text: "call the plumber", room: "r1" })
  loops.open({ ...base, certainty: "explicit", text: "call the bank", room: "r2" })
  loops.open({ ...base, source: "nap", certainty: "explicit", text: "renew the lease", room: "r2", ref: "room:r2:turns:0-16" })
  expect(loops.forgetRoom("r1")).toBe(1)
  expect(loops.list().map((l) => l.room)).toEqual(["r2", "r2"])
  expect(loops.similar("plumber")).toEqual([])
  expect(loops.forgetTurn("r2", 20)).toBe(0)
  expect(loops.forgetTurn("r2", 3)).toBe(1)
  expect(loops.list().map((l) => l.text)).toEqual(["call the bank"])
})

test("a snooze must end after now and within a year", () => {
  const { loops } = world()
  const out = loops.open({ ...base, certainty: "explicit", text: "call the plumber" })
  if (!out.ok) throw new Error("open failed")
  const now = Date.now()
  expect(loops.snooze(out.id, now - 1, now)).toBe(false)
  expect(loops.snooze(out.id, now + 400 * 86_400_000, now)).toBe(false)
  expect(loops.snooze(out.id, now + 86_400_000, now)).toBe(true)
})

test("a burst closes a human's plan from any chat but an agent's promise only from its own", async () => {
  const { loops, initiative } = world()
  const plan = loops.open({ ...base, certainty: "explicit", text: "call the bank about the loan", room: "r2" })
  const promise = loops.open({ ...base, owner: "ada", kind: "commitment", certainty: "explicit", text: "send the bank statement", room: "r2" })
  if (!plan.ok || !promise.ok) throw new Error("open failed")
  const done = (async (_state: unknown, questions: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(questions).map((k) => [k, k.includes("_l") ? { type: "choice", choice: "done", confidence: 0.9, probabilities: { done: 0.9 } } : { type: "bool", probability: 0.1 }]))) as never
  const heard = new Initiative({ loops, life: new Life(world().sql, (fn) => fn(), { get: () => null, set: () => {} }), judge: () => done, title: () => "Taxes", off: () => false, count: () => {}, close: (id, status, at, room) => loops.close(id, status, at, room), noticed: () => [], nudges: () => [], answered: () => {} })
  await heard.heard("r1", [{ messageId: "m1", text: "I called the bank about the loan and sent the bank statement.", at: Date.now() }])
  expect(loops.get(plan.id)?.status).toBe("done")
  expect(loops.get(promise.id)?.status).toBe("open")
})

test("a pass prunes marks, briefs and wakes older than 90 days and keeps recent ones", async () => {
  const { sql, engine } = world()
  const now = Date.now()
  const old = now - 100 * 86_400_000
  sql.exec("INSERT INTO initiative_marks (id, surfaced, ignored, skipped, last_at) VALUES ('loop:1', 1, 9, 0, ?), ('loop:2', 1, 0, 0, ?)", old, now - 1000)
  sql.exec("INSERT INTO initiative_briefed (loop_id, at) VALUES (1, ?), (2, ?)", old, now - 1000)
  sql.exec("INSERT INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES ('w1', 'r1', 'ada', 'intention', '[]', ?, 'spoke'), ('w2', 'r1', 'ada', 'intention', '[]', ?, 'pending'), ('w3', 'r1', 'ada', 'intention', '[]', ?, 'spoke')", old, old, now - 1000)
  await engine.pass(now)
  const ids = (table: string, col: string) => sql.exec<Record<string, string | number>>(`SELECT ${col} FROM ${table} ORDER BY ${col}`).toArray().map((r) => r[col])
  expect(ids("initiative_marks", "id")).toEqual(["loop:2"])
  expect(ids("initiative_briefed", "loop_id")).toEqual([2])
  expect(ids("initiative_wakes", "id")).toEqual(["w2", "w3"])
})

test("with a judge key, Jev alone decides whether a burst answers a nudge; without one, two shared words do", async () => {
  const ignoredOf = async (judged: boolean) => {
    const { sql, loops, engine } = world({ judged })
    const plan = loops.open({ ...base, certainty: "explicit", text: "call the plumber about the leak", room: "r1" })
    if (!plan.ok) throw new Error("open failed")
    const now = Date.now()
    sql.exec("INSERT INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES ('w1', 'r1', 'ada', 'intention', ?, ?, 'pending')", JSON.stringify([`loop:${plan.id}`]), now)
    await engine.signals({ roomId: "r1", openedAt: now, more: 0, signals: [{ kind: "routine_result", roomId: "r1", at: now, routineId: INITIATIVE_RUN, occurrence: "w1", outcome: "ok", seq: 5, text: "did you call the plumber?" }] }, now)
    await engine.signals({ roomId: "r1", openedAt: now + 60_000, more: 0, signals: [{ kind: "burst", roomId: "r1", at: now + 60_000, seq: 6, text: "the plumber is booked for the leak", by: { kind: "human" } }] }, now + 60_000)
    await engine.pass(now + 2 * 86_400_000)
    return engine.devState().marks.find((m) => m.id === `loop:${plan.id}`)?.ignored ?? 0
  }
  expect(await ignoredOf(true)).toBe(1)
  expect(await ignoredOf(false)).toBe(0)
})

test("Jev records a nudge as engaged only when it judges the human's words answer it", async () => {
  const engaged = async (answers: boolean) => {
    const { sql, life, engine, loops } = world()
    const now = Date.now()
    sql.exec("INSERT INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES ('w1', 'r1', 'ada', 'intention', '[\"loop:1\"]', ?, 'pending')", now)
    await engine.signals({ roomId: "r1", openedAt: now, more: 0, signals: [{ kind: "routine_result", roomId: "r1", at: now, routineId: INITIATIVE_RUN, occurrence: "w1", outcome: "ok", seq: 5, text: "did you call the plumber?" }] }, now)
    let read: unknown
    const judge = (async (state: { nudges?: string[] }, questions: Record<string, unknown>) => {
      read = state.nudges
      return Object.fromEntries(Object.keys(questions).map((k) => [k, { type: "bool", probability: k === "n0" && answers ? 0.9 : 0.1 }]))
    }) as never
    const jev = new Initiative({ loops, life, judge: () => judge, title: () => "Taxes", off: () => false, count: () => {}, close: () => false, noticed: () => [], nudges: (r) => engine.nudges(r), answered: (r, l, m, at) => engine.answered(r, l, m, at) })
    await jev.heard("r1", [{ messageId: "m6", text: "not yet", at: now + 60_000 }])
    expect(read).toEqual(["did you call the plumber?"])
    return engine.devState().appetite.pending[0]?.engaged
  }
  expect(await engaged(false)).toBeUndefined()
  expect(typeof (await engaged(true))).toBe("number")
})

import { expect, test } from "bun:test"
import { Life } from "@kiko/memory/life"
import { Loops } from "@kiko/memory/loops"
import { InitiativeEngine, type Level } from "../src/initiative/engine"
import { Initiative } from "../src/initiative/initiative"
import { sqlWith } from "./sql-shim"
import { USER_STEPS } from "../src/user/schema"

const base = { kind: "intention" as const, owner: "human", source: "tool" as const }

function world(opts: { level?: Level; titles?: Record<string, string | null> } = {}) {
  const sql = sqlWith(USER_STEPS)
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, status TEXT NOT NULL, last_fired INTEGER)")
  const settings = new Map<string, string>()
  const loops = new Loops(sql, (fn) => fn())
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  const titles: Record<string, string | null> = { r1: "Taxes", r2: "Other", ...opts.titles }
  const title = (id: string) => titles[id] ?? null
  let level: Level = opts.level ?? "digest"
  const engine = new InitiativeEngine({
    sql,
    loops,
    tz: () => "UTC",
    level: () => level,
    title,
    home: () => null,
    wake: async () => "delivered",
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
  })
  return { sql, loops, life, engine, initiative, setLevel: (l: Level) => void (level = l) }
}

const burst = (text: string) => ({ text })

test("related lines skip loops of a private or deleted chat", async () => {
  const { loops, initiative } = world({ titles: { r3: null } })
  loops.open({ ...base, text: "book the dentist appointment soon", room: "r3" })
  loops.open({ ...base, text: "book the dentist appointment checkup", room: "r2" })
  const view = await initiative.brief("r1", "ada", burst("I need to book the dentist appointment"))
  expect(view.related.length).toBe(1)
  expect(view.related[0]).toContain("checkup")
})

test("initiative off gives a run no lines at all", async () => {
  const { loops, initiative } = world({ level: "off" })
  loops.open({ ...base, owner: "ada", kind: "commitment", text: "send the tax summary", room: "r1" })
  loops.open({ ...base, text: "file the tax return by sunday", room: "r1" })
  loops.open({ ...base, text: "the tax return needs the receipts", room: "r2" })
  expect(await initiative.brief("r1", "ada", burst("tax return receipts"))).toEqual({ owe: [], related: [], noticed: [], noticedIds: [] })
})

test("on their plate lists the human's plans of this chat, due ones first, and rests a loop only once it is marked shown", async () => {
  const { loops, engine, initiative } = world()
  loops.open({ ...base, text: "learn the cello", room: "r1" })
  loops.open({ ...base, text: "submit the grant report", room: "r1", due: "2026-10-20" })
  loops.open({ ...base, text: "call the plumber", room: "r2" })
  const first = await initiative.brief("r1", "ada", burst("hello"))
  expect(first.noticed.length).toBe(2)
  expect(first.noticed[0]).toContain("grant report")
  expect((await initiative.brief("r1", "ada", burst("hello again"))).noticed.length).toBe(2)
  engine.briefed(first.noticedIds)
  expect((await initiative.brief("r1", "ada", burst("hello again"))).noticed).toEqual([])
  expect((await initiative.brief("r1", "ada", burst("later"))).noticedIds).toEqual([])
  engine.briefed(first.noticedIds, Date.now() - 2 * 86_400_000)
  expect((await initiative.brief("r1", "ada", burst("tomorrow"))).noticed.length).toBe(2)
})

test("an agent closes only loops of its own chat", () => {
  const { loops } = world()
  const mine = loops.open({ ...base, text: "call the plumber", room: "r1" })
  const theirs = loops.open({ ...base, text: "call the bank", room: "r2" })
  if (!mine.ok || !theirs.ok) throw new Error("open failed")
  expect(loops.close(theirs.id, "done", Date.now(), "r1")).toBe(false)
  expect(loops.get(theirs.id)?.status).toBe("open")
  expect(loops.close(mine.id, "done", Date.now(), "r1")).toBe(true)
})

test("a private or deleted chat forgets its loops, and a forgotten turn forgets its summary loops", () => {
  const { loops } = world()
  loops.open({ ...base, text: "call the plumber", room: "r1" })
  loops.open({ ...base, text: "call the bank", room: "r2" })
  loops.open({ ...base, source: "jev", text: "renew the lease", room: "r2", ref: "room:r2:turns:0-16" })
  expect(loops.forgetRoom("r1")).toBe(1)
  expect(loops.list().map((l) => l.room)).toEqual(["r2", "r2"])
  expect(loops.similar("plumber")).toEqual([])
  expect(loops.forgetTurn("r2", 20)).toBe(0)
  expect(loops.forgetTurn("r2", 3)).toBe(1)
  expect(loops.list().map((l) => l.text)).toEqual(["call the bank"])
})

test("a snooze must end after now and within a year", () => {
  const { loops } = world()
  const out = loops.open({ ...base, text: "call the plumber" })
  if (!out.ok) throw new Error("open failed")
  const now = Date.now()
  expect(loops.snooze(out.id, now - 1, now)).toBe(false)
  expect(loops.snooze(out.id, now + 400 * 86_400_000, now)).toBe(false)
  expect(loops.snooze(out.id, now + 86_400_000, now)).toBe(true)
})

test("a burst closes a human's plan from any chat but an agent's promise only from its own", async () => {
  const { loops, initiative } = world()
  const plan = loops.open({ ...base, text: "call the bank about the loan", room: "r2" })
  const promise = loops.open({ ...base, owner: "ada", kind: "commitment", text: "send the bank statement", room: "r2" })
  if (!plan.ok || !promise.ok) throw new Error("open failed")
  const done = (async (_state: unknown, questions: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(questions).map((k) => [k, k.includes("_l") ? { type: "choice", choice: "done", confidence: 0.9, probabilities: { done: 0.9 } } : { type: "bool", probability: 0.1 }]))) as never
  const heard = new Initiative({ loops, life: new Life(world().sql, (fn) => fn(), { get: () => null, set: () => {} }), judge: () => done, title: () => "Taxes", off: () => false, count: () => {}, close: (id, status, at, room) => loops.close(id, status, at, room), noticed: () => [] })
  await heard.heard("r1", [{ messageId: "m1", text: "I called the bank about the loan and sent the bank statement.", at: Date.now() }])
  expect(loops.get(plan.id)?.status).toBe("done")
  expect(loops.get(promise.id)?.status).toBe("open")
})

test("a pass prunes briefs and wakes older than 90 days and keeps recent ones", async () => {
  const { sql, engine } = world()
  const now = Date.now()
  const old = now - 100 * 86_400_000
  sql.exec("INSERT INTO initiative_briefed (loop_id, at) VALUES (1, ?), (2, ?)", old, now - 1000)
  sql.exec("INSERT INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES ('w1', 'r1', 'ada', 'intention', 'loop:1', ?, 'sent'), ('w2', 'r1', 'ada', 'intention', 'loop:2', ?, 'sent')", old, now - 1000)
  await engine.pass(now)
  const ids = (table: string, col: string) => sql.exec<Record<string, string | number>>(`SELECT ${col} FROM ${table} ORDER BY ${col}`).toArray().map((r) => r[col])
  expect(ids("initiative_briefed", "loop_id")).toEqual([2])
  expect(ids("initiative_wakes", "id")).toEqual(["w2"])
})

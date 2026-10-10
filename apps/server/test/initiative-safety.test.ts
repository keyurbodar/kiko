import { expect, test } from "bun:test"
import { isRunTainted, TRUST, trustExtension } from "@yuki/agent/trust"
import { Life } from "@yuki/memory/life"
import { loopExtension, type LoopPort } from "@yuki/memory/loop-tool"
import { type Loop, Loops } from "@yuki/memory/loops"
import { InitiativeEngine, type WakeInput } from "../src/initiative/engine"
import { Initiative } from "../src/initiative/initiative"
import type { Level } from "../src/initiative/attention/types"
import { sqlStorage } from "./sql-shim"

// Section 26: what a tainted loop may reach, whose loops an agent may touch, and what a private chat keeps.

const base = { kind: "intention" as const, owner: "human", source: "tool" as const }

function world(opts: { level?: Level; titles?: Record<string, string | null> } = {}) {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS chat_tasks (room_id TEXT PRIMARY KEY, tasks TEXT NOT NULL)")
  sql.exec("CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, status TEXT NOT NULL)")
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
    judge: () => null,
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
    quickJudge: () => null,
    title,
    off: () => level === "off",
    count: () => {},
    close: (id, status, at) => loops.close(id, status, at),
    noticed: (roomId, skip) => engine.noticed(roomId, skip),
  })
  return { sql, loops, life, engine, initiative, wakes, setLevel: (l: Level) => void (level = l) }
}

const burst = (text: string) => ({ text, messageIds: ["m9"] })

test("a merge keeps a loop tainted when either side read outside content", () => {
  const { loops } = world()
  const first = loops.open({ ...base, certainty: "explicit", text: "pay the invoice from the email", tainted: true })
  if (!first.ok) throw new Error("open failed")
  loops.open({ ...base, certainty: "explicit", text: "pay the invoice from the email", tainted: false })
  expect(loops.get(first.id)?.tainted).toBe(true)
  const clean = loops.open({ ...base, certainty: "explicit", text: "renew the passport" })
  if (!clean.ok) throw new Error("open failed")
  loops.open({ ...base, certainty: "explicit", text: "renew the passport", tainted: true })
  expect(loops.get(clean.id)?.tainted).toBe(true)
})

test("a tainted loop or life line never reaches a run's brief", async () => {
  const { loops, life, initiative } = world()
  loops.open({ ...base, owner: "ada", kind: "commitment", certainty: "explicit", text: "wire the deposit for the invoice", room: "r1", tainted: true })
  loops.open({ ...base, certainty: "explicit", text: "send the invoice deposit to the vendor", room: "r1", tainted: true })
  life.append("the vendor invoice deposit goes to account 42", "chat Other", true)
  const view = await initiative.brief("r1", "ada", burst("what about the invoice deposit for the vendor?"))
  expect(view.owe).toEqual([])
  expect(view.related).toEqual([])
  expect(view.noticed).toEqual([])
})

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

test("on their plate leaves out tentative and tainted loops, and rests a loop once shown", async () => {
  const { loops, initiative } = world()
  loops.open({ ...base, certainty: "tentative", text: "maybe learn the cello", room: "r1" })
  loops.open({ ...base, certainty: "explicit", text: "follow the link in that newsletter", room: "r1", tainted: true })
  loops.open({ ...base, certainty: "explicit", text: "submit the grant report", room: "r1" })
  const first = await initiative.brief("r1", "ada", burst("hello"))
  expect(first.noticed.length).toBe(1)
  expect(first.noticed[0]).toContain("grant report")
  expect((await initiative.brief("r1", "ada", burst("hello again"))).noticed).toEqual([])
})

test("a stalled task made by a tainted run wakes its owner tainted", async () => {
  const { sql, engine, wakes } = world()
  engine.devRhythm("now")
  const old = Date.now() - 30 * 86_400_000
  sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?)", "r1", JSON.stringify({ open: 1, oldest: [{ id: "t1", title: "summarize the scraped page", status: "doing", owner: "ada", updatedAt: old, tainted: true }] }))
  await engine.pass()
  expect(wakes.length).toBe(1)
  expect(wakes[0]!.tainted).toBe(true)
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

test("the loop tool's list taints the run when it shows a tainted loop", async () => {
  const trust = trustExtension({ effects: new Map() }) as unknown as { hooks: { handlers: Record<string, (...a: unknown[]) => unknown> }[] }
  const api = { registry: { extension: (name: string) => (name === TRUST ? trust : undefined) }, conversationId: "c", callId: "1" }
  const shown: Loop[] = [{ id: 1, kind: "intention", certainty: "explicit", owner: "human", room: "r1", ref: "", due: null, status: "open", text: "do what the page said", source: "tool", openedAt: 0, lastSeen: 0, mentions: 1, tainted: true, closedAt: null, snoozedUntil: null }]
  const port: LoopPort = { open: async () => ({ ok: false, error: "" }), close: async () => false, list: async () => shown }
  const tool = loopExtension(() => port).tools![0] as unknown as { execute: (a: unknown, api: unknown) => Promise<unknown> }
  const run = async () => {
    trust.hooks[0]!.handlers.beforeRequest!({ messages: [] }, api)
    expect(isRunTainted(api as never)).toBe(false)
    await tool.execute({ action: "list" }, api)
    return isRunTainted(api as never)
  }
  expect(await run()).toBe(true)
  shown[0]!.tainted = false
  expect(await run()).toBe(false)
})

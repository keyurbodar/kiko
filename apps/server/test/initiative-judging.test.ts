import { expect, test } from "bun:test"
import { Life } from "@yuki/memory/life"
import type { RoomId } from "@yuki/protocol"
import { INITIATIVE_RUN } from "../src/initiative/engine"
import { InitiativeLoops, type LoopsDeps } from "../src/user/initiative-loops"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

function judgingWith(captures: boolean) {
  const sql = sqlWith(USER_STEPS)
  sql.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const memory = {
    captures: () => captures,
    capturable: () => true,
  }
  const loops = new InitiativeLoops({ sql, memory, transaction: (fn: () => unknown) => fn() } as unknown as LoopsDeps)
  return loops.judging("r1" as RoomId)
}

test("a judge key with capture off leaves Jev out of a chat, so the two-word touch decides engagement", () => {
  expect(judgingWith(false)).toBe(false)
  expect(judgingWith(true)).toBe(true)
})

test("a judge that fails keeps the human's answer to a nudge counted, not ignored", async () => {
  const sql = sqlWith(USER_STEPS)
  sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES ('r1', 'Taxes', 0)")
  const settings = new Map<string, string>()
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  const memory = {
    captures: () => true,
    capturable: () => true,
    judgeFor: () => (async () => null) as never,
    count: () => {},
  }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} }
  const loops = new InitiativeLoops({ sql, memory, life, alarms, transaction: (fn: () => unknown) => fn() } as unknown as LoopsDeps)
  const plan = loops.loops.open({ kind: "intention", owner: "human", source: "tool", certainty: "explicit", text: "call the plumber about the leak", room: "r1" as RoomId })
  if (!plan.ok) throw new Error("open failed")
  const now = Date.now()
  sql.exec("INSERT INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES ('w1', 'r1', 'ada', 'intention', ?, ?, 'pending')", JSON.stringify([`loop:${plan.id}`]), now)
  await loops.engine.signals({ roomId: "r1", openedAt: now, more: 0, signals: [{ kind: "routine_result", roomId: "r1", at: now, routineId: INITIATIVE_RUN, occurrence: "w1", outcome: "ok", seq: 5, text: "did you call the plumber?" }] }, now)
  const reply = { kind: "burst" as const, roomId: "r1", at: now + 60_000, seq: 6, text: "the plumber is booked for the leak", by: { kind: "human" as const } }
  await loops.engine.signals({ roomId: "r1", openedAt: now + 60_000, more: 0, signals: [reply] }, now + 60_000)
  await loops.hear("r1" as RoomId, [{ messageId: "6", text: reply.text, at: reply.at }])
  await loops.now()
  expect(sql.exec("SELECT 1 FROM loop_heard").toArray().length).toBe(1)
  for (let pass = 0; pass < 10 && sql.exec("SELECT 1 FROM loop_heard").toArray().length; pass++) await loops.now()
  expect(loops.engine.devState().appetite.pending[0]?.engaged).toBeTypeOf("number")
})
